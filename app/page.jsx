import { Header, Badge } from './ui';
import { StartForm } from './forms';

export default function Home() {
  return <>
    <Header />
    <main className="home wrap">
      <section className="hero">
        <h1>Webサイトのセキュリティを<br />無料で確認</h1>
        <p>WebサイトやWebアプリのURLを入れると、外から見える通信や保護設定を確認できます。<br className="desktop" /> 結果は、専門知識がなくても読める言葉でお届けします。</p>
        <StartForm />
      </section>
      <div className="intro-grid">
        <article className="card"><Badge tone="pink">01</Badge><h2>通信と証明書</h2><p>暗号化された通信か、証明書は有効か。</p></article>
        <article className="card"><Badge tone="yellow">02</Badge><h2>ブラウザ側の守り</h2><p>ブラウザやCookieの保護が設定されているか。</p></article>
        <article className="card"><Badge tone="mint">03</Badge><h2>ドメイン登録</h2><p>ドメイン登録の期限が近づいていないか。</p></article>
      </div>
    </main>
  </>;
}
