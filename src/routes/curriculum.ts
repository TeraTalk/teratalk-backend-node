import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { supabase } from '../config/supabase';

const router = Router();

/// GET /api/curriculum/phonemes
/// Returns all mapped phonemes with their tongue placement instructions
router.get('/phonemes', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // We fetch the therapy phonemes and join with tongue placements
    // Assuming the table is matching the user's description. Note: Supabase supports joins if foreign keys are set
    const { data, error } = await supabase
      .from('therapy_phonemes')
      .select(`
        phoneme,
        parent_tip,
        example_words,
        tongue_placements!inner (
          position,
          description,
          visual_guide,
          emoji_hint
        )
      `)
      .order('phoneme');

    if (error) {
      console.warn('[Curriculum][Phonemes] Failed to fetch phoneme data', { error: error.message });
      // If the join fails due to fk constraints not perfectly mapped by PostgREST, fallback to manual mapping
      const { data: phonemes, error: pError } = await supabase.from('therapy_phonemes').select('*');
      const { data: placements, error: plError } = await supabase.from('tongue_placements').select('*');
      
      if (pError || plError) {
        throw new Error('Failed fallback query');
      }
      
      const mappedData = phonemes.map(p => {
        const placement = placements.find(pl => pl.position === p.placement_id || pl.position === p.placement_position);
        return {
           phoneme: p.phoneme,
           parent_tip: p.parent_tip,
           example_words: p.example_words,
           tongue_placements: placement || null
        };
      });
      res.status(200).json({ data: mappedData });
      return;
    }

    res.status(200).json({ data: data ?? [] });
  } catch (err) {
    console.error('[Curriculum][Phonemes] Error fetching curriculum', err);
    res.status(500).json({ error: 'Internal server error fetching curriculum' });
  }
});

export default router;
