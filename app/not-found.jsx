import { Header, Back } from './ui';
export default function NotFound() {
  return <><Header /><main className="narrow"><section className="card">
    <h1>ページが見つかりません</h1><p>診断結果の閲覧期限が切れている場合があります。</p><Back href="/">トップへ</Back>
  </section></main></>;
}
