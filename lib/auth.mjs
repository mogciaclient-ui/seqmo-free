import { firebaseAuth, firebaseConfigured } from './firebase.mjs';

export const staffCookie = 'seqmo_staff';
export const sessionHours = 8;
export function loginConfigured() {
  return firebaseConfigured() && Boolean(process.env.FIREBASE_WEB_API_KEY);
}

export async function login(email, password) {
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 1024) return null;
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const endpoint = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const url = new URL('/v1/accounts:signInWithPassword', endpoint);
  // The Auth emulator serves the Google API under a local path prefix.
  if (emulator) url.pathname = '/identitytoolkit.googleapis.com' + url.pathname;
  url.searchParams.set('key', process.env.FIREBASE_WEB_API_KEY);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) return null;
    const { idToken } = await response.json();
    const auth = firebaseAuth();
    const user = await auth.verifyIdToken(idToken, true);
    if (user.seqmoStaff !== true) return null;
    return await auth.createSessionCookie(idToken, { expiresIn: sessionHours * 3600000 });
  } catch {
    return null;
  }
}

export async function isStaff(token) {
  if (!loginConfigured() || !token) return false;
  try {
    const auth = firebaseAuth();
    const session = await auth.verifySessionCookie(token);
    if (session.seqmoStaff !== true) return false;
    const user = await auth.getUser(session.uid);
    const validAfter = Date.parse(user.tokensValidAfterTime);
    return !user.disabled && user.customClaims?.seqmoStaff === true &&
      (!Number.isFinite(validAfter) || session.auth_time * 1000 >= validAfter);
  } catch {
    return false;
  }
}
