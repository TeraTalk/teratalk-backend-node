import { Router, Request, Response } from 'express';
import { uploadAudio } from '../middleware/upload';
import { authenticate } from '../middleware/auth';
import { SodaService } from '../services/soda_service';
import { PersonalizationService } from '../services/personalization_service';
import { supabase } from '../config/supabase';
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
const MIN_GAME_LEVEL = 2;
const MAX_GAME_LEVEL = 5;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampGameLevel(level: number): number {
  return Math.max(MIN_GAME_LEVEL, Math.min(MAX_GAME_LEVEL, Math.round(level)));
}

function parseLevel(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return clampGameLevel(parsed);
}

function difficultyToLevel(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'beginner') return 2;
  if (normalized === 'intermediate') return 3;
  if (normalized === 'advanced') return 5;

  const numeric = toNumber(normalized);
  return numeric === null ? null : clampGameLevel(numeric);
}

function levelToDifficulty(level: number): 'beginner' | 'intermediate' | 'advanced' {
  if (level <= 2) return 'beginner';
  if (level <= 4) return 'intermediate';
  return 'advanced';
}

async function getOrInitializeUserLevel(
  userId: string,
  requestId: string
): Promise<number | null> {
  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('initial_difficulty')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      console.warn('[Evaluation][Analyze] Unable to fetch profile for level', {
        requestId,
        userId,
        error: error?.message || null,
      });
      return null;
    }

    const parsedLevel = difficultyToLevel(profile.initial_difficulty);
    if (parsedLevel !== null) {
      return parsedLevel;
    }

    const fallbackLevel = MIN_GAME_LEVEL;
    const fallbackDifficulty = levelToDifficulty(fallbackLevel);
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ initial_difficulty: fallbackDifficulty })
      .eq('user_id', userId);

    if (updateError) {
      console.warn('[Evaluation][Analyze] Failed to initialize missing difficulty', {
        requestId,
        userId,
        fallbackDifficulty,
        message: updateError.message,
      });
      return fallbackLevel;
    }

    console.log('[Evaluation][Analyze] Initialized missing user level', {
      requestId,
      userId,
      fallbackLevel,
      fallbackDifficulty,
    });
    return fallbackLevel;
  } catch (error) {
    console.warn('[Evaluation][Analyze] Unexpected level initialization error', {
      requestId,
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function persistUserLevel(
  userId: string,
  level: number,
  requestId: string
): Promise<void> {
  const bounded = clampGameLevel(level);
  const difficulty = levelToDifficulty(bounded);

  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ initial_difficulty: difficulty })
      .eq('user_id', userId);

    if (error) {
      console.warn('[Evaluation][Analyze] Failed to persist user level', {
        requestId,
        userId,
        level: bounded,
        difficulty,
        message: error.message,
      });
      return;
    }

    console.log('[Evaluation][Analyze] User level persisted', {
      requestId,
      userId,
      level: bounded,
      difficulty,
    });
  } catch (error) {
    console.warn('[Evaluation][Analyze] Unexpected level persistence error', {
      requestId,
      userId,
      level: bounded,
      difficulty,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter((v) => v.length > 0);
        }
      } catch {
        // ignore JSON parse errors and fallback to comma split
      }
    }
    return trimmed
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return undefined;
}

async function resolveOptionalUserId(req: Request): Promise<string | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.substring(7);
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return undefined;
    }
    return user.id;
  } catch {
    return undefined;
  }
}

