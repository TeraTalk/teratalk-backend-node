import axios from 'axios';
import FormData from 'form-data';
import { AIAnalysisResponse } from '../types/evaluation';

/// AI service for speech analysis
/// Calls external ngrok API for real speech detection
export class AIService {
  private static readonly NGROK_API_URL = 
    process.env.NGROK_API_URL || 'https://mixible-unquizzable-audriana.ngrok-free.dev/api/v1/detect';

  /// Analyze speech pronunciation using ngrok API
  /// Returns analysis response with score, confidence, and feedback
  static async analyzeSpeech(
    word: string,
    audioFile?: Express.Multer.File
  ): Promise<AIAnalysisResponse> {
    // If no audio file, fall back to mock (for testing)
    if (!audioFile) {
      console.log('[AIService] No audio file provided, using mock analysis');
      return this.mockAnalysis(word);
    }

    console.log('[AIService] Audio received:', {
      filename: audioFile.originalname,
      size: audioFile.size,
      mimetype: audioFile.mimetype,
      word: word,
    });

    try {
      // Create form data for multipart request
      const formData = new FormData();
      formData.append('audio', audioFile.buffer, {
        filename: audioFile.originalname || 'audio.m4a',
        contentType: audioFile.mimetype || 'audio/m4a',
      });
      formData.append('target_text', word);

      console.log('[AIService] Calling ngrok API:', this.NGROK_API_URL);

      // Call ngrok API
      const response = await axios.post(this.NGROK_API_URL, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000, // 30 second timeout
      });

      console.log('[AIService] Ngrok API response received:', {
        status: response.status,
        hasData: !!response.data,
        severity: response.data?.severity,
        confidence: response.data?.confidence,
      });

      // Map ngrok API response to our format
      const mappedResponse = this.mapNgrokResponse(response.data, word);
      
      console.log('[AIService] Mapped response:', {
        score: mappedResponse.score,
        confidence: mappedResponse.confidence,
      });

      return mappedResponse;
    } catch (error) {
      console.error('[AIService] Error calling ngrok API:', error);
      
      // If API call fails, fall back to mock
      if (axios.isAxiosError(error)) {
        console.error('[AIService] API Error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        });
      }
      
      console.log('[AIService] Falling back to mock analysis');
      return this.mockAnalysis(word);
    }
  }

  /// Map ngrok API response to AIAnalysisResponse format
  private static mapNgrokResponse(apiResponse: any, word: string): AIAnalysisResponse {
    // Extract data from ngrok API response
    const severity = apiResponse.severity || 0.5; // 0-1, higher = more errors
    const confidence = apiResponse.confidence || 0.8; // 0-1
    const errorCategory = apiResponse.error_category || 'unknown';
    const processType = apiResponse.process_type || 'unknown';
    const expectedText = apiResponse.expected_text || word;
    const predictedText = apiResponse.predicted_text || word;
    const expectedPhonemes = apiResponse.expected_phonemes || [];
    const predictedPhonemes = apiResponse.predicted_phonemes || [];

    // Convert severity (0-1, higher = worse) to score (0-100, higher = better)
    // score = (1 - severity) * 100
    const score = Math.round((1 - severity) * 100);
    // Ensure score is in valid range
    const clampedScore = Math.max(0, Math.min(100, score));

    // Extract detected sounds from phonemes
    const detectedSounds = this.extractSoundsFromPhonemes(predictedPhonemes);

    // Generate pronunciation feedback based on error category and process type
    const pronunciationFeedback = this.generateFeedbackFromApi(
      word,
      clampedScore,
      errorCategory,
      processType,
      expectedText,
      predictedText
    );

    // Use predicted phonemes or fallback to extracted phonemes
    const phonemes = predictedPhonemes.length > 0 
      ? predictedPhonemes 
      : this.extractPhonemes(word);

    // Calculate accuracy (inverse of severity)
    const accuracy = 1 - severity;

    return {
      score: clampedScore,
      confidence: Math.round(confidence * 100) / 100,
      detectedSounds,
      pronunciationFeedback,
      phonemes,
      accuracy: Math.round(accuracy * 100) / 100,
    };
  }

  /// Extract sounds from phonemes array
  private static extractSoundsFromPhonemes(phonemes: string[]): string[] {
    const sounds: string[] = [];
    const processed = new Set<string>();

    for (const phoneme of phonemes) {
      // Extract individual sounds from phoneme strings
      const upperPhoneme = phoneme.toUpperCase();
      
      // Check for common sound patterns
      if (upperPhoneme.includes('SH') && !processed.has('SH')) {
        sounds.push('SH');
        processed.add('SH');
      }
      if (upperPhoneme.includes('CH') && !processed.has('CH')) {
        sounds.push('CH');
        processed.add('CH');
      }
      if ((upperPhoneme.includes('K') || upperPhoneme.includes('CK')) && !processed.has('K')) {
        sounds.push('K');
        processed.add('K');
      }
      if (upperPhoneme.includes('S') && !processed.has('S')) {
        sounds.push('S');
        processed.add('S');
      }
    }

    return sounds.length > 0 ? sounds : ['UNKNOWN'];
  }

  /// Generate feedback from API response data
  private static generateFeedbackFromApi(
    word: string,
    score: number,
    errorCategory: string,
    processType: string,
    expectedText: string,
    predictedText: string
  ): string {
    if (score >= 90) {
      return `Excellent pronunciation of "${word}"! Your pronunciation matches "${expectedText}" very well.`;
    } else if (score >= 80) {
      return `Good pronunciation of "${word}"! You said "${predictedText}" which is close to "${expectedText}". Keep practicing!`;
    } else if (score >= 70) {
      return `Fair pronunciation. You said "${predictedText}" but the target was "${expectedText}". The ${errorCategory} error (${processType}) needs attention.`;
    } else {
      return `The pronunciation needs improvement. You said "${predictedText}" instead of "${expectedText}". Focus on the ${errorCategory} error (${processType}).`;
    }
  }

  /// Mock analysis fallback (original mock implementation)
  private static async mockAnalysis(word: string): Promise<AIAnalysisResponse> {
    // Simulate processing delay (1-2 seconds)
    const delay = 1000 + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Extract expected sound from word (simple heuristic)
    const expectedSound = this.extractExpectedSound(word);

    // Calculate base score based on word complexity
    const baseScore = this.calculateBaseScore(word);

    // Add random variation to simulate real AI uncertainty
    const randomVariation = (Math.random() - 0.5) * 15; // ±7.5 points

    // Calculate final score (60-100 range)
    let finalScore = baseScore + randomVariation;
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

