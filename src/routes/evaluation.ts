import { Router, Request, Response } from 'express';
import { uploadAudio } from '../middleware/upload';
import { authenticate } from '../middleware/auth';
import { SodaService } from '../services/soda_service';
import { PersonalizationService } from '../services/personalization_service';
import {
  EvaluationAnalyzeRequest,
  EvaluationResponse,
  EvaluationSession,
  CreateSessionRequest,
  CreateSessionResponse,
  EvaluationSubmission,
  SessionResultsResponse,
} from '../types/evaluation';

const router = Router();

/// In-memory session storage (for demo purposes)
/// In production, this would be stored in a database
const sessions = new Map<string, EvaluationSession>();

function toSodaResponse(sodaResponse: Record<string, any>) {
  const severityRaw = sodaResponse.severity;
  const severity =
    typeof severityRaw === 'number'
      ? severityRaw
      : typeof severityRaw === 'string'
      ? parseFloat(severityRaw)
      : NaN;
  const safeSeverity = Number.isFinite(severity)
    ? Math.max(0, Math.min(1, severity))
    : 0.5;

  const confidence = Math.max(0, Math.min(1, 1 - safeSeverity));
  const score = Math.round(confidence * 100);

  const detectedSounds = [
    sodaResponse.base_phoneme,
    sodaResponse.target_phoneme,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

  return {
    score,
    confidence,
    detectedSounds: detectedSounds.length > 0 ? detectedSounds : ['UNKNOWN'],
    pronunciationFeedback:
      typeof sodaResponse.error_type === 'string'
        ? `Pronunciation result: ${sodaResponse.error_type}`
        : 'Pronunciation analysis complete.',
    phonemes: detectedSounds,
    accuracy: confidence,
  };
}

/// Extract expected sound from word (helper function)
function extractExpectedSound(word: string): string {
  const upperWord = word.toUpperCase();
  
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
  
  return upperWord[0] || 'UNKNOWN';
}

/// POST /api/evaluation/analyze
/// Analyzes a word pronunciation with audio file
/// Can work with or without authentication for Postman testing
router.post(
  '/analyze',
  (req, res, next) => {
    uploadAudio(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: 'File upload error',
          message: err.message,
        });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const requestId = `eval_analyze_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Extract request data
      const wordFromBody = req.body.word as string | undefined;
      const expectedTextFromBody = req.body.expected_text as string | undefined;
      const expectedText = (expectedTextFromBody || wordFromBody || '').trim();
      const audioFile = req.file;
      const userId = req.body.userId as string | undefined;
      const age = req.body.age ? parseInt(req.body.age as string) : undefined;
      const difficulty = req.body.difficulty as string | undefined;
      const problemSounds = req.body.problemSounds
        ? (Array.isArray(req.body.problemSounds)
            ? req.body.problemSounds
            : [req.body.problemSounds])
        : undefined;
      const speechLevel = req.body.speechLevel as string | undefined;

      console.log('[Evaluation][Analyze] Request received', {
        requestId,
        hasWord: Boolean(wordFromBody),
        hasExpectedText: Boolean(expectedTextFromBody),
        expectedTextLength: expectedText.length,
        hasAudio: Boolean(audioFile),
        audio: audioFile
          ? {
              originalname: audioFile.originalname,
              mimetype: audioFile.mimetype,
              size: audioFile.size,
            }
          : null,
        userId: userId || null,
        age: age ?? null,
        difficulty: difficulty || null,
        speechLevel: speechLevel || null,
      });

      // Validate required fields
      if (!expectedText) {
        res.status(400).json({
          error: 'expected_text or word is required and must be a non-empty string',
        });
        return;
      }

      if (!audioFile) {
        res.status(400).json({
          error: 'Audio file is required',
        });
        return;
      }

      console.log('[Evaluation][Analyze] Forwarding to SODA', {
        requestId,
        expectedText,
        endpointHint: process.env.SODA_ANALYZE_URL || 'default',
      });
      const sodaResponse = await SodaService.analyzeSpeech(expectedText, audioFile);
      console.log('[Evaluation][Analyze] SODA response received', {
        requestId,
        keys: Object.keys(sodaResponse),
        predicted: sodaResponse.predicted ?? null,
        severity: sodaResponse.severity ?? null,
        error_type: sodaResponse.error_type ?? null,
        therapy_level: sodaResponse.therapy_level ?? null,
      });
      res.json(sodaResponse);
    } catch (error) {
      console.error('[Evaluation][Analyze] Error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/// POST /api/evaluation/session
/// Creates a new evaluation session
router.post('/session', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const body = req.body as CreateSessionRequest;

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create session
    const session: EvaluationSession = {
      sessionId,
      userId: userId || body.userId,
      createdAt: new Date().toISOString(),
      submissions: [],
      metadata: body.metadata || {},
    };

    // Store session
    sessions.set(sessionId, session);

    const response: CreateSessionResponse = {
      sessionId,
      createdAt: session.createdAt,
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/// POST /api/evaluation/session/:sessionId/submit
/// Submits a word+audio for a specific session
router.post(
  '/session/:sessionId/submit',
  authenticate,
  (req, res, next) => {
    uploadAudio(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: 'File upload error',
          message: err.message,
        });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const requestId = `eval_submit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sessionId = req.params.sessionId;
      const userId = req.userId;

      // Get session
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Verify session belongs to user (if userId is set)
      if (session.userId && userId && session.userId !== userId) {
        res.status(403).json({ error: 'Access denied to this session' });
        return;
      }

      // Extract request data
      const wordFromBody = req.body.word as string | undefined;
      const expectedTextFromBody = req.body.expected_text as string | undefined;
      const word = (wordFromBody || expectedTextFromBody || '').trim();
      const audioFile = req.file;
      const age = req.body.age ? parseInt(req.body.age as string) : undefined;
      const difficulty = req.body.difficulty as string | undefined;
      const problemSounds = req.body.problemSounds
        ? (Array.isArray(req.body.problemSounds)
            ? req.body.problemSounds
            : [req.body.problemSounds])
        : undefined;
      const speechLevel = req.body.speechLevel as string | undefined;

      console.log('[Evaluation][SessionSubmit] Request received', {
        requestId,
        sessionId,
        userId: userId || null,
        word,
        hasAudio: Boolean(audioFile),
        audio: audioFile
          ? {
              originalname: audioFile.originalname,
              mimetype: audioFile.mimetype,
              size: audioFile.size,
            }
          : null,
        age: age ?? null,
        difficulty: difficulty || null,
        speechLevel: speechLevel || null,
      });

      // Validate required fields
      if (!word || typeof word !== 'string' || word.trim().length === 0) {
        res.status(400).json({
          error: 'Word is required and must be a non-empty string',
        });
        return;
      }

      // Extract expected sound
      const expectedSound = extractExpectedSound(word);

      // Get SODA analysis
      const sodaResponse = await SodaService.analyzeSpeech(word, audioFile);
      const aiResponse = toSodaResponse(sodaResponse);
      console.log('[Evaluation][SessionSubmit] SODA response mapped', {
        requestId,
        sessionId,
        score: aiResponse.score,
        confidence: aiResponse.confidence,
        detectedSounds: aiResponse.detectedSounds,
      });

      // Build personalization context
      const context = await PersonalizationService.buildContext(
        session.userId || userId,
        age,
        speechLevel,
        difficulty,
        problemSounds
      );

      // Apply personalization
      const personalizedResponse = await PersonalizationService.personalizeResponse(
        aiResponse,
        word,
        expectedSound,
        context
      );

      // Create submission
      const submission: EvaluationSubmission = {
        word,
        expectedSound,
        score: personalizedResponse.score,
        feedback: personalizedResponse.feedback,
        timestamp: new Date().toISOString(),
        audioMetadata: audioFile
          ? {
              filename: audioFile.originalname,
              size: audioFile.size,
              mimetype: audioFile.mimetype,
            }
          : undefined,
      };

      // Add submission to session
      session.submissions.push(submission);
      sessions.set(sessionId, session);

      // Return response with submission info
      res.json({
        ...personalizedResponse,
        submissionId: submission.timestamp,
        sessionId,
      });
      console.log('[Evaluation][SessionSubmit] Submission saved', {
        requestId,
        sessionId,
        submissionTimestamp: submission.timestamp,
        score: personalizedResponse.score,
      });
    } catch (error) {
      console.error('[Evaluation][SessionSubmit] Error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/// GET /api/evaluation/session/:sessionId
/// Retrieves evaluation session results
router.get('/session/:sessionId', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const userId = req.userId;

    // Get session
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify session belongs to user (if userId is set)
    if (session.userId && userId && session.userId !== userId) {
      res.status(403).json({ error: 'Access denied to this session' });
      return;
    }

    // Calculate statistics
    const totalSubmissions = session.submissions.length;
    if (totalSubmissions === 0) {
      res.json({
        sessionId,
        userId: session.userId,
        createdAt: session.createdAt,
        totalSubmissions: 0,
        averageScore: 0,
        submissions: [],
        soundBreakdown: {},
        recommendations: ['Start submitting words to see results!'],
        level: 'Not Started',
        levelMessage: 'No submissions yet',
      });
      return;
    }

    const scores = session.submissions.map((s) => s.score);
    const averageScore =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;

    // Group by sound
    const soundBreakdown: Record<
      string,
      { count: number; averageScore: number; words: string[] }
    > = {};

    session.submissions.forEach((submission) => {
      const sound = submission.expectedSound;
      if (!soundBreakdown[sound]) {
        soundBreakdown[sound] = {
          count: 0,
          averageScore: 0,
          words: [],
        };
      }
      soundBreakdown[sound].count++;
      soundBreakdown[sound].words.push(submission.word);
    });

    // Calculate average per sound
    Object.keys(soundBreakdown).forEach((sound) => {
      const soundSubmissions = session.submissions.filter(
        (s) => s.expectedSound === sound
      );
      const soundScores = soundSubmissions.map((s) => s.score);
      soundBreakdown[sound].averageScore =
        soundScores.reduce((sum, score) => sum + score, 0) / soundScores.length;
    });

    // Determine level
    let level: string;
    let levelMessage: string;
    if (averageScore >= 90) {
      level = 'Excellent';
      levelMessage = "Excellent! You're doing great!";
    } else if (averageScore >= 75) {
      level = 'Good';
      levelMessage = 'Good! Keep practicing!';
    } else if (averageScore >= 60) {
      level = 'Improving';
      levelMessage = "You're improving! Keep it up!";
    } else {
      level = 'Needs Practice';
      levelMessage = "Keep practicing! You'll get better!";
    }

    // Generate recommendations
    const recommendations: string[] = [];
    const problemSounds: string[] = [];

    // Find sounds that need practice (score < 75)
    Object.keys(soundBreakdown).forEach((sound) => {
      if (soundBreakdown[sound].averageScore < 75) {
        problemSounds.push(sound);
        recommendations.push(
          `Focus on practicing the ${sound} sound - your average score is ${Math.round(soundBreakdown[sound].averageScore)}.`
        );
      }
    });

    if (recommendations.length === 0) {
      recommendations.push(
        'Great work! Continue practicing to maintain your excellent performance.'
      );
    }

    const response: SessionResultsResponse = {
      sessionId,
      userId: session.userId,
      createdAt: session.createdAt,
      totalSubmissions,
      averageScore: Math.round(averageScore * 100) / 100,
      submissions: session.submissions,
      soundBreakdown,
      recommendations: recommendations.slice(0, 5), // Top 5 recommendations
      level,
      levelMessage,
    };

    res.json(response);
  } catch (error) {
    console.error('Session results error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

