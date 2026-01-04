import { AIAnalysisResponse } from '../types/evaluation';

/// Mock AI service for speech analysis
/// Simulates realistic AI model behavior with delays and scoring
export class AIService {
  /// Simulate AI analysis of speech pronunciation
  /// Returns a mocked but realistic analysis response
  static async analyzeSpeech(
    word: string,
    audioFile?: Express.Multer.File
  ): Promise<AIAnalysisResponse> {
    // Simulate processing delay (1-2 seconds)
    const delay = 1000 + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Extract expected sound from word (simple heuristic)
    const expectedSound = this.extractExpectedSound(word);

    // Calculate base score based on word complexity
    const baseScore = this.calculateBaseScore(word);

    // Add variation based on audio file metadata (if available)
    let scoreVariation = 0;
    if (audioFile) {
      // Simulate that larger files might indicate longer recordings (better pronunciation)
      const sizeFactor = Math.min(audioFile.size / 100000, 1); // Normalize to 0-1
      scoreVariation = (sizeFactor - 0.5) * 10; // ±5 points based on size
    }

    // Add random variation to simulate real AI uncertainty
    const randomVariation = (Math.random() - 0.5) * 15; // ±7.5 points

    // Calculate final score (60-100 range)
    let finalScore = baseScore + scoreVariation + randomVariation;
    finalScore = Math.max(60, Math.min(100, Math.round(finalScore)));

    // Calculate confidence (higher for scores closer to 100)
    const confidence = 0.7 + (finalScore - 60) / 40 * 0.25; // 0.7-0.95 range

    // Detect sounds (mock phoneme detection)
    const detectedSounds = this.detectSounds(word, finalScore);

    // Generate pronunciation feedback
    const pronunciationFeedback = this.generateFeedback(word, finalScore, expectedSound);

    // Extract phonemes (simplified)
    const phonemes = this.extractPhonemes(word);

    // Calculate accuracy based on score
    const accuracy = finalScore / 100;

    return {
      score: finalScore,
      confidence: Math.round(confidence * 100) / 100,
      detectedSounds,
      pronunciationFeedback,
      phonemes,
      accuracy: Math.round(accuracy * 100) / 100,
    };
  }

  /// Extract expected sound from word (simple heuristic)
  private static extractExpectedSound(word: string): string {
    const upperWord = word.toUpperCase();
    
    // Check for common sound patterns
    if (upperWord.includes('SH') || upperWord.startsWith('SH')) {
      return 'SH';
    }
    if (upperWord.includes('CH')) {
      return 'CH';
    }
    if (upperWord.startsWith('K') || upperWord.includes('CK')) {
      return 'K';
    }
    if (upperWord.startsWith('C') && !upperWord.startsWith('CH')) {
      return 'C';
    }
    if (upperWord.startsWith('S')) {
      return 'S';
    }
    if (upperWord.startsWith('B')) {
      return 'B';
    }
    if (upperWord.startsWith('T')) {
      return 'T';
    }
    if (upperWord.startsWith('M')) {
      return 'M';
    }
    if (upperWord.startsWith('P')) {
      return 'P';
    }
    if (upperWord.startsWith('R')) {
      return 'R';
    }
    if (upperWord.startsWith('L')) {
      return 'L';
    }
    
    // Default to first letter
    return upperWord[0] || 'UNKNOWN';
  }

  /// Calculate base score based on word complexity
  private static calculateBaseScore(word: string): number {
    const length = word.length;
    const complexity = this.getWordComplexity(word);

    // Shorter, simpler words get higher base scores
    let baseScore = 85;

    // Adjust based on length
    if (length > 5) {
      baseScore -= 5;
    }
    if (length > 7) {
      baseScore -= 5;
    }

    // Adjust based on complexity
    if (complexity === 'high') {
      baseScore -= 10;
    } else if (complexity === 'medium') {
      baseScore -= 5;
    }

    return baseScore;
  }

