/// Maps Phonological Detector API response (new structure with alignment,
/// detected_processes, etc.) to the SODA-like shape used by buildGamePersonalization
/// and toSodaResponse.
export function mapPhonologicalToSodaLike(
  phonologicalResponse: Record<string, any>
): Record<string, any> {
  const severityRaw = phonologicalResponse.severity;
  const severity =
    typeof severityRaw === 'number' && Number.isFinite(severityRaw)
      ? Math.max(0, Math.min(1, severityRaw))
      : typeof severityRaw === 'string'
        ? Math.max(0, Math.min(1, parseFloat(severityRaw) || 0.5))
        : 0.5;

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
    error_type: errorType,
    base_phoneme: basePhoneme,
    target_phoneme: targetPhoneme,
    therapy_level: therapyLevel,
    // Pass through new fields (error_category, alignment, pattern_position, detected_processes, confidence)
  };
}
