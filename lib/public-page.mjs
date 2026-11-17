import { parse as domainInfo } from 'tldts';

const vendors = [
  ['googletagmanager.com', 'Googleタグマネージャー', 'analytics'],
  ['google-analytics.com', 'Google Analytics', 'analytics'],
  ['doubleclick.net', 'Google広告', 'ads'],
  ['youtube.com', 'YouTube', 'video'],
  ['youtube-nocookie.com', 'YouTube', 'video'],
  ['vimeo.com', 'Vimeo', 'video'],
  ['fonts.googleapis.com', 'Google Fonts', 'font'],
  ['fonts.gstatic.com', 'Google Fonts', 'font'],
  ['maps.googleapis.com', 'Google Maps', 'map'],
  ['intercom.io', 'Intercom', 'chat'],
];

const parseHost = (host) => domainInfo(host, { allowPrivateDomains: true });
export function mailDomain(host) {
  const domain = parseHost(host);
  return { name: domain.domain || host, shared: domain.isPrivate === true && Boolean(domain.domain) };
}

export const sameSite = (a, b) => a === b || Boolean(parseHost(a).domain && parseHost(a).domain === parseHost(b).domain);

export function externalServices(urls) {
  const services = new Map();
  for (const url of urls) {
    const { hostname } = url;
    const registered = parseHost(hostname).domain;
    if (!registered) continue;
    const vendor = vendors.find(([suffix]) => hostname === suffix || hostname.endsWith('.' + suffix));
    const [, service, kind] = vendor || [null, registered, 'other'];
    if (!services.has(service)) services.set(service, { service, kind, domains: [], beforeConsent: null, confidence: 'confirmed' });
    // Known service DNS names are public constants. Other hosts are reduced to the site name.
    const label = vendor ? vendor[0] : registered;
    const entry = services.get(service);
    if (!entry.domains.includes(label)) entry.domains.push(label);
  }
  return [...services.values()];
}

const dkimSelectors = ['google', 'selector1', 'selector2', 'default'];

export async function lookupPublicDns(resolver, host, sink, checkMail) {
  const { name, shared } = mailDomain(host);
  if (shared) {
    sink.observations.push('SPF・DMARC・DKIMは対象外（共有ドメインのため）。根拠はPublic Suffix Listの共有ドメイン区分です。');
    return 'not_applicable';
  }
  const queries = [resolver.resolveTxt(name), resolver.resolveTxt(`_dmarc.${host}`),
    resolver.resolveMx(name), resolver.resolveCaa(host)];
  if (host !== name) queries.push(resolver.resolveTxt(`_dmarc.${name}`));
  const [spf, hostDmarc, mx, caa, parentDmarc] = await Promise.allSettled(queries);
  const absent = hostDmarc.status === 'fulfilled'
    ? !hostDmarc.value.some((parts) => /^v=DMARC1(?:;|$)/i.test(parts.join('')))
    : ['ENODATA', 'ENOTFOUND'].includes(hostDmarc.reason?.code);
  const dmarc = absent && parentDmarc ? parentDmarc : hostDmarc;
  if (dmarc === parentDmarc && dmarc.status === 'fulfilled' &&
      dmarc.value.some((parts) => /^v=DMARC1(?:;|$)/i.test(parts.join('')))) {
    sink.observations.push('サブドメインに明示されたDMARCがないため、登録ドメインの公開DNSを確認しました。');
  }
  const before = sink.limitations.length;
  checkMail({ spf, dmarc, mx, caa }, sink, name !== host);
  const answers = await Promise.allSettled(dkimSelectors.map((selector) => resolver.resolveTxt(`${selector}._domainkey.${name}`)));
  const found = answers.filter((entry) => entry.status === 'fulfilled' &&
    entry.value.some((parts) => /(?:^|;)\s*p\s*=\s*[A-Za-z0-9+/]/i.test(parts.join('')))).length;
  if (found) sink.good.push(`登録ドメインの公開DNSでDKIMの公開鍵を${found}件確認しました（既定の4セレクタを確認・公開鍵の値は保存しません）。`);
  else sink.limitations.push('DKIMは既定の4セレクタでは確認できませんでした。別のセレクタが設定されている可能性があります。');
  if (sink.limitations.length > before) return 'unchecked';
  return sink.observations.some((entry) => entry.startsWith('DMARCの方針は p=none')) ? 'caution' : 'good';
}
