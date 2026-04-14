import { SpeechLevel, getSeverityThreshold, isPassForLevel } from '../config/speech_level_policy';

export type CandyLandMoveReason =
  | 'fail_no_move'
  | 'pass_quality_scaled'
  | 'pass_no_severity_assumed_mid';

export type CandyLandMoveAnimationHints = {
  stepDelayMs: number;
  celebration: boolean;
};

export type ComputeCandyLandMoveInput = {
  severity?: number | null;
  confidence?: number | null;
  isCorrect?: boolean | null;
  speechLevelUsed?: SpeechLevel | null;
  gameLevelUsed?: number | null; // 2..5
};

export type ComputeCandyLandMoveOutput = {
  moveTiles: number;
  qualityScore: number; // 0..1
  reason: CandyLandMoveReason;
  severityThresholdUsed: number | null;
  allowRetry: boolean;
  animation: CandyLandMoveAnimationHints;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(n: number, min: number, max: number): number {
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded)) return min;
  return Math.max(min, Math.min(max, rounded));
}

function deriveMaxTiles(gameLevelUsed: number): number {
  // Keep consistent with existing backend convention (2..5 levels).
  // Level acts as a gentle cap on movement magnitude.
  const lvl = clampInt(gameLevelUsed, 2, 5);
  return lvl; // level 2→2 tiles max … 5→5 tiles max
}

function computeQualityScore(params: { severity: number | null; confidence: number | null }): number {
  const s = params.severity;
  const c = params.confidence;
  const base = s == null ? 0.5 : clamp01(1 - s);
  if (c == null) return base;
  return clamp01(0.7 * base + 0.3 * clamp01(c));
}

export function computeCandyLandMove(
  input: ComputeCandyLandMoveInput
): ComputeCandyLandMoveOutput {
  const speechLevelUsed: SpeechLevel = input.speechLevelUsed ?? 'beginner';
  const severityThresholdUsed =
    input.severity == null ? null : getSeverityThreshold(speechLevelUsed);

  const severity =
    input.severity == null || !Number.isFinite(input.severity)
      ? null
      : clamp01(input.severity);
  const confidence =
    input.confidence == null || !Number.isFinite(input.confidence)
      ? null
      : clamp01(input.confidence);

  const qualityScore = computeQualityScore({ severity, confidence });

  // Determine pass/fail
  const isCorrect =
    typeof input.isCorrect === 'boolean'
      ? input.isCorrect
      : severity != null
        ? isPassForLevel(speechLevelUsed, severity)
        : false;

  // Retry policy: on fail, allow retry; on pass, no retry needed.
  // (Frontend can still implement additional constraints like attempt limits.)
  const allowRetry = !isCorrect;

  if (!isCorrect) {
    return {
      moveTiles: 0,
      qualityScore,
      reason: 'fail_no_move',
      severityThresholdUsed,
      allowRetry,
      animation: {
        stepDelayMs: 180,
        celebration: false,
      },
    };
  }

  const maxTiles = deriveMaxTiles(input.gameLevelUsed ?? 2);
  const gamma = 1.4;
  const scaled = Math.pow(qualityScore, gamma);
  const moveTiles = clampInt(1 + Math.floor((maxTiles - 1) * scaled), 1, maxTiles);

  return {
    moveTiles,
    qualityScore,
    reason: severity == null ? 'pass_no_severity_assumed_mid' : 'pass_quality_scaled',
    severityThresholdUsed,
    allowRetry,
    animation: {
      // Faster movement when performance is strong.
      stepDelayMs: clampInt(220 - 80 * qualityScore, 120, 220),
      celebration: qualityScore >= 0.75,
    },
  };
}

