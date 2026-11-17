import assert from 'node:assert/strict';
import test from 'node:test';
import { checkResponse } from '../lib/response-checks.mjs';
import { checkMail } from '../lib/mail-checks.mjs';

function report() {
  const result = {
    good: [], observations: [], limitations: [], issues: [],
    add(id, category, level, title, impact, fix, evidence, confidence) {
      result.issues.push({ id, category, level, title, impact, fix, evidence, confidence });
    },
  };
  return result;
}

const baseline = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-type': 'text/html; charset=utf-8',
};
const inspect = (headers, body = '', truncated = false) => {
  const result = report();
  checkResponse({ headers, body, url: new URL('https://example.com/'), truncated }, result);
  return result;
};

test('present but ineffective header directives and fallback precedence', () => {
  const invalid = inspect({ ...baseline, 'strict-transport-security': 'max-age=0',
    'x-content-type-options': 'other, nosniff', 'x-frame-options': 'obsolete',
    'referrer-policy': 'unknown, unsafe-url' });
  assert.deepEqual(invalid.issues.map(({ id }) => id), ['header-values', 'referrer-url']);
  assert.match(invalid.issues[0].evidence, /有効期間0/);
  assert.doesNotMatch(invalid.issues[0].evidence, /X-Frame-Options/);
  assert.deepEqual(inspect({ ...baseline, 'strict-transport-security': 'max-age="31536000"' }).issues, []);
});

test('HTML references are parsed without loading them, with base URL and form overrides', () => {
  const result = inspect(baseline, `
    <base href="http://example.com/path/">
    <!-- <script src="http://ignored.example/comment"></script> -->
    <template><iframe src="http://ignored.example/template"></iframe></template>
    <script type="application/json" src="http://ignored.example/data"></script>
    <script src="http&#58;//assets.example/app.js?token=example-secret"></script>
    <link rel="stylesheet" href="style.css">
    <img src="photo.jpg">
    <form action="https://example.com/submit">
      <button type="reset" formaction="http://ignored.example/reset">Reset</button>
      <button formaction="save">Save</button>
    </form>`, true);
  assert.deepEqual(result.issues.map(({ id }) => id), ['mixed-active', 'mixed-media', 'form']);
  assert.match(result.issues[0].evidence, /2件/);
  assert.match(result.issues[2].evidence, /1件/);
  assert.doesNotMatch(JSON.stringify(result), /example-secret|assets\.example/);
  assert.match(result.limitations[0], /192 KiB/);
});

test('Cookie combinations are audited without reporting names or values', () => {
  const result = inspect({ ...baseline, 'set-cookie': [
    'discard=expired; Max-Age=0',
    '__Host-sensitive-name=fixture-secret; Secure; Domain=example.com; Path=/; HttpOnly; SameSite=Lax',
    'opaque-name=fixture-secret; SameSite=None; HttpOnly',
  ] });
  assert.deepEqual(result.issues.map(({ id }) => id), ['cookie-secure', 'cookie-attributes']);
  assert.match(result.issues[1].evidence, /2件/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|sensitive-name|opaque-name/);
});

const fulfilled = (value) => ({ status: 'fulfilled', value });
test('DNS flags permissive or duplicate records and reports monitoring policies', () => {
  const result = report();
  checkMail({
    spf: fulfilled([['v=spf1 ', '+all']]),
    dmarc: fulfilled([['v=DMARC1; p=none; rua=mailto:private@example.com']]),
    mx: fulfilled([{ priority: 0, exchange: '.' }]),
    caa: fulfilled([{ critical: 0, issue: 'ca.example' }]),
  }, result);
  assert.deepEqual(result.issues.map(({ id }) => id), ['spf-open']);
  assert.match(result.observations.join(' '), /p=none.*Null MX.*CAA/);
  assert.doesNotMatch(JSON.stringify(result), /private@example|ca\.example/);
  const duplicate = report();
  checkMail({
    spf: fulfilled([['v=spf1 -all'], ['v=spf1 ~all']]),
    dmarc: fulfilled([['v=DMARC1; p=reject'], ['v=DMARC1; p=none']]),
    mx: fulfilled([]), caa: fulfilled([]),
  }, duplicate);
  assert.deepEqual(duplicate.issues.map(({ id }) => id), ['spf-duplicates', 'dmarc-duplicates']);
});

test('a working protection appears even when unrelated settings are missing', () => {
  const result = inspect({
    'strict-transport-security': 'max-age=31536000',
    'content-type': 'text/html',
  }, '<script src="/app.js"></script><link rel="stylesheet" href="/site.css">');
  assert.equal(result.issues[0].id, 'headers');
  assert.deepEqual(result.good.map((item) => item.match(/^(?:HSTS|公開ページ)/)?.[0]), ['HSTS', '公開ページ']);
  assert.equal(inspect({ 'strict-transport-security': 'max-age=0' }).good.length, 0);
  assert.equal(inspect(baseline, '<script src="/app.js"></script>', true).good.some((item) => item.startsWith('公開ページ')), false);
});

test('external services are grouped by service without storing URLs or querying them', () => {
  const result = report();
  const page = checkResponse({
    headers: baseline,
    url: new URL('https://tenant.vercel.app/'),
    body: `<script src="/own.js"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?fixture-secret">
      <link rel="stylesheet" href="https://fonts.gstatic.com/fonts">
      <iframe src="https://www.youtube-nocookie.com/embed/example"></iframe>
      <form method="post" action="https://example.net/contact?fixture-secret"><label>お問い合わせ<textarea name="message"></textarea></label></form>`,
  }, result);
  assert.deepEqual(page.thirdParties.map(({ service, kind }) => [service, kind]), [['Google Fonts', 'font'], ['YouTube', 'video']]);
  assert(page.thirdParties.every(({ beforeConsent }) => beforeConsent === null));
  assert(result.observations.some((line) => line.includes('別ドメイン')));
  assert.equal(result.issues[0].id, 'privacy-policy');
  assert.equal(result.issues[0].confidence, '可能性あり');
  assert.doesNotMatch(JSON.stringify({ result, page }), /fixture-secret|\/embed\/|\/contact\?/);
});

test('only explicit retired Universal Analytics tags are reported without identifiers', () => {
  const result = inspect(baseline, `
    <script src="https://www.googletagmanager.com/gtag/js?id=UA-888888-1"></script>
    <script src="https://www.googletagmanager.com/gtag/js?id=G-NEW"></script>
    <script src="https://example.net/gtag/js?id=UA-777777-1"></script>
  `);
  assert.equal(result.issues[0].id, 'retired-analytics');
  assert.match(result.issues[0].evidence, /1件/);
  assert.doesNotMatch(JSON.stringify(result), /UA-888888|UA-777777/);
});

test('HTML flags HTTP meta refresh and video posters without exposing destination URLs', () => {
  const result = inspect(baseline, `
    <meta http-equiv="refresh" content="0; url='http://example.com/?token=fixture-secret'">
    <meta http-equiv="refresh" content="0; url=/new-page">
    <video poster="http://example.com/poster.jpg"></video>`);
  assert.deepEqual(result.issues.map(({ id }) => id), ['insecure-refresh', 'mixed-media']);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|poster\.jpg/);
  assert(!inspect(baseline, '', true).observations.some((line) => line.includes('meta refresh')));
});
