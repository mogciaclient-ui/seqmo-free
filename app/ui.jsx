import Image from 'next/image';
import Link from 'next/link';

export function Header({ children }) {
  return <header className="site-header">
    <Link className="logo" href="/" aria-label="seQmo. トップ">
      <Image src="/seqmo-logo.png" alt="" width={600} height={219} unoptimized />
    </Link>
    {children}
  </header>;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Back({ href, children = '診断結果にもどる' }) {
  return <Link className="button small" href={href}>← {children}</Link>;
}

export function ReportActions({ id }) {
  return <div className="actions">
    <Link className="button pink" href={`/scan/${id}/consult?kind=diagnosis`}>詳細診断を申し込む</Link>
    <Link className="button" href={`/scan/${id}/consult?kind=rebuild`}>建て替えの相談をする</Link>
  </div>;
}
