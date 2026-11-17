const catalog = {
  wordpress: { name: 'WordPress', category: 'CMS' },
  eccube: { name: 'EC-CUBE', category: 'CMS' },
  movabletype: { name: 'Movable Type', category: 'CMS' },
  jquery: { name: 'jQuery', category: 'JSライブラリ' },
  php: { name: 'PHP', category: '実行環境' },
  nodejs: { name: 'Node.js', category: '実行環境' },
  nextjs: { name: 'Next.js', category: 'Webフレームワーク' },
  nuxt: { name: 'Nuxt', category: 'Webフレームワーク' },
  angular: { name: 'Angular', category: 'Webフレームワーク' },
  nginx: { name: 'NGINX', category: 'Webサーバー' },
  'apache-http-server': { name: 'Apache HTTP Server', category: 'Webサーバー' },
  cloudflare: { name: 'Cloudflare', category: '配信サービス' },
  vercel: { name: 'Vercel', category: '配信サービス' },
};
const versionPattern = '[0-9]{1,3}(?:\\.[0-9]{1,4}){1,2}';
const jqueryFile = new RegExp(`^jquery(?:-(${versionPattern}))?(?:\\.slim)?(?:\\.min)?\\.js$`, 'i');
const technologyPattern = (name) => new RegExp(`^${name}(?:[/ ]+v?(${versionPattern}))?$`, 'i');
const frameworkPatterns = [
  ['nextjs', technologyPattern('Next\\.js')],
  ['nuxt', technologyPattern('Nuxt(?:\\.js)?')],
  ['angular', technologyPattern('Angular')],
];
const headerPatterns = [
  ['php', technologyPattern('PHP')],
  ['nodejs', technologyPattern('Node\\.js')],
  ...frameworkPatterns,
];
const generatorPatterns = [
  ['wordpress', technologyPattern('WordPress')],
  ['eccube', technologyPattern('EC-CUBE')],
  ['movabletype', technologyPattern('Movable Type')],
  ...frameworkPatterns,
];
const serverPatterns = [
  ['nginx', new RegExp(`^nginx(?:/(${versionPattern}))?(?:\\s+\\([^()]*\\))?$`, 'i')],
  ['apache-http-server', new RegExp(`^Apache(?:/(${versionPattern}))?(?:\\s+\\([^()]*\\))?$`, 'i')],
  ['cloudflare', /^cloudflare$/i],
  ['vercel', /^vercel$/i],
];
const numericVersion = new RegExp(`^${versionPattern}$`);

function indication(key, version, evidence) {
  return {
    key, ...catalog[key], ...(version ? { version } : {}),
    confidence: version ? 'likely' : 'possible', evidence: [evidence],
  };
}

export function declaredRuntimes(headers) {
  const observations = [];
  for (const header of ['x-powered-by', 'server']) {
    if (typeof headers[header] !== 'string') continue;
    const sources = headers[header].split(',').map((part) => part.trim());
    for (const source of sources) {
      const patterns = header === 'server' ? [...headerPatterns, ...serverPatterns] : headerPatterns;
      for (const [key, pattern] of patterns) {
        const match = pattern.exec(source);
        if (match) {
          const entry = indication(key, match[1], `公開ページの${header === 'server' ? 'Server' : 'X-Powered-By'}ヘッダーに記載`);
          if (header === 'x-powered-by' && !entry.version) entry.confidence = 'confirmed';
          observations.push(entry);
        }
      }
    }
  }
  return observations;
}

export function generatorDeclaration(content) {
  for (const [key, pattern] of generatorPatterns) {
    const match = pattern.exec(content?.trim() || '');
    if (match) return indication(key, match[1], '公開ページのmeta generatorに記載');
  }
  return null;
}

export function angularDeclaration(version) {
  return numericVersion.test(version || '') && indication('angular', version, '公開ページのHTMLのng-version属性に記載');
}

export function phpIndication(evidence) {
  return indication('php', undefined, evidence);
}

export function wordpressLinkDeclaration(url, page) {
  if (url?.origin !== page.origin || !/\/(?:wp-admin|wp-content|wp-includes)(?:\/|$)/i.test(url.pathname)) return null;
  return indication('wordpress', undefined, '公開ページにWordPressで使われる同一サイト内のパスへの参照');
}

