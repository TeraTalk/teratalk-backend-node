import { NotificationContext, SuggestedWords } from '../types/notifications';

/// Word database organized by category and sound
const WORD_DATABASE: Record<string, Record<string, string[]>> = {
  food: {
    '/k/': ['cake', 'cookie', 'kitchen', 'cook', 'cup', 'corn', 'carrot', 'crackers'],
    '/s/': ['sandwich', 'soup', 'salad', 'sauce', 'spoon', 'strawberry'],
    '/r/': ['rice', 'roll', 'raisin', 'roast'],
    '/l/': ['lunch', 'lemon', 'lettuce', 'lollipop'],
    '/th/': ['thirsty', 'thanks'],
    '/ch/': ['cheese', 'chicken', 'cherry', 'chips'],
    '/sh/': ['shake', 'sherbet'],
    '/f/': ['food', 'fork', 'fruit'],
    '/v/': ['vegetable', 'vanilla'],
  },
  morning: {
    '/k/': ['kitchen', 'cup', 'cereal', 'clock'],
    '/s/': ['sun', 'sleep', 'school', 'shower', 'soap', 'spoon'],
    '/r/': ['run', 'read', 'ready', 'rise'],
    '/l/': ['light', 'lunch', 'learn'],
    '/th/': ['think', 'thank', 'thirsty'],
    '/ch/': ['chair', 'chalk', 'choose'],
    '/sh/': ['shower', 'shirt', 'shoe'],
    '/f/': ['food', 'friend', 'fun'],
    '/v/': ['very', 'visit'],
  },
  afternoon: {
    '/k/': ['car', 'color', 'come', 'crayon'],
    '/s/': ['sun', 'swing', 'slide', 'sand'],
    '/r/': ['run', 'read', 'ride', 'red'],
    '/l/': ['like', 'learn', 'lunch', 'love'],
    '/th/': ['think', 'that', 'this'],
    '/ch/': ['chair', 'chalk', 'choose', 'child'],
    '/sh/': ['share', 'show', 'shoe'],
    '/f/': ['fun', 'friend', 'find'],
    '/v/': ['very', 'visit', 'video'],
  },
  evening: {
    '/k/': ['kitchen', 'cup', 'cook', 'clean'],
    '/s/': ['sleep', 'story', 'snack', 'soap'],
    '/r/': ['read', 'rest', 'relax'],
    '/l/': ['light', 'listen', 'love'],
    '/th/': ['think', 'thank', 'that'],
    '/ch/': ['chair', 'choose', 'chalk'],
    '/sh/': ['shower', 'shirt', 'shoe'],
    '/f/': ['food', 'fun', 'friend'],
    '/v/': ['very', 'visit'],
  },
  activity: {
    '/k/': ['kick', 'catch', 'color', 'climb'],
    '/s/': ['swing', 'slide', 'sing', 'skip'],
    '/r/': ['run', 'ride', 'read', 'roll'],
    '/l/': ['like', 'learn', 'listen', 'love'],
    '/th/': ['think', 'throw', 'that'],
    '/ch/': ['chase', 'choose', 'chalk'],
    '/sh/': ['share', 'show', 'shake'],
    '/f/': ['fun', 'find', 'friend'],
    '/v/': ['very', 'visit', 'video'],
  },
};

/// Generate context-aware message based on time and problem sounds
export function generateContextualMessage(
  context: NotificationContext,
  problemSounds: string[]
): SuggestedWords | null {
  const { time, sound } = context;

  // Determine category based on time
  let category: string;
  switch (time) {
    case 'Morning':
      category = 'morning';
      break;
    case 'Afternoon':
      category = 'afternoon';
      break;
    case 'Evening':
      category = 'evening';
      break;
    case 'Dinner':
      category = 'food';
      break;
    default:
      category = 'activity';
  }

  // If specific sound is provided, use it; otherwise use first problem sound
  const targetSound = sound || problemSounds[0];
  if (!targetSound) {
    console.error(`[Message Generator] No target sound available. Problem sounds: ${problemSounds.join(', ')}`);
    return null;
  }

  // Normalize sound format: ensure it has slashes and is lowercase
  // Database uses format like "/l/", "/k/", "/s/", etc.
  const normalizeSound = (soundStr: string): string => {
    let normalized = soundStr.toLowerCase().trim();
    // Add slashes if not present
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized.endsWith('/')) {
      normalized = normalized + '/';
    }
    return normalized;
  };

  const normalizedTargetSound = normalizeSound(targetSound);
  console.log(`[Message Generator] Normalized target sound: "${targetSound}" -> "${normalizedTargetSound}"`);

  // Get words for this category and sound
  const categoryWords = WORD_DATABASE[category];
  if (!categoryWords) {
    console.error(`[Message Generator] Category "${category}" not found in word database`);
    return null;
  }

  console.log(`[Message Generator] Available sounds in category "${category}": ${Object.keys(categoryWords).join(', ')}`);

  const words = categoryWords[normalizedTargetSound];
  if (!words || words.length === 0) {
    console.log(`[Message Generator] No words found for sound "${normalizedTargetSound}" in category "${category}", trying fallback...`);
    // Fallback: try to find words with any problem sound (normalized)
    for (const ps of problemSounds) {
      const normalizedPs = normalizeSound(ps);
      console.log(`[Message Generator] Trying fallback sound: "${ps}" -> "${normalizedPs}"`);
      const fallbackWords = categoryWords[normalizedPs];
      if (fallbackWords && fallbackWords.length > 0) {
        console.log(`[Message Generator] Found fallback words for sound "${normalizedPs}" in category "${category}"`);
        return {
          words: fallbackWords.slice(0, 5),
          context,
          message: `Try practicing these ${category} words with the ${ps} sound: ${fallbackWords.slice(0, 3).join(', ')}`,
        };
      }
    }
    console.error(`[Message Generator] No words found for any problem sound in category "${category}". Problem sounds: ${problemSounds.join(', ')}`);
    console.error(`[Message Generator] Normalized problem sounds tried: ${problemSounds.map(ps => normalizeSound(ps)).join(', ')}`);
    return null;
  }

  // Generate message
  const selectedWords = words.slice(0, 5);
  const displayWords = selectedWords.slice(0, 3).join(', ');
  const message = `Try practicing these ${category} words with the ${normalizedTargetSound} sound: ${displayWords}`;

  console.log(`[Message Generator] Successfully generated message with ${selectedWords.length} words for sound "${normalizedTargetSound}" in category "${category}"`);

  return {
    words: selectedWords,
    context: {
      ...context,
      category,
      sound: normalizedTargetSound,
    },
    message,
  };
}

/// Get suggested words for a given context
export function getSuggestedWords(
  time: 'Morning' | 'Afternoon' | 'Evening' | 'Dinner',
  problemSounds: string[],
  specificSound?: string
): SuggestedWords | null {
  const context: NotificationContext = {
    time,
    sound: specificSound,
  };

  return generateContextualMessage(context, problemSounds);
}

