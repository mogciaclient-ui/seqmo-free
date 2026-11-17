import { notFound, redirect } from 'next/navigation';
import { getScan } from '../../../../lib/db.mjs';
import { diagnoseDate, expiryLabel, findingImpact, guarantee, lifecycleLabels, missingHeaderChecks, protectionBenefit, reportAiUse, serviceCounts, severity, technologyConfidence, technologyLifecycle, visibleLimitations } from '../../../../lib/report.mjs';
import { Header, Badge } from '../../../ui';
import { ReportAnalysis } from '../../../report-analysis';
import { reputationSummary } from '../../../../lib/reputation.mjs';
import { gradeLabels, scoreBreakdown, serviceLabels } from '../../../../lib/grading.mjs';

export const dynamic = 'force-dynamic';
const scoreTones = { '危険': 'pink', '注意': 'yellow', '安全': 'mint', '判定保留': 'neutral' };
const issueTones = { critical: 'pink', high: 'pink', medium: 'yellow', low: 'yellow', info: 'neutral' };

function IssueRow({ issue, aiSelected }) {
  const tone = issueTones[issue.level];
  const checks = missingHeaderChecks(issue);
  return <article id={`issue-${issue.id}`} className={`finding ${tone}-tint`}>
    <div className="finding-heading">
      <Badge tone={tone}>{severity[issue.level]}</Badge>
      <strong>{checks.length ? `公開ページの応答に保護設定が${checks.length}件見つかりませんでした` : issue.title}</strong>
      <Badge>確度　{issue.confidence}</Badge>
      {aiSelected && <Badge tone="yellow">AIが先に見る候補に選定</Badge>}
    </div>
    {checks.length ? <ul className="setting-findings">{checks.map(({ name, title, risk }) =>
      <li key={name}><strong>{title}</strong><p>{risk}</p></li>)}</ul> : <>
      <p>{findingImpact(issue)}</p><p className="small-text"><strong>根拠</strong>　{issue.evidence}</p>
    </>}
  </article>;
}

