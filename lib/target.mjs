import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export const badAddress = 'このアドレスは診断できません。';

export function isPublic(ip) {
  try {
    const address = ipaddr.process(ip);
    if (address.range() !== 'unicast') return false;
    if (address.kind() === 'ipv6') return address.match(ipaddr.parse('2000::'), 3)
      && !address.match(ipaddr.parse('2001::'), 23) && !address.match(ipaddr.parse('3fff::'), 20);
    return true;
  } catch {
    return false;
  }
}

export function publicPagePath(pathname) {
  if (['/robots.txt', '/sitemap.xml', '/.well-known/security.txt'].includes(pathname)) return true;
  return pathname.split('/').every((segment) => {
    try {
      const value = decodeURIComponent(segment);
      return !value.startsWith('.') && !/[\\/\u0000-\u001f\u007f]|%[a-f\d]{2}/i.test(value) &&
        !/^(?:backup|dump|database)\.(?:zip|tar(?:\.gz)?|gz|sql|bak)$/i.test(value);
    } catch {
      return false;
    }
  });
}

export function publicPageRedirect(start, current, location) {
  let next;
  try { next = new URL(location, current); } catch { return null; }
  if (next.hostname !== start.hostname || next.username || next.password || next.port || next.search ||
      !['https:', 'http:'].includes(next.protocol) || !publicPagePath(next.pathname)) return null;
  next.hash = '';
  return next;
}

export function normalize(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('URLの形が正しくありません。');
  const value = input.trim();
  let url;
  try {
    url = new URL(/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error('URLの形が正しくありません。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) throw new Error(badAddress);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (ipaddr.isValid(host) ? !isPublic(host) : !host.includes('.') || /\.(localhost|local|internal|test|onion|invalid)$/.test(host)) {
    throw new Error(badAddress);
  }
  url.hostname = host.includes(':') ? `[${host}]` : host;
  if (!publicPagePath(url.pathname)) throw new Error(badAddress);
  url.search = '';
  url.hash = '';
  return url;
}

export async function publicAddress(host, resolve = dns.lookup) {
  const name = host.replace(/^\[|\]$/g, '');
  let timeout;
  const addresses = await Promise.race([
    resolve(name, { all: true, verbatim: true }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('DNS確認がタイムアウトしました。')), 3500); }),
  ]).finally(() => clearTimeout(timeout));
  if (!addresses.length || addresses.some(({ address }) => !isPublic(address))) throw new Error(badAddress);
  return addresses.find(({ family }) => family === 4) || addresses[0];
}