export function frameworkAssetDeclaration(url, page) {
  if (!url || url.origin !== page.origin) return null;
  if (/\/(?:wp-includes|wp-content)\/.+\.js$/i.test(url.pathname)) {
    return indication('wordpress', undefined, '公開ページにWordPress標準のスクリプト参照。参照先は未取得');
  }
  if (/^\/_next\/static\/.+\.js$/.test(url.pathname)) {
    return indication('nextjs', undefined, '公開ページにNext.js標準の静的スクリプト参照。参照先は未取得');
  }
  if (/^\/_nuxt\/.+\.js$/.test(url.pathname)) {
    return indication('nuxt', undefined, '公開ページにNuxt標準の静的スクリプト参照。参照先は未取得');
  }
  return null;
}

export function libraryDeclaration(url) {
  if (!url || !['https:', 'http:'].includes(url.protocol)) return null;
  const file = url.pathname.split('/').at(-1);
  const match = jqueryFile.exec(file);
  if (!match) return null;
  const google = url.hostname === 'ajax.googleapis.com' &&
    new RegExp(`^/ajax/libs/jquery/(${versionPattern})/jquery(?:\\.min)?\\.js$`, 'i').exec(url.pathname);
  return indication('jquery', match[1] || google?.[1], '公開ページのscriptタグにあるjQueryの参照名。参照先は未取得');
}

const cache = new Map();
const day = 86400000;

function isoDate(input) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const date = Date.parse(input + 'T00:00:00Z');
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === input ? input : null;
}

async function lifecycleCatalog(key) {
  if (key === 'eccube' || key === 'movabletype') return null;
  const now = Date.now();
  const item = cache.get(key);
  if (item?.until > now) return item.pending;
  const pending = (async () => {
    try {
      const response = await fetch(`https://endoflife.date/api/v1/products/${key}/`, {
        signal: AbortSignal.timeout(2000), redirect: 'error',
      });
      if (!response.ok) return null;
      const { result } = await response.json();
      return result?.name === key && Array.isArray(result.releases) ? result.releases : null;
    } catch {
      return null;
    }
  })();
  cache.set(key, { until: now + day, pending });
  if (!(await pending)) cache.set(key, { until: now + 5 * 60000, pending });
  return pending;
}

export function lifecycleFor(version, releases, now = Date.now(), product = '') {
  if (!version || !Array.isArray(releases)) return null;
  const series = releases
    .filter((row) => typeof row?.name === 'string' && (version === row.name || version.startsWith(row.name + '.')))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!series) return null;
  const officialSupport = product === 'wordpress';
  // WordPress only officially supports its latest series. Older series can still receive backports.
  const endedFlag = officialSupport ? series.isEoas : series.isEol;
  const date = isoDate(officialSupport ? series.eoasFrom : series.eolFrom);
  const dateTime = date ? Date.parse(date + 'T00:00:00Z') : null;
  // Support dates represent the provider's stated day, inclusive.
  const since = dateTime == null ? null : Math.ceil((dateTime - now) / day);
  let status;
  if (endedFlag === true || (since !== null && since < 0)) status = 'ended';
  else if (since !== null) status = since <= 183 ? 'ending_soon' : 'supported';
  else if (endedFlag === false) status = 'supported';
  else return null;
  const released = isoDate(series.releaseDate);
  const versionReleased = series.latest?.name === version ? isoDate(series.latest.date) : null;
  return {
    status, ...(date ? { date } : {}), ...(released ? { seriesReleased: released } : {}),
    ...(versionReleased ? { versionReleased } : {}), series: series.name,
    ...(officialSupport ? { officialSupport: true } : {}),
    ...(!officialSupport && status !== 'ended' && series.isEoas === true ? { securityOnly: true } : {}),
  };
}

