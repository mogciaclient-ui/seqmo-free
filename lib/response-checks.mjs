import { parse } from 'parse5';
import { externalServices, sameSite } from './public-page.mjs';
import { angularDeclaration, declaredRuntimes, frameworkAssetDeclaration, generatorDeclaration, libraryDeclaration, phpIndication, wordpressLinkDeclaration } from './technology.mjs';

const category = 'ブラウザ側の守り';
const guardHeaders = {
  'strict-transport-security': 'HSTS',
  'content-security-policy': 'Content-Security-Policy',
  'x-content-type-options': 'X-Content-Type-Options',
  'referrer-policy': 'Referrer-Policy',
};
const referrerPolicies = new Set([
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
]);

function checkHeaders(headers, add, good, observations) {
  const csp = headers['content-security-policy'] || '';
  const frameOptions = headers['x-frame-options'] || '';
  const missing = Object.entries(guardHeaders).filter(([name]) => !headers[name]).map(([, name]) => name);
  const frameAncestors = csp.split(/[,;]/).map((directive) => directive.trim())
    .some((directive) => /^frame-ancestors\s+\S/i.test(directive));
  if (!frameOptions && !frameAncestors) missing.push('フレーム表示制限');
  if (missing.length) {
    add('headers', category, 'medium', 'ブラウザ向けの保護設定に不足があります', 'ページに応じた保護が一部働かない可能性があります。', '先に検証環境で影響を確認し、必要な保護ヘッダーを設定してください。', `HTTPS応答で未検出の設定: ${missing.join('、')}`);
  }

  const invalid = [];
  const hsts = headers['strict-transport-security'];
  if (hsts) {
    const maxAge = hsts.split(';').map((part) => part.trim()).filter((part) => /^max-age\s*(?:=|$)/i.test(part));
    if (maxAge.length !== 1 || !/^max-age\s*=\s*(?:\d+|"\d+")$/i.test(maxAge[0])) invalid.push('HSTSの有効期間を読み取れない');
    else if (/=\s*"?0+"?$/.test(maxAge[0])) invalid.push('HSTSが無効（有効期間0）');
    else good.push('HSTSに有効期間が設定され、ブラウザに次回以降のHTTPS接続を指示しています。');
  }
  const typeOptions = headers['x-content-type-options'];
  if (typeOptions && typeOptions.split(',')[0].trim().toLowerCase() !== 'nosniff') invalid.push('X-Content-Type-Optionsの先頭値がnosniffではない');
  else if (typeOptions) good.push('ファイルの種類をブラウザが推測しないよう、nosniff が設定されています。');
  // Modern browsers give an enforced frame-ancestors directive precedence over X-Frame-Options.
  if (frameOptions && !frameAncestors && !/^(?:DENY|SAMEORIGIN)$/i.test(frameOptions.trim())) {
    invalid.push('X-Frame-OptionsがDENYまたはSAMEORIGINではない');
  }
  if (!csp && /^(?:DENY|SAMEORIGIN)$/i.test(frameOptions.trim())) {
    good.push('別サイトからの画面の埋め込みを制限するX-Frame-Optionsが設定されています。');
  }
  const referrer = headers['referrer-policy'];
  const policy = referrer?.split(',').map((value) => value.trim()).findLast((value) => referrerPolicies.has(value));
  if (referrer && !policy) invalid.push('Referrer-Policyに認識できる規則がない');
  if (invalid.length) {
    add('header-values', category, 'medium', '保護ヘッダーの一部が意図どおり働かない設定です', 'ヘッダーが付いていても、ブラウザが保護を適用できないことがあります。', 'サーバーやCDNで該当するヘッダーの値を確認し、変更後にブラウザで動作を確認してください。', invalid.join('、'));
  }
  if (policy === 'unsafe-url') {
    add('referrer-url', category, 'low', '別サイトへの移動時に詳しい参照元URLが送られる設定です', 'URLのパスやクエリに含まれる情報がリンク先へ伝わる可能性があります。', '参照元情報が必要な範囲を確認し、より限定したReferrer-Policyを検討してください。', 'HTTPS応答のReferrer-Policyでunsafe-urlが有効');
  }
  if (['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'origin-when-cross-origin'].includes(policy)) {
    good.push('別サイトに参照元URLのパスやクエリを送らないReferrer-Policyが設定されています。');
  }
  if (!csp && headers['content-security-policy-report-only']) observations.push('CSPはレポート専用モードです。読み込みの制限は適用していません。');
}

function cookieAttributes(header) {
  const [pair, ...parts] = header.split(';');
  const name = pair.slice(0, pair.indexOf('=')).trim().toLowerCase();
  const attributes = new Map(parts.map((part) => {
    const separator = part.indexOf('=');
    return separator < 0
      ? [part.trim().toLowerCase(), '']
      : [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  }));
  return { name, attributes };
}

function checkCookies(headers, add, good, observations) {
  const cookies = (headers['set-cookie'] || []).map(cookieAttributes).filter(({ attributes }) => {
    const age = attributes.get('max-age');
    if (age && /^-?\d+$/.test(age)) return Number(age) > 0;
    const expires = Date.parse(attributes.get('expires') || '');
    return !Number.isFinite(expires) || expires > Date.now();
  });
  if (!cookies.length) return;
  observations.push(`HTTPS応答で保存を指示したCookie ${cookies.length}件（名前・値は保存していません）`);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite']) {
    const key = attribute.toLowerCase();
    const count = cookies.filter(({ attributes }) => key === 'samesite'
      ? !['strict', 'lax', 'none'].includes(attributes.get(key)?.toLowerCase())
      : !attributes.has(key)).length;
    if (count) add(`cookie-${key}`, category, 'low', `一部のCookieに ${attribute} の指定がありません`, 'Cookieの用途によっては、意図より広い範囲で扱われる可能性があります。', 'Cookieの用途と必要な属性を確認してください。', `Set-Cookieのうち${count}件に該当属性なし。Cookie名と値は省略。`);
  }
  const rejected = cookies.filter(({ name, attributes }) =>
    (attributes.get('samesite')?.toLowerCase() === 'none' && !attributes.has('secure')) ||
    (name.startsWith('__secure-') && !attributes.has('secure')) ||
    (name.startsWith('__host-') && (!attributes.has('secure') || attributes.get('path') !== '/' || attributes.has('domain')))
  ).length;
  if (rejected) {
    add('cookie-attributes', category, 'medium', 'ブラウザが保存を拒否するCookie設定があります', '利用環境によっては、ログイン状態や利用者の設定が引き継がれないことがあります。', 'SameSite=NoneやCookie名の保護用接頭辞に必要な属性を見直し、ブラウザで保存されることを確認してください。', `SameSite=NoneとSecureの組み合わせ、またはCookie名の接頭辞の条件を満たさないSet-Cookieが${rejected}件。個別の名称や値は省略。`);
  } else if (cookies.every(({ attributes }) => attributes.has('secure'))) {
    good.push('この応答で確認したCookieは、すべてHTTPSに限定する設定でした。');
  }
}

function elements(html) {
  const root = parse(html);
  const pending = [root];
  const result = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName) result.push(node);
    for (let index = (node.childNodes?.length || 0) - 1; index >= 0; index--) pending.push(node.childNodes[index]);
  }
  return result;
}

