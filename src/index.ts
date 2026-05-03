import dotenv from 'dotenv';

// Load environment variables first, before any other imports
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import onboardingRoutes from './routes/onboarding';
import profileRoutes from './routes/profile';
import notificationRoutes from './routes/notifications';
import notificationPreferencesRoutes from './routes/notification_preferences';
import evaluationRoutes from './routes/evaluation';
import gamesRoutes from './routes/games';
import voiceAgentRoutes from './routes/voice_agent';
import journalRoutes from './routes/journal';
import curriculumRoutes from './routes/curriculum';
import therapistsRoutes from './routes/therapists';
import bookingsRoutes from './routes/bookings';
import { startNotificationScheduler } from './services/notification_scheduler';
import {
  getMlServiceBaseUrlForLogs,
  isMlHintsEnabled,
  isMlSpeechLevelEnabled,
  isMlWordsEnabled,
} from './services/ml_service_client';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to Teratalk Backend API Azure test' });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Onboarding routes
app.use('/api/onboarding', onboardingRoutes);

// Profile routes
app.use('/api/profile', profileRoutes);

// Notification routes
app.use('/api/notifications', notificationRoutes);

// Notification preferences routes
app.use('/api/notification-preferences', notificationPreferencesRoutes);

// Evaluation routes
app.use('/api/evaluation', evaluationRoutes);

// Game routes
app.use('/api/games', gamesRoutes);

// Voice agent routes
app.use('/api/voice-agent', voiceAgentRoutes);

// Journal routes
app.use('/api/journal', journalRoutes);

// Curriculum routes
app.use('/api/curriculum', curriculumRoutes);

// Therapist routes
app.use('/api/therapists', therapistsRoutes);

// Booking routes
app.use('/api/bookings', bookingsRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  const mlBase = getMlServiceBaseUrlForLogs();
  if (mlBase) {
    console.log('[ML] ML_SERVICE_URL resolved to:', mlBase, {
      words: isMlWordsEnabled(),
      speechLevel: isMlSpeechLevelEnabled(),
      hints: isMlHintsEnabled(),
    });
  } else {
    console.log('[ML] ML_SERVICE_URL not set — ML integration disabled');
  }

  // Start notification scheduler
  try {
    startNotificationScheduler();
  } catch (error) {
    console.error('Failed to start notification scheduler:', error);
  }
});

