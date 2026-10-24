import { getApp, getApps, initializeApp } from 'firebase/app';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = () =>
  Object.values(config).every((value) => Boolean(value) && value !== 'REPLACE_ME');

export const getFirebaseApp = () => {
  if (!isFirebaseConfigured()) {
    throw new Error('Google sign-in is not configured for this app.');
  }
  return getApps().length ? getApp() : initializeApp(config);
};
