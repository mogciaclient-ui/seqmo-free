export const guarantee = 'この無料診断は、システム内部の安全性を保証するものではありません。';
export const aiNotice = 'AIは診断結果をもとに説明します。安全かどうかを保証するものではありません。';
export const diagnoseDate = (value) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', dateStyle: 'long',
}).format(new Date(value));
export const severity = { critical: '緊急', high: '高', medium: '中', low: '低', info: '情報' };
export const stages = ['サイトに接続', '通信の暗号化（SSL）', 'ブラウザ側の守り', 'ドメイン登録の期限', 'レポートの作成'];

const headerChecks = [
  {
    name: 'Content-Security-Policy', title: '読み込めるスクリプトの制限',
    purpose: 'ブラウザが実行するスクリプトや読み込む外部素材を制限します。',
    risk: 'ページに不正なスクリプトが入り込んだ場合、ブラウザ側で実行を止める防御が一つ減ります。',
    action: '利用中の外部サービスを洗い出し、検証環境でレポート専用モードから影響を確認してください。',
  },
  {
    name: 'フレーム表示制限', title: '別サイトへの埋め込みの制限',
    purpose: '別のサイトに画面を埋め込まれ、意図しない操作へ誘導されるリスクを減らします。',
    risk: '別サイトに画面を重ねて表示されると、利用者が気づかずにボタンを押すおそれがあります。',
    action: '正規の埋め込み先があるか確認し、CSPの frame-ancestors で許可先を指定してください。',
  },
  {
    name: 'X-Content-Type-Options', title: 'ファイルの種類をブラウザが推測する動作の制限',
    purpose: 'スクリプトやスタイルシートを、サーバーが指定した種類に従って扱わせる設定です。',
    risk: '配信するファイルの種類の指定が誤っている場合、ブラウザが意図しない種類として扱うおそれがあります。',
    action: 'スクリプトとスタイルシートの Content-Type を確認し、nosniff を設定して表示を確認してください。',
  },
  {
    name: 'Referrer-Policy', title: 'リンクを開いたときの参照元情報の制御',
    purpose: 'ページ移動などの際に、参照元のURLをどこまで相手に伝えるか制御します。',
    risk: '外部サイトや外部サービスへの通信で、ページのURLに含まれる情報が意図した範囲を超えて伝わることがあります。',
    action: '外部サービスや計測への影響を確認し、必要な範囲に参照元情報を限定してください。',
  },
  {
    name: 'HSTS', title: '次回以降の接続をHTTPSに限定',
    purpose: '設定を受け取ったブラウザが、そのサイトへ以後HTTPSで接続するようにします。',
    risk: '以前にHTTPSで開いた利用者でも、次回にHTTPでアクセスした際、暗号化なしの接続をブラウザが強制的に防ぐ仕組みがありません。',
    action: '対象サイトが継続してHTTPSで利用できることを確認し、適用範囲を決めてください。',
  },
];

export function missingHeaderChecks(issue) {
  if (issue?.id !== 'headers') return [];
  const prefix = 'HTTPS応答で未検出の設定: ';
  if (typeof issue.evidence !== 'string' || !issue.evidence.startsWith(prefix)) return [];
  const names = new Set(issue.evidence.slice(prefix.length).split('、').map((name) => name.trim()));
  return headerChecks.filter(({ name }) => names.has(name));
}

export function findingImpact(issue) {
  if (issue.id.startsWith('support-ended-')) {
    return '通常サポートが終了した系列では、新たに問題が見つかっても、その系列向けの修正が提供されないことがあります。配布元や保守契約によっては、個別に修正が提供される場合があります。';
  }
  return issue.impact;
}

export function protectionBenefit(item) {
  if (item.includes('サーバーの証明書を検証できました')) {
    return 'ブラウザと接続先の間で送る内容を第三者に読まれにくくし、接続先が指定されたドメインであることを確かめられます。';
  }
  if (item.startsWith('HTTPから同じホストのHTTPSに転送')) {
    return '利用者がHTTPのURLを開いても、ページの閲覧を暗号化された接続に切り替えられます。';
  }
  if (item.includes('埋め込みのWeb参照') && item.endsWith('はHTTPSでした。')) {
    return '確認した素材の参照は暗号化されるため、通信経路で書き換えられるリスクを抑えられます。';
  }
  if (item.includes('公開情報上のサポート期間内')) {
    return '対象の系列は、提供元から修正を受けられる期間内です。';
  }
  return '';
}

