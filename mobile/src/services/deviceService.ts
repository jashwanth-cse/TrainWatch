/**
 * Device registration service for push notification delivery.
 * Associates persistent device ID with current FCM push token.
 */

import { authService } from './authService';

const DEFAULT_BASE_URL = 'https://dream-destiny.cloud.run';

export interface DeviceRegistrationResponse {
  status: string;
  device_id: string;
}

export async function registerDeviceToken(
  fcmToken: string,
  platform: 'android' | 'ios' | 'web' = 'android'
): Promise<boolean> {
  if (!fcmToken || !fcmToken.trim()) return false;

  try {
    const deviceId = await authService.getDeviceId();
    const baseUrl =
      process.env.EXPO_PUBLIC_TRAINWATCH_API_URL ||
      process.env.EXPO_PUBLIC_TRANSPORT_SERVICE_URL ||
      DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/devices/${deviceId}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceId}`,
      },
      body: JSON.stringify({
        fcm_token: fcmToken.trim(),
        platform,
      }),
    });

    if (res.ok) {
      await authService.setFcmToken(fcmToken);
      return true;
    }
    return false;
  } catch {
    // Fail silently on network errors so app experience is uninterrupted
    return false;
  }
}

export async function revokeDeviceToken(): Promise<boolean> {
  try {
    const deviceId = await authService.getDeviceId();
    const baseUrl =
      process.env.EXPO_PUBLIC_TRAINWATCH_API_URL ||
      process.env.EXPO_PUBLIC_TRANSPORT_SERVICE_URL ||
      DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/devices/${deviceId}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${deviceId}`,
      },
    });

    return res.ok;
  } catch {
    return false;
  }
}
