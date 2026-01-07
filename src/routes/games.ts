import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

/// PUT /api/games/level - Update user's current game level
router.put('/level', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    // Validate request
    if (req.body.level === undefined) {
      res.status(400).json({ error: 'level is required' });
      return;
    }

    if (typeof req.body.level !== 'number') {
      res.status(400).json({ error: 'level must be a number' });
      return;
    }

    if (req.body.level < 1 || req.body.level > 5) {
      res.status(400).json({ error: 'level must be between 1 and 5' });
      return;
    }

    // Check if profile exists
    const { data: existingProfile, error: checkError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code === 'PGRST116') {
      res.status(404).json({ error: 'Profile not found. Please complete onboarding first.' });
      return;
    }

    if (checkError) {
      console.error('Error checking profile:', checkError);
      res.status(500).json({ error: 'Failed to check profile' });
      return;
    }

    // Update current_game_level
    const { data: updatedProfile, error: updateError } = await supabase
      .from('user_profiles')
      .update({ current_game_level: req.body.level })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating game level:', updateError);
      res.status(500).json({ error: 'Failed to update game level' });
      return;
    }

    res.status(200).json({
      success: true,
      currentGameLevel: updatedProfile.current_game_level,
    });
  } catch (error) {
    console.error('Game level update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
