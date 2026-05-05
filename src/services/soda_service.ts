/// SODA service proxy for pronunciation analysis.
/// Forwards audio + expected_text to the external analyzer endpoint.
export class SodaService {
  private static normalizeExpectedText(expectedText: string): string {
    const trimmed = expectedText.trim();
    if (!trimmed) return expectedText;

    // Apply only for single alphabet letters so existing word behavior is unchanged.
    if (!/^[A-Za-z]$/.test(trimmed)) {
      return expectedText;
    }

    const letterNames: Record<string, string> = {
      A: 'ay',
      B: 'bee',
      C: 'cee',
      D: 'dee',
      E: 'ee',
      F: 'ef',
      G: 'jee',
      H: 'aitch',
      I: 'eye',
      J: 'jay',
      K: 'kay',
      L: 'el',
      M: 'em',
      N: 'en',
      O: 'oh',
      P: 'pee',
      Q: 'cue',
      R: 'ar',
      S: 'ess',
      T: 'tee',
      U: 'you',
      V: 'vee',
      W: 'double u',
      X: 'ex',
      Y: 'why',
      Z: 'zee',
    };

    return letterNames[trimmed.toUpperCase()] || expectedText;
  }

  private static toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private static normalizeSeverity(payload: Record<string, any>): Record<string, any> {
    const existingSeverity = this.toNumber(payload.severity);
    const severityText = this.toNumber(payload.severity_text);
    const severityPhoneme = this.toNumber(payload.severity_phoneme);

    let normalizedSeverity = existingSeverity;
    if (normalizedSeverity === null) {
      if (severityText !== null) {
        normalizedSeverity = severityText;
      } else if (severityPhoneme !== null) {
        normalizedSeverity = severityPhoneme;
      } else if (payload.is_correct === true) {
        // Preserve old frontend contract for clearly correct utterances.
        normalizedSeverity = 0;
      }
    }

    if (normalizedSeverity === null) {
      return payload;
    }

    return {
      ...payload,
      severity: Math.max(0, Math.min(1, normalizedSeverity)),
    };
  }

  static async analyzeSpeech(
    expectedText: string,
    audioFile?: Express.Multer.File
  ): Promise<Record<string, any>> {
    const configured = process.env.SODA_ANALYZE_URL || 'http://20.197.13.253:5050/analyze';
    const endpoint = configured.endsWith('/analyze')
      ? configured
      : `${configured.replace(/\/+$/, '')}/analyze`;
    const startedAt = Date.now();

    if (!audioFile) {
      throw new Error('Audio file is required for SODA analysis');
    }

    const normalizedExpectedText = this.normalizeExpectedText(expectedText);

    console.log('[SodaService] Preparing analyze request', {
      endpoint,
      expectedText,
      normalizedExpectedText,
      audio: {
        originalname: audioFile.originalname,
        mimetype: audioFile.mimetype,
        size: audioFile.size,
      },
    });

    const form = new FormData();
    const audioBlob = new Blob([audioFile.buffer], { type: audioFile.mimetype });
    form.append('audio', audioBlob, audioFile.originalname || 'audio.m4a');
    form.append('expected_text', normalizedExpectedText);

    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: form,
      });
    } catch (error) {
      console.error('[SodaService] Network error calling SODA', {
        endpoint,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const responseText = await response.text();
    let parsed: Record<string, any> = {};

    try {
      parsed = responseText ? (JSON.parse(responseText) as Record<string, any>) : {};
    } catch {
      parsed = { message: responseText };
    }

    console.log('[SodaService] SODA response received', {
      endpoint,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      keys: Object.keys(parsed),
    });
    console.log('[SodaService] Full SODA response payload', parsed);

    if (!response.ok) {
      const message =
        parsed.error || parsed.message || `SODA request failed with ${response.status}`;
      console.error('[SodaService] SODA returned error', {
        endpoint,
        status: response.status,
        message,
        body: parsed,
      });
      throw new Error(message);
    }

    const normalized = this.normalizeSeverity(parsed);
    return normalized;
  }
}

/// Fields to store in `user_speech_attempts.soda_analysis` (jsonb). Omits top-level
/// `severity` / `predicted` / `predicted_word` where they duplicate table columns.
const SODA_ANALYSIS_SNAPSHOT_KEYS = [
  'acoustic_severity',
  'articulation_errors',
  'pronunciation_quality_combined',
  'severity_phoneme',
  'severity_phoneme_combined',
  'severity_phoneme_strict',
  'severity_phoneme_strict_combined',
  'severity_text',
  'severity_text_combined',
  'soda_errors',
  'tongue_position_analysis',
] as const;

/** JSON-serializable SODA diagnostics for DB storage, or null if nothing to store. */
export function buildSodaAnalysisSnapshot(
  resp: Record<string, unknown>
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of SODA_ANALYSIS_SNAPSHOT_KEYS) {
    if (!(key in resp)) continue;
    const v = resp[key];
    if (v !== undefined && v !== null) {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Heard word for reporting: prefers `predicted`, then `predicted_word`. */
export function extractSodaTranscribedWord(resp: Record<string, unknown>): string | null {
  const p = resp.predicted;
  if (typeof p === 'string' && p.trim().length > 0) return p;
  const w = resp.predicted_word;
  if (typeof w === 'string' && w.trim().length > 0) return w;
  return null;
}

/** Therapy label from top-level `error_type` or nested `soda_errors`. */
export function extractSodaErrorTypeLabel(resp: Record<string, unknown>): string | null {
  const top = resp.error_type;
  if (typeof top === 'string' && top.trim().length > 0) return top;
  const se = resp.soda_errors;
  if (se && typeof se === 'object' && !Array.isArray(se)) {
    const o = se as Record<string, unknown>;
    const primary = o.primary_error_type;
    if (typeof primary === 'string' && primary.trim().length > 0) return primary;
    const base = o.base_soda_error;
    if (typeof base === 'string' && base.trim().length > 0) return base;
  }
  return null;
}
