import { AnalysisRefresh } from './forms';

import { analysisSectionTitles, visibleAnalysisRows } from '../lib/report.mjs';

export function ReportAnalysis({ analysis }) {
  if (!analysis) return null;
  const { sections, status } = analysis;
  const pending = status === 'pending' && Date.now() - Date.parse(analysis.checkedAt) < 30000;
  const publications = (analysis.sources || []).filter(({ kind }) => kind === 'advisory' || kind === 'release');
  const byEvidence = new Map((analysis.evidence || []).map((row) => [row.id, row]));
  const bySource = new Map((analysis.sources || []).map((row) => [row.id, row]));
  return <section className="card result-section">
    <h2>AI総合分析</h2>
    {pending && <><AnalysisRefresh checkedAt={analysis.checkedAt} /><p role="status">公開情報を照合し、AIで分析しています。診断結果はすでにご覧いただけます。</p></>}
    {!pending && status !== 'ready' && <p>AI総合分析を表示できませんでした。下の診断結果をご覧ください。</p>}
    {sections && <>
      <p className="small-text">AIが整理した見解です。リスクと影響には推測が含まれます。</p>
      {Object.entries(analysisSectionTitles).map(([key, title]) => {
        const rows = visibleAnalysisRows(analysis, key);
        return rows.length > 0 && <div className="analysis-group" key={key}>
          <h3>{title}</h3>
          <ul>{rows.map(({ text, evidenceIds, sourceIds }, index) => <li key={index}>
            <p>{text}</p>
            <details className="small-text">
              <summary>根拠と出典</summary>
              <ul>{evidenceIds.map((id) => {
                const entry = byEvidence.get(id);
                if (!entry) return null;
                const label = entry.title || [entry.name, entry.version].filter(Boolean).join(' ');
                return <li key={id}>{entry.kind === 'finding' ? <a href={`#issue-${id}`}>{label}</a> : label} <code>{id}</code></li>;
              })}
            {sourceIds.map((id) => {
              const source = bySource.get(id);
              return source && <li key={id}><a href={source.url}>{source.title}</a></li>;
            })}</ul>
          </details>
        </li>)}</ul>
      </div>;
      })}
    </>}
    {status !== 'pending' && (publications.length > 0 || analysis.lookups) && <div className="analysis-group">
      <h3>公開されている更新・脆弱性情報</h3>
      <p className="small-text">公開されている版番号との照合結果です。実際の構成や配布元の修正状況によって影響は異なります。</p>
      {publications.length > 0 && <ul>{publications.map((source) => <li key={source.id}>
        {source.technology} {source.version} ／ <a href={source.url}>{source.title}</a>
        {source.latestVersion && <> ／ 公開版 {source.latestVersion}</>}
        {source.score != null && <> ／ CVSS {source.score}</>}
        {source.exploited && <> ／ CISAの既知の悪用リストに掲載</>}
        {source.published && <> ／ 公開日 {source.published}</>}
      </li>)}</ul>}
      {analysis.lookups?.map(({ technology, version, status }) => <p className="small-text" key={`${technology}:${version}`}>
        {technology} {version} ／ {({ checked: '版番号で照合済み', partial: '一部の公開情報を取得', unavailable: '公開情報を取得できませんでした' })[status]}
      </p>)}
      {analysis.lookups?.length === 0 && <p className="small-text">照合できる版番号がありませんでした。</p>}
      {analysis.omitted > 0 && <p className="small-text">版番号が不明、照合に未対応、または取得件数の上限により未照合の技術があります。</p>}
    </div>}
  </section>;
}
