import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { staffCookie, isStaff } from '../../../../lib/auth.mjs';
import { getScan } from '../../../../lib/db.mjs';
import { trafficConfiguration, trafficSources } from '../../../../lib/traffic.mjs';
import { Header, Back } from '../../../ui';
import { TrafficImport } from '../../../forms';

export const dynamic = 'force-dynamic';

export default async function PrivateTraffic({ params }) {
  if (!(await isStaff((await cookies()).get(staffCookie)?.value))) redirect('/login');
  const { id } = await params;
  const scan = await getScan(id);
  if (scan?.state !== 'completed') notFound();
  const config = trafficConfiguration(new URL(scan.url).hostname);
  return <><Header /><main className="wrap">
    <Back href={`/scan/${id}/result`} />
    <section className="card"><h1>アクセス元の分析</h1>
      <p>{scan.url}</p>
      <p>管理者向けの集計です。アクセス元の国だけで不審な通信とは判定しません。</p>
      {Object.entries(trafficSources).map(([source, title]) => {
        const report = scan.privateTraffic?.[source];
        return <section key={source} className="result-section">
          <h2>{title}</h2>
          {config[source] ? <TrafficImport id={id} source={source} /> : <p>対象ホストの連携設定がありません。</p>}
          {report && <>
            <p>取得指定期間（{source === 'cloudflare' ? 'UTC' : 'GA4プロパティのタイムゾーン'}）　{report.requestedFrom} ～ {report.requestedTo}</p>
            <p>データが返った期間　{report.from && report.to ? `${report.from} ～ ${report.to}` : 'データなし'}</p>
            <div className="report-evidence">
              <div><h3>国別ランキング（{report.metric}）</h3>
                <ol>{report.countries.slice(0, 20).map(({ name, count }, index) => <li key={index}>{name}　{count.toLocaleString('ja-JP')}</li>)}</ol>
              </div>
              <div><h3>日別推移（{report.metric}）</h3>
                <ul>{report.daily.map(({ date, count }) => <li key={date}>{date}　{count.toLocaleString('ja-JP')}</li>)}</ul>
              </div>
            </div>
            {report.security && <div>
              <h3>Cloudflareのセキュリティ処理</h3>
              {report.security.status === 'unchecked' ? <p>この連携ではセキュリティ処理の内訳を確認できませんでした。</p>
                : report.security.actions.length ? <ul>{report.security.actions.map(({ action, count }, index) =>
                  <li key={index}>{action}　{count.toLocaleString('ja-JP')}</li>)}</ul> : <p>取得したデータにセキュリティ処理の記録はありません。</p>}
              <p className="small-text">Cloudflareが返した集計です。攻撃件数とは異なり、プランによりサンプリングされることがあります。</p>
            </div>}
          </>}
        </section>;
      })}
    </section>
  </main></>;
}
