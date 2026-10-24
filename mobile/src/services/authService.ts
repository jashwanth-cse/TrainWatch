import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../types/auth';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from './firebaseApp';
import { getFirebaseAuth } from './firebaseClient';
import { signInGoogleIdentity, signOutGoogleIdentity } from './googleIdentity';

const USER_SESSION_KEY = '@trainwatch_user_session';
const FCM_TOKEN_KEY = '@trainwatch_fcm_token';

/**
 * Authentication & Session Management Service
 * Manages Google Sign-In state and local persistence.
 */
class AuthService {
  private currentUser: UserProfile | null = null;

  async loadPersistedSession(): Promise<UserProfile | null> {
    this.currentUser = null;
    // Old demo profiles are not proof of identity. Never restore them.
    await AsyncStorage.removeItem(USER_SESSION_KEY);
    if (!isFirebaseConfigured()) return null;
    const auth = getFirebaseAuth();
    await auth.authStateReady();
    if (!auth.currentUser) return null;
    await auth.currentUser.getIdToken(true);
    this.currentUser = await this.toProfile(auth.currentUser);
    return this.currentUser;
  }

  async signInWithGoogle(): Promise<UserProfile> {
    const user = await signInGoogleIdentity(getFirebaseAuth());
    const profile = await this.toProfile(user);
    this.currentUser = profile;
    return profile;
  }

  private async toProfile(user: User): Promise<UserProfile> {
    if (!user.providerData.some((provider) => provider.providerId === 'google.com')) {
      throw new Error('A verified Google account is required.');
    }
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      fcmToken: await this.getFcmToken(),
      createdAt: new Date(user.metadata.creationTime!).toISOString(),
    };
  }

  async signOut(): Promise<void> {
    await signOutGoogleIdentity(getFirebaseAuth());
    this.currentUser = null;
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
}

export const authService = new AuthService();
