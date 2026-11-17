import { firebaseAuth } from '../lib/firebase.mjs';

const [action, email, extra] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !email || extra) {
  console.error('使い方: npm run staff -- grant staff@example.com または npm run staff -- revoke staff@example.com');
  process.exitCode = 1;
} else {
  try {
    const auth = firebaseAuth();
    const user = await auth.getUserByEmail(email.trim());
    const claims = { ...user.customClaims };
    if (action === 'grant') claims.seqmoStaff = true;
    else delete claims.seqmoStaff;
    await auth.setCustomUserClaims(user.uid, claims);
    console.log(action === 'grant'
      ? 'スタッフ権限を付与しました。Firebaseのメールアドレスとパスワードでログインしてください。'
      : 'スタッフ権限を解除しました。');
  } catch (error) {
    console.error(error.code === 'auth/user-not-found'
      ? '該当アカウントがありません。Firebase Authenticationのユーザー一覧を確認してください。'
      : 'スタッフ権限を更新できませんでした。.env.local のFirebase接続とサービスアカウントの権限を確認してください。');
    process.exitCode = 1;
  }
}
