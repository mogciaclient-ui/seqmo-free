import { GoogleAuth } from 'google-auth-library';

const analyticsAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
export const trafficSources = { ga4: 'Google Analytics 4', cloudflare: 'Cloudflare' };
const day = 86400000;
const utcDate = (time) => new Date(time).toISOString().slice(0, 10);
const count = (value) => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value) || 0)));
const label = (value) => typeof value === 'string' && value.length <= 100 ? value : '不明';
const shortDate = (value) => /^\d{8}$/.test(value || '') ? value.replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3') : value;

export function trafficConfiguration(host, env = process.env) {
  try {
    const sites = JSON.parse(env.SEQMO_TRAFFIC_SITES_JSON || '{}');
    const site = Object.hasOwn(sites, host) ? sites[host] : null;
    return {
      ga4: /^\d{1,20}$/.test(site?.ga4Property || '') ? String(site.ga4Property) : null,
      cloudflare: env.SEQMO_CLOUDFLARE_ANALYTICS_TOKEN && /^[a-f\d]{32}$/i.test(site?.cloudflareZone || '') ? site.cloudflareZone : null,
      cloudflareDays: Math.min(30, Math.max(1, Number.parseInt(site?.cloudflareDays, 10) || 7)),
    };
  } catch { return {}; }
}

export function trafficWindow(days, now = Date.now()) {
  return { from: utcDate(now - days * day), to: utcDate(now - day), until: utcDate(now) };
}

async function query(url, token, body, request) {
  const response = await request(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(9000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error('provider');
  return response.json();
}

async function ga4(host, property, window, request, googleToken) {
  const token = await googleToken();
  if (!token) throw new Error('credential');
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`;
  const body = {
    dateRanges: [{ startDate: window.from, endDate: window.to }],
    metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
    dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: host, caseSensitive: false } } },
  };
  const [countries, daily] = await Promise.all(['country', 'date'].map((name) => query(endpoint, token,
    { ...body, dimensions: [{ name }], limit: 300 }, request)));
  return {
    countries: (countries.rows || []).map((row) => ({ name: label(row.dimensionValues?.[0]?.value), count: count(row.metricValues?.[0]?.value), views: count(row.metricValues?.[1]?.value) })),
    daily: (daily.rows || []).map((row) => ({ date: shortDate(row.dimensionValues?.[0]?.value), count: count(row.metricValues?.[0]?.value), views: count(row.metricValues?.[1]?.value) })),
    metric: 'セッション',
  };
}

const cloudflareQuery = `query ($zone: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
  viewer { zones(filter: {zoneTag: $zone}) {
    countries: httpRequestsAdaptiveGroups(limit: 300, filter: $filter) { count dimensions { clientCountryName } }
    daily: httpRequestsAdaptiveGroups(limit: 31, filter: $filter) { count dimensions { date } }
  } }
}`;

const cloudflareSecurityQuery = `query ($zone: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
  viewer { zones(filter: {zoneTag: $zone}) {
    actions: httpRequestsAdaptiveGroups(limit: 30, filter: $filter) { count dimensions { securityAction } }
  } }
}`;

async function cloudflare(host, zone, window, request, token) {
  const endpoint = 'https://api.cloudflare.com/client/v4/graphql';
  const variables = {
    zone, filter: { datetime_geq: `${window.from}T00:00:00Z`, datetime_lt: `${window.until}T00:00:00Z`, clientRequestHTTPHost: host },
  };
  const [result, securityResult] = await Promise.all([
    query(endpoint, token, { query: cloudflareQuery, variables }, request),
    query(endpoint, token, { query: cloudflareSecurityQuery, variables }, request).catch(() => null),
  ]);
  const report = result.data?.viewer?.zones?.[0];
  if (result.errors?.length || !report) throw new Error('provider');
  const actions = !securityResult?.errors?.length && securityResult?.data?.viewer?.zones?.[0]?.actions;
  const security = Array.isArray(actions) ? {
    status: 'available',
    actions: actions.filter(({ dimensions }) => typeof dimensions?.securityAction === 'string' && dimensions.securityAction.trim())
      .map(({ count: value, dimensions }) => ({ action: label(dimensions.securityAction), count: count(value) })),
  } : { status: 'unchecked' };
  const names = new Intl.DisplayNames('ja', { type: 'region', fallback: 'none' });
  return {
    countries: (report.countries || []).map(({ count: value, dimensions }) => {
      const code = dimensions?.clientCountryName;
      return { name: /^[A-Z]{2}$/.test(code || '') ? names.of(code) || '不明' : '不明', count: count(value) };
    }),
    daily: (report.daily || []).map(({ count: value, dimensions }) => ({ date: dimensions?.date, count: count(value) })),
    metric: 'HTTPリクエスト', security,
  };
}

export async function fetchTraffic(host, source, { env = process.env, request = fetch, googleToken = () => analyticsAuth.getAccessToken(), now = Date.now() } = {}) {
  const config = trafficConfiguration(host, env);
  if (!Object.hasOwn(trafficSources, source) || !config[source]) return null;
  const window = trafficWindow(source === 'ga4' ? 30 : config.cloudflareDays, now);
  const data = source === 'ga4' ? await ga4(host, config.ga4, window, request, googleToken)
    : await cloudflare(host, config.cloudflare, window, request, env.SEQMO_CLOUDFLARE_ANALYTICS_TOKEN);
  data.countries.sort((a, b) => b.count - a.count);
  data.daily = data.daily.filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date >= window.from && date <= window.to)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    source, ...data, from: data.daily[0]?.date || null, to: data.daily.at(-1)?.date || null,
    requestedFrom: window.from, requestedTo: window.to, fetchedAt: new Date(now).toISOString(),
  };
}
