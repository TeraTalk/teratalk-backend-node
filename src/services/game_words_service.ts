import { supabase } from '../config/supabase';
import { isMlHintsEnabled, isMlWordsEnabled, mlPredictHint, mlSelectWord } from './ml_service_client';

type TherapyItemRow = {
  id: string;
  payload_json: Record<string, any>;
  order_index: number | null;
};

type ActivityRow = {
  id: string;
  level_id: number;
  target_letter: string | null;
  therapy_items: TherapyItemRow[];
};

export type GameWord = {
  id: string;
  text: string;
  letter: string;
  examples: string[];
  tonguePlacement: {
    position: 'front' | 'back' | 'top' | 'bottom' | 'center';
    description: string;
    visualGuide: string;
    emojiHint?: string;
  };
  difficulty: number;
  /** Optional ML template hint for “say the word” UI */
  hintText?: string;
};

export type WordSelectionMeta = {
  matchedSound: string | null;
  fallbackUsed: boolean;
  levelUsed: number | null;
};

export type WordSelectionResult = {
  words: Array<GameWord & { meta: WordSelectionMeta }>;
  requestedLevel: number;
  source: 'exact' | 'nearby' | 'global_fallback';
  /** Set when LinUCB bandit reordered candidates */
  mlModelVersion?: string;
};

const ML_CANDIDATE_CAP = 40;

async function applyBanditReorder(params: {
  userId: string;
  words: Array<GameWord & { meta: WordSelectionMeta }>;
  source: 'exact' | 'nearby' | 'global_fallback';
  requestedLevel: number;
  numProblemSounds: number;
  limit: number;
}): Promise<{ words: Array<GameWord & { meta: WordSelectionMeta }>; mlModelVersion?: string }> {
  const { userId, words, source, requestedLevel, numProblemSounds, limit } = params;
  if (!isMlWordsEnabled() || words.length <= 1) {
    return { words: words.slice(0, limit) };
  }

  const chosen = await mlSelectWord({
    userId,
    candidateWordIds: words.map((w) => w.id),
    requestedLevel,
    numProblemSounds,
    source,
  });
  if (!chosen?.chosen_word_id) {
    return { words: words.slice(0, limit) };
  }

  const idx = words.findIndex((w) => w.id === chosen.chosen_word_id);
  if (idx < 0) {
    return { words: words.slice(0, limit) };
  }

  const chosenWord = words[idx];
  const rest = words.filter((_, i) => i !== idx);
  const reordered = [chosenWord, ...rest];
  return {
    words: reordered.slice(0, limit),
    mlModelVersion: chosen.model_version,
  };
}

function clampDifficulty(level: number): number {
  return Math.max(1, Math.min(10, Math.round(level)));
}

function normalizeSound(sound: string): string {
  const cleaned = sound.trim().toUpperCase().replace(/[^A-Z]/g, '');
  return cleaned;
}

function normalizeSounds(sounds: string[]): string[] {
  return Array.from(
    new Set(sounds.map(normalizeSound).filter((value) => value.length > 0))
  );
}

function pickClosestLevel(inputLevel: number, availableLevels: number[]): number {
  if (availableLevels.length === 0) {
    return Math.round(inputLevel) || 1;
  }

  const roundedInput = Math.round(inputLevel);
  return availableLevels.reduce((closest, current) => {
    const currentDistance = Math.abs(current - roundedInput);
    const closestDistance = Math.abs(closest - roundedInput);
    return currentDistance < closestDistance ? current : closest;
  }, availableLevels[0]);
}

function getNearbyLevels(level: number, availableLevels: number[]): number[] {
  const index = availableLevels.indexOf(level);
  if (index === -1) return [];

  const nearby: number[] = [];
  if (index > 0) nearby.push(availableLevels[index - 1]);
  if (index < availableLevels.length - 1) nearby.push(availableLevels[index + 1]);
  return nearby;
}

function parseExamples(value: unknown, fallbackText: string): string[] {
  if (Array.isArray(value)) {
    const parsed = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (parsed.length > 0) return parsed;
  }
  return [fallbackText];
}

function toTonguePlacement(sound: string | null) {
  const normalized = normalizeSound(sound || '');
  if (normalized === 'R') {
    return {
      position: 'back' as const,
      description: 'Curl your tongue slightly back while saying the sound.',
      visualGuide: 'back_tongue_r',
    };
  }

  if (normalized === 'K' || normalized === 'G') {
    return {
      position: 'back' as const,
      description: 'Lift the back of your tongue toward the soft palate.',
      visualGuide: 'back_tongue_k',
    };
  }

  return {
    position: 'front' as const,
    description: 'Keep your tongue close to the front teeth and release clearly.',
    visualGuide: 'front_tongue',
  };
}

