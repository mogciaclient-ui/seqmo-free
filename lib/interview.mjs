export const questions = [
  { key: 'purpose', title: '何のサイト・システムですか？', options: { homepage: 'HP', booking: '予約・EC', members: '会員サイト', internal: '社内システム' } },
  { key: 'builder', title: '誰が作りましたか？', options: { own: '自社', vendor: '制作会社', individual: '個人・知り合い' } },
  { key: 'maintenance', title: '保守・更新はしていますか？', options: { regular: '定期的に', on_request: '頼んだ時だけ', none: 'していない' } },
  { key: 'data', title: '個人情報やカード情報を扱いますか？', options: { yes: '扱う', no: '扱わない' } },
  { key: 'concerns', title: '最近気になったことはありますか？', multiple: true, options: { spam: '迷惑メールが増えた', spoofing: 'なりすましメール', display: '表示がおかしい', slow: '遅い', none: '特にない' } },
].map((question) => ({ ...question, options: { ...question.options, unknown: 'わからない' } }));

export function parseInterview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const answers = {};
  for (const { key, options, multiple } of questions) {
    const value = input[key];
    if (value === undefined) continue;
    const selections = multiple ? value : [value];
    if (!Array.isArray(selections) || selections.length > Object.keys(options).length ||
        selections.some((item) => typeof item !== 'string' || !Object.hasOwn(options, item))) return null;
    const unique = [...new Set(selections)];
    if (multiple && unique.length > 1 && unique.some((item) => ['none', 'unknown'].includes(item))) return null;
    if (unique.length) answers[key] = multiple ? unique : unique[0];
  }
  return Object.keys(answers).length ? answers : null;
}

export function interviewContext(answers) {
  if (!answers) return [];
  return questions.flatMap(({ key, title, options }) => {
    const value = answers[key];
    const labels = (Array.isArray(value) ? value : [value]).filter((entry) => entry && Object.hasOwn(options, entry)).map((entry) => options[entry]);
    return labels.length ? [{ title, value: labels.join('、') }] : [];
  });
}

export function interviewNextStep(answers) {
  if (!answers) return '';
  const contact = answers.builder === 'vendor' ? '制作会社の窓口' : answers.builder === 'own' ? '社内の運用担当者' : '運用を担当している方';
  if (answers.data === 'yes') return `最初に${contact}と、個人情報に触れられるアカウントと更新の担当を確認してください。`;
  if (answers.concerns?.some((entry) => ['spam', 'spoofing'].includes(entry))) return `気になっているメールについて、送信ドメインや発生時期を${contact}と確認してください。`;
  if (answers.maintenance === 'none' || answers.maintenance === 'on_request') return `${contact}と更新の担当、頻度、連絡先を決めておくと次の対応を進めやすくなります。`;
  if (['internal', 'members'].includes(answers.purpose)) return `${contact}とログイン後の権限設定や退職者アカウントの扱いを確認してください。`;
  return '';
}
