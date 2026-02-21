/// SODA service proxy for pronunciation analysis.
/// Forwards audio + expected_text to the external analyzer endpoint.
export class SodaService {
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

    console.log('[SodaService] Preparing analyze request', {
      endpoint,
      expectedText,
      audio: {
        originalname: audioFile.originalname,
        mimetype: audioFile.mimetype,
        size: audioFile.size,
      },
    });

    const form = new FormData();
    const audioBlob = new Blob([audioFile.buffer], { type: audioFile.mimetype });
    form.append('audio', audioBlob, audioFile.originalname || 'audio.m4a');
    form.append('expected_text', expectedText);

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

    return parsed;
  }
}