export async function assessTechnology(declarations, { add, observations, limitations }, getCatalog = lifecycleCatalog) {
  const distinct = new Map();
  for (const entry of declarations) {
    const id = entry.key + ':' + (entry.version || '');
    if (!distinct.has(id)) distinct.set(id, { ...entry, evidence: [...entry.evidence] });
    else {
      const current = distinct.get(id);
      if (entry.confidence === 'confirmed') current.confidence = 'confirmed';
      for (const item of entry.evidence) if (!current.evidence.includes(item)) current.evidence.push(item);
    }
  }
  const withVersion = new Set([...distinct.values()].filter(({ version }) => version).map(({ key }) => key));
  const unique = [...distinct.values()].filter(({ key, version }) => version || !withVersion.has(key));
  if (unique.length > 32) limitations.push('技術の表示は最初の32項目までです。');
  const techs = await Promise.all(unique.slice(0, 32).map(async (entry) => {
    if (!entry.version) return entry;
    const eol = lifecycleFor(entry.version, await getCatalog(entry.key), Date.now(), entry.key);
    return eol ? { ...entry, eol: { ...eol, source: `https://endoflife.date/${entry.key}` } } : entry;
  }));
  const ended = new Map();
  for (const entry of techs) {
    observations.push(`${entry.name} ${entry.version || '版は不明'}（${({ confirmed: '確定', likely: '可能性が高い', possible: '可能性あり' })[entry.confidence]}）。根拠は${entry.evidence.join('、')}。`);
    if (entry.eol?.status === 'ended' && !ended.has(entry.key)) ended.set(entry.key, entry);
  }
  for (const [key, entry] of ended) {
    add(`support-ended-${key}`, '部品の古さ', 'medium', `${entry.name}のサポート終了版が使われている可能性があります`,
      entry.eol.officialSupport
        ? 'この系列は公式サポートの対象外です。古い系列への修正の提供は保証されていません。'
        : 'この系列は通常のサポートが終了しているため、今後の修正や更新の扱いを確認する必要があります。',
      '運用担当者に実際の版と保守契約を確認し、対応中の系列への更新計画を検討してください。',
      `${entry.name} ${entry.version} 系列の公開サポート情報と照合（${entry.eol.date || '終了日は公表データで確認できず'}）。版の根拠は${entry.evidence.join('、')}。`, '可能性が高い');
  }
  if (!techs.length) limitations.push('公開ページの明示情報から、対応する技術名や版を確認できませんでした。');
  else if (techs.some(({ category, version, eol }) => category !== '配信サービス' && (!version || !eol))) {
    limitations.push('一部の技術については版またはサポート状況が不明です。');
  }
  return techs;
}

function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || (x[2] || 0) - (y[2] || 0);
}

const releaseHosts = new Set([
  'nginx.org', 'httpd.apache.org', 'nodejs.org', 'php.net', 'www.php.net', 'wordpress.org',
  'nextjs.org', 'nuxt.com', 'angular.dev', 'blog.jquery.com',
]);
const releaseRepositories = ['/vercel/next.js/', '/nuxt/nuxt/', '/angular/angular/', '/jquery/jquery/', '/nodejs/node/'];

function officialReleaseLink(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return releaseHosts.has(url.hostname) ||
      (url.hostname === 'github.com' && releaseRepositories.some((prefix) => url.pathname.startsWith(prefix)))
      ? url.href : null;
  } catch {
    return null;
  }
}

export function latestPublishedRelease(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row) => {
    const version = row?.latest?.name;
    const date = isoDate(row?.latest?.date);
    return typeof version === 'string' && numericVersion.test(version) && date ? [{ version, date, link: officialReleaseLink(row.latest.link) }] : [];
  }).sort((a, b) => compareVersions(b.version, a.version))[0] || null;
}

export async function researchTechnology(techs, getCatalog = lifecycleCatalog) {
  const candidates = new Map();
  for (const tech of techs || []) {
    if (!Object.hasOwn(catalog, tech.key) || !tech.version) continue;
    if (!candidates.has(tech.key)) candidates.set(tech.key, { ...tech, versions: new Set() });
    candidates.get(tech.key).versions.add(tech.version);
  }
  const entries = await Promise.all([...candidates.values()].filter(({ versions }) => versions.size === 1).slice(0, 5)
    .map(async (tech) => {
      const latest = latestPublishedRelease(await getCatalog(tech.key));
      if (!latest || compareVersions(latest.version, tech.version) <= 0) return null;
      return {
        id: tech.key, name: catalog[tech.key].name, observedVersion: tech.version, latestVersion: latest.version,
        releaseDate: latest.date, source: latest.link || `https://endoflife.date/${tech.key}`, checkedAt: new Date().toISOString(),
        confidence: tech.confidence,
      };
    }));
  return entries.filter(Boolean);
}
