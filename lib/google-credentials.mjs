import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getVercelOidcTokenSync } from '@vercel/oidc';

let tokenPath;
let latestToken;

// Firebase Admin's Firestore integration only accepts certificates or Application Default Credentials.
export function prepareGoogleCredentials() {
  const audience = process.env.GOOGLE_OIDC_AUDIENCE;
  if (!audience) return;
  const account = process.env.GOOGLE_OIDC_SERVICE_ACCOUNT;
  if (!/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[\w-]+\/providers\/[\w-]+$/.test(audience) ||
      !/^[\w-]+@[\w-]+\.iam\.gserviceaccount\.com$/.test(account || '')) {
    throw new Error('Invalid Google workload identity configuration');
  }
  const token = getVercelOidcTokenSync();
  if (!tokenPath) {
    const directory = mkdtempSync(join(tmpdir(), 'seqmo-google-'));
    const credentialsPath = join(directory, 'adc.json');
    const source = join(directory, 'oidc');
    writeFileSync(credentialsPath, JSON.stringify({
      type: 'external_account',
      audience,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
      credential_source: { file: source },
    }), { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    tokenPath = source;
  }
  if (token !== latestToken) {
    writeFileSync(tokenPath, token, { mode: 0o600 });
    latestToken = token;
  }
}
