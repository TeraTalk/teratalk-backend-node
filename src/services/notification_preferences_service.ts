import { supabase } from '../config/supabase';
import {
  NotificationPreferences,
  NotificationTime,
  UpdateNotificationPreferencesRequest,
} from '../types/notifications';

/// Notification preferences service
export class NotificationPreferencesService {
  /// Get default notification preferences
  getDefaultPreferences(): NotificationPreferences {
    return {
      enabled: true,
      notificationTimes: [],
    };
  }

  /// Validate notification times
  validateNotificationTimes(times: NotificationTime[]): { valid: boolean; error?: string } {
    // Check maximum 4 notifications
    if (times.length > 4) {
      return { valid: false, error: 'Maximum 4 notification times allowed' };
    }

    // Validate each notification time
    for (const time of times) {
      // Validate time context
      const validContexts = ['Morning', 'Afternoon', 'Evening', 'Dinner'];
      if (!validContexts.includes(time.timeContext)) {
        return {
          valid: false,
          error: `Invalid time context: ${time.timeContext}. Must be one of: ${validContexts.join(', ')}`,
        };
      }

      // Validate hour
      if (time.hour < 0 || time.hour > 23) {
        return { valid: false, error: `Invalid hour: ${time.hour}. Must be between 0 and 23` };
      }

      // Validate minute
      if (time.minute < 0 || time.minute > 59) {
        return { valid: false, error: `Invalid minute: ${time.minute}. Must be between 0 and 59` };
      }

      // Validate ID
      if (!time.id || time.id.trim().length === 0) {
        return { valid: false, error: 'Notification time must have a valid ID' };
      }
    }

    // Check for duplicate times (same timeContext + hour + minute)
    const timeKeys = times.map((t) => `${t.timeContext}-${t.hour}-${t.minute}`);
    const uniqueKeys = new Set(timeKeys);
    if (timeKeys.length !== uniqueKeys.size) {
      return { valid: false, error: 'Duplicate notification times are not allowed' };
    }

    return { valid: true };
  }

  /// Get user's notification preferences
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('enabled, notification_times')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Preferences don't exist, return defaults
        return this.getDefaultPreferences();
      }

      if (error) {
        console.error('Error fetching notification preferences:', error);
        return this.getDefaultPreferences();
      }

      return {
        enabled: data.enabled ?? true,
        notificationTimes: (data.notification_times as NotificationTime[]) || [],
      };
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      return this.getDefaultPreferences();
    }
  }

  /// Update user's notification preferences
  async updatePreferences(
    userId: string,
    request: UpdateNotificationPreferencesRequest
  ): Promise<{ success: boolean; error?: string; preferences?: NotificationPreferences }> {
    try {
      // Validate notification times if provided
      if (request.notificationTimes) {
        const validation = this.validateNotificationTimes(request.notificationTimes);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      // Get current preferences
      const currentPreferences = await this.getPreferences(userId);

      // Merge with request
      const updatedPreferences: NotificationPreferences = {
        enabled: request.enabled !== undefined ? request.enabled : currentPreferences.enabled,
        notificationTimes: request.notificationTimes || currentPreferences.notificationTimes,
      };

      // Check if preferences exist
      const { data: existing } = await supabase
        .from('notification_preferences')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (existing) {
        // Update existing preferences
        const { error } = await supabase
          .from('notification_preferences')
          .update({
            enabled: updatedPreferences.enabled,
            notification_times: updatedPreferences.notificationTimes,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);

        if (error) {
          console.error('Error updating notification preferences:', error);
          return { success: false, error: 'Failed to update notification preferences' };
        }
      } else {
        // Insert new preferences
        const { error } = await supabase.from('notification_preferences').insert({
          user_id: userId,
          enabled: updatedPreferences.enabled,
          notification_times: updatedPreferences.notificationTimes,
        });

        if (error) {
          console.error('Error creating notification preferences:', error);
          return { success: false, error: 'Failed to create notification preferences' };
        }
      }

      return { success: true, preferences: updatedPreferences };
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      return { success: false, error: 'Internal server error' };
    }
  }
}


