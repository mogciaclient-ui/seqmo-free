import test from 'node:test';
import assert from 'node:assert/strict';
import { badAddress, isPublic, normalize, publicAddress, publicPageRedirect } from '../lib/target.mjs';

test('public web-app paths are kept while query parameters and fragments are dropped', () => {
  assert.equal(normalize(' Example.com/from?token=x#part ').href, 'https://example.com/from');
  assert.equal(normalize('http://EXAMPLE.COM.').href, 'http://example.com/');
  for (const name of ['localhost', '127.0.0.1', 'http://2130706433', '169.254.169.254',
    '172.17.0.1', 'http://[::ffff:127.0.0.1]', 'http://[fd00:ec2::254]', 'https://example.com:8030',
    'https://name:secret@example.com', 'file://example.com/etc/passwd', 'https://example.com/.env',
    'https://example.com/app/%252eenv', 'https://example.com/app%2F.env', 'https://example.com/backup.zip']) {
    assert.throws(() => normalize(name), { message: badAddress });
  }
});

test('IPv4 mapped IPv6 and special-purpose IPv6 are classified before use', () => {
  assert.equal(isPublic('::ffff:10.0.0.8'), false);
  assert.equal(isPublic('2001:db8::1'), false);
  assert.equal(isPublic('64:ff9b::7f00:1'), false);
  assert.equal(isPublic('100.64.0.1'), false);
  assert.equal(isPublic('2606:4700:4700::1111'), true);
  assert.equal(isPublic('1.1.1.1'), true);
});

test('mixed DNS answers block the whole destination and public answers stay pinned', async () => {
  const good = { address: '8.8.8.8', family: 4 };
  const bad = { address: '10.0.0.4', family: 4 };
  await assert.rejects(publicAddress('example.com', async () => [good, bad]), { message: badAddress });
  assert.deepEqual(await publicAddress('example.com', async () => [good]), good);
});

test('the worker GETs the submitted login page and only follows eligible same-host redirects', async () => {
  const { visitPublicPage } = await import('../lib/scan.mjs');
  const start = normalize('https://example.com/workspace/login?hint=fixture#header');
  const trail = [];
  const response = await visitPublicPage(start, Date.now() + 1000, async (url) => {
    trail.push(url.href);
    return trail.length === 1 ? { status: 302, headers: { location: '/workspace/sign-in' } } : { status: 200, headers: {} };
  });
  assert.deepEqual(trail, ['https://example.com/workspace/login', 'https://example.com/workspace/sign-in']);
  assert.equal(response.url.pathname, '/workspace/sign-in');
  for (const blocked of ['https://other.example/login', 'http://169.254.169.254/', '/.git/config', '/.env', '/login?token=fixture']) {
    assert.equal(publicPageRedirect(start, start, blocked), null);
  }
});
