const products = {
  nginx: 'nginx:nginx',
  'apache-http-server': 'apache:http_server',
  wordpress: 'wordpress:wordpress',
  php: 'php:php',
  nodejs: 'nodejs:node.js',
  nextjs: 'vercel:next.js',
  nuxt: 'nuxt:nuxt',
  angular: 'angular:angular',
  jquery: 'jquery:jquery',
};

function severityScore(cve) {
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const score = cve.metrics?.[key]?.[0]?.cvssData?.baseScore;
    if (typeof score === 'number' && score >= 0 && score <= 10) return score;
  }
  return null;
}

export async function advisorySources(techs = [], request = fetch) {
  const candidates = techs.filter(({ key, version }) => Object.hasOwn(products, key) && /^\d+(?:\.\d+){2}$/.test(version || ''));
  const unique = [...new Map(candidates.map((entry) => [`${entry.key}:${entry.version}`, entry])).values()];
  const queries = unique.slice(0, 3);
  const results = await Promise.all(queries.map(async (tech) => {
    const url = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0');
    url.searchParams.set('cpeName', `cpe:2.3:a:${products[tech.key]}:${tech.version}:*:*:*:*:*:*:*`);
    url.searchParams.set('isVulnerable', '');
    url.searchParams.set('resultsPerPage', '200');
    try {
      const response = await request(url, { signal: AbortSignal.timeout(3500), redirect: 'error' });
      if (!response.ok) throw Error('Advisory lookup failed');
      const body = await response.json();
      if (!Array.isArray(body.vulnerabilities)) throw Error('Invalid advisory response');
      const matching = body.vulnerabilities.flatMap(({ cve }) => {
        if (!/^CVE-\d{4}-\d{4,}$/.test(cve?.id || '') || cve.vulnStatus === 'Rejected') return [];
        return [{
          kind: 'advisory', title: cve.id, technology: tech.name, version: tech.version,
          url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          published: /^\d{4}-\d{2}-\d{2}T/.test(cve.published || '') ? cve.published.slice(0, 10) : '',
          score: severityScore(cve), exploited: /^\d{4}-\d{2}-\d{2}$/.test(cve.cisaExploitAdd || ''),
        }];
      });
      const status = body.totalResults > matching.length ? 'partial' : 'checked';
      return { technology: tech.name, version: tech.version, status, matching };
    } catch {
      return { technology: tech.name, version: tech.version, status: 'unavailable', matching: [] };
    }
  }));
  const advisories = results.flatMap(({ matching }) => matching).sort((a, b) =>
    Number(b.exploited) - Number(a.exploited) || (b.score ?? -1) - (a.score ?? -1) || b.published.localeCompare(a.published));
  const recent = [...advisories].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 3);
  const selected = [...new Set([...advisories.slice(0, 5), ...recent])];
  return {
    advisories: selected,
    lookups: results.map(({ technology, version, status }) => ({ technology, version, status })),
    omitted: techs.filter(({ category }) => category !== '配信サービス').length - queries.length,
  };
}
