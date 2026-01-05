/// Evaluation request for analyzing a word pronunciation
export interface EvaluationAnalyzeRequest {
  word: string;
  audio?: Express.Multer.File;
  userId?: string;
  age?: number;
  difficulty?: string;
  problemSounds?: string[];
  sessionId?: string;
}

/// AI analysis response (mocked)
export interface AIAnalysisResponse {
  score: number; // 60-100
  confidence: number; // 0-1
  detectedSounds: string[];
  pronunciationFeedback: string;
  phonemes: string[];
  accuracy: number; // 0-1
}

/// Personalization context
export interface PersonalizationContext {
  userId?: string;
  age?: number;
  speechLevel?: string;
  difficulty?: string;
  problemSounds?: string[];
  userProfile?: {
    childAge: number;
    speechLevel: string;
    initialDifficulty: string;
    problemSounds: string[];
  };
}

/// Evaluation response
export interface EvaluationResponse {
  score: number;
  confidence: number;
  feedback: string;
  soundAnalysis: {
    detectedSounds: string[];
    expectedSound: string;
    accuracy: number;
  };
  personalizedRecommendations: string[];
  pronunciationFeedback: string;
  timestamp: string;
}

/// Evaluation session
export interface EvaluationSession {
  sessionId: string;
  userId?: string;
  createdAt: string;
  submissions: EvaluationSubmission[];
  metadata?: Record<string, any>;
}

/// Evaluation submission (word + audio analysis)
export interface EvaluationSubmission {
  word: string;
  expectedSound: string;
  score: number;
  feedback: string;
  timestamp: string;
  audioMetadata?: {
    filename: string;
    size: number;
    mimetype: string;
  };
}

/// Session creation request
export interface CreateSessionRequest {
  userId?: string;
  metadata?: Record<string, any>;
}

/// Session creation response
export interface CreateSessionResponse {
  sessionId: string;
  createdAt: string;
}

/// Session results response
export interface SessionResultsResponse {
  sessionId: string;
  userId?: string;
  createdAt: string;
  totalSubmissions: number;
  averageScore: number;
  submissions: EvaluationSubmission[];
  soundBreakdown: Record<string, {
    count: number;
    averageScore: number;
    words: string[];
  }>;
  recommendations: string[];
  level: string;
  levelMessage: string;
}

