import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReport } from '../lib/grading.mjs';
import { lookupPublicDns, mailDomain } from '../lib/public-page.mjs';
import { checkMail } from '../lib/mail-checks.mjs';

test('shared hosting suppresses mail DNS lookups, while custom domains get one fallback DMARC lookup', async () => {
  const sink = { observations: [], limitations: [], good: [], add() {} };
  const calls = [];
  const resolver = {
    async resolveTxt(name) {
      calls.push(name);
      if (name === '_dmarc.example.co.jp') return [['v=DMARC1; p=reject']];
      if (name === 'example.co.jp') return [['v=spf1 -all']];
      if (name === 'selector1._domainkey.example.co.jp') return [['v=DKIM1; p=TESTKEY']];
      return [];
    },
    async resolveMx() { return []; },
    async resolveCaa() { return []; },
  };
  assert.deepEqual(mailDomain('selmo-v1.vercel.app'), { name: 'selmo-v1.vercel.app', shared: true });
  assert.equal(await lookupPublicDns(resolver, 'selmo-v1.vercel.app', sink, checkMail), 'not_applicable');
  assert.deepEqual(calls, []);
  assert.equal(await lookupPublicDns(resolver, 'www.example.co.jp', sink, checkMail), 'good');
  assert(calls.includes('_dmarc.www.example.co.jp') && calls.includes('_dmarc.example.co.jp'));
  assert(calls.includes('selector1._domainkey.example.co.jp'));
  assert(sink.good.some((line) => line.includes('DKIM')));
  assert.doesNotMatch(JSON.stringify(sink), /TESTKEY/);
});

test('not applicable does not cap the score and possible findings count for half', () => {
  const config = { medium: 10, maxScore: 90, dangerLevel: 4, cautionLevel: 3 };
  const checked = { transport: 'good', settings: 'good', aging: 'good', thirdParty: 'good', entrance: 'good', trust: 'good' };
  const issues = [{ id: 'privacy-policy', category: '玄関', level: 'medium', confidence: '可能性あり' }];
  const result = scoreReport(issues, config, true, checked);
  assert.equal(result.score, 95);
  assert.deepEqual(result.categoryGrades.find(({ key }) => key === 'frontend').issueIds, ['privacy-policy']);
  assert.equal(scoreReport(issues, config, true, { ...checked, aging: 'unchecked' }).score, 95);
});

test('RDAP expiry only accepts a matching authoritative domain and a single date', async () => {
  const { registrationExpiry } = await import('../lib/registration.mjs');
  const base = { objectClassName: 'domain', ldhName: 'EXAMPLE.COM', events: [{ eventAction: 'expiration', eventDate: '2030-01-08T00:00:00Z' }] };
  assert.equal(registrationExpiry(base, 'example.com', Date.parse('2030-01-01')).daysLeft, 7);
  assert.equal(registrationExpiry(base, 'example.net'), null);
  assert.equal(registrationExpiry({ ...base, events: [...base.events, { eventAction: 'expiration', eventDate: '2031-01-08T00:00:00Z' }] }, 'example.com'), null);
});

test('only a confirmed high finding caps the nine-category report at 59', () => {
  const config = { high: 20, highScoreCap: 59, maxScore: 90, dangerLevel: 4, cautionLevel: 3 };
  const finding = { id: 'url-reputation', category: '公開情報', level: 'high', confidence: '可能性あり' };
  const result = scoreReport([finding], config, true, {});
  assert.equal(result.score, 90);
  assert.equal(scoreReport([{ ...finding, confidence: '確定' }], config, true, {}).score, 59);
  assert.equal(result.categoryGrades.length, 9);
  assert.deepEqual(result.categoryGrades.find(({ key }) => key === 'trust').issueIds, ['url-reputation']);
});
