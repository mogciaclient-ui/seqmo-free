import { notFound, redirect } from 'next/navigation';
import { getScan } from '../../../lib/db.mjs';
import { Header } from '../../ui';
import { Progress } from '../../forms';

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params }) {
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan) notFound();
  if (scan.state === 'completed') redirect(`/scan/${id}/result`);
  return <><Header /><main className="wrap"><Progress id={id} url={scan.url} initialState={scan.state} initialStep={scan.step} /></main></>;
}
