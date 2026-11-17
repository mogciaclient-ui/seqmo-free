const level = { info: 1, low: 2, medium: 3, high: 4, critical: 5 };
const confidence = { '確定': 1, '可能性が高い': 0.7, '可能性あり': 0.5 };
export const gradeLabels = { good: '良い', caution: '注意', bad: '危険', unchecked: '未確認', not_applicable: '対象外' };
export const serviceLabels = { analytics: '解析・タグ管理', ads: '広告', chat: 'チャット', map: '地図', video: '動画', font: 'フォント', other: 'その他' };

const groups = [
  ['entrance', 'HTMLの自動転送', (issue) => issue.id === 'insecure-refresh'],
  ['technology', '技術', () => false],
  ['vulnerability', '検出した技術のサポート状況', (issue) => issue.category === '部品の古さ'],
  ['transport', 'HTTPS接続・証明書', (issue) => (issue.category === '通信' && !['domain-expiry', 'insecure-refresh'].includes(issue.id)) || issue.id === 'form'],
  ['settings', 'セキュリティ設定', (issue) => issue.category === 'ブラウザ側の守り' && !['form', 'mixed-active', 'mixed-media'].includes(issue.id)],
  ['frontend', 'HTMLの参照・フォーム', (issue) => ['mixed-active', 'mixed-media', 'privacy-policy', 'form'].includes(issue.id)],
  ['domain', 'ドメイン', (issue) => issue.id === 'domain-expiry'],
  ['thirdParty', '外部サービス', (issue) => issue.category === '外部とのつながり'],
  ['trust', '危険サイト登録', (issue) => issue.id === 'url-reputation'],
];

export function scoreReport(issues, config, coverage, checked) {
  issues.sort((a, b) => level[b.level] - level[a.level]);
  const categories = groups.map(([key, label, matches]) => {
    const items = issues.filter(matches);
    const rank = level[items[0]?.level] || 0;
    const grade = rank >= config.dangerLevel ? 'bad' : rank >= config.cautionLevel || rank === level.low ? 'caution'
      : checked[key] || 'unchecked';
    return {
      key, label, grade, issueIds: items.map(({ id }) => id),
      checkedCount: ['good', 'caution', 'bad'].includes(grade) ? 1 : 0,
      uncheckedCount: grade === 'unchecked' ? 1 : 0,
    };
  });
  const highest = level[issues[0]?.level] || 0;
  const applicable = categories.filter(({ grade }) => grade !== 'not_applicable');
  const coveragePercent = applicable.length
    ? Math.round(100 * applicable.filter(({ checkedCount }) => checkedCount > 0).length / applicable.length) : 0;
  return {
    categoryGrades: categories, coveragePercent,
    score: coverage || issues.length ? scoreBreakdown(issues, config).score : null,
    signal: highest >= config.dangerLevel ? '危険' : highest >= config.cautionLevel ? '注意' : coverage ? '安全' : '判定保留',
  };
}

export function scoreBreakdown(issues, config) {
  const cap = issues.some((issue) => level[issue.level] >= level.high && issue.confidence === '確定')
    ? config.highScoreCap ?? 59 : 100;
  const unique = new Map();
  for (const issue of issues) {
    if (!unique.has(issue.id)) unique.set(issue.id, issue);
  }
  const deductions = [...unique.values()].map((issue) => ({
    id: issue.id, title: issue.title, base: config[issue.level],
    weight: confidence[issue.confidence] ?? 0,
    points: config[issue.level] * (confidence[issue.confidence] ?? 0),
  }));
  const total = deductions.reduce((sum, item) => sum + item.points, 0);
  const raw = 100 - total;
  const rounded = Math.round(raw);
  return { deductions, total, raw, rounded, cap, score: Math.max(0, Math.min(cap, rounded)) };
}
