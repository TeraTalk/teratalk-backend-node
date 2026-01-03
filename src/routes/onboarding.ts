import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticate } from '../middleware/auth';
import {
  OnboardingRequest,
  UserProfile,
  DifficultyLevel,
} from '../types/onboarding';

const router = Router();

/// Assign difficulty level based on age and speech level
function assignDifficulty(
  age: number,
  speechLevel: string
): DifficultyLevel {
  const level = speechLevel.toLowerCase();

  // Simple rule-based assignment
  if (age < 5) {
    // Young children start at beginner
    return 'beginner';
  } else if (age >= 5 && age <= 8) {
    // Middle age group
    if (level === 'beginner') {
      return 'beginner';
    } else if (level === 'intermediate') {
      return 'intermediate';
    } else {
      return 'intermediate';
    }
  } else {
    // Older children (9-12)
    if (level === 'beginner') {
      return 'intermediate';
    } else if (level === 'intermediate') {
      return 'intermediate';
    } else {
      return 'advanced';
    }
  }
}

/// Validate onboarding request
function validateOnboardingRequest(
  body: any
): { valid: boolean; error?: string } {
  if (!body.childName || typeof body.childName !== 'string') {
    return {
      valid: false,
      error: 'childName is required and must be a string',
    };
  }

  if (body.childName.trim().length < 2) {
    return {
      valid: false,
      error: 'childName must be at least 2 characters long',
    };
  }

  if (!body.childAge || typeof body.childAge !== 'number') {
    return { valid: false, error: 'childAge is required and must be a number' };
  }

  if (body.childAge < 2 || body.childAge > 12) {
    return {
      valid: false,
      error: 'childAge must be between 2 and 12 years',
    };
  }

  if (!body.speechLevel || typeof body.speechLevel !== 'string') {
    return {
      valid: false,
      error: 'speechLevel is required and must be a string',
    };
  }

  const validSpeechLevels = ['beginner', 'intermediate', 'advanced'];
  if (!validSpeechLevels.includes(body.speechLevel.toLowerCase())) {
    return {
      valid: false,
      error: `speechLevel must be one of: ${validSpeechLevels.join(', ')}`,
    };
  }

  if (!Array.isArray(body.problemSounds)) {
    return {
      valid: false,
      error: 'problemSounds is required and must be an array',
    };
  }

  if (body.problemSounds.length === 0) {
    return {
      valid: false,
      error: 'At least one problem sound must be selected',
    };
  }

  if (!body.caregiverSchedule || typeof body.caregiverSchedule !== 'object') {
    return {
      valid: false,
      error: 'caregiverSchedule is required and must be an object',
    };
  }

  if (Object.keys(body.caregiverSchedule).length === 0) {
    return {
      valid: false,
      error: 'At least one caregiver schedule time must be selected',
    };
  }

  return { valid: true };
}

/// POST /api/onboarding - Submit onboarding data
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    // Validate request
    const validation = validateOnboardingRequest(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const onboardingData: OnboardingRequest = req.body;

    // Check if profile already exists
    const { data: existingProfile, error: checkError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is "not found" error, which is expected for new profiles
      console.error('Error checking existing profile:', checkError);
      res.status(500).json({ error: 'Failed to check existing profile' });
      return;
    }

    if (existingProfile) {
      res.status(409).json({ error: 'Profile already exists for this user' });
      return;
    }

    // Assign difficulty level
    const difficulty = assignDifficulty(
      onboardingData.childAge,
      onboardingData.speechLevel
    );

    // Create user profile in Supabase
    const { data: profile, error: insertError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: userId,
        child_name: onboardingData.childName.trim(),
        child_age: onboardingData.childAge,
        speech_level: onboardingData.speechLevel.toLowerCase(),
        initial_difficulty: difficulty,
        problem_sounds: onboardingData.problemSounds,
        caregiver_schedule: onboardingData.caregiverSchedule,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating profile:', insertError);
      res.status(500).json({ error: 'Failed to create user profile' });
      return;
    }

    // Initialize daily target sound plan (placeholder)
    // TODO: Implement actual sound plan initialization logic
    const dailyTargetSoundPlan = {
      sounds: onboardingData.problemSounds,
      difficulty: difficulty,
      createdAt: new Date().toISOString(),
    };

    // Return user profile
    const userProfile: UserProfile = {
      userId: userId,
      childName: onboardingData.childName.trim(),
      speechLevel: onboardingData.speechLevel,
      initialDifficulty: difficulty,
      problemSounds: onboardingData.problemSounds,
      caregiverSchedule: onboardingData.caregiverSchedule,
    };

    res.status(201).json(userProfile);
  } catch (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;

