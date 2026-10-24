import { GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth';

export const signInGoogleIdentity = async (auth: Auth) => {
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return result.user;
};

export const signOutGoogleIdentity = (auth: Auth) => signOut(auth);
