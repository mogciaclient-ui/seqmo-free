import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficConfiguration, fetchTraffic } from '../lib/traffic.mjs';
import { executionUrl, startScanJob } from '../lib/cloud-jobs.mjs';
import { researchTechnology } from '../lib/technology.mjs';

const json = (value) => new Response(JSON.stringify(value));
const env = {
  SEQMO_TRAFFIC_SITES_JSON: JSON.stringify({ 'app.example.com': { ga4Property: '124', cloudflareZone: 'a'.repeat(32), cloudflareDays: 7 } }),
  SEQMO_CLOUDFLARE_ANALYTICS_TOKEN: 'fixture',
};

test('GA4 aggregates are filtered at the exact configured host and use read-only credentials', async () => {
  assert.equal(trafficConfiguration('other.example.com', env).ga4, null);
  assert.equal(await fetchTraffic('other.example.com', 'ga4', { env, request: () => assert.fail() }), null);
  const result = await fetchTraffic('app.example.com', 'ga4', {
    env, now: Date.parse('2026-11-18'), googleToken: async () => 'fixture',
    request: async (url, options) => {
      assert.match(url, /analyticsdata\.googleapis\.com.*124:runReport$/);
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      const body = JSON.parse(options.body);
      assert.equal(body.dimensionFilter.filter.stringFilter.value, 'app.example.com');
      const value = body.dimensions[0].name === 'date' ? '20261116' : 'Japan';
      return json({ rows: [{ dimensionValues: [{ value }], metricValues: [{ value: '8' }, { value: '13' }] }] });
    },
  });
  assert.deepEqual(result.countries, [{ name: 'Japan', count: 8, views: 13 }]);
  assert.equal(result.from, '2026-11-16');
  assert.equal(result.requestedTo, '2026-11-17');
  assert.doesNotMatch(JSON.stringify(result), /fixture/);
});

test('Cloudflare returns normalized aggregates and GraphQL errors do not become zero traffic', async () => {
  const request = async (url, options) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(JSON.parse(options.body).variables.filter.clientRequestHTTPHost, 'app.example.com');
    return json({ data: { viewer: { zones: [{ countries: [{ count: 2, dimensions: { clientCountryName: 'JP' } }],
      daily: [{ count: 2, dimensions: { date: '2026-11-17' } }] }] } } });
  };
  const result = await fetchTraffic('app.example.com', 'cloudflare', { env, now: Date.parse('2026-11-18'), request });
  assert.deepEqual(result.countries, [{ name: '日本', count: 2 }]);
  assert.equal(result.metric, 'HTTPリクエスト');
  await assert.rejects(fetchTraffic('app.example.com', 'cloudflare', { env, request: async () => json({ errors: [{}] }) }));
});

test('Cloud Run dispatch is confined to a configured job at the official API', async () => {
  const job = 'projects/example-project/locations/asia-northeast1/jobs/seqmo-worker';
  assert.equal(executionUrl('https://example.com'), null);
  assert.equal(await startScanJob(job, async (url, options) => {
    assert.equal(url, 'https://run.googleapis.com/v2/' + job + ':run');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    return json({});
  }, async () => 'fixture'), true);
});

test('release research records only a newer published version and omits ambiguous candidates', async () => {
  const wordpress = { key: 'wordpress', version: '5.8.1', confidence: 'likely' };
  const research = await researchTechnology([wordpress, { key: 'php', version: '9.0.1' }], async () => [
    { latest: { name: '6.9.4', date: '2026-11-01' } }, { latest: { name: '7.0.1-beta', date: '2026-11-01' } },
  ]);
  assert.equal(research.length, 1);
  assert.equal(research[0].latestVersion, '6.9.4');
  assert.equal(research[0].source, 'https://endoflife.date/wordpress');
  assert.deepEqual(await researchTechnology([wordpress, { ...wordpress, version: '6.0.2' }]), []);
});
