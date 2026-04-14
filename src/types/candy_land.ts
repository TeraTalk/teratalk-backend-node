import { SpeechLevel } from '../config/speech_level_policy';
import { CandyLandMoveReason } from '../services/candy_land_movement_policy';

export type CandyLandMoveTilesRequest = {
  severity?: number | null;
  severity_text?: number | string | null;
  severity_phoneme?: number | string | null;
  confidence?: number | null;
  is_correct?: boolean | null;
  speechLevelUsed?: SpeechLevel | null;
  gameLevelUsed?: number | null;
};

export type CandyLandMoveTilesResponse = {
  moveTiles: number;
  qualityScore: number;
  reason: CandyLandMoveReason;
  severityThresholdUsed: number | null;
  allowRetry: boolean;
  animation: {
    stepDelayMs: number;
    celebration: boolean;
  };
};

