import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationService } from '../services/notification_service';
import { RegisterDeviceRequest } from '../types/notifications';
import { supabase } from '../config/supabase';

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
      // Notifications are optional: never block auth/onboarding flows on device registration failures.
      res.status(200).json({
        success: true,
        optionalSkipped: true,
        message: 'Device registration skipped (optional)',
        warning: result.error || 'Failed to register device',
      });
    }
  } catch (error) {
    console.error('Device registration error:', error);
    // Notifications are optional: fail-open to avoid blocking onboarding/sign-in.
    res.status(200).json({
      success: true,
      optionalSkipped: true,
      message: 'Device registration skipped (optional)',
      warning: 'Internal server error',
    });
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
      // Notifications are optional: don't block user flows on cleanup failures.
      res.status(200).json({
        success: true,
        optionalSkipped: true,
        message: 'Device unregistration skipped (optional)',
        warning: result.error || 'Failed to unregister device',
      });
    }
  } catch (error) {
    console.error('Device unregistration error:', error);
    // Notifications are optional: fail-open to avoid blocking onboarding/sign-in.
    res.status(200).json({
      success: true,
      optionalSkipped: true,
      message: 'Device unregistration skipped (optional)',
      warning: 'Internal server error',
    });
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

/// POST /api/notifications/demo - Send demo notification with time context
router.post('/demo', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'User ID not found' });
      return;
    }

    const { time } = req.body;

    // Validate time parameter
    const validTimes = ['Morning', 'Afternoon', 'Evening', 'Dinner'];
    if (!time || !validTimes.includes(time)) {
      res.status(400).json({
        error: 'Invalid time parameter',
        message: `Time must be one of: ${validTimes.join(', ')}`,
      });
      return;
    }

    // Fetch user's problem sounds from profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('problem_sounds')
      .eq('user_id', userId)
      .single();

    let problemSounds: string[] = [];
    if (!profileError && profile && profile.problem_sounds) {
      problemSounds = profile.problem_sounds;
    }

    // If user has problem sounds, send contextual notification
    if (problemSounds.length > 0) {
      const result = await notificationService.sendContextualNotification(
        userId,
        time as 'Morning' | 'Afternoon' | 'Evening' | 'Dinner',
        problemSounds
      );

      if (result.success) {
        res.status(200).json({
          success: true,
          message: `Demo notification sent for ${time}`,
        });
      } else {
        res.status(500).json({
          error: result.error || 'Failed to send demo notification',
        });
      }
    } else {
      // Fallback to simple notification if no problem sounds
      const timeMessages: Record<string, string> = {
        Morning: 'Good morning! Time for some speech practice! 🌅',
        Afternoon: 'Good afternoon! Let\'s practice together! ☀️',
        Evening: 'Good evening! Ready for some practice? 🌆',
        Dinner: 'Dinner time! Let\'s practice while we eat! 🍽️',
      };

      const result = await notificationService.sendNotification(userId, {
        title: 'Practice Time! 🎯',
        body: timeMessages[time] || 'Time for speech practice!',
        data: {
          type: 'demo',
          time: time,
        },
      });

      if (result.success) {
        res.status(200).json({
          success: true,
          message: `Demo notification sent for ${time}`,
        });
      } else {
        res.status(500).json({
          error: result.error || 'Failed to send demo notification',
        });
      }
    }
  } catch (error) {
    console.error('Demo notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

