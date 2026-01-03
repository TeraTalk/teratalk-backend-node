import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationPreferencesService } from '../services/notification_preferences_service';
import { UpdateNotificationPreferencesRequest } from '../types/notifications';

const router = Router();
const preferencesService = new NotificationPreferencesService();

/// GET /api/notification-preferences - Get user's notification preferences
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const preferences = await preferencesService.getPreferences(userId);

    res.status(200).json({
      enabled: preferences.enabled,
      notificationTimes: preferences.notificationTimes,
    });
  } catch (error) {
    console.error('Error getting notification preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/// PUT /api/notification-preferences - Update user's notification preferences
router.put('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const request: UpdateNotificationPreferencesRequest = req.body;

    // Validate request
    if (request.enabled === undefined && !request.notificationTimes) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'Either enabled or notificationTimes must be provided',
      });
      return;
    }

    const result = await preferencesService.updatePreferences(userId, request);

    if (result.success) {
      res.status(200).json({
        success: true,
        enabled: result.preferences?.enabled,
        notificationTimes: result.preferences?.notificationTimes,
      });
    } else {
      res.status(400).json({ error: result.error || 'Failed to update notification preferences' });
    }
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