function toGameWord(
  item: TherapyItemRow,
  activity: ActivityRow
): (GameWord & { meta: WordSelectionMeta }) | null {
  const payload = item.payload_json || {};
  const textRaw = payload.text;
  if (typeof textRaw !== 'string' || textRaw.trim().length === 0) {
    return null;
  }

  const text = textRaw.trim();
  const letter =
    typeof payload.letter === 'string' && payload.letter.trim().length > 0
      ? payload.letter.trim().toUpperCase()
      : normalizeSound(activity.target_letter || '').slice(0, 2) || text[0].toUpperCase();
  const targetSound =
    typeof payload.targetSound === 'string' ? payload.targetSound : activity.target_letter;
  const matchedSound = normalizeSound(targetSound || '') || null;

  return {
    id: item.id,
    text,
    letter,
    examples: parseExamples(payload.examples, text),
    tonguePlacement: toTonguePlacement(matchedSound),
    difficulty: clampDifficulty(activity.level_id),
    meta: {
      matchedSound,
      fallbackUsed: false,
      levelUsed: Number.isFinite(activity.level_id) ? activity.level_id : null,
    },
  };
}

async function fetchAvailableWordPracticeLevels(): Promise<number[]> {
  const { data, error } = await supabase
    .from('therapy_activities')
    .select('level_id')
    .eq('is_active', true)
    .eq('type', 'word_practice')
    .order('level_id', { ascending: true });

  if (error || !Array.isArray(data)) return [];

  return Array.from(
    new Set(
      data
        .map((entry) => Number(entry.level_id))
        .filter((level) => Number.isFinite(level))
    )
  ).sort((a, b) => a - b);
}

async function fetchProfileProblemSounds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('problem_sounds')
    .eq('user_id', userId)
    .single();

  if (error || !data) return [];
  const sounds = Array.isArray(data.problem_sounds)
    ? data.problem_sounds.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return normalizeSounds(sounds);
}

