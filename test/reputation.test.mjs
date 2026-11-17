import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReputation, reputationSummary } from '../lib/reputation.mjs';

const api = (value, status = 200) => new Response(JSON.stringify(value), { status });
const target = 'https://example.com/login?private=fixture#section';

test('Web Risk checks only the submitted URL with query and fragment removed', async () => {
  const result = await checkReputation(target, {
    key: 'fixture-api-key',
    async request(query, options) {
      assert.equal(query.origin, 'https://webrisk.googleapis.com');
      assert.equal(query.pathname, '/v1/uris:search');
      assert.equal(query.searchParams.get('uri'), 'https://example.com/login');
      assert.deepEqual(query.searchParams.getAll('threatTypes'), ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']);
      assert.equal(query.searchParams.has('key'), false);
      assert.equal(options.headers['x-goog-api-key'], 'fixture-api-key');
      assert.equal(options.method, 'GET');
      return api({ threat: { threatTypes: ['SOCIAL_ENGINEERING', 'MALWARE', 'ignored'], expireTime: '2030-01-01T00:00:00Z' } });
    },
  });
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.matches, ['マルウェア', 'フィッシングなどの偽装']);
  assert.doesNotMatch(JSON.stringify(result), /fixture|example\.com/);
});

test('unconfigured, failed and unknown responses are distinct from an explicit no-match', async () => {
  const missing = await checkReputation(target, { key: '', request() { assert.fail('needs a key'); } });
  assert.equal(missing.status, 'not_configured');
  const forbidden = await checkReputation(target, { key: 'key', request: async () => api({}, 403) });
  assert.equal(forbidden.status, 'unchecked');
  const unknown = await checkReputation(target, { key: 'key', request: async () => api({ unexpected: true }) });
  assert.equal(unknown.status, 'unchecked');
  const clear = await checkReputation(target, { key: 'key', request: async () => api({}) });
  assert.equal(clear.status, 'no_match');
  assert.match(reputationSummary(clear), /対象リストに診断時点で一致なし/);
});
