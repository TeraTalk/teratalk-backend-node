import { supabase } from '../config/supabase';
import {
  PersonalizationContext,
  AIAnalysisResponse,
  EvaluationResponse,
} from '../types/evaluation';

/// Personalization service for adjusting evaluation based on user profile
export class PersonalizationService {
  /// Fetch user profile from database
  static async fetchUserProfile(
    userId: string
  ): Promise<PersonalizationContext['userProfile'] | null> {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('child_age, speech_level, initial_difficulty, problem_sounds')
        .eq('user_id', userId)
        .single();

      if (error || !profile) {
        return null;
      }

      return {
        childAge: profile.child_age,
        speechLevel: profile.speech_level,
        initialDifficulty: profile.initial_difficulty,
        problemSounds: profile.problem_sounds || [],
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  /// Build personalization context from request and database
  static async buildContext(
    userId?: string,
    age?: number,
    speechLevel?: string,
    difficulty?: string,
    problemSounds?: string[]
  ): Promise<PersonalizationContext> {
    let userProfile = null;

    // Fetch user profile from database if userId is provided
    if (userId) {
      userProfile = await this.fetchUserProfile(userId);
    }

    // Combine database profile with request parameters
    // Request parameters take precedence if provided
    const finalAge = age || userProfile?.childAge;
    const finalSpeechLevel = speechLevel || userProfile?.speechLevel;
    const finalDifficulty = difficulty || userProfile?.initialDifficulty;
    const finalProblemSounds =
      problemSounds && problemSounds.length > 0
        ? problemSounds
        : userProfile?.problemSounds || [];

    return {
      userId,
      age: finalAge,
      speechLevel: finalSpeechLevel,
      difficulty: finalDifficulty,
      problemSounds: finalProblemSounds,
      userProfile: userProfile || undefined,
    };
  }

  /// Adjust AI analysis score based on personalization context
  static adjustScore(
    aiResponse: AIAnalysisResponse,
    context: PersonalizationContext,
    expectedSound: string
  ): number {
    let adjustedScore = aiResponse.score;

    // Adjust based on age (younger children get more lenient scoring)
    if (context.age) {
      if (context.age < 5) {
        // Very young: add 5-10 points
        adjustedScore += 5 + Math.random() * 5;
      } else if (context.age < 7) {
        // Young: add 2-5 points
        adjustedScore += 2 + Math.random() * 3;
      } else if (context.age >= 9) {
        // Older: slightly stricter (subtract 0-3 points)
        adjustedScore -= Math.random() * 3;
      }
    }

    // Adjust based on speech level
    if (context.speechLevel) {
      const level = context.speechLevel.toLowerCase();
      if (level === 'beginner') {
        // More lenient for beginners
        adjustedScore += 3 + Math.random() * 4;
      } else if (level === 'advanced') {
        // Stricter for advanced
        adjustedScore -= 2 + Math.random() * 3;
      }
    }

    // Adjust based on problem sounds
    // If the expected sound is NOT a problem sound, be more lenient
    if (context.problemSounds && context.problemSounds.length > 0) {
      const isProblemSound = context.problemSounds
        .map((s) => s.toUpperCase())
        .includes(expectedSound.toUpperCase());

      if (!isProblemSound) {
        // Not a problem sound: add 2-5 points (easier to pronounce correctly)
        adjustedScore += 2 + Math.random() * 3;
      } else {
        // Problem sound: slightly more lenient (they're working on it)
        adjustedScore += 1 + Math.random() * 2;
      }
    }

    // Ensure score stays in 60-100 range
    adjustedScore = Math.max(60, Math.min(100, Math.round(adjustedScore)));

    return adjustedScore;
  }

  /// Generate personalized feedback message
  static generatePersonalizedFeedback(
    word: string,
    score: number,
    context: PersonalizationContext,
    expectedSound: string
  ): string {
    const age = context.age;
    const isProblemSound =
      context.problemSounds &&
      context.problemSounds
        .map((s) => s.toUpperCase())
        .includes(expectedSound.toUpperCase());

    // Age-appropriate feedback
    let feedback = '';

    if (age && age < 5) {
      // Very young children - simple, encouraging
      if (score >= 90) {
        feedback = `Wow! You said "${word}" so well! Great job! 🌟`;
      } else if (score >= 80) {
        feedback = `Good job saying "${word}"! You're doing great! Keep it up!`;
      } else if (score >= 70) {
        feedback = `Nice try with "${word}"! Let's practice a little more.`;
      } else {
        feedback = `You're learning to say "${word}"! Keep practicing, you'll get it!`;
      }
    } else if (age && age < 8) {
      // Young children - encouraging with guidance
      if (score >= 90) {
        feedback = `Excellent! Your pronunciation of "${word}" is very clear!`;
      } else if (score >= 80) {
        feedback = `Good work on "${word}"! The ${expectedSound} sound is coming along nicely.`;
      } else if (score >= 70) {
        feedback = `You're getting better at "${word}"! Try to make the ${expectedSound} sound a bit clearer.`;
      } else {
        feedback = `Keep practicing "${word}"! Focus on making the ${expectedSound} sound more distinct.`;
      }
    } else {
      // Older children - more detailed feedback
      if (score >= 90) {
        feedback = `Excellent pronunciation! The ${expectedSound} sound in "${word}" is very well articulated.`;
      } else if (score >= 80) {
        feedback = `Good pronunciation of "${word}"! The ${expectedSound} sound is mostly clear, with minor room for improvement.`;
      } else if (score >= 70) {
        feedback = `Fair pronunciation. The ${expectedSound} sound in "${word}" is present but could be clearer. Keep practicing!`;
      } else {
        feedback = `The ${expectedSound} sound in "${word}" needs more work. Focus on articulation and clarity.`;
      }
    }

    // Add problem sound specific encouragement
    if (isProblemSound && score < 85) {
      feedback += ` Remember, ${expectedSound} is a sound you're working on - every practice helps!`;
    }

    return feedback;
  }

  /// Generate personalized recommendations
  static generateRecommendations(
    score: number,
    context: PersonalizationContext,
    expectedSound: string,
    word: string
  ): string[] {
    const recommendations: string[] = [];
    const isProblemSound =
      context.problemSounds &&
      context.problemSounds
        .map((s) => s.toUpperCase())
        .includes(expectedSound.toUpperCase());

    // Score-based recommendations
    if (score < 70) {
      recommendations.push(
        `Practice saying "${word}" slowly, focusing on the ${expectedSound} sound.`
      );
      recommendations.push(
        `Try breaking down "${word}" into smaller parts and practice each part.`
      );
    } else if (score < 80) {
      recommendations.push(
        `Continue practicing "${word}" to make the ${expectedSound} sound even clearer.`
      );
    } else if (score < 90) {
      recommendations.push(
        `Great progress! Keep practicing "${word}" to perfect the ${expectedSound} sound.`
      );
    } else {
      recommendations.push(
        `Excellent work! You've mastered "${word}"! Try similar words with the ${expectedSound} sound.`
      );
    }

    // Problem sound specific recommendations
    if (isProblemSound) {
      recommendations.push(
        `Since ${expectedSound} is a sound you're working on, try practicing it in different words.`
      );
    }

    // Age-appropriate recommendations
    if (context.age && context.age < 6) {
      recommendations.push(
        `Practice with a parent or caregiver - they can help you hear the sounds better!`
      );
    }

    // Speech level recommendations
    if (context.speechLevel) {
      const level = context.speechLevel.toLowerCase();
      if (level === 'beginner') {
        recommendations.push(
          `As a beginner, take your time and practice regularly. Progress comes with consistency!`
        );
      } else if (level === 'advanced') {
        recommendations.push(
          `You're at an advanced level - focus on fine-tuning your pronunciation for clarity.`
        );
      }
    }

    return recommendations.slice(0, 3); // Return top 3 recommendations
  }

  /// Apply personalization to AI response
  static async personalizeResponse(
    aiResponse: AIAnalysisResponse,
    word: string,
    expectedSound: string,
    context: PersonalizationContext
  ): Promise<EvaluationResponse> {
    // Adjust score based on context
    const adjustedScore = this.adjustScore(aiResponse, context, expectedSound);

    // Generate personalized feedback
    const feedback = this.generatePersonalizedFeedback(
      word,
      adjustedScore,
      context,
      expectedSound
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      adjustedScore,
      context,
      expectedSound,
      word
    );

    return {
      score: adjustedScore,
      confidence: aiResponse.confidence,
      feedback,
      soundAnalysis: {
        detectedSounds: aiResponse.detectedSounds,
        expectedSound,
        accuracy: aiResponse.accuracy,
      },
      personalizedRecommendations: recommendations,
      pronunciationFeedback: aiResponse.pronunciationFeedback,
      timestamp: new Date().toISOString(),
    };
  }
}

