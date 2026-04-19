/**
 * HTTP client for teratalk-ml-service (FastAPI).
 * If ML_SERVICE_URL is unset, all methods return null and callers keep legacy behavior.
 */

const DEFAULT_TIMEOUT_MS = 8000;

function baseUrl(): string | null {
  let raw = process.env.ML_SERVICE_URL?.trim();
  if (!raw) return null;
  raw = raw.replace(/\/$/, '');
  // fetch() requires an absolute URL with scheme (e.g. http://127.0.0.1:8090)
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  return raw;
}

function authHeader(): Record<string, string> {
  const key = process.env.ML_INTERNAL_API_KEY?.trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isMlServiceConfigured(): boolean {
  return baseUrl() !== null;
}

export function isMlWordsEnabled(): boolean {
  return isMlServiceConfigured() && truthyEnv('ML_WORDS_ENABLED');
}

export function isMlSpeechLevelEnabled(): boolean {
  return isMlServiceConfigured() && truthyEnv('ML_SPEECH_LEVEL_ENABLED');
}

export function isMlHintsEnabled(): boolean {
  return isMlServiceConfigured() && truthyEnv('ML_HINTS_ENABLED');
}

/** Resolved base URL (with http:// if omitted). For diagnostics only. */
export function getMlServiceBaseUrlForLogs(): string | null {
  return baseUrl();
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T | null> {
  const root = baseUrl();
  if (!root) return null;
  const url = `${root}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[MlServiceClient] ML HTTP error', {
        url,
        status: res.status,
        bodyPreview: text.slice(0, 200),
      });
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const isAbort = err.name === 'AbortError';
    console.warn('[MlServiceClient] ML fetch failed', {
      url,
      reason: isAbort ? `timeout after ${DEFAULT_TIMEOUT_MS}ms` : err.message,
      code: (e as NodeJS.ErrnoException)?.code,
      hint: isAbort
        ? 'Increase timeout or ensure ML service responds quickly.'
        : 'Check ML_SERVICE_URL is reachable from this Node process (use host.docker.internal if Node runs in Docker). URL must include host:port; scheme http:// is added if missing.',
    });
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type SelectWordResult = { chosen_word_id: string; model_version: string };

export async function mlSelectWord(params: {
  userId: string;
  candidateWordIds: string[];
  requestedLevel: number;
  numProblemSounds: number;
  source: 'exact' | 'nearby' | 'global_fallback';
}): Promise<SelectWordResult | null> {
  if (!isMlWordsEnabled()) return null;
  const data = await postJson<SelectWordResult>('/v1/bandit/select-word', {
    user_id: params.userId,
    candidate_word_ids: params.candidateWordIds,
    requested_level: params.requestedLevel,
    num_problem_sounds: params.numProblemSounds,
    source: params.source,
  });
  return data;
}

export async function mlRecordBanditReward(params: {
  userId: string;
  wordId: string;
  reward: number;
  requestedLevel: number;
  numProblemSounds: number;
  source: 'exact' | 'nearby' | 'global_fallback';
}): Promise<void> {
  if (!isMlWordsEnabled()) return;
  const root = baseUrl();
  if (!root) return;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(`${root}/v1/bandit/reward`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
      },
      body: JSON.stringify({
        user_id: params.userId,
        word_id: params.wordId,
        reward: Math.max(0, Math.min(1, params.reward)),
        requested_level: params.requestedLevel,
        num_problem_sounds: params.numProblemSounds,
        source: params.source,
      }),
      signal: controller.signal,
    });
  } catch {
    // fire-and-forget
  } finally {
    clearTimeout(t);
  }
}

export type SpeechLevelMlResult = {
  speech_level_after: string;
  is_pass: boolean;
  severity_threshold_used: number;
  model_version: string;
};

export async function mlPredictSpeechLevel(params: {
  speechLevelBefore: string;
  historyWithCurrent: boolean[];
  severity: number | null;
}): Promise<SpeechLevelMlResult | null> {
  if (!isMlSpeechLevelEnabled()) return null;
  return postJson<SpeechLevelMlResult>('/v1/speech-level/predict', {
    speech_level_before: params.speechLevelBefore,
    history_with_current: params.historyWithCurrent,
    severity: params.severity,
  });
}

export type HintMlResult = { template_id: string; hint_text: string; model_version: string };

export async function mlPredictHint(params: {
  expectedWord: string;
  expectedSound: string;
  hintTone: string | null | undefined;
  attempt: number;
  severity: number | null;
}): Promise<HintMlResult | null> {
  if (!isMlHintsEnabled()) return null;
  return postJson<HintMlResult>('/v1/hint/template', {
    expected_word: params.expectedWord,
    expected_sound: params.expectedSound,
    hint_tone: params.hintTone ?? null,
    attempt: params.attempt,
    severity: params.severity,
  });
}
