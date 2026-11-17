import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isStaff, staffCookie } from '../../lib/auth.mjs';
import { dashboard } from '../../lib/db.mjs';
import { Header } from '../ui';
import { AdminSettings, ConsultStatus, Logout } from '../forms';

const tabs = { home: 'ホーム', scans: '診断一覧', consult: '相談一覧', settings: '設定' };
const states = { queued: '受付済み', running: '実行中', completed: '成功', failed: '失敗' };
const date = (time) => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(time);

export default async function Admin({ searchParams }) {
  if (!(await isStaff((await cookies()).get(staffCookie)?.value))) redirect('/login');
  const { tab: requested } = await searchParams;
  const tab = Object.hasOwn(tabs, requested) ? requested : 'home';
  const data = await dashboard(tab).catch(() => null);
  return <><Header><Logout /></Header><main className="wrap admin">
    <nav className="card admin-nav" aria-label="管理画面">{Object.entries(tabs).map(([key, title]) =>
      <Link key={key} href={`/admin?tab=${key}`} aria-current={key === tab ? 'page' : undefined}>{title}</Link>)}</nav>
    <section className="card admin-content"><h1>{tabs[tab]}</h1>
      {!data && <p role="status">Firestoreに接続できません。Firebase Consoleでデータベースの設定を確認してください。</p>}
      {data && tab === 'home' && <div className="admin-counts">
        <p>診断数 <strong>{data.scans}</strong></p>
        <p>相談数 <strong>{data.consultations}</strong></p>
      </div>}
      {data && tab === 'scans' && <div className="table-scroll"><table><thead><tr><th>実行日時</th><th>対象URL</th><th>点数</th><th>状態</th><th>結果</th></tr></thead>
        <tbody>{data.map((row) =>
          <tr key={row.id}><td>{date(row.started)}</td><td>{row.url}</td><td>{row.result?.score ?? '—'}</td>
          <td>{states[row.state]}</td><td>{row.state === 'completed' && <><Link href={`/scan/${row.id}/result`}>結果を見る</Link>{' ／ '}<Link href={`/admin/traffic/${row.id}`}>アクセス集計</Link></>}</td></tr>)}</tbody>
      </table></div>}
      {data && tab === 'consult' && <div className="table-scroll"><table><thead><tr><th>会社・お名前</th><th>種類</th><th>連絡先</th><th>相談内容</th><th>対応状況</th></tr></thead>
        <tbody>{data.map((row) =>
          <tr key={row.id}><td>{row.company}<br />{row.person}</td><td>{row.kind === 'diagnosis' ? '詳細診断' : '建て替え・開発'}</td>
          <td>{row.contact}<br />{row.channel}</td><td><details><summary>内容を表示</summary><p>{row.note}</p><Link href={`/scan/${row.scan}/result`}>診断結果</Link></details></td>
          <td><ConsultStatus id={row.id} status={row.status} /></td></tr>)}</tbody>
      </table></div>}
      {data && tab === 'settings' && <AdminSettings config={data} />}
    </section>
  </main></>;
}
