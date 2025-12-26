/// Notification request and response types

export interface RegisterDeviceRequest {
  fcmToken: string;
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  timezone?: string; // IANA timezone (e.g., "Asia/Colombo", "America/New_York")
}

export interface NotificationContext {
  time: 'Morning' | 'Afternoon' | 'Evening' | 'Dinner';
  sound?: string;
  category?: string;
}

export interface NotificationMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SuggestedWords {
  words: string[];
  context: NotificationContext;
  message: string;
}

/// Notification preferences types
export interface NotificationTime {
  id: string;
  timeContext: 'Morning' | 'Afternoon' | 'Evening' | 'Dinner';
  hour: number; // 0-23
  minute: number; // 0-59
  enabled: boolean;
}

export interface NotificationPreferences {
  enabled: boolean;
  notificationTimes: NotificationTime[];
}

export interface GetNotificationPreferencesResponse {
  enabled: boolean;
  notificationTimes: NotificationTime[];
}

export interface UpdateNotificationPreferencesRequest {
  enabled?: boolean;
  notificationTimes?: NotificationTime[];
}

