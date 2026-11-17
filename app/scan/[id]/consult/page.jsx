import { notFound } from 'next/navigation';
import { getScan } from '../../../../lib/db.mjs';
import { Header, Back } from '../../../ui';
import { ConsultForm } from '../../../forms';

export const dynamic = 'force-dynamic';

export default async function ConsultPage({ params, searchParams }) {
  const { id } = await params;
  const { kind } = await searchParams;
  const scan = await getScan(id);
  if (scan?.state !== 'completed') notFound();
  const top = scan.result.issues.slice(0, 3).map(({ title }) => title);
  const draft = `${scan.url} の無料診断について相談したいです。\n${top.length ? `結果で確認した点\n${top.map((title) => '・' + title).join('\n')}\n` : ''}今後どのように確認・対応を進めるとよいか教えてください。`;
  return <><Header /><main className="narrow consult-page">
    <Back href={`/scan/${id}/result`} />
    <h1>MOGCIAに相談する</h1>
    <p>診断結果をもとに、担当者からご連絡します。費用がかかる場合は、内容とお見積もりを先にお伝えします。</p>
    <ConsultForm id={id} kind={kind === 'rebuild' ? 'rebuild' : 'diagnosis'} draft={draft} />
  </main></>;
}