  /// Determine word complexity
  private static getWordComplexity(word: string): 'low' | 'medium' | 'high' {
    const upperWord = word.toUpperCase();
    
    // High complexity: contains multiple consonant clusters, digraphs
    if (
      upperWord.includes('SH') ||
      upperWord.includes('CH') ||
      upperWord.includes('TH') ||
      upperWord.includes('CK') ||
      upperWord.length > 6
    ) {
      return 'high';
    }

    // Medium complexity: moderate length or some clusters
    if (upperWord.length > 4 || upperWord.match(/[BCDFGHJKLMNPQRSTVWXYZ]{2,}/)) {
      return 'medium';
    }

    return 'low';
  }

  /// Mock sound detection
  private static detectSounds(word: string, score: number): string[] {
    const sounds: string[] = [];
    const upperWord = word.toUpperCase();

    // Detect common sounds based on word content
    if (upperWord.includes('SH') || upperWord.startsWith('SH')) {
      sounds.push('SH');
    }
    if (upperWord.includes('CH')) {
      sounds.push('CH');
    }
    if (upperWord.includes('K') || upperWord.includes('CK') || upperWord.includes('C')) {
      sounds.push('K');
    }
    if (upperWord.includes('S')) {
      sounds.push('S');
    }
    if (upperWord.includes('B')) {
      sounds.push('B');
    }
    if (upperWord.includes('T')) {
      sounds.push('T');
    }
    if (upperWord.includes('M')) {
      sounds.push('M');
    }
    if (upperWord.includes('P')) {
      sounds.push('P');
    }
    if (upperWord.includes('R')) {
      sounds.push('R');
    }
    if (upperWord.includes('L')) {
      sounds.push('L');
    }

    // If score is high, add more detected sounds (simulating better detection)
    if (score > 85) {
      const vowels = ['A', 'E', 'I', 'O', 'U'];
      vowels.forEach((vowel) => {
        if (upperWord.includes(vowel) && !sounds.includes(vowel)) {
          sounds.push(vowel);
        }
      });
    }

    return sounds.length > 0 ? sounds : [upperWord[0] || 'UNKNOWN'];
  }

  /// Generate pronunciation feedback
  private static generateFeedback(
    word: string,
    score: number,
    expectedSound: string
  ): string {
    if (score >= 90) {
      return `Excellent pronunciation of "${word}"! The ${expectedSound} sound is very clear and well-articulated.`;
    } else if (score >= 80) {
      return `Good pronunciation of "${word}"! The ${expectedSound} sound is mostly clear, with minor areas for improvement.`;
    } else if (score >= 70) {
      return `Fair pronunciation of "${word}". The ${expectedSound} sound is present but could be clearer. Keep practicing!`;
    } else {
      return `The pronunciation of "${word}" needs improvement. Focus on making the ${expectedSound} sound more distinct.`;
    }
  }

  /// Extract phonemes (simplified mock)
  private static extractPhonemes(word: string): string[] {
    const phonemes: string[] = [];
    const upperWord = word.toUpperCase();

    // Simple phoneme extraction (mock)
    for (let i = 0; i < upperWord.length; i++) {
      const char = upperWord[i];
      const nextChar = upperWord[i + 1];

      // Handle digraphs
      if (char === 'S' && nextChar === 'H') {
        phonemes.push('SH');
        i++; // Skip next character
      } else if (char === 'C' && nextChar === 'H') {
        phonemes.push('CH');
        i++;
      } else if (char === 'C' && nextChar === 'K') {
        phonemes.push('K');
        i++;
      } else if (!['A', 'E', 'I', 'O', 'U'].includes(char)) {
        // Consonants
        phonemes.push(char);
      } else {
        // Vowels
        phonemes.push(char);
      }
    }

    return phonemes.length > 0 ? phonemes : [upperWord[0] || '?'];
  }
}

