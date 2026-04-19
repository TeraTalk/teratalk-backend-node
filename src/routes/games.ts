import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { GameWordsService } from '../services/game_words_service';

const router = Router();

function parseLevel(raw: unknown): number {
  const parsed =
    typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 2;
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(2, Math.min(5, Math.round(parsed)));
}

function parseLimit(raw: unknown): number {
  const parsed =
    typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 1;
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function parseExcludeWordIds(raw: unknown): string[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

/// GET /api/games/words/next
/// Returns curated words prioritized by profile problem_sounds and level fallback rules.
router.get('/words/next', authenticate, async (req: Request, res: Response) => {
  try {
    const requestId = `game_words_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!req.userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const level = parseLevel(req.query.level);
    const limit = parseLimit(req.query.limit);
    const excludeWordIds = parseExcludeWordIds(req.query.excludeWordIds);
    console.log('[Games][WordsNext] Request received', {
      requestId,
      userId: req.userId,
      level,
      limit,
      excludeWordIdsCount: excludeWordIds.length,
    });

    const result = await GameWordsService.getNextWords({
      userId: req.userId,
      level,
      limit,
      excludeWordIds,
    });

    const firstMeta = result.words[0]?.meta;
    console.log('[Games][WordsNext] Response ready', {
      requestId,
      userId: req.userId,
      source: result.source,
      wordsCount: result.words.length,
      firstWordId: result.words[0]?.id ?? null,
      firstWordText: result.words[0]?.text ?? null,
      matchedSound: firstMeta?.matchedSound ?? null,
      fallbackUsed: firstMeta?.fallbackUsed ?? true,
      levelUsed: firstMeta?.levelUsed ?? null,
    });
    res.json({
      words: result.words,
      metadata: {
        requestedLevel: result.requestedLevel,
        levelUsed: firstMeta?.levelUsed ?? null,
        matchedSound: firstMeta?.matchedSound ?? null,
        fallbackUsed: firstMeta?.fallbackUsed ?? true,
        source: result.source,
        mlModelVersion: result.mlModelVersion ?? null,
      },
    });
  } catch (error) {
    console.error('[Games][WordsNext] Error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
