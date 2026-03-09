/// Phonological Detector service proxy for pronunciation analysis.
/// Forwards audio + target_text to the external detector endpoint.
/// Converts uploads (e.g. M4A/AAC) to WAV so the API accepts them.
import { ensureWavOrMp3 } from './audio_transcode';

export class PhonologicalDetectorService {
  static async analyzeSpeech(
    expectedText: string,
    audioFile?: Express.Multer.File
  ): Promise<Record<string, any>> {
    const configured = process.env.PHONOLOGICAL_DETECT_URL;
    if (!configured || configured.trim() === '') {
      throw new Error('PHONOLOGICAL_DETECT_URL is not configured');
    }
    const endpoint = configured.replace(/\/+$/, '');
    const startedAt = Date.now();

    if (!audioFile) {
      throw new Error('Audio file is required for Phonological Detector analysis');
    }

    const targetText = expectedText.trim() || expectedText;

    const { buffer, filename, mimetype } = await ensureWavOrMp3(
      audioFile.buffer,
      audioFile.originalname,
      audioFile.mimetype
    );

    console.log('[PhonologicalDetectorService] Preparing detect request', {
      endpoint,
      targetText,
      audio: {
        originalname: audioFile.originalname,
        mimetype: audioFile.mimetype,
        size: audioFile.size,
        sentAs: filename,
        sentMimetype: mimetype,
      },
    });

    const form = new FormData();
    const audioBlob = new Blob([buffer], { type: mimetype });
    form.append('audio', audioBlob, filename);
    form.append('target_text', targetText);

    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: form,
      });
    } catch (error) {
      console.error('[PhonologicalDetectorService] Network error calling Phonological Detector', {
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

    console.log('[PhonologicalDetectorService] Phonological Detector response received', {
      endpoint,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      keys: Object.keys(parsed),
    });

    if (!response.ok) {
      const message =
        parsed.error || parsed.message || `Phonological Detector request failed with ${response.status}`;
      console.error('[PhonologicalDetectorService] Phonological Detector returned error', {
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