export default async function Result({ params }) {
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan) notFound();
  if (scan.state !== 'completed') redirect(`/scan/${id}`);
  const { result } = scan;
  const limitations = visibleLimitations(result.limitations);
  const breakdown = scan.config && result.score != null ? scoreBreakdown(result.issues, scan.config) : null;
  const formatPoints = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format;
  const grades = result.categoryGrades || result.categories || [];
  return <>
    <Header><a className="button small" href={`/api/scans/${id}/pdf`}>PDFで保存</a></Header>
    <main className="wrap result">
      <h1>{scan.url} の診断結果</h1>
      <p className="date"><Badge>{diagnoseDate(result.date)}時点</Badge></p>
      <section className="card result-section">
        <h2>診断スコア</h2>
        {result.score != null
          ? <div className="score"><strong>{result.score}</strong> / 100 <Badge tone={scoreTones[result.signal]}>{result.signal === '安全' ? '確認範囲で重大な指摘なし' : result.signal}</Badge></div>
          : <p>判定保留</p>}
        {breakdown && breakdown.score === result.score && <div className="score-breakdown">
          <h3>減点の内訳</h3>
          {breakdown.total > 0 ? <ul>{breakdown.deductions.filter(({ points }) => points > 0).map(({ id, title, base, weight, points }) =>
            <li key={id}>{title} <strong>−{formatPoints(points)}点</strong>{weight < 1 && <span className="small-text">（{base}点 × 確度による係数 {formatPoints(weight)}）</span>}</li>)}</ul>
            : <p>指摘による減点はありません。</p>}
          <p className="small-text">100点 − {formatPoints(breakdown.total)}点 ＝ {formatPoints(breakdown.raw)}点
            {breakdown.raw !== breakdown.rounded && <>（四捨五入で{breakdown.rounded}点）</>}
            {breakdown.rounded > breakdown.cap && <>、確定した重大な指摘による上限を適用して{breakdown.cap}点</>}
            {breakdown.rounded < 0 && <>、下限を適用して0点</>}
          </p>
        </div>}
        {Number.isFinite(result.coveragePercent) && <p>判定できた分野の割合：{result.coveragePercent}%</p>}
        {grades.length > 0 && <div className="grade-grid">{grades.map(({ key, label, grade }) =>
          <div key={key} className={`grade-tile grade-${grade}`}>
            <strong>{label}</strong><span>{gradeLabels[grade]}</span>
          </div>)}</div>}
        <p className="small-text score-scope">{guarantee} ログイン後の画面、APIのアクセス制御、プログラムの中身、アクセスログは診断範囲外です。</p>
      </section>
      <ReportAnalysis analysis={result.analysis} />
      <section className="card result-section">
        <h2>見つかったリスク（{result.issues.length}件）</h2>
        {result.issues.slice(0, 3).map((issue) => <IssueRow key={issue.id} issue={issue} aiSelected={result.summaryReference === issue.id} />)}
        {!result.issues.length && <p>{result.coverage ? '確認できた範囲では指摘はありませんでした。' : '公開ページを十分に確認できませんでした。確認できなかった項目は下に記載しています。'}</p>}
        {result.issues.length > 3 && <details className="more-issues"><summary>ほかの気になる点 {result.issues.length - 3}件をすべて見る</summary>
          {result.issues.slice(3).map((issue) => <IssueRow key={issue.id} issue={issue} aiSelected={result.summaryReference === issue.id} />)}
        </details>}
      </section>
      <section className="card result-section">
        <h2>確認できた良い点（{result.good.length}件）</h2>
        {result.good.map((item) => {
          const benefit = protectionBenefit(item);
          return <article className="finding mint-tint good-item" key={item}>
            <strong>{item}</strong>
            {benefit && <p>{benefit}</p>}
          </article>;
        })}
        {!result.good.length && <p>確認できた項目はありません。</p>}
      </section>
      {Array.isArray(result.thirdParties) && <section className="card result-section">
        <h2>このサイトの中身</h2>
        <div className="report-evidence">
          <div><h3>使っている技術</h3>
            {result.techs?.length ? <>
              <ul className="technology-list">{result.techs.map((entry) => <li key={`${entry.name}:${entry.version || ''}`}>
                <strong>{entry.name} {entry.version || '版は不明'}</strong>
                <p className="small-text">{entry.category} ／ 確度　{technologyConfidence[entry.confidence]}</p>
                <Badge tone={entry.eol?.status === 'ended' ? 'pink' : entry.eol?.status === 'ending_soon' ? 'yellow' : entry.eol ? 'mint' : 'neutral'}>
                  {lifecycleLabels[entry.eol?.status] || (entry.category === '配信サービス' ? '版別サポートの照合対象外' : 'サポート状況不明')}
                </Badge>
                {technologyLifecycle(entry, result.date).map((item) => <p className="small-text" key={item}>{item}</p>)}
                <p className="small-text">根拠　{entry.evidence.join('、')}</p>
                {entry.eol?.source && <a className="small-text" href={entry.eol.source}>サポート情報の出典</a>}
              </li>)}</ul>
              <p className="small-text">公開ページに明示された情報からの推定です。運用中の正確な構成と保守契約は担当者に確認してください。</p>
            </> : <p>公開ページの明示情報から技術名・版は確認できませんでした。</p>}
          </div>
          <div><h3>つながっている外部サービス</h3>
            <p><strong className="service-count">{result.thirdParties.length}</strong> 件の参照先</p>
            {result.thirdParties.length > 0 && <>
              <p>{serviceCounts(result.thirdParties).map(([kind, count]) => `${serviceLabels[kind]} ${count}件`).join(' ／ ')}</p>
              <ul>{result.thirdParties.map(({ service, kind }) => <li key={service}>{service}（{serviceLabels[kind]}）</li>)}</ul>
            </>}
            <p className="small-text">根拠は公開ページのHTMLです（参照の記載は確定）。実際の通信と同意前の動作は未確認です。</p>
          </div>
          {result.reputation && <div><h3>危険サイト登録</h3>
            <p>{reputationSummary(result.reputation)}</p>
            {result.reputation.status === 'no_match' && <p className="small-text">照合対象は入力されたURLです。</p>}
          </div>}
          <div><h3>期限</h3><ul>{result.expiries.map((expiry) =>
            <li key={expiry.kind}>{expiry.kind === 'certificate' ? '証明書' : 'ドメイン'}　{expiryLabel(expiry)}</li>)}</ul></div>
        </div>
      </section>}
      {grades.some(({ key }) => key === 'traffic') && <section className="card result-section">
        <h2>アクセス元の分析</h2><p>アクセスログを連携すると、Webサイトへのアクセス元の国や不審な通信を確認できます。</p>
        <p className="small-text">今回の診断ではアクセスログ未連携です。</p>
      </section>}
      {result.research?.entries?.length > 0 && <section className="card result-section">
        <h2>公開リリースの追加調査</h2>
        <p>公開資料に掲載された版です。利用中の版は、診断時に確認した情報をもとにしています。</p>
        <ul className="setting-findings">{result.research.entries.map((entry) => <li key={entry.id}>
          {result.research.priority === entry.id && <Badge tone="yellow">AIが選んだ確認候補</Badge>}
          <strong>{entry.name}　検出した版 {entry.observedVersion} ／ 公開資料の最新版 {entry.latestVersion}</strong>
          <p className="small-text">公開日 {entry.releaseDate} ／ 照合日 {diagnoseDate(entry.checkedAt)} ／ 検出版の確度 {technologyConfidence[entry.confidence]}</p>
          <a href={entry.source}>出典</a>
        </li>)}</ul>
      </section>}
      {limitations.length > 0 && <section className="card result-section">
        <h2>確認できなかったこと</h2>
        <ul>{limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>}
      <p className="small-text">{reportAiUse}</p>
    </main>
  </>;
}
