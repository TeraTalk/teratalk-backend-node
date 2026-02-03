/// Therapy activity type enum
export type TherapyActivityType =
  | 'warmup_word'
  | 'word_practice'
  | 'question_mcq'
  | 'question_open';

/// Therapy item type enum
export type TherapyItemType = 'word' | 'question';

/// Tongue placement position enum
export type TonguePosition = 'front' | 'middle' | 'back';

/// Therapy difficulty enum
export type TherapyDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

/// Therapy level
export interface TherapyLevel {
  id: number;
  name: string;
  description?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/// Therapy activity
export interface TherapyActivity {
  id: string;
  levelId: number;
  type: TherapyActivityType;
  title: string;
  targetLetter?: string | null;
  difficulty?: TherapyDifficulty | null;
  orderIndex: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/// Therapy item
export interface TherapyItem {
  id: string;
  activityId: string;
  itemType: TherapyItemType;
  payloadJson: Record<string, unknown>;
  orderIndex: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/// Tongue placement
export interface TonguePlacement {
  id: number;
  position: TonguePosition;
  description?: string | null;
  visualGuide?: string | null;
  emojiHint?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/// Database therapy level (matches Supabase table structure)
export interface DatabaseTherapyLevel {
  id: number;
  name: string;
  description: string | null;
  min_age: number | null;
  max_age: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/// Database therapy activity (matches Supabase table structure)
export interface DatabaseTherapyActivity {
  id: string;
  level_id: number;
  type: TherapyActivityType;
  title: string;
  target_letter: string | null;
  difficulty: TherapyDifficulty | null;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/// Database therapy item (matches Supabase table structure)
export interface DatabaseTherapyItem {
  id: string;
  activity_id: string;
  item_type: TherapyItemType;
  payload_json: Record<string, unknown>;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/// Database tongue placement (matches Supabase table structure)
export interface DatabaseTonguePlacement {
  id: number;
  position: TonguePosition;
  description: string | null;
  visual_guide: string | null;
  emoji_hint: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
