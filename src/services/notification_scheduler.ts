import * as cron from 'node-cron';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { supabase } from '../config/supabase';
import { NotificationService } from './notification_service';
import { NotificationTime } from '../types/notifications';

const notificationService = new NotificationService();

/// Determine time context based on current hour
/// Extended to support 24-hour range for notifications
type TimeContext = 'Morning' | 'Afternoon' | 'Evening' | 'Dinner' | 'Night' | null;
function getTimeContext(hour: number): TimeContext {
  if (hour >= 6 && hour < 12) {
    return 'Morning';
  } else if (hour >= 12 && hour < 17) {
    return 'Afternoon';
  } else if (hour >= 17 && hour < 21) {
    return 'Evening';
  } else if (hour >= 18 && hour < 20) {
    return 'Dinner';
  } else if (hour >= 21 && hour < 24) {
    return 'Night'; // 9 PM to midnight
  } else if (hour >= 0 && hour < 6) {
    return 'Night'; // Midnight to 6 AM
  }
  return null;
}

/// Check if current time matches a notification time
/// Note: Time context is NOT checked here - it's only used for message generation, not for matching
function matchesNotificationTime(
  currentHour: number,
  currentMinute: number,
  timeContext: TimeContext,
  notificationTime: NotificationTime
): boolean {
  // Check if notification is enabled
  if (!notificationTime.enabled) {
    return false;
  }

  // Check if hour matches
  if (notificationTime.hour !== currentHour) {
    return false;
  }

  // Check if minute matches (with ±5 minute tolerance for cron scheduling)
  const minuteDiff = Math.abs(notificationTime.minute - currentMinute);
  if (minuteDiff > 5) {
    return false;
  }

  // Time context is NOT checked - it's only used for generating contextual messages
  return true;
}

/// Enhanced logging for match checking
/// Note: Time context is NOT checked - it's only used for message generation
function matchesNotificationTimeWithLogging(
  currentHour: number,
  currentMinute: number,
  timeContext: TimeContext,
  notificationTime: NotificationTime
): { matches: boolean; reason?: string } {
  if (!notificationTime.enabled) {
    return { matches: false, reason: 'Notification time is disabled' };
  }

  if (notificationTime.hour !== currentHour) {
    return { 
      matches: false, 
      reason: `Hour mismatch: expected ${notificationTime.hour}, got ${currentHour}` 
    };
  }

  const minuteDiff = Math.abs(notificationTime.minute - currentMinute);
  if (minuteDiff > 5) {
    return { 
      matches: false, 
      reason: `Minute difference too large: ${minuteDiff} minutes (tolerance: 5 minutes)` 
    };
  }

  // Time context is NOT checked - it's only used for generating contextual messages
  return { matches: true };
}

