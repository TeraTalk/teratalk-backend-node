/// Coerces API `severity` to [0, 1]: scalar number/string, or nested `{ score }`
/// from the phonological detector.
export function coerceSeverity01(severityRaw: unknown): number {
  if (typeof severityRaw === 'number' && Number.isFinite(severityRaw)) {
    return Math.max(0, Math.min(1, severityRaw));
  }
  if (typeof severityRaw === 'string') {
    const parsed = parseFloat(severityRaw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
  }
  if (severityRaw && typeof severityRaw === 'object') {
    const score = (severityRaw as Record<string, unknown>).score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      return Math.max(0, Math.min(1, score));
    }
    if (typeof score === 'string') {
      const parsed = parseFloat(score);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(1, parsed));
      }
    }
  }
  return 0.5;
}

function severityObjectExtras(
  severityRaw: unknown
): { severity_label?: string; severity_details?: Record<string, unknown> } {
  if (!severityRaw || typeof severityRaw !== 'object') {
    return {};
  }
  const obj = severityRaw as Record<string, unknown>;
  const extras: { severity_label?: string; severity_details?: Record<string, unknown> } = {};
  if (typeof obj.label === 'string' && obj.label.length > 0) {
    extras.severity_label = obj.label;
  }
  if (obj.details && typeof obj.details === 'object' && obj.details !== null) {
    extras.severity_details = obj.details as Record<string, unknown>;
  }
  return extras;
}

/// Keys to persist in `user_speech_attempts.phonological_analysis` (jsonb).
/// Omits SODA-shaped duplicates already stored as scalar columns on the row.
const PHONOLOGICAL_ANALYSIS_SNAPSHOT_KEYS = [
  'errors',
  'transcribed_text',
  'recognized_phonemes',
  'expected_phonemes',
  'predicted_phonemes',
  'confidence_score',
  'confidence',
  'wrong_word',
  'wrong_word_msg',
  'asr_backend',
  'severity_label',
  'severity_details',
  'alignment',
  'detected_processes',
  'error_category',
  'pattern_position',
  'process_type',
  'affected_unit',
  'expected_text',
  'target_text',
] as const;

/** Returns a JSON-serializable subset for DB storage, or null if nothing to store. */
export function buildPhonologicalAnalysisSnapshot(
  resp: Record<string, unknown>
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of PHONOLOGICAL_ANALYSIS_SNAPSHOT_KEYS) {
    if (!(key in resp)) continue;
    const v = resp[key];
    if (v !== undefined && v !== null) {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/// Maps Phonological Detector API response (new structure with alignment,
/// detected_processes, etc.) to the SODA-like shape used by buildGamePersonalization
/// and toSodaResponse.
export function mapPhonologicalToSodaLike(
  phonologicalResponse: Record<string, any>
): Record<string, any> {
  const severityRaw = phonologicalResponse.severity;
  const severity = coerceSeverity01(severityRaw);
  const severityExtras = severityObjectExtras(severityRaw);

  const processType = phonologicalResponse.process_type;
  const errorType =
    typeof processType === 'string' && processType.length > 0
      ? processType.charAt(0).toUpperCase() + processType.slice(1).toLowerCase()
      : undefined;

  const expectedPhonemes = phonologicalResponse.expected_phonemes;
  const affectedUnit = phonologicalResponse.affected_unit;
  const predictedPhonemes = phonologicalResponse.predicted_phonemes;
  const predictedText = phonologicalResponse.predicted_text;
  const alignment = phonologicalResponse.alignment;

  // Prefer base/target from first substitution in alignment (new structure)
  let basePhoneme = '';
  let targetPhoneme = '';
  if (Array.isArray(alignment)) {
    const firstSub = alignment.find(
      (s: { operation?: string }) => s?.operation === 'substitution'
    );
    if (firstSub && firstSub.expected != null && firstSub.predicted != null) {
      basePhoneme = String(firstSub.expected);
      targetPhoneme = String(firstSub.predicted);
    }
  }
  if (!basePhoneme) {
    basePhoneme =
      Array.isArray(expectedPhonemes) && expectedPhonemes[0] != null
        ? String(expectedPhonemes[0])
        : Array.isArray(affectedUnit) && affectedUnit[0] != null
          ? String(affectedUnit[0])
          : '';
  }
  if (!targetPhoneme) {
    targetPhoneme =
      Array.isArray(predictedPhonemes) && predictedPhonemes[0] != null
        ? String(predictedPhonemes[0])
        : typeof predictedText === 'string'
          ? predictedText
          : '';
  }

  const therapyLevel = severity >= 0.6 ? 'high' : 'low';

  const apiConfidenceRaw =
    phonologicalResponse.confidence ?? phonologicalResponse.confidence_score;
  const confidence =
    typeof apiConfidenceRaw === 'number' && Number.isFinite(apiConfidenceRaw)
      ? apiConfidenceRaw
      : undefined;

  return {
    ...phonologicalResponse,
    predicted:
      phonologicalResponse.predicted_text ??
      phonologicalResponse.transcribed_text ??
      phonologicalResponse.predicted ??
      '',
    expected:
      phonologicalResponse.expected_text ??
      phonologicalResponse.expected ??
      phonologicalResponse.target_text ??
      '',
    severity,
    ...severityExtras,
    error_type: errorType,
    base_phoneme: basePhoneme,
    target_phoneme: targetPhoneme,
    therapy_level: therapyLevel,
    ...(confidence !== undefined ? { confidence } : {}),
    // Pass through error_category, alignment, pattern_position, detected_processes, etc.
  };
}
