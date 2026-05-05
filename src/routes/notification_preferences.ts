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
      // Notification preferences are optional; treat empty payload as no-op.
      const preferences = await preferencesService.getPreferences(userId);
      res.status(200).json({
        success: true,
        optionalSkipped: true,
        message: 'Notification preferences update skipped (optional)',
        enabled: preferences.enabled,
        notificationTimes: preferences.notificationTimes,
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
      // Notification preferences are optional; fail-open so auth/onboarding won't be blocked.
      const preferences = await preferencesService.getPreferences(userId);
      res.status(200).json({
        success: true,
        optionalSkipped: true,
        message: 'Notification preferences update skipped (optional)',
        warning: result.error || 'Failed to update notification preferences',
        enabled: preferences.enabled,
        notificationTimes: preferences.notificationTimes,
      });
    }
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    // Notification preferences are optional; fail-open to avoid blocking onboarding/sign-in.
    const userId = req.userId;
    if (!userId) {
      res.status(200).json({
        success: true,
        optionalSkipped: true,
        message: 'Notification preferences update skipped (optional)',
        warning: 'Internal server error',
      });
      return;
    }

    const preferences = await preferencesService.getPreferences(userId);
    res.status(200).json({
      success: true,
      optionalSkipped: true,
      message: 'Notification preferences update skipped (optional)',
      warning: 'Internal server error',
      enabled: preferences.enabled,
      notificationTimes: preferences.notificationTimes,
    });
  }
});

export default router;


