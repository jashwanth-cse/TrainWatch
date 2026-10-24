import type { Persistence } from 'firebase/auth';
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';

// Firebase 13 exposes this documented API at runtime in its React Native entry,
// but firebase/auth's public declaration re-export omits the native-only export.
// Match @firebase/auth/dist/src/platform_react_native/persistence/react_native.d.ts.
declare module 'firebase/auth' {
  export function getReactNativePersistence(
    storage: Pick<AsyncStorageStatic, 'getItem' | 'setItem' | 'removeItem'>,
  ): Persistence;
}