async function fetchWordActivities(params: {
  levelIds?: number[];
  sounds?: string[];
}): Promise<ActivityRow[]> {
  let query = supabase
    .from('therapy_activities')
    .select(
      'id, level_id, target_letter, therapy_items!inner(id, payload_json, order_index, item_type, is_active)'
    )
    .eq('is_active', true)
    .eq('type', 'word_practice')
    .eq('therapy_items.item_type', 'word')
    .eq('therapy_items.is_active', true)
    .order('level_id', { ascending: true });

  if (params.levelIds && params.levelIds.length > 0) {
    query = query.in('level_id', params.levelIds);
  }

  if (params.sounds && params.sounds.length > 0) {
    const candidateSounds = Array.from(
      new Set(params.sounds.flatMap((sound) => [sound, sound.toLowerCase(), sound.toUpperCase()]))
    );
    query = query.in('target_letter', candidateSounds);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as unknown as ActivityRow[];
}

function pickWords(params: {
  activities: ActivityRow[];
  requestedLevel: number;
  excludedWordIds: Set<string>;
  limit: number;
  fallbackUsed: boolean;
}): Array<GameWord & { meta: WordSelectionMeta }> {
  const words: Array<GameWord & { meta: WordSelectionMeta }> = [];
  const seenIds = new Set<string>();

  for (const activity of params.activities) {
    if (!Array.isArray(activity.therapy_items) || activity.therapy_items.length === 0) {
      continue;
    }

    for (const item of activity.therapy_items) {
      if (params.excludedWordIds.has(item.id) || seenIds.has(item.id)) {
        continue;
      }

      const word = toGameWord(item, activity);
      if (!word) continue;

      word.meta.fallbackUsed = params.fallbackUsed;
      words.push(word);
      seenIds.add(item.id);

      if (words.length >= params.limit) return words;
    }
  }

  return words;
}

type GameWordWithMeta = GameWord & { meta: WordSelectionMeta };

async function attachPracticeHints(words: GameWordWithMeta[]): Promise<GameWordWithMeta[]> {
  if (!isMlHintsEnabled() || words.length === 0) {
    return words;
  }
  const out: GameWordWithMeta[] = [];
  for (const w of words) {
    const hintMl = await mlPredictHint({
      expectedWord: w.text,
      expectedSound: w.letter,
      hintTone: 'light',
      attempt: 1,
      severity: null,
    });
    if (hintMl?.hint_text) {
      out.push({ ...w, hintText: hintMl.hint_text });
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

export class GameWordsService {
  static async getNextWords(params: {
    userId: string;
    level: number;
    limit: number;
    excludeWordIds?: string[];
  }): Promise<WordSelectionResult> {
    const requestId = `svc_words_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const limit = Math.max(1, Math.min(10, Math.round(params.limit)));
    const pickLimit = isMlWordsEnabled() ? Math.max(limit, ML_CANDIDATE_CAP) : limit;
    const excludedWordIds = new Set(params.excludeWordIds || []);
    const availableLevels = await fetchAvailableWordPracticeLevels();
    const requestedLevel = pickClosestLevel(params.level, availableLevels);

    const problemSounds = await fetchProfileProblemSounds(params.userId);
    console.log('[GameWordsService] Starting selection', {
      requestId,
      userId: params.userId,
      requestedLevel,
      availableLevels,
      limit,
      excludeWordIdsCount: excludedWordIds.size,
      problemSounds,
    });
    const nearbyLevels = getNearbyLevels(requestedLevel, availableLevels);

    if (problemSounds.length > 0) {
      const exactActivities = await fetchWordActivities({
        levelIds: [requestedLevel],
        sounds: problemSounds,
      });
      const exactWords = pickWords({
        activities: exactActivities,
        requestedLevel,
        excludedWordIds,
        limit: pickLimit,
        fallbackUsed: false,
      });
      console.log('[GameWordsService] Exact-level attempt', {
        requestId,
        activitiesCount: exactActivities.length,
        wordsCount: exactWords.length,
      });
      if (exactWords.length > 0) {
        const { words: finalWords, mlModelVersion } = await applyBanditReorder({
          userId: params.userId,
          words: exactWords,
          source: 'exact',
          requestedLevel,
          numProblemSounds: problemSounds.length,
          limit,
        });
        const hintedWords = await attachPracticeHints(finalWords);
        console.log('[GameWordsService] Selected exact-level words', {
          requestId,
          source: 'exact',
          wordsCount: hintedWords.length,
          firstWordId: hintedWords[0]?.id ?? null,
          firstWordText: hintedWords[0]?.text ?? null,
          mlModelVersion: mlModelVersion ?? null,
          firstHintLen: hintedWords[0]?.hintText?.length ?? 0,
        });
        return {
          words: hintedWords,
          requestedLevel,
          source: 'exact',
          mlModelVersion,
        };
      }

      if (nearbyLevels.length > 0) {
        const nearbyActivities = await fetchWordActivities({
          levelIds: nearbyLevels,
          sounds: problemSounds,
        });
        const nearbyWords = pickWords({
          activities: nearbyActivities,
          requestedLevel,
          excludedWordIds,
          limit: pickLimit,
          fallbackUsed: true,
        });
        console.log('[GameWordsService] Nearby-level attempt', {
          requestId,
          nearbyLevels,
          activitiesCount: nearbyActivities.length,
          wordsCount: nearbyWords.length,
        });
        if (nearbyWords.length > 0) {
          const { words: finalWords, mlModelVersion } = await applyBanditReorder({
            userId: params.userId,
            words: nearbyWords,
            source: 'nearby',
            requestedLevel,
            numProblemSounds: problemSounds.length,
            limit,
          });
          const hintedWords = await attachPracticeHints(finalWords);
          console.log('[GameWordsService] Selected nearby-level words', {
            requestId,
            source: 'nearby',
            wordsCount: hintedWords.length,
            firstWordId: hintedWords[0]?.id ?? null,
            firstWordText: hintedWords[0]?.text ?? null,
            mlModelVersion: mlModelVersion ?? null,
            firstHintLen: hintedWords[0]?.hintText?.length ?? 0,
          });
          return {
            words: hintedWords,
            requestedLevel,
            source: 'nearby',
            mlModelVersion,
          };
        }
      }
    } else {
      console.log('[GameWordsService] No problem sounds found, skipping exact/nearby matching', {
        requestId,
      });
    }

    const fallbackActivities = await fetchWordActivities({});
    const fallbackWords = pickWords({
      activities: fallbackActivities,
      requestedLevel,
      excludedWordIds,
      limit: pickLimit,
      fallbackUsed: true,
    });
    const { words: finalFallback, mlModelVersion } = await applyBanditReorder({
      userId: params.userId,
      words: fallbackWords,
      source: 'global_fallback',
      requestedLevel,
      numProblemSounds: problemSounds.length,
      limit,
    });
    const hintedFallback = await attachPracticeHints(finalFallback);
    console.log('[GameWordsService] Global fallback selection', {
      requestId,
      source: 'global_fallback',
      activitiesCount: fallbackActivities.length,
      wordsCount: hintedFallback.length,
      firstWordId: hintedFallback[0]?.id ?? null,
      firstWordText: hintedFallback[0]?.text ?? null,
      mlModelVersion: mlModelVersion ?? null,
      firstHintLen: hintedFallback[0]?.hintText?.length ?? 0,
    });

    return {
      words: hintedFallback,
      requestedLevel,
      source: 'global_fallback',
      mlModelVersion,
    };
  }
}
