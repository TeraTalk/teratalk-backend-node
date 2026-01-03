/// Difficulty levels for speech therapy
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

/// Onboarding request from frontend
export interface OnboardingRequest {
  childName: string;
  childAge: number;
  speechLevel: string;
  problemSounds: string[];
  caregiverSchedule: Record<string, string[]>;
}

/// User profile response
export interface UserProfile {
  userId: string;
  childName: string;
  speechLevel: string;
  initialDifficulty: DifficultyLevel;
  problemSounds: string[];
  caregiverSchedule: Record<string, string[]>;
}

/// Profile check response
export interface ProfileCheckResponse {
  hasProfile: boolean;
  profile?: UserProfile;
}

/// Database user profile (matches Supabase table structure)
export interface DatabaseUserProfile {
  id: string;
  user_id: string;
  child_name: string;
  child_age: number;
  speech_level: string;
  initial_difficulty: string;
  problem_sounds: string[];
  caregiver_schedule: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}


