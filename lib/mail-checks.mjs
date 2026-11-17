const records = (answer, pattern) => answer.status === 'fulfilled'
  ? answer.value.map((parts) => parts.join('')).filter((value) => pattern.test(value))
  : [];

export function checkMail({ spf, dmarc, mx, caa }, { add, good, observations, limitations }, registeredLookup = false) {
  const subject = registeredLookup ? '登録ドメイン' : '対象ホスト';
  const spfRecords = records(spf, /^v=spf1(?:\s|$)/i);
  if (spfRecords.length > 1) {
    add('spf-duplicates', 'ドメイン・メール', 'medium', '同じ名前に複数のSPFレコードがあります', 'メールの受信側が送信元の認証を正常に判定できないことがあります。', '実際に使う送信サービスを確認し、SPFポリシーを1件にまとめてください。', `${subject}の公開DNSにSPFレコードが${spfRecords.length}件`);
  } else if (spfRecords.length) {
    const all = spfRecords[0].split(/\s+/).find((term) => /^[+~?-]?all$/i.test(term));
    if (/^\+?all$/i.test(all || '')) {
      add('spf-open', 'ドメイン・メール', 'medium', 'SPFがすべての送信元を許可しています', '受信側がSPFで正規の送信元を選別できません。', '正規の送信サービスを特定し、SPFで許可する範囲を絞ってください。', `${subject}のSPFに送信元を限定しないall規則があります。`);
    } else {
      good.push(`${subject}の公開DNSにSPF設定がありました。`);
    }
  } else {
    limitations.push(`${subject}に明示されたSPF設定は確認できませんでした。`);
  }

  const dmarcRecords = records(dmarc, /^v=DMARC1(?:;|$)/i);
  if (dmarcRecords.length > 1) {
    add('dmarc-duplicates', 'ドメイン・メール', 'medium', '同じ名前に複数のDMARCレコードがあります', '受信側が認証に失敗したメールの扱いを決められないことがあります。', '運用中の方針を確認し、DMARCレコードを1件にまとめてください。', `確認した_DMARCの公開DNSにDMARCレコードが${dmarcRecords.length}件`);
  } else if (dmarcRecords.length) {
    const policies = dmarcRecords[0].split(';').map((term) => term.trim()).filter((term) => /^p\s*=/i.test(term));
    const policy = policies.length === 1 && /^p\s*=\s*(none|quarantine|reject)$/i.exec(policies[0])?.[1]?.toLowerCase();
    if (policy === 'none') observations.push('DMARCの方針は p=none（監視用）。認証失敗メールの隔離・拒否は要求していません。');
    else if (policy) good.push(`確認したDMARCに、認証失敗メールを${policy === 'reject' ? '拒否' : '隔離'}する方針が指定されています。`);
    else limitations.push('確認したDMARCレコードからメールの扱いを読み取れませんでした。');
  } else {
    limitations.push('確認した公開DNSにDMARC設定は見つかりませんでした。');
  }

  if (mx.status === 'fulfilled' && mx.value.length) {
    if (mx.value.length === 1 && mx.value[0].priority === 0 && ['', '.'].includes(mx.value[0].exchange)) {
      observations.push(`${subject}はメールを受け取らない設定（Null MX）です。`);
    } else {
      observations.push(`${subject}の公開DNSでメール受信先（MX）を${mx.value.length}件確認しました。`);
    }
  }
  if (caa.status === 'fulfilled' && caa.value.length) {
    observations.push(`対象ホストの公開DNSに証明書発行に関するCAAレコードが${caa.value.length}件ありました。`);
  }
}