/// Process notifications for all users
async function processNotifications(): Promise<void> {
  try {
    const serverNow = new Date();
    const serverHour = serverNow.getHours();
    const serverMinute = serverNow.getMinutes();
    
    console.log(`[Notification Scheduler] Server time: ${serverNow.toISOString()} (${serverHour}:${serverMinute.toString().padStart(2, '0')})`);

    // Fetch all users with enabled notification preferences
    const { data: preferencesData, error: preferencesError } = await supabase
      .from('notification_preferences')
      .select('user_id, enabled, notification_times')
      .eq('enabled', true);

    if (preferencesError) {
      console.error('Error fetching notification preferences:', preferencesError);
      return;
    }

    if (!preferencesData || preferencesData.length === 0) {
      console.log('No users with enabled notifications found');
      return;
    }

    // Get all user IDs
    const userIds = preferencesData.map((p) => p.user_id);

    // Fetch user profiles for these users
    const { data: profilesData, error: profilesError } = await supabase
      .from('user_profiles')
      .select('user_id, problem_sounds')
      .in('user_id', userIds);

    if (profilesError) {
      console.error('Error fetching user profiles:', profilesError);
      return;
    }

    // Fetch user devices with timezone information
    const { data: devicesData, error: devicesError } = await supabase
      .from('user_devices')
      .select('user_id, timezone, device_id')
      .in('user_id', userIds);

    if (devicesError) {
      console.error('[Notification Scheduler] Error fetching user devices:', devicesError);
      // Continue without timezone - will use server time as fallback
    } else {
      console.log(`[Notification Scheduler] Fetched ${devicesData?.length || 0} devices with timezone info`);
      (devicesData || []).forEach((device) => {
        console.log(`  - User ${device.user_id}: timezone=${device.timezone || 'NULL'}, device=${device.device_id}`);
      });
    }

    // Create maps for quick lookup
    const profilesMap = new Map(
      (profilesData || []).map((profile) => [profile.user_id, profile])
    );
    
    // Map user_id -> timezone (use first device's timezone if multiple)
    const timezoneMap = new Map<string, string>();
    (devicesData || []).forEach((device) => {
      if (device.timezone && device.timezone !== 'UTC' && !timezoneMap.has(device.user_id)) {
        timezoneMap.set(device.user_id, device.timezone);
        console.log(`[Notification Scheduler] Mapped user ${device.user_id} to timezone: ${device.timezone}`);
      } else if (!device.timezone || device.timezone === 'UTC') {
        console.log(`[Notification Scheduler] User ${device.user_id} has no timezone or UTC, will use server time`);
      }
    });

    let sentCount = 0;
    let skippedCount = 0;

    // Process each user
    for (const preference of preferencesData) {
      const userId = preference.user_id;
      const notificationTimes = (preference.notification_times as NotificationTime[]) || [];
      const profile = profilesMap.get(userId);
      const problemSounds = profile?.problem_sounds || [];

      console.log(`[User ${userId}] Processing notification check...`);
      console.log(`  - Notification times configured: ${notificationTimes.length}`);
      console.log(`  - Problem sounds: ${problemSounds.length}`);
      if (notificationTimes.length > 0) {
        console.log(`  - Configured times:`, notificationTimes.map(nt => 
          `${nt.hour}:${nt.minute.toString().padStart(2, '0')} (${nt.timeContext}, enabled: ${nt.enabled})`
        ).join(', '));
      }

      // Skip if no problem sounds
      if (problemSounds.length === 0) {
        console.log(`[User ${userId}] ⏭️ SKIPPED: No problem sounds configured`);
        skippedCount++;
        continue;
      }

      // Get user's timezone (default to UTC if not available)
      const userTimezone = timezoneMap.get(userId) || 'UTC';
      
      // Convert server time to user's timezone
      let userNow: Date;
      let userHour: number;
      let userMinute: number;
      
      try {
        // Convert UTC server time to user's timezone
        userNow = utcToZonedTime(serverNow, userTimezone);
        userHour = userNow.getHours();
        userMinute = userNow.getMinutes();
        
        console.log(`[User ${userId}] Timezone: ${userTimezone}, Local time: ${userHour}:${userMinute.toString().padStart(2, '0')}`);
      } catch (error) {
        console.error(`[User ${userId}] Error converting timezone ${userTimezone}, using server time:`, error);
        // Fallback: use server time
        userNow = serverNow;
        userHour = serverHour;
        userMinute = serverMinute;
      }

      // Determine time context based on user's local time
      const timeContext = getTimeContext(userHour);
      console.log(`[User ${userId}] Current hour: ${userHour}, Time context: ${timeContext || 'NONE'}`);

      // Allow notifications even without time context - just match by hour and minute
      // This allows notifications at any time of day
      if (!timeContext) {
        console.log(`[User ${userId}] ⚠️ No time context for hour ${userHour}, but will still check for exact time matches`);
      }

      // Check if any notification time matches user's local time
      let shouldSend = false;
      let matchedNotificationTime: NotificationTime | null = null;

      console.log(`[User ${userId}] Checking ${notificationTimes.length} notification time(s) against current time ${userHour}:${userMinute.toString().padStart(2, '0')}...`);
      console.log(`  Note: Time context (${timeContext || 'none'}) is only used for message generation, not for matching`);
      
      for (const notificationTime of notificationTimes) {
        // Match by hour and minute only - time context is NOT checked for matching
        const result = matchesNotificationTimeWithLogging(userHour, userMinute, timeContext, notificationTime);
        
        if (result.matches) {
          console.log(`  ✅ MATCH: ${notificationTime.hour}:${notificationTime.minute.toString().padStart(2, '0')} (context: ${notificationTime.timeContext} - used for message only, enabled: ${notificationTime.enabled})`);
          shouldSend = true;
          matchedNotificationTime = notificationTime;
          break;
        } else {
          console.log(`  ❌ No match: ${notificationTime.hour}:${notificationTime.minute.toString().padStart(2, '0')} (context: ${notificationTime.timeContext}, enabled: ${notificationTime.enabled}) - ${result.reason}`);
        }
      }

      if (!shouldSend) {
        console.log(`[User ${userId}] ⏭️ SKIPPED: No notification time matches current time ${userHour}:${userMinute.toString().padStart(2, '0')} with context ${timeContext}`);
        skippedCount++;
        continue;
      }
      if (!matchedNotificationTime) {
        console.log(`[User ${userId}] ⏭️ SKIPPED: No matched notification time was recorded`);
        skippedCount++;
        continue;
      }

      // Send contextual notification
      // Use the notification time's context, not the current time context
      // This allows notifications to use their intended context (e.g., "Dinner" at 22:50)
      const notificationContext = matchedNotificationTime.timeContext;
      
      // Map notification context to valid message generator context
      // If notification context is not valid, use current time context or default to 'Evening'
      let messageContext: 'Morning' | 'Afternoon' | 'Evening' | 'Dinner';
      if (notificationContext === 'Morning' || notificationContext === 'Afternoon' || 
          notificationContext === 'Evening' || notificationContext === 'Dinner') {
        messageContext = notificationContext;
      } else {
        // Fallback: use current time context if valid, otherwise default to 'Evening'
        messageContext = (timeContext === 'Morning' || timeContext === 'Afternoon' || 
                          timeContext === 'Evening' || timeContext === 'Dinner') 
                          ? timeContext 
                          : 'Evening';
        console.log(`[User ${userId}] ⚠️ Notification context "${notificationContext}" not valid, using "${messageContext}" for message`);
      }

      // For dinner time, prioritize food-related sounds
      const targetSound =
        messageContext === 'Dinner'
          ? problemSounds.find((s: string) => s.includes('/k/') || s.includes('/ch/'))
          : undefined;

      console.log(
        `[User ${userId}] Sending notification at local time ${userHour}:${userMinute.toString().padStart(2, '0')} (timezone: ${userTimezone})`
      );
      console.log(`[User ${userId}] Using message context: "${messageContext}" (from notification time context: "${notificationContext}")`);
      console.log(`[User ${userId}] Problem sounds: ${problemSounds.join(', ')}`);
      console.log(`[User ${userId}] Target sound: ${targetSound || 'none'}`);

      const result = await notificationService.sendContextualNotification(
        userId,
        messageContext,
        problemSounds,
        targetSound
      );

      if (result.success) {
        sentCount++;
        console.log(
          `[User ${userId}] ✅ Successfully sent ${messageContext} notification`
        );
      } else {
        console.error(`[User ${userId}] ❌ Failed to send notification:`, result.error);
        console.error(`[User ${userId}]   Context: ${messageContext}, Problem sounds: ${problemSounds.join(', ')}, Target sound: ${targetSound || 'none'}`);
      }

      // Small delay to avoid overwhelming FCM
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`[Notification Scheduler] Processing complete: ${sentCount} sent, ${skippedCount} skipped`);
  } catch (error) {
    console.error('Error processing notifications:', error);
  }
}

/// Start notification scheduler
export function startNotificationScheduler(): void {
  // Run every 5 minutes to check for notification times
  // This allows for more precise timing (within 5-minute tolerance)
  cron.schedule('*/5 * * * *', async () => {
    console.log('[Notification Scheduler] Running scheduled notification check...');
    await processNotifications();
  });

  // Also run immediately on startup (for testing)
  console.log('[Notification Scheduler] Started - checking every 5 minutes');
  console.log('[Notification Scheduler] Server timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
  processNotifications().catch((error) => {
    console.error('[Notification Scheduler] Error in initial notification processing:', error);
  });
}

/// Stop notification scheduler (for testing/cleanup)
export function stopNotificationScheduler(): void {
  // Note: node-cron doesn't have a built-in stop method
  // This would need to be implemented if needed
  console.log('Notification scheduler stop requested');
}
