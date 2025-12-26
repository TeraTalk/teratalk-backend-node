import * as admin from 'firebase-admin';
import { messaging } from '../config/firebase';
import { supabase } from '../config/supabase';
import { NotificationMessage, RegisterDeviceRequest, SuggestedWords } from '../types/notifications';
import { getSuggestedWords } from './message_generator';

/// Notification service for FCM operations
export class NotificationService {
  /// Register device FCM token
  async registerDevice(
    userId: string,
    deviceData: RegisterDeviceRequest
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if device already exists
      const { data: existingDevice } = await supabase
        .from('user_devices')
        .select('id')
        .eq('user_id', userId)
        .eq('device_id', deviceData.deviceId)
        .single();

      if (existingDevice) {
        // Update existing device
        const updateData: any = {
          fcm_token: deviceData.fcmToken,
          platform: deviceData.platform,
          updated_at: new Date().toISOString(),
        };
        
        // Add timezone if provided (always update timezone if provided, even if empty string)
        if (deviceData.timezone !== undefined && deviceData.timezone !== null) {
          updateData.timezone = deviceData.timezone;
          console.log(`[Device Registration] Updating timezone to: ${deviceData.timezone}`);
        } else {
          console.log(`[Device Registration] No timezone provided in update`);
        }
        
        console.log(`[Device Registration] Update data:`, updateData);
        
        const { error } = await supabase
          .from('user_devices')
          .update(updateData)
          .eq('id', existingDevice.id);

        if (error) {
          console.error('[Device Registration] Error updating device:', error);
          return { success: false, error: 'Failed to update device' };
        }
        
        // Verify the update
        const { data: updatedDevice } = await supabase
          .from('user_devices')
          .select('timezone')
          .eq('id', existingDevice.id)
          .single();
        
        console.log(`[Device Registration] Updated existing device for user ${userId}, stored timezone: ${updatedDevice?.timezone || 'NULL'}`);
      } else {
        // Insert new device
        const insertData: any = {
          user_id: userId,
          fcm_token: deviceData.fcmToken,
          device_id: deviceData.deviceId,
          platform: deviceData.platform,
        };
        
        // Add timezone if provided
        if (deviceData.timezone !== undefined && deviceData.timezone !== null) {
          insertData.timezone = deviceData.timezone;
          console.log(`[Device Registration] Inserting with timezone: ${deviceData.timezone}`);
        } else {
          console.log(`[Device Registration] No timezone provided in insert`);
        }
        
        console.log(`[Device Registration] Insert data:`, insertData);
        
        const { error } = await supabase.from('user_devices').insert(insertData);

        if (error) {
          console.error('[Device Registration] Error registering device:', error);
          return { success: false, error: 'Failed to register device' };
        }
        
        // Verify the insert
        const { data: insertedDevice } = await supabase
          .from('user_devices')
          .select('timezone')
          .eq('user_id', userId)
          .eq('device_id', deviceData.deviceId)
          .single();
        
        console.log(`[Device Registration] Registered new device for user ${userId}, stored timezone: ${insertedDevice?.timezone || 'NULL'}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Device registration error:', error);
      return { success: false, error: 'Internal server error' };
    }
  }

  /// Unregister device FCM token
  async unregisterDevice(userId: string, deviceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('user_devices')
        .delete()
        .eq('user_id', userId)
        .eq('device_id', deviceId);

      if (error) {
        console.error('Error unregistering device:', error);
        return { success: false, error: 'Failed to unregister device' };
      }

      return { success: true };
    } catch (error) {
      console.error('Device unregistration error:', error);
      return { success: false, error: 'Internal server error' };
    }
  }

  /// Get FCM tokens for a user
  async getUserTokens(userId: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('fcm_token')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user tokens:', error);
        return [];
      }

      return data.map((device) => device.fcm_token).filter((token) => token != null);
    } catch (error) {
      console.error('Error getting user tokens:', error);
      return [];
    }
  }

  /// Get user devices with timezone information
  async getUserDevices(userId: string): Promise<Array<{ fcm_token: string; timezone?: string }>> {
    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('fcm_token, timezone')
        .eq('user_id', userId);

      if (error) {
        console.error('Error fetching user devices:', error);
        return [];
      }

      return (data || []).map((device) => ({
        fcm_token: device.fcm_token,
        timezone: device.timezone || undefined,
      })).filter((device) => device.fcm_token != null);
    } catch (error) {
      console.error('Error getting user devices:', error);
      return [];
    }
  }

  /// Send notification to user
  async sendNotification(
    userId: string,
    message: NotificationMessage
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tokens = await this.getUserTokens(userId);

      if (tokens.length === 0) {
        return { success: false, error: 'No devices registered for user' };
      }

      const notification: admin.messaging.MulticastMessage = {
        notification: {
          title: message.title,
          body: message.body,
        },
        data: message.data || {},
        tokens: tokens,
      };

      const response = await messaging.sendEachForMulticast(notification);

      // Log successful sends
      if (response.successCount > 0) {
        console.log(`Successfully sent ${response.successCount} notifications`);
      }

      // Log failures
      if (response.failureCount > 0) {
        console.error(`Failed to send ${response.failureCount} notifications`);
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(`Failed token ${idx}:`, resp.error);
          }
        });
      }

      return { success: response.successCount > 0 };
    } catch (error) {
      console.error('Error sending notification:', error);
      return { success: false, error: 'Failed to send notification' };
    }
  }

  /// Generate and send context-aware notification
  async sendContextualNotification(
    userId: string,
    time: 'Morning' | 'Afternoon' | 'Evening' | 'Dinner',
    problemSounds: string[],
    specificSound?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Generate contextual message
      const suggestedWords = getSuggestedWords(time, problemSounds, specificSound);

      if (!suggestedWords) {
        return { success: false, error: 'Could not generate contextual message' };
      }

      // Create notification message
      const notificationMessage: NotificationMessage = {
        title: 'Practice Time! 🎯',
        body: suggestedWords.message,
        data: {
          type: 'contextual_guidance',
          time: time,
          sound: suggestedWords.context.sound || '',
          words: suggestedWords.words.join(','),
        },
      };

      return await this.sendNotification(userId, notificationMessage);
    } catch (error) {
      console.error('Error sending contextual notification:', error);
      return { success: false, error: 'Failed to send contextual notification' };
    }
  }
}

