import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../types/auth';

const DEVICE_ID_KEY = '@trainwatch_device_id';
const FCM_TOKEN_KEY = '@trainwatch_fcm_token';

/**
 * Generate a unique, stable device installation identifier
 */
function generateDeviceId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `tw_${timestamp}_${randomPart}`;
}

/**
 * Device-Based Session & Authentication Service
 * Automatically assigns a persistent device identifier to each installation.
 * Eliminates login friction while preserving user identity for background watch alerts.
 */
class AuthService {
  private currentUser: UserProfile | null = null;

  async loadPersistedSession(): Promise<UserProfile> {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = generateDeviceId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    const fcmToken = await this.getFcmToken();
    this.currentUser = {
      uid: deviceId,
      email: null,
      displayName: 'Traveler',
      photoURL: null,
      fcmToken,
      createdAt: new Date().toISOString(),
    };

    return this.currentUser;
  }

  async getDeviceId(): Promise<string> {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = generateDeviceId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

  async setFcmToken(token: string): Promise<void> {
    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
    if (this.currentUser) {
      this.currentUser.fcmToken = token;
    }
  }

  async getFcmToken(): Promise<string | null> {
    return AsyncStorage.getItem(FCM_TOKEN_KEY);
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  async signOut(): Promise<void> {
    // Generate a fresh session identifier
    const newDeviceId = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newDeviceId);
    this.currentUser = {
      uid: newDeviceId,
      email: null,
      displayName: 'Traveler',
      photoURL: null,
      createdAt: new Date().toISOString(),
    };
  }
}

export const authService = new AuthService();
