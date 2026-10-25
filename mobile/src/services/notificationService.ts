import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerDeviceToken } from './deviceService';
import { authService } from './authService';

/**
 * Configure default notification behavior when app is in foreground
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const NOTIFICATION_CHANNEL_ID = 'trainwatch-alerts';

export interface NotificationRegistrationResult {
  granted: boolean;
  token: string | null;
  error?: string;
}

/**
 * Initialize Android notification channels
 */
export async function initializeNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Seat Availability Alerts',
      description: 'Alerts when tracked train seats become available or match your criteria',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E3A8A',
      enableVibrate: true,
      enableLights: true,
    });
  }
}

/**
 * Check if notifications are currently permitted
 */
export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Request notification permissions and register device FCM token with TrainWatch backend
 */
export async function requestNotificationPermissionsAndRegisterDevice(): Promise<NotificationRegistrationResult> {
  try {
    await initializeNotificationChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return {
        granted: false,
        token: null,
        error: 'Notification permission was denied. You will not receive background alerts.',
      };
    }

    let pushToken: string | null = null;

    // Try retrieving native FCM device push token first (standard for production Android builds)
    try {
      const devicePush = await Notifications.getDevicePushTokenAsync();
      if (devicePush && devicePush.data) {
        pushToken = devicePush.data;
      }
    } catch {
      // Fallback for Expo Go or development environments
      try {
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ?? 'f5ead958-336d-401d-b483-bc3a129dc9c9';
        const expoPush = await Notifications.getExpoPushTokenAsync({ projectId });
        if (expoPush && expoPush.data) {
          pushToken = expoPush.data;
        }
      } catch (expoErr) {
        // Handle physical vs emulator restriction
      }
    }

    if (pushToken && pushToken.trim()) {
      await authService.setFcmToken(pushToken);
      const registered = await registerDeviceToken(
        pushToken,
        Platform.OS === 'ios' ? 'ios' : 'android'
      );
      return {
        granted: true,
        token: pushToken,
        error: registered ? undefined : 'Token retrieved but failed to sync with backend',
      };
    }

    return {
      granted: true,
      token: null,
      error: 'Permission granted, but push token could not be obtained on this device environment',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown notification registration error';
    return {
      granted: false,
      token: null,
      error: message,
    };
  }
}
