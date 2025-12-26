import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationService } from '../services/notification_service';
import { RegisterDeviceRequest } from '../types/notifications';

const router = Router();
const notificationService = new NotificationService();

/// POST /api/notifications/register - Register device FCM token
router.post('/register', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const { fcmToken, deviceId, platform, timezone }: RegisterDeviceRequest = req.body;

    console.log(`[Device Registration] Received request:`, {
      userId,
      deviceId,
      platform,
      timezone: timezone || 'NOT PROVIDED',
      hasTimezone: !!timezone,
    });

    if (!fcmToken || !deviceId || !platform) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'fcmToken, deviceId, and platform are required',
      });
      return;
    }

    if (!['android', 'ios', 'web'].includes(platform)) {
      res.status(400).json({
        error: 'Invalid platform',
        message: 'Platform must be android, ios, or web',
      });
      return;
    }

    console.log(`[Device Registration] Processing: User: ${userId}, Timezone: ${timezone || 'NOT PROVIDED'}, Platform: ${platform}`);

    const result = await notificationService.registerDevice(userId, {
      fcmToken,
      deviceId,
      platform,
      timezone,
    });

    if (result.success) {
      res.status(200).json({ success: true, message: 'Device registered successfully' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to register device' });
    }
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/// POST /api/notifications/unregister - Unregister device FCM token
router.post('/unregister', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const { deviceId } = req.body;

    if (!deviceId) {
      res.status(400).json({
        error: 'Missing required field',
        message: 'deviceId is required',
      });
      return;
    }

    const result = await notificationService.unregisterDevice(userId, deviceId);

    if (result.success) {
      res.status(200).json({ success: true, message: 'Device unregistered successfully' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to unregister device' });
    }
  } catch (error) {
    console.error('Device unregistration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/// POST /api/notifications/test - Send test notification (for testing purposes)
router.post('/test', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const result = await notificationService.sendNotification(userId, {
      title: 'Test Notification',
      body: 'This is a test notification from Teratalk',
      data: {
        type: 'test',
      },
    });

    if (result.success) {
      res.status(200).json({ success: true, message: 'Test notification sent' });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send test notification' });
    }
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

