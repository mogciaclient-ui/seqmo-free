import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeReport } from '../lib/report-analysis.mjs';
import { advisorySources } from '../lib/analysis-sources.mjs';
import { scoreBreakdown } from '../lib/grading.mjs';

const result = {
  issues: [
    { id: 'headers', level: 'medium', confidence: '確定', title: '保護設定不足' },
    { id: 'support-ended-nginx', level: 'medium', confidence: '可能性が高い', title: 'サポート終了の可能性' },
  ],
  good: [], limitations: [],
  techs: [{ key: 'nginx', name: 'NGINX', version: '1.10.3', confidence: 'likely' }],
};
const config = { url: new URL('https://api.openai.com/v1/chat/completions'), limit: 100, model: 'fixture', token: 'fixture' };

test('BadSSL score breakdown keeps the existing weighted deductions and rounding', () => {
  const score = scoreBreakdown(result.issues, { medium: 11 });
  assert.deepEqual(score.deductions.map(({ points }) => points.toFixed(1)), ["11.0", "7.7"]);
  assert.equal(score.raw, 81.3);
  assert.equal(score.score, 81);
  const high = { id: 'http', level: 'high', confidence: '確定' };
  assert.equal(scoreBreakdown([high, high], { high: 24, highScoreCap: 59 }).score, 59);
  assert.equal(scoreBreakdown([high, high], { high: 24 }).total, 24);
});

test('analysis saves links from the data source and rejects invented evidence or links', async () => {
  const lookup = (techs) => advisorySources(techs, async (url) => {
    assert.equal(url.hostname, 'services.nvd.nist.gov');
    assert.equal(url.searchParams.get('cpeName'), 'cpe:2.3:a:nginx:nginx:1.10.3:*:*:*:*:*:*:*');
    return Response.json({ totalResults: 1, vulnerabilities: [{ cve: {
      id: 'CVE-2000-99999', cisaExploitAdd: '2022-01-01', published: '2020-01-01T00:00:00',
    } }] });
  });
  const claim = { text: '運用の確認が必要です。', evidenceIds: ['technology-1'], sourceIds: ['source-1'] };
  const output = { overview: [claim], risks: [], relationships: [], businessImpact: [], improvements: [], unknowns: [] };
  const mock = (data) => async (_url, { body }) => {
    assert.equal(JSON.parse(body).response_format.json_schema.strict, true);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
  };
  const options = { config, reserve: async () => true, lookup, releases: async () => [] };
  const ready = await analyzeReport(result, { ...options, request: mock(output) });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.sources[0].url, 'https://nvd.nist.gov/vuln/detail/CVE-2000-99999');
  assert.equal(ready.sources[0].exploited, true);
  assert.deepEqual(ready.sections.overview[0].evidenceIds, ['technology-1']);
  const bad = await analyzeReport(result, { ...options, request: mock({
    ...output, overview: [{ ...claim, evidenceIds: ['headers'] }],
  }) });
  assert.equal(bad.status, 'unavailable');
  assert.equal(bad.sources.length, 1);
});
