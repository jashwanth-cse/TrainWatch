import { Platform } from 'react-native';
import { GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';

export const signInGoogleIdentity = async (auth: Auth) => {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId || (Platform.OS === 'ios' && !iosClientId)) {
    throw new Error('Google sign-in is not configured for this app.');
  }

  // Load only when requested so Expo Go can display the sign-in screen and error.
  let GoogleSignin;
  let isSuccessResponse;
  try {
    const mod = await import('@react-native-google-signin/google-signin');
    GoogleSignin = mod.GoogleSignin;
    isSuccessResponse = mod.isSuccessResponse;
  } catch {
    throw new Error(
      'Native Google Sign-In is unavailable in Expo Go. Please use a native development build (npx expo run:android) or Continue as Guest.'
    );
  }

  GoogleSignin.configure({ webClientId, iosClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new Error('Google sign-in was cancelled.');
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google sign-in did not return an identity token.');
  }
  const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return result.user;
};

export const signOutGoogleIdentity = async (auth: Auth) => {
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // Silently continue if native Google module is not present in runtime (e.g. Expo Go)
  }
  await signOut(auth);
};
