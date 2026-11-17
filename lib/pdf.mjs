import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { reputationSummary } from './reputation.mjs';
import { gradeLabels, scoreBreakdown, serviceLabels } from './grading.mjs';
import { analysisSectionTitles, diagnoseDate, expiryLabel, findingImpact, guarantee, lifecycleLabels, missingHeaderChecks, protectionBenefit, reportAiUse, serviceCounts, severity, technologyConfidence, technologyLifecycle, visibleAnalysisRows, visibleLimitations } from './report.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function issueTitle(issue) {
  const checks = missingHeaderChecks(issue);
  return checks.length ? `公開ページの応答に保護設定が${checks.length}件見つかりませんでした` : issue.title;
}

function headerChecklist(issue) {
  const checks = missingHeaderChecks(issue);
  if (!checks.length) return '';
  return `<ul class="settings">${checks.map(({ title, risk }) =>
    `<li><strong>${escape(title)}</strong><br>${escape(risk)}</li>`
  ).join('')}</ul>`;
}

function analysisHtml(analysis) {
  if (!analysis || analysis.status === 'pending') return '';
  const sources = new Map((analysis.sources || []).map((item) => [item.id, item]));
  const textSections = Object.entries(analysisSectionTitles).map(([key, label]) => {
    const rows = visibleAnalysisRows(analysis, key);
    if (!rows?.length) return '';
    return `<h3>${escape(label)}</h3>${rows.map(({ text, evidenceIds, sourceIds }) =>
      `<article><p>${escape(text)}</p><small>根拠 ${escape(evidenceIds.join('、'))}
      ${sourceIds.map((id) => sources.get(id)).filter(Boolean).map(({ url, title }) =>
        ` <a href="${escape(url)}">${escape(title)}</a>`).join('')}</small></article>`).join('')}`;
  }).join('');
  const publications = [...sources.values()].filter(({ kind }) => kind === 'advisory' || kind === 'release');
  return `<section class="analysis"><h2>AI総合分析</h2>
    <p>${analysis.status === 'ready' ? 'AIが整理した見解です。リスクと影響には推測が含まれます。' : 'AI総合分析を表示できませんでした。'}</p>
    ${textSections}
    ${publications.length ? `<h3>公開されている更新・脆弱性情報</h3>
      <p>公開されている版番号との照合結果です。実際の構成や配布元の修正状況によって影響は異なります。</p>
      ${publications.map((source) => `<p>${escape(source.technology)} ${escape(source.version)} ／ <a href="${escape(source.url)}">${escape(source.title)}</a>
        ${source.latestVersion ? ` ／ 公開版 ${escape(source.latestVersion)}` : ''}
        ${source.exploited ? ' ／ CISAの既知の悪用リストに掲載' : ''}</p>`).join('')}` : ''}
    </section>`;
}

