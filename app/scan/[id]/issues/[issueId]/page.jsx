import { notFound } from 'next/navigation';
import { aiAvailable } from '../../../../../lib/ai.mjs';
import { getScan } from '../../../../../lib/db.mjs';
import { diagnoseDate, missingHeaderChecks, severity } from '../../../../../lib/report.mjs';
import { Back, Badge, Header, ReportActions } from '../../../../ui';
import { Ask } from '../../../../forms';

export const dynamic = 'force-dynamic';

export default async function IssuePage({ params }) {
  const { id, issueId } = await params;
  const scan = await getScan(id);
  const issue = scan?.state === 'completed' && scan.result.issues.find((entry) => entry.id === issueId);
  if (!issue) notFound();
  const checks = missingHeaderChecks(issue);
  const sections = [
    ['何が起きている？', issue.what, 'pink'],
    ['何が困る？', issue.impact, 'yellow'],
    ['どうする？', issue.fix, 'mint'],
  ];
  return <><Header /><main className="narrow issue-page">
    <Back href={`/scan/${id}/result`} />
    <div className="actions metadata">
      <Badge tone={['critical','high'].includes(issue.level) ? 'pink' : 'yellow'}>{severity[issue.level]}</Badge>
      <Badge>確度　{issue.confidence}</Badge>
      <Badge>診断日　{diagnoseDate(scan.result.date)}</Badge>
    </div>
    <h1>{issue.title}</h1>
    {sections.map(([label, content, tone], index) => <section className="card numbered" key={label}>
      <span className={`stage-icon ${tone}`} aria-hidden="true">{index + 1}</span>
      <div><h2>{label}</h2><p>{content}</p>{index === 2 && <ReportActions id={id} />}</div>
    </section>)}
    {checks.length > 0 && <section className="card result-section">
      <h2>確認・対応方法</h2>
      <ul className="setting-findings">{checks.map(({ name, title, purpose, action }) => <li key={name}>
        <strong>{title}</strong><p>{purpose}</p><p>{action}</p>
      </li>)}</ul>
    </section>}
    <Ask id={id} issueId={issueId} enabled={aiAvailable()} />
    <details className="card no-shadow technical">
      <summary>技術的な詳細（エンジニア向け）</summary>
      <pre>{issue.evidence}</pre>
      <p>分類　{issue.category} ／ 確度　{issue.confidence}</p>
    </details>
  </main></>;
}
