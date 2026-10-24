import { getAuth } from 'firebase/auth';
import { getFirebaseApp } from './firebaseApp';

export const getFirebaseAuth = () => getAuth(getFirebaseApp());
