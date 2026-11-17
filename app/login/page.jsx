import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isStaff, loginConfigured, staffCookie } from '../../lib/auth.mjs';
import { Login } from '../forms';
import { Header } from '../ui';

export const metadata = { title: 'スタッフログイン | seQmo.' };

export default async function LoginPage() {
  if (await isStaff((await cookies()).get(staffCookie)?.value)) redirect('/');
  return <><Header /><main className="narrow login-page"><Login configured={loginConfigured()} /></main></>;
}
