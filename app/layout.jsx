import './globals.css';

export const metadata = {
  title: 'seQmo. 無料診断',
  description: 'Webアプリ・業務ツールの通信や保護設定を外から確認する、MOGCIAの無料診断。',
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return <html lang="ja"><body>{children}</body></html>;
}
