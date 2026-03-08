export type SpeechLevel = 'beginner' | 'intermediate' | 'advanced';

export const SPEECH_LEVEL_THRESHOLDS: Record<SpeechLevel, number> = {
  beginner: 0.7,
  intermediate: 0.5,
  advanced: 0.3,
};

export const SPEECH_LEVEL_TRANSITIONS = {
  promotion: {
    beginner: { to: 'intermediate', requiredPasses: 3, window: 6 },
    intermediate: { to: 'advanced', requiredPasses: 4, window: 8 },
  },
  demotion: {
    advanced: { to: 'intermediate', requiredFails: 3, window: 6 },
    intermediate: { to: 'beginner', requiredFails: 3, window: 6 },
  },
} as const;

export function normalizeSpeechLevel(value: unknown): SpeechLevel {
  if (typeof value !== 'string') return 'beginner';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'intermediate') return 'intermediate';
  if (normalized === 'advanced') return 'advanced';
  return 'beginner';
}

export function getSeverityThreshold(level: SpeechLevel): number {
  return SPEECH_LEVEL_THRESHOLDS[level];
}

/** Max history window for a level (for DB fetch). Resets when level changes. */
export function getHistoryWindowForLevel(level: SpeechLevel): number {
  const promotion =
    level === 'beginner'
      ? SPEECH_LEVEL_TRANSITIONS.promotion.beginner.window
      : level === 'intermediate'
        ? SPEECH_LEVEL_TRANSITIONS.promotion.intermediate.window
        : 0;
  const demotion =
    level === 'advanced'
      ? SPEECH_LEVEL_TRANSITIONS.demotion.advanced.window
      : level === 'intermediate'
        ? SPEECH_LEVEL_TRANSITIONS.demotion.intermediate.window
        : 0;
  return Math.max(promotion, demotion, 6);
}

export function isPassForLevel(level: SpeechLevel, severity: number): boolean {
  return severity <= getSeverityThreshold(level);
}

export function nextSpeechLevelFromHistory(
  level: SpeechLevel,
  history: boolean[],
): SpeechLevel {
  const promotionRule =
    level === 'beginner'
      ? SPEECH_LEVEL_TRANSITIONS.promotion.beginner
      : level === 'intermediate'
        ? SPEECH_LEVEL_TRANSITIONS.promotion.intermediate
        : null;

  if (promotionRule) {
    const scoped = history.slice(0, promotionRule.window);
    const passCount = scoped.filter(Boolean).length;
    if (passCount >= promotionRule.requiredPasses) {
      return promotionRule.to;
    }
  }

  const demotionRule =
    level === 'advanced'
      ? SPEECH_LEVEL_TRANSITIONS.demotion.advanced
      : level === 'intermediate'
        ? SPEECH_LEVEL_TRANSITIONS.demotion.intermediate
        : null;

  if (demotionRule) {
    const scoped = history.slice(0, demotionRule.window);
    const failCount = scoped.filter((result) => !result).length;
    if (failCount >= demotionRule.requiredFails) {
      return demotionRule.to;
    }
  }

  return level;
}
