import AsyncStorage from '@react-native-async-storage/async-storage';
import { getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth';
import { getFirebaseApp } from './firebaseApp';

let auth: Auth | undefined;

export const getFirebaseAuth = () => {
  auth ??= initializeAuth(getFirebaseApp(), {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return auth;
};
