import https from 'node:https';
import { withRequestLimit } from './network-budget.mjs';
import { mailDomain } from './public-page.mjs';

const bootstrap = new URL('https://data.iana.org/rdap/dns.json');
const maxBytes = 256 * 1024;
let registryCache;

async function readJson(url, deadline) {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('RDAP URL is outside the allowed scope');
  return withRequestLimit(url, deadline, 'GET', (address, remaining) => new Promise((resolve, reject) => {
    const timeout = Math.min(2500, remaining);
    const request = https.get(url, {
      agent: false,
      family: address.family,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [address])
        : callback(null, address.address, address.family),
      signal: AbortSignal.timeout(timeout),
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': `seQmo/1.0 (domain expiry check; ${process.env.SEQMO_CONTACT || 'MOGCIA'})`,
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error('RDAP response unavailable'));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) { response.destroy(new Error('RDAP response is too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  }));
}

export function registrationExpiry(data, name, now = Date.now()) {
  if (data?.objectClassName !== 'domain' || typeof data.ldhName !== 'string' || data.ldhName.toLowerCase() !== name) return null;
  const dates = [...new Set((Array.isArray(data.events) ? data.events : [])
    .filter((event) => event?.eventAction === 'expiration')
    .map((event) => Date.parse(event.eventDate)).filter(Number.isFinite))];
  if (dates.length !== 1) return null;
  return {
    kind: 'domain', date: new Date(dates[0]).toISOString().slice(0, 10),
    daysLeft: Math.ceil((dates[0] - now) / 86400000), confidence: 'confirmed',
  };
}

export async function lookupRegistrationExpiry(host, deadline) {
  const { name, shared } = mailDomain(host);
  if (shared) return { kind: 'domain', notApplicable: true };
  const tld = name.split('.').at(-1);
  if (!/^(?:[a-z0-9-]+\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i.test(name)) return { kind: 'domain' };
  try {
    if (!registryCache || registryCache.until <= Date.now()) {
      const data = await readJson(bootstrap, deadline);
      if (!Array.isArray(data?.services)) return { kind: 'domain' };
      registryCache = { data, until: Date.now() + 86400000 };
    }
    const registry = registryCache.data.services.find(([zones]) => zones.includes(tld));
    const base = registry?.[1]?.find((value) => typeof value === 'string' && value.startsWith('https://'));
    if (!base) return { kind: 'domain' };
    const url = new URL(`domain/${encodeURIComponent(name)}`, base.endsWith('/') ? base : base + '/');
    return registrationExpiry(await readJson(url, deadline), name) || { kind: 'domain' };
  } catch {
    return { kind: 'domain' };
  }
}