function buildGamePersonalization(
  sodaResponse: Record<string, any>,
  context: Awaited<ReturnType<typeof PersonalizationService.buildContext>>,
  params: {
    currentLevel?: number;
    attempt?: number;
    playerMode?: string;
  }
) {
  const severity =
    toNumber(sodaResponse.severity) ??
    toNumber(sodaResponse.severity_text) ??
    toNumber(sodaResponse.severity_phoneme);
  const boundedSeverity =
    severity === null ? null : Math.max(0, Math.min(1, severity));

  const currentLevel = clampGameLevel(params.currentLevel || MIN_GAME_LEVEL);
  const attempt = Math.max(1, Math.min(5, params.attempt || 1));
  const playerMode = params.playerMode === 'with_guardian' ? 'with_guardian' : 'alone';
  const therapyLevel =
    typeof sodaResponse.therapy_level === 'string'
      ? sodaResponse.therapy_level.toLowerCase()
      : '';

  // Conservative difficulty policy:
  // - Do not increase difficulty automatically.
  // - Reduce by 1 only after repeated poor attempts.
  let nextDifficulty = currentLevel;
  if (boundedSeverity !== null) {
    const isPoorAttempt = boundedSeverity >= 0.65;
    if (isPoorAttempt && attempt >= 3 && currentLevel > 2) {
      nextDifficulty = currentLevel - 1;
    }
  }

  const focusSounds = (
    context.problemSounds && context.problemSounds.length > 0
      ? context.problemSounds
      : [sodaResponse.base_phoneme, sodaResponse.target_phoneme]
  )
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, 3);

  let hintTone: 'light' | 'supportive' | 'direct';
  if (boundedSeverity === null || boundedSeverity <= 0.35) {
    hintTone = 'light';
  } else if (boundedSeverity <= 0.7) {
    hintTone = 'supportive';
  } else {
    hintTone = 'direct';
  }

  const allowRetry =
    boundedSeverity === null || (boundedSeverity <= 0.7 && attempt < 3);

  const suggestGuardianAssist =
    playerMode === 'with_guardian' &&
    (attempt >= 2 || therapyLevel === 'high' || (boundedSeverity !== null && boundedSeverity > 0.6));

  return {
    nextDifficulty,
    focusSounds,
    hintTone,
    allowRetry,
    suggestGuardianAssist,
    playerMode,
  };
}

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
      const tokenUserId = await resolveOptionalUserId(req);
      const userId = tokenUserId || (req.body.userId as string | undefined);
      const age = req.body.age ? parseInt(req.body.age as string) : undefined;
      const levelFromBody = parseLevel(req.body.level);
      const profileLevel = userId
        ? await getOrInitializeUserLevel(userId, requestId)
        : null;
      const effectiveLevel = levelFromBody ?? profileLevel ?? MIN_GAME_LEVEL;
      const difficulty =
        (req.body.difficulty as string | undefined) ||
        (profileLevel !== null ? levelToDifficulty(profileLevel) : undefined);
      const problemSounds = parseStringArray(req.body.problemSounds);
      const speechLevel = req.body.speechLevel as string | undefined;
      const attempt = req.body.attempt ? parseInt(req.body.attempt as string) : undefined;
      const playerModeRaw = (req.body.player_mode as string | undefined) || 'alone';
      const playerMode = playerModeRaw === 'with_guardian' ? 'with_guardian' : 'alone';
      const wordId = req.body.word_id as string | undefined;

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
        tokenUserId: tokenUserId || null,
        age: age ?? null,
        difficulty: difficulty || null,
        speechLevel: speechLevel || null,
        level: levelFromBody ?? null,
        profileLevel: profileLevel ?? null,
        effectiveLevel,
        attempt: attempt ?? null,
        player_mode: playerMode,
        word_id: wordId || null,
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
      const context = await PersonalizationService.buildContext(
        userId,
        age,
        speechLevel,
        difficulty,
        problemSounds
      );
      const gamePersonalization = buildGamePersonalization(sodaResponse, context, {
        currentLevel: effectiveLevel,
        attempt,
        playerMode,
      });
      if (userId) {
        await persistUserLevel(userId, gamePersonalization.nextDifficulty, requestId);
      }

      console.log('[Evaluation][Analyze] SODA response received', {
        requestId,
        keys: Object.keys(sodaResponse),
        predicted: sodaResponse.predicted ?? null,
        severity: sodaResponse.severity ?? null,
        error_type: sodaResponse.error_type ?? null,
        therapy_level: sodaResponse.therapy_level ?? null,
        gamePersonalization,
        effectiveLevel,
      });
      res.json({
        ...sodaResponse,
        gamePersonalization,
        effectiveLevel,
      });
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

