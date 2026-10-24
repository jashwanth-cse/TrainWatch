import { Platform } from 'react-native';
import { GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';

export const signInGoogleIdentity = async (auth: Auth) => {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId || (Platform.OS === 'ios' && !iosClientId)) {
    throw new Error('Google sign-in is not configured for this app.');
  }

  // Load only when requested so Expo Go can display the sign-in screen and error.
  const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin');
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
  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  await GoogleSignin.signOut();
  await signOut(auth);
};
