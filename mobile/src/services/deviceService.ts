/**
 * Device registration service for push notification delivery.
 * Associates persistent device ID with current FCM push token.
 */

import { authService } from './authService';

export function getDeviceApiBaseUrl(): string {
  const url =
    process.env.EXPO_PUBLIC_TRAINWATCH_API_URL ||
    process.env.EXPO_PUBLIC_TRANSPORT_SERVICE_URL;
  return url ? url.trim().replace(/\/+$/, '') : '';
}

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
    const baseUrl = getDeviceApiBaseUrl();
    if (!baseUrl) return false;
    const deviceId = await authService.getDeviceId();
    const url = `${baseUrl}/api/v1/devices/${deviceId}`;

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
    const baseUrl = getDeviceApiBaseUrl();
    if (!baseUrl) return false;
    const deviceId = await authService.getDeviceId();
    const url = `${baseUrl}/api/v1/devices/${deviceId}`;

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
