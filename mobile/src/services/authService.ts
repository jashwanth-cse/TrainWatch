import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../types/auth';

const USER_SESSION_KEY = '@trainwatch_user_session';
const FCM_TOKEN_KEY = '@trainwatch_fcm_token';

/**
 * Authentication & Session Management Service
 * Manages Google Sign-In state and local persistence.
 */
class AuthService {
  private currentUser: UserProfile | null = null;

  async loadPersistedSession(): Promise<UserProfile | null> {
    try {
      const data = await AsyncStorage.getItem(USER_SESSION_KEY);
      if (data) {
        this.currentUser = JSON.parse(data);
        return this.currentUser;
      }
    } catch (err) {
      console.warn('[AuthService] Failed to load persisted session', err);
    }
    return null;
  }

  async signInWithGoogleMock(mockProfile?: Partial<UserProfile>): Promise<UserProfile> {
    // Standard OAuth Google User structure
    const profile: UserProfile = {
      uid: mockProfile?.uid || `usr_${Date.now()}`,
      email: mockProfile?.email || 'user@example.com',
      displayName: mockProfile?.displayName || 'Train Traveler',
      photoURL: mockProfile?.photoURL || null,
      fcmToken: await this.getFcmToken(),
      createdAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(USER_SESSION_KEY, JSON.stringify(profile));
    this.currentUser = profile;
    return profile;
  }

  async signOut(): Promise<void> {
    await AsyncStorage.removeItem(USER_SESSION_KEY);
    this.currentUser = null;
  }

  async setFcmToken(token: string): Promise<void> {
    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
    if (this.currentUser) {
      this.currentUser.fcmToken = token;
      await AsyncStorage.setItem(USER_SESSION_KEY, JSON.stringify(this.currentUser));
    }
  }

  async getFcmToken(): Promise<string | null> {
    return AsyncStorage.getItem(FCM_TOKEN_KEY);
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }
}

export const authService = new AuthService();
