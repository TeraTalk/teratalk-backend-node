import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import {
  UserProfile,
  ProfileCheckResponse,
  DifficultyLevel,
} from '../types/onboarding';

const router = Router();

/// GET /api/profile/check - Check if user profile exists
router.get('/check', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    // Check if profile exists
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Profile not found
      const response: ProfileCheckResponse = {
        hasProfile: false,
      };
      res.json(response);
      return;
    }

    if (error) {
      console.error('Error checking profile:', error);
      res.status(500).json({ error: 'Failed to check profile' });
      return;
    }

    // Profile exists
    const userProfile: UserProfile = {
      userId: profile.user_id,
      speechLevel: profile.speech_level,
      initialDifficulty: profile.initial_difficulty as DifficultyLevel,
      problemSounds: profile.problem_sounds,
      caregiverSchedule: profile.caregiver_schedule,
    };

    const response: ProfileCheckResponse = {
      hasProfile: true,
      profile: userProfile,
    };

    res.json(response);
  } catch (error) {
    console.error('Profile check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