export async function generatePdf(scan) {
  const logo = (await readFile(join(process.cwd(), 'public/seqmo-logo.png'))).toString('base64');
  const { result } = scan;
  const limitations = visibleLimitations(result.limitations);
  const grades = result.categoryGrades || result.categories || [];
  const services = result.thirdParties || [];
  const breakdown = scan.config && result.score != null ? scoreBreakdown(result.issues, scan.config) : null;
  const points = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format;
  const activeSignal = ({ '危険': 'danger', '注意': 'caution', '安全': 'safe' })[result.signal];
  const onVercel = process.env.VERCEL === '1';
  const fontDirectory = join(process.cwd(), 'node_modules/@fontsource-variable/noto-sans-jp');
  const fontCss = onVercel
    ? (await readFile(join(fontDirectory, 'index.css'), 'utf8')).replaceAll('url(./files/', 'url(https://pdf-font.invalid/')
    : '';
  const serverChromium = onVercel && !process.env.SEQMO_CHROMIUM_PATH ? (await import('@sparticuz/chromium')).default : null;
  const browser = await chromium.launch({
    executablePath: process.env.SEQMO_CHROMIUM_PATH || await serverChromium?.executablePath(),
    args: serverChromium?.args,
    headless: true,
  });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (onVercel && url.origin === 'https://pdf-font.invalid' &&
          /^\/noto-sans-jp-[\w-]+\.woff2$/.test(url.pathname)) {
        return route.fulfill({
          body: await readFile(join(fontDirectory, 'files', url.pathname.slice(1))),
          contentType: 'font/woff2',
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }
      return route.abort();
    });
    await page.setContent(`<!DOCTYPE html><html lang="ja"><meta charset="utf-8"><style>
      ${fontCss}
      *{box-sizing:border-box} body{background:#91d4f6;color:#191919;font:12px 'Noto Sans JP Variable',system-ui,sans-serif;margin:0;padding:14px}
      .report-logo{display:block;width:110px;height:auto}
      section{background:white;border:2px solid #191919;border-radius:15px;box-shadow:4px 4px #191919;padding:9px;margin:0 0 9px;break-inside:avoid}
      h1{font-size:23px;overflow-wrap:anywhere;margin:10px 0 4px} h2{font-size:16px;margin:0 0 5px} p{margin:3px 0;overflow-wrap:anywhere}
      article{border:1px solid;border-radius:9px;padding:8px;margin:6px 0;break-inside:avoid}
      .grade{display:inline-block;border:1px solid;border-radius:5px;padding:2px 5px;margin:2px}
      .grade-good{background:#e1f6ef}.grade-caution{background:#fff7c7}.grade-bad{background:#ffe4eb}
      .grade-unchecked{background:#eee}.grade-not_applicable{background:repeating-linear-gradient(135deg,#efefef 0 4px,#fff 4px 8px)}
      .settings{margin:5px 0 0;padding-left:18px}
      .settings li{margin:4px 0;break-inside:avoid;overflow-wrap:anywhere}
      .critical,.high{background:#ffe4eb}.medium{background:#fff7c7}.good{background:#e1f6ef;break-inside:auto}.analysis{break-inside:auto}.analysis h3{break-after:avoid}

      .score{font-size:28px;font-weight:900;display:flex;align-items:center;gap:12px}
      .signal{display:inline-flex;flex-direction:column;gap:2px;border:1.5px solid;border-radius:10px;padding:3px}
      .lamp{width:8px;height:8px;border:1px solid;border-radius:50%;background:#e9e9e7}
      .danger{background:#ff7c9c}.caution{background:#ffe56e}.safe{background:#93dec7}
      .next{background:#ffe56e}.muted{color:#383838} small{font-size:11px}
      @page{size:A4;margin:10mm} @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style><body><img class="report-logo" src="data:image/png;base64,${logo}" alt="seQmo." width="600" height="219"><h1>${escape(scan.url)} の診断結果</h1>
    <p>${escape(diagnoseDate(result.date))}時点</p>
    <section><div class="score"><span class="signal" aria-hidden="true">
      ${['danger','caution','safe'].map((tone) => `<span class="lamp ${activeSignal === tone ? tone : ''}"></span>`).join('')}
    </span>${escape(result.score ?? '—')} / 100　${escape(result.signal)}</div>
      ${breakdown && breakdown.score === result.score ? `<h3>減点の内訳</h3>
        ${breakdown.deductions.filter(({ points }) => points > 0).map((item) =>
          `<p>${escape(item.title)}　−${points(item.points)}点</p>`).join('')}
        <p>100点 − ${points(breakdown.total)}点 ＝ ${points(breakdown.raw)}点
          ${breakdown.raw !== breakdown.rounded ? `（四捨五入で${breakdown.rounded}点）` : ''}
          ${breakdown.rounded > breakdown.cap ? `、上限を適用して${breakdown.cap}点` : ''}
          ${breakdown.rounded < 0 ? '、下限を適用して0点' : ''}</p>` : ''}
      <p>外から見える部分: ${result.coverage ? '一部確認済み' : '接続に制限あり'} ／ ログイン後・社内から: まだ ／ プログラムの中身: まだ</p>
      <p>老朽度の参考　${escape(result.upkeep || '未確認')}</p></section>
    ${Number.isFinite(result.coveragePercent) ? `<p>診断網羅率 ${result.coveragePercent}%（対象外を除いた分野のうち、判定できた分野の割合）</p>` : ''}
    ${grades.length ? `<section><h2>分野別の成績表</h2>
      ${grades.map(({ label, grade }) => `<span class="grade grade-${escape(grade)}">${escape(label)}　${escape(gradeLabels[grade])}</span>`).join('')}
    </section>` : ''}
    ${analysisHtml(result.analysis)}
    <h2>見つかったリスク</h2>
    ${result.issues.map((issue) => `<article class="${escape(issue.level)}"><strong>${escape(issueTitle(issue))}</strong>
      <p>${escape(severity[issue.level])} ／ 確度: ${escape(issue.confidence)}</p>
      ${result.summaryReference === issue.id ? '<p>AIが先に見る候補に選定</p>' : ''}
      ${missingHeaderChecks(issue).length ? '' : `<p>${escape(findingImpact(issue))}</p><small>根拠　${escape(issue.evidence)}</small>`}
      ${headerChecklist(issue)}</article>`).join('') || '<p>確認した項目に指摘はありませんでした。</p>'}
    ${result.expiries ? `<section><h2>このサイトの中身</h2>
      <h3>使っている技術</h3>
      ${result.techs?.length ? result.techs.map((entry) => `<article><strong>${escape(entry.name)} ${escape(entry.version || '版は不明')}</strong>
        <p>${escape(entry.category)} ／ 確度 ${escape(technologyConfidence[entry.confidence])} ／ ${escape(lifecycleLabels[entry.eol?.status] || (entry.category === '配信サービス' ? '版別サポートの照合対象外' : 'サポート状況不明'))}</p>
        ${technologyLifecycle(entry, result.date).map((item) => `<p>${escape(item)}</p>`).join('')}
        <p>根拠　${escape(entry.evidence.join('、'))}</p>
        ${entry.eol?.source ? `<a href="${escape(entry.eol.source)}">サポート情報の出典</a>` : ''}
      </article>`).join('') : '<p>公開ページの明示情報から技術名・版は確認できませんでした。</p>'}
      <p>外部サービスの参照 ${services.length}件。根拠は公開ページのHTMLです（参照の記載は確定）。</p>
      <p>${escape(serviceCounts(services).map(([kind, count]) => `${serviceLabels[kind]} ${count}件`).join(' ／ '))}</p>
      ${services.map(({ service, kind }) => `<p>${escape(service)}（${escape(serviceLabels[kind])}）</p>`).join('')}
      <p>実際の通信と同意前の動作は未確認です。</p>
      ${result.reputation ? `<h3>危険サイト登録</h3><p>${escape(reputationSummary(result.reputation))}</p>` : ''}
      ${result.expiries.map((expiry) => `<p>${expiry.kind === 'certificate' ? '証明書' : 'ドメイン'}　${escape(expiryLabel(expiry))}</p>`).join('')}
    </section>` : ''}
    <section class="good"><h2>良い点</h2>${result.good.map((item) => {
      const benefit = protectionBenefit(item);
      return `<article><strong>${escape(item)}</strong>${benefit ? `<p>${escape(benefit)}</p>` : ''}</article>`;
    }).join('') || '<p>確認できた項目はありません。</p>'}</section>
    ${grades.some(({ key }) => key === 'traffic') ? '<section><h2>アクセス元の分析</h2><p>今回の診断ではアクセスログ未連携です。</p></section>' : ''}
    ${result.research?.entries?.length ? `<section><h2>公開リリースの追加調査</h2>
      ${result.research.entries.map((entry) => `<p><strong>${escape(entry.name)}</strong>　検出版 ${escape(entry.observedVersion)} ／ 公開資料の最新版 ${escape(entry.latestVersion)}
        <br>公開日 ${escape(entry.releaseDate)} ／ 照合日 ${escape(diagnoseDate(entry.checkedAt))} ／ 検出版の確度 ${escape(technologyConfidence[entry.confidence])}
        ${result.research.priority === entry.id ? ' ／ AIが選んだ確認候補' : ''}　<a href="${escape(entry.source)}">出典</a></p>`).join('')}
    </section>` : ''}
    ${limitations.length ? `<section><h2>確認できなかったこと</h2>
      ${limitations.map((limit) => `<p class="muted">${escape(limit)}</p>`).join('')}
    </section>` : ''}
    <p class="muted">${escape(reportAiUse)}</p><p>${escape(guarantee)}</p>
    </body></html>`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