export const reportAiUse = '検出と判定は、取得した情報と診断ルールに基づきます。AI総合分析は、公開診断の結果と照合した公開情報をもとに、関連性・影響・改善案をまとめます。';

function nextStep(result) {
  const issue = result.issues[0];
  if (!issue) {
    return result.coverage
      ? '公開ページの確認結果を記録し、ログイン後の画面や社内から使う機能は必要に応じて別途確認してください。'
      : '対象URLとアクセス制限を確認し、公開ページで確認できなかった項目を整理してください。';
  }
  const missing = missingHeaderChecks(issue);
  if (missing.length) {
    return `最初に、公開ページの応答で確認できなかった保護設定${missing.length}項目を、制作・運用の担当者と確認してください。設定後はページの動作を確認してから再診断してください。`;
  }
  return issue.fix;
}

export function reportPriority(result) {
  const priority = nextStep(result);
  return result.techs?.some(({ eol }) => eol?.status === 'ended')
    ? `${priority} サポート終了版を使用している場合は、更新や作り直しも含めて相談できます。`
    : priority;
}

export function expiryLabel(expiry) {
  if (expiry.notApplicable) return '対象外（共有ドメイン）';
  if (!Number.isFinite(expiry.daysLeft) || !expiry.date) return '未確認';
  const days = expiry.daysLeft < 0 ? `期限から${Math.abs(expiry.daysLeft)}日経過` : `あと${expiry.daysLeft}日`;
  return `${days}（${expiry.date}・診断日時点）`;
}

export function serviceCounts(services) {
  return Object.entries(services.reduce((counts, { kind }) => {
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, Object.create(null)));
}

export const technologyConfidence = { confirmed: '確定', likely: '可能性が高い', possible: '可能性あり' };
export const lifecycleLabels = { supported: 'サポート中', ending_soon: 'まもなく終了', ended: 'サポート終了' };

function ageLabel(date, timestamp) {
  const from = new Date(date + 'T00:00:00Z');
  const now = new Date(timestamp);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(now.getTime()) || from > now) return '';
  const monthDifference = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + now.getUTCMonth() - from.getUTCMonth();
  const months = Math.max(0, monthDifference - Number(now.getUTCDate() < from.getUTCDate()));
  if (months < 1) return '1か月未満';
  const years = Math.floor(months / 12);
  return [years && `${years}年`, months % 12 && `${months % 12}か月`].filter(Boolean).join('');
}

export function technologyLifecycle(entry, date) {
  const eol = entry.eol;
  if (!eol) return [];
  const release = eol.versionReleased || eol.seriesReleased;
  const age = release ? ageLabel(release, date) : '';
  const endedAgo = eol.status === 'ended' && eol.date ? ageLabel(eol.date, date) : '';
  const lifecycle = eol.date ? `${eol.officialSupport ? '公式サポート終了日' : 'サポート終了日'} ${eol.date}${endedAgo ? `（診断時点で終了から${endedAgo}）` : ''}`
    : eol.status === 'ended' ? '終了日の記載なし' : '終了日の公表なし';
  const supportNote = eol.officialSupport && eol.status === 'ended' ? '古い系列にも修正が提供される場合があります。'
    : eol.securityOnly ? '通常サポートは終了し、セキュリティ対応の期間中です。' : '';
  return [release && `${eol.versionReleased ? 'この版' : '系列'}の公開日 ${release}${age ? `（診断時点で${age}経過）` : ''}`, lifecycle, supportNote].filter(Boolean);
}

export const analysisSectionTitles = {
  overview: 'サイト全体の総評',
  risks: '特に注意すべきリスク',
  relationships: '指摘どうしの関連',
  businessImpact: '想定される事業への影響',
  improvements: '推奨する改善内容',
  unknowns: '追加で確認すべきこと',
};

const retiredLimitation = '管理画面と同意前の通信は未確認です。';

export function visibleLimitations(items = []) {
  return items.filter((item) => item !== retiredLimitation);
}

export function visibleAnalysisRows(analysis, key) {
  const rows = analysis.sections?.[key] || [];
  if (key !== 'unknowns') return rows;
  const retiredIds = new Set((analysis.evidence || [])
    .filter(({ kind, title }) => kind === 'limitation' && title === retiredLimitation)
    .map(({ id }) => id));
  return rows.filter(({ evidenceIds }) => !evidenceIds.length || evidenceIds.some((id) => !retiredIds.has(id)));
}
