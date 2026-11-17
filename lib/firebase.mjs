import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { prepareGoogleCredentials } from './google-credentials.mjs';

export function firebaseConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID);
}

function app() {
  prepareGoogleCredentials();
  const existing = getApps().find(({ name }) => name === 'seqmo');
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID が設定されていません。');
  const key = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  if (Boolean(key) !== Boolean(clientEmail)) throw new Error('Firebase のサービスアカウント情報を確認してください。');
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Auth エミュレーター利用時は Firestore エミュレーターも設定してください。');
  }
  const credential = key ? cert({ projectId, clientEmail, privateKey: key.replace(/\\n/g, '\n') }) : applicationDefault();
  return initializeApp({ projectId, credential }, 'seqmo');
}

export const firestore = () => getFirestore(app());
export const firebaseAuth = () => getAuth(app());
