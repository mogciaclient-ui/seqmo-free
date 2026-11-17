import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isStaff, staffCookie } from '../../../../lib/auth.mjs';
import { getScan } from '../../../../lib/db.mjs';
import { interviewContext, interviewNextStep } from '../../../../lib/interview.mjs';
import { Back, Header } from '../../../ui';

export const dynamic = 'force-dynamic';

export default async function StaffMemo({ params }) {
  if (!(await isStaff((await cookies()).get(staffCookie)?.value))) redirect('/login');
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan || scan.state !== 'completed') notFound();
  const context = interviewContext(scan.interview);
  const next = interviewNextStep(scan.interview);
  return <><Header /><main className="narrow">
    <Back href={`/scan/${id}/result`} />
    <section className="card form-body">
      <h1>スタッフ用メモ</h1>
      {next && <p>{next}</p>}
      {context.length ? <dl className="staff-interview">{context.map(({ title, value }) =>
        <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl> : <p>ヒアリングの回答はありません。</p>}
    </section>
  </main></>;
}
