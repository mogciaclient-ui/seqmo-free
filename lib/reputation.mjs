const endpoint = 'https://webrisk.googleapis.com/v1/uris:search';
const lists = {
  MALWARE: 'マルウェア',
  SOCIAL_ENGINEERING: 'フィッシングなどの偽装',
  UNWANTED_SOFTWARE: '望ましくないソフトウェア',
};
const provider = 'Google Cloud Web Risk';

export async function checkReputation(input, { key = process.env.SEQMO_WEB_RISK_API_KEY, request = fetch } = {}) {
  if (!key?.trim()) return { status: 'not_configured', provider };
  try {
    const target = new URL(input);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
      return { status: 'unchecked', provider };
    }
    target.search = '';
    target.hash = '';
    const query = new URL(endpoint);
    query.searchParams.set('uri', target.href);
    for (const type of Object.keys(lists)) query.searchParams.append('threatTypes', type);
    const response = await request(query, {
      method: 'GET', headers: { 'x-goog-api-key': key.trim(), Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { status: 'unchecked', provider };
    const result = await response.json();
    if (result && typeof result === 'object' && !Array.isArray(result) && !Object.keys(result).length) {
      return { status: 'no_match', provider };
    }
    const types = result?.threat?.threatTypes;
    if (!Array.isArray(types)) return { status: 'unchecked', provider };
    const matches = Object.entries(lists).filter(([type]) => types.includes(type)).map(([, label]) => label);
    return matches.length ? { status: 'matched', provider, matches } : { status: 'unchecked', provider };
  } catch {
    return { status: 'unchecked', provider };
  }
}

export function reputationSummary(reputation) {
  if (!reputation) return '';
  if (reputation.status === 'matched') return `${reputation.provider}に登録一致（${reputation.matches.join('、')}、確度：確定）。`;
  if (reputation.status === 'no_match') return `${reputation.provider}の対象リストに診断時点で一致なし。`;
  if (reputation.status === 'not_configured') return '未確認（レピュテーションサービス未設定）。';
  return '未確認（レピュテーション照合の結果を取得できませんでした）。';
}