function resolveReference(value, base) {
  if (!value?.trim()) return null;
  try { return new URL(value, base); } catch { return null; }
}

const activeSources = { script: 'src', iframe: 'src', frame: 'src', embed: 'src', object: 'data' };
const mediaSources = { img: 'src', audio: 'src', video: 'src', source: 'src' };

function textContent(children = []) {
  const pending = [...children];
  let text = '';
  while (pending.length && text.length < 300) {
    const node = pending.shift();
    if (node.nodeName === '#text') text += node.value.slice(0, 300);
    if (node.childNodes?.length) pending.unshift(...node.childNodes.slice(0, 50));
  }
  return text;
}

function showsPhpDiagnostic(nodes) {
  const body = nodes.find(({ tagName }) => tagName === 'body');
  const pending = [...(body?.childNodes || [])].reverse();
  const ignored = new Set(['script', 'style', 'template', 'noscript', 'pre', 'code', 'textarea']);
  const parts = [];
  while (pending.length) {
    const node = pending.pop();
    if (ignored.has(node.tagName) || node.attrs?.some(({ name }) => name === 'hidden')) continue;
    if (node.nodeName === '#text') parts.push(node.value);
    for (let i = (node.childNodes?.length || 0) - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  const visibleText = parts.join(' ').replace(/\s+/g, ' ');
  return /\b(?:Fatal error|Warning|Parse error|Deprecated|Notice)\s*:[^<>]{1,400}\bin\s+(?:\/|[a-z]:\\)[^<>]{1,240}\.php\s+(?:on\s+line\s+\d+|:\d+)/i.test(visibleText);
}

function checkHtml(html, url, add, good, observations, limitations, truncated) {
  const nodes = elements(html);
  const baseNode = nodes.find(({ tagName, attrs }) => tagName === 'base' && attrs.some(({ name }) => name === 'href'));
  const base = resolveReference(baseNode?.attrs.find(({ name }) => name === 'href')?.value, url) || url;
  let scripts = 0;
  let active = 0;
  let activeHttps = 0;
  let media = 0;
  let insecureRefreshes = 0;
  let forms = 0;
  let externalForms = 0;
  let hasPrivacyLink = false;
  let hasContactForm = false;
  let hasPassword = false;
  const refs = [];
  const declarations = [];
  if (showsPhpDiagnostic(nodes)) {
    declarations.push(phpIndication('公開ページの本文にPHP形式の診断メッセージ'));
    add('php-error-disclosure', category, 'low', '公開ページにPHPのエラー詳細が表示されています',
      'サーバー内部のファイル構成が外部に伝わるおそれがあります。',
      '本番ではエラーの詳細を利用者の画面に表示せず、アクセスを制限したサーバーログに記録してください。',
      '本文にPHP形式のエラー、内部ファイルパス、行番号を検出。元の文面とパスは保存していません。', '可能性が高い');
  }
  let retiredTags = 0;
  for (const { tagName, attrs, childNodes, parentNode } of nodes) {
    const attribute = (key) => attrs.find(({ name }) => name === key)?.value;
    if (tagName === 'a' || tagName === 'link') {
      const wordpress = wordpressLinkDeclaration(resolveReference(attribute('href'), base), url);
      if (wordpress) declarations.push(wordpress);
    }
    // Ignore inline script/data and iframe src when the iframe uses an inline document.
    const scriptResource = tagName === 'script' && attribute('src') &&
      !['application/json', 'application/ld+json', 'importmap', 'speculationrules'].includes(attribute('type')?.trim().toLowerCase());
    if (scriptResource) {
      scripts++;
      const scriptUrl = resolveReference(attribute('src'), base);
      const library = libraryDeclaration(scriptUrl);
      if (library) declarations.push(library);
      const framework = frameworkAssetDeclaration(scriptUrl, url);
      if (framework) declarations.push(framework);
    }
    if (tagName === 'meta' && attribute('name')?.toLowerCase() === 'generator') {
      const declared = generatorDeclaration(attribute('content'));
      if (declared) declarations.push(declared);
    }
    if (tagName === 'meta' && attribute('http-equiv')?.trim().toLowerCase() === 'refresh') {
      const destination = attribute('content')?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(?:"([^"]+)"|'([^']+)'|([^"']+))\s*$/i);
      const target = destination && resolveReference(destination[1] || destination[2] || destination[3], url);
      if (target?.protocol === 'http:') insecureRefreshes++;
    }
    const angular = angularDeclaration(attribute('ng-version'));
    if (angular) declarations.push(angular);
    const inlineFrame = tagName === 'iframe' && attribute('srcdoc') !== undefined;
    const rel = attribute('rel')?.toLowerCase().split(/\s+/) || [];
    const linkResource = tagName === 'link' && rel.some((value) => ['stylesheet', 'modulepreload'].includes(value));
    const resource = linkResource ? attribute('href') : (tagName !== 'script' || scriptResource) && !inlineFrame && attribute(activeSources[tagName]);
    const resourceUrl = resolveReference(resource || '', base);
    const protocol = resourceUrl?.protocol;
    if ((protocol === 'http:' || protocol === 'https:') && !sameSite(resourceUrl.hostname, url.hostname)) {
      refs.push(resourceUrl);
      if (scriptResource &&
          ['googletagmanager.com', 'www.googletagmanager.com'].includes(resourceUrl.hostname) &&
          resourceUrl.pathname === '/gtag/js' && /^UA-\d+-\d+$/i.test(resourceUrl.searchParams.get('id') || '')) retiredTags++;
    }
    if (protocol === 'http:') active++;
    if (protocol === 'https:') activeHttps++;
    if (resolveReference(attribute(mediaSources[tagName]), base)?.protocol === 'http:') media++;
    if (tagName === 'video' && resolveReference(attribute('poster'), base)?.protocol === 'http:') media++;
    const type = attribute('type')?.trim().toLowerCase();
    if (tagName === 'input' && type === 'password') hasPassword = true;
    const control = tagName === 'button' ? !['button', 'reset'].includes(type) : tagName === 'input' && ['submit', 'image'].includes(type);
    const formTarget = tagName === 'form' ? attribute('action') : control ? attribute('formaction') : '';
    const target = resolveReference(formTarget, base);
    if (target?.protocol === 'http:') forms++;
    if (target && ['http:', 'https:'].includes(target.protocol) && !sameSite(target.hostname, url.hostname)) externalForms++;
    if (tagName === 'textarea' && attribute('name')) {
      for (let ancestor = parentNode; ancestor; ancestor = ancestor.parentNode) {
        if (ancestor.tagName !== 'form') continue;
        const formText = textContent(ancestor.childNodes);
        hasContactForm ||= /お問い合わせ|問い合わせ|contact|メッセージ/i.test(formText);
        break;
      }
    }
    if (tagName === 'a') {
      const href = resolveReference(attribute('href'), base);
      const text = (textContent(childNodes) + ' ' + (attribute('aria-label') || '')).trim();
      if (href && ['http:', 'https:'].includes(href.protocol) &&
          (/プライバシー|個人情報|privacy/i.test(text) || /(?:^|\/)(?:privacy(?:-policy)?|privacypolicy)(?:[/.]|$)/i.test(href.pathname))) hasPrivacyLink = true;
    }
  }
  if (truncated) limitations.push('HTMLは先頭192 KiBまでを読み取りました。途中以降の参照やフォームは未確認です。');
  if (insecureRefreshes) {
    add('insecure-refresh', '通信', 'medium', '公開ページにHTTPへの自動転送指定があります',
      '転送後のページが暗号化されない接続で開く可能性があります。',
      'HTMLの自動転送先をHTTPSに変更し、ブラウザで遷移を確認してください。',
      `取得したHTMLにHTTPへのmeta refresh指定が${insecureRefreshes}件。転送先への通信は未実施。`);
  } else if (!truncated) {
    observations.push('取得したHTMLで、HTTPへのmeta refreshによる自動転送指定は見つかりませんでした。');
  }
  observations.push(`取得したHTMLにある参照スクリプトの指定 ${scripts}件（取得・実行は未実施）`);
  if (activeHttps && !active && !truncated) {
    good.push(`公開ページのHTML内で確認したスクリプト・スタイル・埋め込みのWeb参照${activeHttps}件はHTTPSでした。`);
  }
  if (active) add('mixed-active', category, 'medium', 'HTTPSページからHTTPのスクリプトなどを参照しています', 'ブラウザが読み込みを止めたりHTTPSに切り替えたりするため、表示や機能に影響することがあります。', '対象リソースがHTTPSで配信されていることを確認し、参照先をHTTPSに統一してください。', `取得したHTML内にHTTPを参照するスクリプト・スタイル・埋め込みの指定が${active}件。参照先への通信は未実施。`, '可能性が高い');
  if (media) add('mixed-media', category, 'low', 'HTTPSページからHTTPの画像やメディアを参照しています', 'ブラウザがHTTPSに切り替えるか、読み込まないことがあります。', '画像や動画などの参照先をHTTPSに統一してください。', `取得したHTML内の画像・メディアにHTTPの指定が${media}件。参照先への通信は未実施。`, '可能性が高い');
  if (forms) add('form', category, 'high', '暗号化されない送信先を指定したフォームがあります', '入力内容が通信中に見える可能性があります。', '送信ボタンごとの指定も含め、フォーム送信先をHTTPSへ変更して動作を確認してください。', `取得したHTML内にHTTPのフォーム送信先が${forms}件。送信操作は未実施。`, '可能性が高い');
  if (hasPassword) observations.push('指定された公開ページのHTMLでパスワード入力欄を確認しました（入力・送信は未実施、項目の記載は確定）。');
  if (externalForms) observations.push(`公開ページのHTMLに、別ドメインへのフォーム送信先の指定が${externalForms}件あります（送信操作は未実施・指定の確認は確定）。`);
  if (hasPrivacyLink) good.push('公開ページにプライバシーポリシーへのリンクが見つかりました（リンク先は未取得）。');
  if (!hasPrivacyLink && hasContactForm && !truncated) {
    add('privacy-policy', '玄関', 'medium', '問い合わせフォームと同じページに個人情報の案内が見つかりません', '入力した情報がどう使われるか、利用者が送信前に確認しにくい可能性があります。', '同じページにプライバシーポリシーへのリンクが分かりやすく掲載されているか確認してください。', '取得した公開ページのHTMLに問い合わせを示す語と記述欄のあるフォームがあり、ポリシーへのリンクは未検出。', '可能性あり');
  }
  if (retiredTags) add('retired-analytics', '外部とのつながり', 'low', '終了したUniversal Analyticsのタグが残っています', 'この参照からは、現在の計測に必要なデータが取れません。', '現在使っている計測設定を確認し、不要になったタグを整理してください。', `公開ページのHTMLに旧Universal Analytics用のタグ参照が${retiredTags}件。タグの識別子は省略。`);
  const thirdParties = externalServices(refs);
  if (thirdParties.length) observations.push('外部サービスの根拠は取得した公開ページの参照タグです。通信の実行と同意前の動作は未確認です。');
  return { thirdParties, declarations, completeHtml: !truncated, externalHttp: refs.some((ref) => ref.protocol === 'http:') };
}

export function hasPasswordField({ body, headers }) {
  return /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(headers['content-type'] || '') &&
    elements(body).some(({ tagName, attrs }) => tagName === 'input' &&
      attrs.some(({ name, value }) => name === 'type' && value.toLowerCase() === 'password'));
}

export function checkResponse({ headers, body, url, truncated }, { add, good, observations, limitations }) {
  checkHeaders(headers, add, good, observations);
  if (headers['access-control-allow-origin']?.trim() === '*') {
    observations.push('取得した応答に、任意のオリジンを許可するCORSヘッダーの指定がありました（確定）。認証付きAPIのアクセス制御は未確認です。');
  }
  if (headers['permissions-policy']?.trim()) {
    observations.push('取得した応答に、ブラウザ機能の使用を制御するPermissions-Policyの記載がありました（確定）。適用範囲は未確認です。');
  }
  checkCookies(headers, add, good, observations);
  const runtimes = declaredRuntimes(headers);
  const exposedPhp = runtimes.find(({ key, version, evidence }) =>
    key === 'php' && version && evidence.some((item) => item.includes('X-Powered-By')));
  if (exposedPhp) {
    add('php-version-disclosure', category, 'info', '公開ヘッダーにPHPの版番号が表示されています',
      '利用中の版を絞り込む手がかりになります。版番号が分かると、その版に関する既知の問題を調べやすくなります。',
      '実際の版と更新状況を確認し、不要な公開ヘッダーはPHPや配信側の設定で抑えてください。',
      `X-Powered-ByにPHP ${exposedPhp.version}の記載。`);
  }
  if (/\.php$/i.test(url.pathname)) runtimes.push(phpIndication('取得した公開URLのパスが.phpで終わる'));
  if ((headers['set-cookie'] || []).some((header) => /^\s*PHPSESSID=/.test(header))) {
    runtimes.push(phpIndication('公開応答にPHPの既定セッションCookie名が記載（値は保存していません）'));
  }
  if (/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(headers['content-type'] || '')) {
    const page = checkHtml(body, url, add, good, observations, limitations, truncated);
    return { ...page, declarations: [...runtimes, ...page.declarations] };
  } else {
    limitations.push('HTMLとして配信された応答を確認できなかったため、ページ内のフォームや参照先は未確認です。');
    return { declarations: runtimes };
  }
}
