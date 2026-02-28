import { Router, Request, Response } from 'express';
import { uploadAudio } from '../middleware/upload';
import { transcribeAudio } from '../services/whisper_service';
import { OpenRouterService } from '../services/open_router_service';

const router = Router();

const MIN_TRANSCRIPT_LENGTH = 1;
const FALLBACK_MESSAGE =
  "I didn't catch that. Could you try again? Speak clearly after pressing the button.";

/**
 * POST /api/voice-agent/turn
 * Body: multipart with "audio" file (M4A or other supported format).
 * Returns: { text: string, transcript?: string }
 */
router.post(
  '/turn',
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
      const audioFile = req.file;
      if (!audioFile) {
        res.status(400).json({ error: 'Audio file is required' });
        return;
      }

      const transcript = await transcribeAudio(
        audioFile.buffer,
        audioFile.mimetype,
        audioFile.originalname
      );

      if (!transcript || transcript.length < MIN_TRANSCRIPT_LENGTH) {
        res.json({
          text: FALLBACK_MESSAGE,
          transcript: transcript || '',
        });
        return;
      }

      const text = await OpenRouterService.chat(transcript);

      res.json({
        text: text || FALLBACK_MESSAGE,
        transcript,
      });
    } catch (error) {
      console.error('[VoiceAgent][Turn] Error', {
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

export default router;
