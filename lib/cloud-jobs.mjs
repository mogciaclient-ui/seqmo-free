import { GoogleAuth } from 'google-auth-library';
import { prepareGoogleCredentials } from './google-credentials.mjs';

export function executionUrl(job) {
  if (!/^projects\/[a-z0-9][a-z0-9-]{3,62}\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9][a-z0-9-]*$/.test(job || '')) return null;
  return `https://run.googleapis.com/v2/${job}:run`;
}

const googleAccessToken = () => {
  prepareGoogleCredentials();
  return new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
};

export async function startScanJob(job = process.env.SEQMO_CLOUD_RUN_JOB, request = fetch, accessToken = googleAccessToken) {
  const url = executionUrl(job);
  if (!url) return false;
  try {
    const token = await accessToken();
    if (!token) return false;
    const response = await request(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(3500), redirect: 'error',
    });
    return response.ok;
  } catch { return false; }
}
