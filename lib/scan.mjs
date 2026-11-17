import http from 'node:http';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { withRequestLimit } from './network-budget.mjs';
import { badAddress, publicAddress, publicPageRedirect } from './target.mjs';

import { lookupRegistrationExpiry } from './registration.mjs';
import { negotiateVersion } from './tls-settings.mjs';
import { checkReputation } from './reputation.mjs';
import { assessTechnology } from './technology.mjs';
import { scoreReport } from './grading.mjs';
import { checkResponse, hasPasswordField } from './response-checks.mjs';
function request(url, address, timeout) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'GET', agent: false, family: address.family, autoSelectFamily: false,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [address])
        : callback(null, address.address, address.family),
      headers: {
        'User-Agent': `seQmo/1.0 (public configuration check; ${process.env.SEQMO_CONTACT || 'MOGCIA'})`,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeout),
      maxHeaderSize: 24576,
    }, (res) => {
      const certificate = res.socket.getPeerCertificate?.();
      const headers = res.headers;
      const protocol = res.socket.getProtocol?.();
      const chunks = [];
      let length = 0;
      const finish = (truncated = false) => resolve({ status: res.statusCode, headers, certificate, protocol, truncated, body: Buffer.concat(chunks).toString('utf8') });
      res.on('data', (chunk) => {
        const remaining = 192 * 1024 - length;
        chunks.push(chunk.subarray(0, remaining));
        length += Math.min(remaining, chunk.length);
        if (length >= 192 * 1024) { finish(true); res.destroy(); }
      });
      res.on('end', () => finish());
      res.on('aborted', () => reject(new Error('応答が途中で終了しました。')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function limitedGet(url, deadline) {
  return withRequestLimit(url, deadline, 'GET', (address, timeout) => request(url, address, timeout));
}

async function checkLegacyTls(url, deadline, add, observations, limitations, good) {
  const accepted = [];
  const rejected = [];
  const unchecked = [];
  for (const version of ['TLSv1', 'TLSv1.1']) {
    const label = version === 'TLSv1' ? 'TLS 1.0' : 'TLS 1.1';
    let status;
    try {
      status = await withRequestLimit(url, deadline, 'TLS_HANDSHAKE', (address, timeout) =>
        negotiateVersion(url.hostname, address.address, version, Math.min(timeout, 1800)));
    } catch (error) {
      if (error.message === badAddress) throw error;
    }
    if (status === 'accepted') accepted.push(label);
    else if (status === 'rejected') rejected.push(label);
    else unchecked.push(label);
  }
  if (accepted.length) add('legacy-tls', '通信', 'medium', '旧式のTLSでも接続できます', '古い通信方式を利用できる状態です。', '古い端末への影響を確認し、ホスティング側で最小TLSバージョンを見直してください。', `接続時に${accepted.join('・')}を指定し、証明書を検証したうえで接続成立。`);
  if (rejected.length === 2) good.push('TLS 1.0とTLS 1.1は、接続先で明示的に拒否されました。');
  else if (rejected.length) observations.push(`接続先は${rejected.join('・')}を明示的に拒否しました（確定）。`);
  if (unchecked.length) limitations.push(`${unchecked.join('・')}は試行結果だけでは対応の有無を判断できませんでした。`);
  return unchecked.length === 0;
}

async function getWithRetry(url, deadline) {
  try { return await limitedGet(url, deadline); }
  catch (error) {
    if (Date.now() >= deadline || !['ABORT_ERR', 'ETIMEDOUT'].includes(error.code)) throw error;
    return limitedGet(url, deadline);
  }
}

export async function visitPublicPage(start, deadline, get = getWithRetry) {
  let current = start;
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    if (seen.has(current.href)) return { stop: 'リダイレクトが繰り返されています。' };
    seen.add(current.href);
    const response = await get(current, deadline);
    if (response.status < 300 || response.status >= 400 || !response.headers.location) return { ...response, url: current };
    const next = publicPageRedirect(start, current, response.headers.location);
    if (!next) return { stop: '転送先は診断の対象範囲外、またはクエリ付きのURLです。' };
    current = next;
  }
  return { stop: 'リダイレクトの確認上限に達しました。' };
}

export async function scanSite(row, config, update) {
  const deadline = Date.now() + 22000;
  const issues = [];
  const good = [];
  const limitations = [];
  const observations = [];
  let publicPage;
  let domainExpiry = { kind: 'domain' };
  let certificateExpiry = { kind: 'certificate' };
  let upkeep = '未確認';
  const add = (id, category, level, title, impact, fix, evidence, confidence = '確定') => {
    issues.push({ id, category, level, confidence, title, what: title, impact, fix, evidence });
  };
  const httpsUrl = new URL(row.url);
  httpsUrl.protocol = 'https:';
  const httpUrl = new URL(httpsUrl);
  httpUrl.protocol = 'http:';
  await update(0, issues.length, good.length);
  let httpsResult;
  try {
    await publicAddress(httpsUrl.hostname);
  } catch (error) {
    if (error.message === badAddress) throw error;
    limitations.push('対象の名前を確認できませんでした。URLを確認してください。');
  }
  const reputationCheck = limitations.length ? null : checkReputation(row.url);
  await update(1, issues.length, good.length);
  if (!limitations.length) {
    try {
      httpsResult = await visitPublicPage(httpsUrl, deadline);
      if (httpsResult.stop) limitations.push(httpsResult.stop);
    } catch (error) {
      if (error.message === badAddress) throw error;
      if (/CERT|ISSUER|SIGNED|VERIFY|TLS_CERT/.test(error.code || '')) {
        add('certificate', '通信', 'high', '証明書の有効性を確認できませんでした', 'ブラウザに警告が出ることがあります。', '証明書の期限、対象ドメイン、発行元を管理者に確認してください。', `HTTPS 接続時の証明書検証エラー（${error.code}）`);
      } else {
        limitations.push('HTTPSで外から接続できませんでした。');
      }
    }
    let certificateVerified = false;
    const certificateDate = Date.parse(httpsResult?.certificate?.valid_to);
    if (Number.isFinite(certificateDate)) {
      const date = new Date(certificateDate).toISOString().slice(0, 10);
      const daysLeft = Math.ceil((certificateDate - Date.now()) / 86400000);
      certificateExpiry = { kind: 'certificate', date, daysLeft, confidence: 'confirmed' };
      observations.push(`公開ページに接続した際の証明書の有効期限 ${date}（UTC・確定）`);
      if (daysLeft <= 30) add('expiry', '通信', daysLeft <= 7 ? 'high' : 'medium', '証明書の更新時期が近づいています', '期限を過ぎると接続時に警告されます。', '自動更新の状態と更新予定を確認してください。', `HTTPS証明書の残り日数 約${daysLeft}日`);
      certificateVerified = true;
    }
    if (httpsResult?.url?.protocol === 'https:') {
      const tls = ['TLSv1.2', 'TLSv1.3'].includes(httpsResult.protocol) ? `（${httpsResult.protocol}）` : '';
      good.push(certificateVerified ? `HTTPS${tls}で接続し、サーバーの証明書を検証できました。` : `HTTPS${tls}で接続できました。`);
      if (['TLSv1.2', 'TLSv1.3'].includes(httpsResult.protocol)) observations.push(`確認時の通信方式 ${httpsResult.protocol}`);
    }
    try {
      const result = await getWithRetry(httpUrl, deadline);
      if (result.status >= 300 && result.status < 400 && result.headers.location) {
        const destination = new URL(result.headers.location, httpUrl);
        if (destination.protocol === 'https:' && destination.hostname === httpUrl.hostname && !destination.port && !destination.username && !destination.password) {
          await publicAddress(destination.hostname);
          good.push('HTTPから同じホストのHTTPSに転送されています。');
        } else {
          limitations.push('HTTPからの転送先は診断対象外です。');
        }
      } else if (result.status >= 200 && result.status < 300) {
        const hasPassword = hasPasswordField(result);
        add('http', '通信', 'high',
          hasPassword ? '暗号化されていないページにパスワード入力欄があります' : '暗号化されていない接続でもページが開きます',
          '通信の内容が第三者に見える可能性があります。', 'HTTPのリクエストをHTTPSに転送する設定を検討してください。',
          `HTTP GET → ${result.status}${hasPassword ? '。HTMLにパスワード入力欄を確認（入力・送信は未実施）。' : ''}`);
      }
    } catch (error) {
      if (error.message === badAddress) throw error;
      limitations.push('HTTPからHTTPSへの転送は未確認です。');
    }
  }

  await update(2, issues.length, good.length);
  const status = httpsResult?.status;
  const readable = status >= 200 && status < 300 && httpsResult?.url?.protocol === 'https:';
  if (status === 401 || status === 403) {
    good.push('アクセス制限がありました。ただし、制限対象の内容や設定範囲は未確認です。');
    if (httpsResult.headers['cf-mitigated'] === 'challenge') good.push('接続時にブラウザの確認を求める保護機能が働きました。');
    limitations.push(`アクセス制限（HTTP ${status}）によりページの内容を確認できませんでした。`);
  } else if (status && !readable) {
    limitations.push(`HTTPSで保護されたページは確認できませんでした（HTTP ${status}）。`);
  }
  if (readable) {
    observations.push(httpsResult.url.pathname === httpsUrl.pathname
      ? '指定された公開ページをGETで取得して確認しました。'
      : '指定URLから同じホストの公開ページへ転送されたため、転送後のページを確認しました。');
    const { headers } = httpsResult;
    const lastModified = Date.parse(headers['last-modified'] || '');
    if (Number.isFinite(lastModified) && lastModified <= Date.now()) {
      upkeep = `ページ応答の最終更新情報 ${new Date(lastModified).toISOString().slice(0, 10)}`;
    }
    publicPage = checkResponse(httpsResult, { add, good, observations, limitations });
  }

  const technologyNotes = { observations: [], limitations: [] };
  const technology = assessTechnology(publicPage?.declarations || [], { add, ...technologyNotes });
  if (readable) await checkLegacyTls(httpsUrl, Math.min(deadline, Date.now() + 6500), add, observations, limitations, good);
  if (!readable) limitations.push('HTTPSページに接続できなかったため、旧式TLSの対応状況は未確認です。');
  await update(3, issues.length, good.length);
  const name = httpsUrl.hostname;
  if (!name.startsWith('[') && !/^\d+(\.\d+){3}$/.test(name)) {
    const resolver = new Resolver({ timeout: 900, tries: 1 });
    const [registration, caa] = await Promise.all([
      lookupRegistrationExpiry(name, Math.min(deadline, Date.now() + 5000)),
      resolver.resolveCaa(name).catch(() => []),
    ]);
    domainExpiry = registration;
    if (caa.length) observations.push(`対象ホストの公開DNSに証明書発行に関するCAAレコードが${caa.length}件ありました。`);
    if (domainExpiry.notApplicable) observations.push('共有ドメインのため、登録期限は対象外です。');
    else if (domainExpiry.date) {
      observations.push(`登録ドメインの期限 ${domainExpiry.date}（レジストリのRDAP・確定）`);
      if (domainExpiry.daysLeft <= 30) add('domain-expiry', '通信', domainExpiry.daysLeft <= 7 ? 'high' : 'medium',
        'ドメインの登録期限が近いか、すでに過ぎています', '更新されない場合、サイトや関連サービスに影響することがあります。',
        '契約先の管理画面で更新予定と自動更新の状態を確認してください。', `レジストリのRDAPに記載された登録期限 ${domainExpiry.date}`);
    } else limitations.push('登録ドメインの期限は公開RDAPから確認できませんでした。');
  }
  const reputation = reputationCheck ? await reputationCheck : { status: 'unchecked', provider: 'Google Cloud Web Risk' };
  if (reputation.status === 'matched') {
    add('url-reputation', '公開情報', 'high', '診断URLが危険サイトのリストに登録されています',
      '利用者のブラウザなどで警告が表示されることがあります。',
      '管理担当者に共有し、登録理由と対応状況をGoogle Search Consoleなどで確認してください。',
      `診断時点でGoogle Cloud Web Riskのリストに一致：${reputation.matches.join('、')}`);
  }
  const techs = await technology;
  const supportTargets = techs.filter(({ category }) => category !== '配信サービス');
  observations.push(...technologyNotes.observations);
  limitations.push(...technologyNotes.limitations);
  if (supportTargets.length && supportTargets.every(({ eol }) => eol?.status === 'supported')) {
    good.push('版と照合できた技術は、公開情報上のサポート期間内でした。');
  }
  await update(4, issues.length, good.length);

  const grading = scoreReport(issues, config, readable, {
    entrance: publicPage?.completeHtml ? 'good' : 'unchecked',
    frontend: publicPage?.completeHtml ? 'good' : 'unchecked',
    transport: certificateExpiry.date ? 'good' : 'unchecked',
    domain: domainExpiry.notApplicable ? 'not_applicable' : domainExpiry.date ? 'good' : 'unchecked',
    technology: techs.length ? 'good' : 'unchecked',
    settings: readable ? 'good' : 'unchecked',
    trust: reputation.status === 'not_configured' ? 'not_applicable' : reputation.status === 'no_match' ? 'good' : 'unchecked',
    vulnerability: techs.length && !supportTargets.length ? 'not_applicable'
      : supportTargets.some(({ eol }) => eol?.status === 'ending_soon') ? 'caution'
      : supportTargets.length && supportTargets.every(({ eol }) => eol?.status === 'supported') ? 'good' : 'unchecked',
    thirdParty: publicPage?.externalHttp ? 'caution' : publicPage?.completeHtml ? 'good' : 'unchecked',
  });
  return {
    ...grading, date: new Date().toISOString(),
    issues, good, limitations, observations, upkeep, coverage: Boolean(readable),
    reputation, techs, thirdParties: publicPage?.thirdParties || [], expiries: [certificateExpiry, domainExpiry],
    summary: issues.length ? `外から確認できた範囲で、気になる点が${issues.length}件見つかりました。`
      : readable ? '確認した範囲で、気になる設定は見つかりませんでした。' : 'ページへの接続に制限があり、確認できた設定だけを掲載しています。',
  };
}
