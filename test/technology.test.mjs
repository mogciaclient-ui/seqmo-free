import assert from 'node:assert/strict';
import test from 'node:test';
import { checkResponse } from '../lib/response-checks.mjs';
import { assessTechnology, lifecycleFor } from '../lib/technology.mjs';
import { technologyLifecycle } from '../lib/report.mjs';

const sink = () => {
  const issues = [];
  return { good: [], observations: [], limitations: [], issues, add(...issue) { issues.push(issue); } };
};

test('declared technologies preserve explicit versions but omit cache-busting strings and raw metadata', () => {
  const result = checkResponse({
    headers: { 'content-type': 'text/html', 'x-powered-by': 'PHP/8.2.31, Node.js', server: 'custom fixture-secret' },
    body: `<meta name="generator" content="WordPress 5.8.1">
      <script src="/assets/jquery.min.js?ver=9.9.9&token=fixture-secret"></script>
      <script src="https://code.jquery.com/jquery-1.12.4.min.js?token=fixture-secret"></script>
      <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>`,
    url: new URL('https://example.com/'),
  }, sink());
  assert.deepEqual(result.declarations.map(({ name, version }) => [name, version]), [
    ['PHP', '8.2.31'], ['Node.js', undefined], ['WordPress', '5.8.1'], ['jQuery', undefined], ['jQuery', '1.12.4'], ['jQuery', '3.7.1'],
  ]);
  assert.doesNotMatch(JSON.stringify(result.declarations), /fixture-secret|9\.9\.9|example\.com|code\.jquery/);
});

test('lifecycle uses the most specific known series, and labels series dates separately from release dates', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const lifecycle = lifecycleFor('8.2.12', [
    { name: '8', isEol: false },
    { name: '8.2', isEol: false, eolFrom: '2026-12-31', releaseDate: '2022-12-08', latest: { name: '8.2.35', date: '2026-10-15' } },
  ], now);
  assert.equal(lifecycle.status, 'ending_soon');
  assert.equal(lifecycle.versionReleased, undefined);
  assert.match(technologyLifecycle({ eol: lifecycle }, now)[0], /系列の公開日 2022-12-08（診断時点で3年11か月経過）/);
  assert.equal(lifecycleFor('1.12.4', [{ name: '1', isEol: true }], now).date, undefined);
  assert.equal(lifecycleFor('99.12', [{ name: '1', isEol: true }], now), null);
});

test('ended versions are reported once per product and unknown versions are unscored', async () => {
  const notes = sink();
  const page = checkResponse({
    headers: { 'content-type': 'text/html', 'x-powered-by': 'Node.js' },
    body: '<script src="/jquery-1.12.4.js"></script><script src="/jquery-2.2.4.js"></script>',
    url: new URL('https://example.com/'),
  }, sink());
  const catalogCalls = [];
  const items = await assessTechnology(page.declarations, notes, async (key) => {
    catalogCalls.push(key);
    return [{ name: '1', isEol: true }, { name: '2', isEol: true }];
  });
  assert.equal(items.find(({ name }) => name === 'Node.js').version, undefined);
  assert(catalogCalls.every((key) => key === 'jquery'));
  assert.equal(notes.issues.length, 1);
  assert.equal(notes.issues[0][0], 'support-ended-jquery');
  assert.equal(notes.issues[0].at(-1), '可能性が高い');
});

test('WordPress reports the end of official support separately from backported security fixes', () => {
  const date = Date.parse('2026-11-17T12:00:00Z');
  const series = { name: '5.8', isEoas: true, eoasFrom: '2022-01-25', isEol: false };
  const value = lifecycleFor('5.8.1', [series], date, 'wordpress');
  assert.equal(value.status, 'ended');
  assert.match(technologyLifecycle({ eol: value }, date).join(' '), /公式サポート終了日 2022-01-25.*修正が提供される場合/);
});

test('login page detects Web frameworks from public declarations without treating asset hashes as versions', () => {
  const notes = sink();
  const result = checkResponse({
    headers: { 'content-type': 'text/html', 'x-powered-by': 'Next.js' },
    body: `<meta name="generator" content="Nuxt 3.18.1">
      <script src="/_next/static/chunks/16.4.3.js?fixture-secret"></script>
      <script src="https://other.example/_nuxt/example.js"></script>
      <app-root ng-version="20.3.0"><form><input type="password"></form></app-root>`,
    url: new URL('https://example.com/workspace/login'),
  }, notes);
  assert.deepEqual(result.declarations.map(({ name, version }) => [name, version]), [
    ['Next.js', undefined], ['Nuxt', '3.18.1'], ['Next.js', undefined], ['Angular', '20.3.0'],
  ]);
  assert(notes.observations.some((item) => item.includes('パスワード入力欄')));
  assert.doesNotMatch(JSON.stringify(result.declarations), /16\.4\.3|fixture-secret|other\.example/);
});

test('public server headers supply versions for support lookup while managed delivery stays versionless', async () => {
  const { declarations } = checkResponse({
    headers: { server: 'nginx/1.28.3 (Ubuntu), Apache/2.4.65 (Unix), cloudflare', 'content-type': 'text/html' },
    url: new URL('https://example.com/'),
    body: '<script src="/wp-includes/js/app.js?ver=6.8.1"></script>',
  }, sink());
  const lookedUp = [];
  const techs = await assessTechnology(declarations, sink(), async (key) => {
    lookedUp.push(key);
    return [{ name: key === 'nginx' ? '1.28' : '2.4', isEol: false }];
  });
  assert.deepEqual(lookedUp, ['nginx', 'apache-http-server']);
  assert.deepEqual(techs.map(({ name, version, eol }) => [name, version, eol?.status]), [
    ['NGINX', '1.28.3', 'supported'],
    ['Apache HTTP Server', '2.4.65', 'supported'],
    ['Cloudflare', undefined, undefined],
    ['WordPress', undefined, undefined],
  ]);
});

test('PHP hints never infer a version or preserve cookie values and internal paths', () => {
  const output = sink();
  const headers = { 'content-type': 'text/html', 'set-cookie': ['PHPSESSID=fixture-secret; Secure; HttpOnly; SameSite=Lax'] };
  const result = checkResponse({
    headers, url: new URL('https://example.com/login.php?id=123'),
    body: '<b>Warning</b>: something happened in <b>/srv/private-fixture/index.php</b> on line <b>42</b>',
  }, output);
  assert.equal(result.declarations.filter(({ key }) => key === 'php').length, 3);
  assert(result.declarations.every(({ version }) => version === undefined));
  assert(output.issues.some(([id]) => id === 'php-error-disclosure'));
  assert.doesNotMatch(JSON.stringify({ result, output }), /fixture-secret|private-fixture/);
  const docs = checkResponse({
    headers: { 'content-type': 'text/html' }, url: new URL('https://example.com/?id=123'),
    body: '<pre>Warning: sample in /srv/example.php on line 42</pre>',
  }, sink());
  assert.deepEqual(docs.declarations, []);
});
