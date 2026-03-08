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
      childName: profile.child_name || '',
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

/// Validate profile update request
function validateProfileUpdateRequest(
  body: any
): { valid: boolean; error?: string } {
  const validSpeechLevels = ['beginner', 'intermediate', 'advanced'];

  // At least one field must be provided
  if (
    !body.childName &&
    !body.problemSounds &&
    !body.caregiverSchedule &&
    body.speechLevel === undefined
  ) {
    return {
      valid: false,
      error:
        'At least one field (childName, problemSounds, caregiverSchedule, or speechLevel) must be provided',
    };
  }

  // Validate speechLevel if provided
  if (body.speechLevel !== undefined) {
    if (typeof body.speechLevel !== 'string') {
      return {
        valid: false,
        error: 'speechLevel must be a string',
      };
    }
    if (!validSpeechLevels.includes(body.speechLevel.trim().toLowerCase())) {
      return {
        valid: false,
        error: `speechLevel must be one of: ${validSpeechLevels.join(', ')}`,
      };
    }
  }

  // Validate childName if provided
  if (body.childName !== undefined) {
    if (typeof body.childName !== 'string') {
      return {
        valid: false,
        error: 'childName must be a string',
      };
    }
    if (body.childName.trim().length < 2) {
      return {
        valid: false,
        error: 'childName must be at least 2 characters long',
      };
    }
  }

  // Validate problemSounds if provided
  if (body.problemSounds !== undefined) {
    if (!Array.isArray(body.problemSounds)) {
      return {
        valid: false,
        error: 'problemSounds must be an array',
      };
    }
    if (body.problemSounds.length === 0) {
      return {
        valid: false,
        error: 'At least one problem sound must be selected',
      };
    }
  }

  // Validate caregiverSchedule if provided
  if (body.caregiverSchedule !== undefined) {
    if (typeof body.caregiverSchedule !== 'object' || Array.isArray(body.caregiverSchedule)) {
      return {
        valid: false,
        error: 'caregiverSchedule must be an object',
      };
    }
    if (Object.keys(body.caregiverSchedule).length === 0) {
      return {
        valid: false,
        error: 'At least one schedule time must be selected',
      };
    }
  }

  return { valid: true };
}

/// PUT /api/profile - Update user profile
router.put('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    // Validate request
    const validation = validateProfileUpdateRequest(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
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

    // Build update object
    const updateData: any = {};
    if (req.body.childName !== undefined) {
      updateData.child_name = req.body.childName.trim();
    }
    if (req.body.problemSounds !== undefined) {
      updateData.problem_sounds = req.body.problemSounds;
    }
    if (req.body.caregiverSchedule !== undefined) {
      updateData.caregiver_schedule = req.body.caregiverSchedule;
    }
    if (req.body.speechLevel !== undefined) {
      updateData.speech_level = req.body.speechLevel.trim().toLowerCase();
      updateData.speech_level_set_at = new Date().toISOString();
    }

    // Update profile in Supabase
    const { data: updatedProfile, error: updateError } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating profile:', updateError);
      res.status(500).json({ error: 'Failed to update user profile' });
      return;
    }

    // Return updated user profile
    const userProfile: UserProfile = {
      userId: updatedProfile.user_id,
      childName: updatedProfile.child_name || '',
      speechLevel: updatedProfile.speech_level,
      initialDifficulty: updatedProfile.initial_difficulty as DifficultyLevel,
      problemSounds: updatedProfile.problem_sounds,
      caregiverSchedule: updatedProfile.caregiver_schedule,
    };

    res.status(200).json(userProfile);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


