import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

function normalizeLetter(input?: string): string {
  if (!input) {
    return 'L';
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return 'L';
  }

  return trimmed[0].toUpperCase();
}

function normalizeLevelName(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

/// GET /api/therapy/activities?letter=L
/// Fetch therapy activities for a target letter, grouped by level with items
router.get('/activities', async (req: Request, res: Response) => {
  try {
    const letter = normalizeLetter(req.query.letter as string | undefined);
    const levelIdParam = req.query.levelId as string | undefined;
    const levelName = normalizeLevelName(req.query.level as string | undefined);
    const levelId = levelIdParam ? Number(levelIdParam) : undefined;

    if (levelIdParam && (Number.isNaN(Number(levelIdParam)) || Number(levelIdParam) <= 0)) {
      res.status(400).json({ error: 'levelId must be a positive number' });
      return;
    }

    let query = supabase
      .from('therapy_activities')
      .select(
        `
        id,
        level_id,
        type,
        title,
        target_letter,
        difficulty,
        order_index,
        therapy_levels (
          id,
          name,
          description
        ),
        therapy_items (
          id,
          item_type,
          payload_json,
          order_index
        )
        `
      )
      .eq('target_letter', letter);

    if (levelId) {
      query = query.eq('level_id', levelId);
    }

    if (levelName) {
      query = query.eq('therapy_levels.name', levelName);
    }

    const { data, error } = await query
      .order('order_index', { ascending: true })
      .order('order_index', { foreignTable: 'therapy_items', ascending: true });

    if (error) {
      console.error('Error fetching therapy activities:', error);
      res.status(500).json({ error: 'Failed to fetch therapy activities' });
      return;
    }

    const levelMap = new Map<
      number,
      {
        id: number;
        name: string;
        description: string | null;
        activities: Array<{
          id: string;
          type: string;
          title: string;
          targetLetter: string | null;
          difficulty: string | null;
          orderIndex: number;
          items: Array<{
            id: string;
            itemType: string;
            payload: Record<string, unknown>;
            orderIndex: number;
          }>;
        }>;
      }
    >();

    for (const activity of data || []) {
      const levelData = activity.therapy_levels;
      const level: { id: number; name: string; description: string | null } | null =
        Array.isArray(levelData)
          ? (levelData.length > 0
              ? (levelData[0] as { id: number; name: string; description: string | null })
              : null)
          : (levelData as { id: number; name: string; description: string | null } | null);

      if (!level) {
        continue;
      }

      if (!levelMap.has(level.id)) {
        levelMap.set(level.id, {
          id: level.id,
          name: level.name,
          description: level.description,
          activities: [],
        });
      }

      const items = (activity.therapy_items || []).map((item: any) => ({
        id: item.id,
        itemType: item.item_type,
        payload: item.payload_json,
        orderIndex: item.order_index,
      }));

      levelMap.get(level.id)!.activities.push({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        targetLetter: activity.target_letter,
        difficulty: activity.difficulty,
        orderIndex: activity.order_index,
        items,
      });
    }

    const levels = Array.from(levelMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    res.status(200).json({
      letter,
      levelId: levelId || null,
      level: levelName || null,
      levels,
    });
  } catch (error) {
    console.error('Therapy activities error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
