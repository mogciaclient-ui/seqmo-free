'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { aiNotice, stages } from '../lib/report.mjs';

async function send(path, body) {
  try {
    const response = await fetch('/api/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await response.json();
  } catch {
    return { error: '通信に失敗しました。時間をおいてお試しください。' };
  }
}

export function StartForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const data = await send('scans', { url: new FormData(event.currentTarget).get('url') });
    if (data.id) {
      if (data.cancelToken) {
        try { sessionStorage.setItem(`seqmo-cancel:${data.id}`, data.cancelToken); } catch {}
      }
      router.push('/scan/' + data.id);
      return;
    }
    setError(data.error);
    setBusy(false);
  }
  return <form className="card start-form" onSubmit={submit} noValidate>
    <label htmlFor="target">診断するWebアプリ・業務ツールのURL</label>
    <div className="inline-form">
      <input id="target" name="url" inputMode="url" autoComplete="url" placeholder="https://app.example.co.jp" aria-invalid={Boolean(error)} aria-describedby={error ? 'target-error' : undefined} />
      <button className="button pink" disabled={busy}>{busy ? '受付中…' : '診断する！'}</button>
    </div>
    {error && <p className="error" id="target-error" role="alert">{error}</p>}
  </form>;
}

export function AnalysisRefresh({ checkedAt }) {
  const router = useRouter();
  useEffect(() => {
    const remaining = 30000 - (Date.now() - Date.parse(checkedAt));
    if (!(remaining > 0)) return;
    const timer = setInterval(() => router.refresh(), 2500);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      router.refresh();
    }, remaining);
    return () => {
      clearTimeout(timeout);
      clearInterval(timer);
    };
  }, [checkedAt, router]);
  return null;
}

const progressMessages = [
  'サイトに接続できるか確認しています。',
  '通信が暗号化されているか確認しています。',
  'ブラウザが使う保護設定を調べています。',
  'ドメインの登録期限を確認しています。',
  '確認できた項目をまとめています。',
];

export function Progress({ id, url, initialState, initialStep }) {
  const router = useRouter();
  const [cancelToken, setCancelToken] = useState(null);
  const [cancelError, setCancelError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    try { setCancelToken(sessionStorage.getItem(`seqmo-cancel:${id}`)); } catch {}
  }, [id]);
  const [progress, setProgress] = useState({ state: initialState, step: initialStep });
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function check() {
      try {
        const response = await fetch('/api/scans/' + id, { cache: 'no-store', signal: controller.signal });
        const info = await response.json();
        if (controller.signal.aborted) return;
        if (info.state === 'completed') { router.replace(`/scan/${id}/result`); return; }
        setProgress(response.ok ? info : { state: 'failed', error: info.error });
        if (!response.ok || ['failed', 'cancelled'].includes(info.state)) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      timer = setTimeout(check, 1500);
    }
    check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, router]);
  const step = Math.min(progress.step ?? 0, stages.length - 1);
  const percent = progress.state === 'completed' ? 100 : progress.state === 'queued' ? 0 : [10, 28, 53, 76, 92][step];
  return <div className="progress-grid">
    <section className="card progress-panel">
      <span className="eyebrow">診断しているWebアプリ・業務ツール</span>
      <h1>{url}</h1>
      {['failed', 'cancelled'].includes(progress.state) ? <div className="failure" role="alert">
        <p>{progress.state === 'cancelled' ? '診断を中止しました。' : progress.error || '診断を完了できませんでした。'}</p>
        <a className="button pink" href="/">もう一度診断する</a>
      </div> : <>
        <div className="split"><strong>いま {percent}%</strong><span>{progress.state === 'queued' ? '順番待ち' : progress.state === 'completed' ? '診断完了' : '確認中'}</span></div>
        <progress value={percent} max="100" aria-label="診断の進み具合" />
        <p className="live-line" role="status">{progress.state === 'queued' ? 'ワーカーの実行を待っています。' : progressMessages[step]}</p>
        {cancelToken && ['queued', 'running'].includes(progress.state) && <button type="button" className="button small" disabled={cancelling} onClick={async () => {
          setCancelling(true);
          const data = await send(`scans/${id}/cancel`, { token: cancelToken });
          if (data.ok) setProgress({ state: 'cancelled' });
          else setCancelError(data.error);
          setCancelling(false);
        }}>診断を中止</button>}
        {cancelError && <p className="error" role="alert">{cancelError}</p>}
        <ol className="stages">
          {stages.map((stage, index) => {
            const state = progress.state === 'completed' ? '完了' : progress.state === 'queued' ? 'まだ' : index < step ? '完了' : index === step ? '調べ中' : 'まだ';
            return <li key={stage} className={state === '調べ中' ? 'active' : ''}>
              <span className={`stage-icon ${state === '完了' ? 'mint' : state === '調べ中' ? 'pink' : ''}`} aria-hidden="true">{state === '完了' ? '✓' : state === '調べ中' ? '…' : ''}</span>
              <strong>{stage}</strong><span>{state}</span>
            </li>;
          })}
        </ol>
      </>}
    </section>
    <aside className="progress-aside">
      <section className="card"><h2>ここまでの途中経過</h2>
        <div className="split"><span className="badge mint">良い点</span><strong>{progress.good || 0}</strong></div>
        <div className="split"><span className="badge yellow">気になる点</span><strong>{progress.issues || 0}</strong></div>
      </section>
      <p className="card no-shadow">外から見える公開設定を確認しています。フォームの送信やログインの操作は行いません。</p>
    </aside>
  </div>;
}

const topics = [['what', '何が起きていますか？'], ['impact', 'どんな影響がありますか？'], ['fix', '何から直せばいいですか？']];
export function Ask({ id, issueId, enabled }) {
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);
  async function ask(topic, question) {
    setBusy(true);
    const data = await send(`scans/${id}/ask`, { issueId, topic, question });
    setResponse({ ...data, question });
    setBusy(false);
  }
  return <section className="card ask">
    <h2><span className="stage-icon lilac" aria-hidden="true">?</span> AIに聞く</h2>
    {!enabled && <p className="small-text">現在は、診断結果に保存された標準の説明をご案内します。</p>}
    {response && <div role="status">
      <p className="question">{response.question}</p>
      <p className="answer">{response.answer || response.error}</p>
      {response.reference && <small>根拠　{response.reference}</small>}
    </div>}
    <div className="actions">{topics.map(([topic, title]) =>
      <button className="button small flat" key={topic} type="button" disabled={busy} onClick={() => ask(topic, title)}>{title}</button>)}</div>
    {enabled && <form className="inline-form ask-form" onSubmit={(event) => {
      event.preventDefault();
      const question = new FormData(event.currentTarget).get('question').trim();
      if (question) ask(null, question);
    }}>
      <input name="question" aria-label="この指摘についての質問" placeholder="この指摘について質問する" maxLength="300" required />
      <button className="button small lilac" disabled={busy}>聞く</button>
    </form>}
    <p className="small-text">{aiNotice}</p>
  </section>;
}

export function ConsultForm({ id, kind, draft }) {
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(null);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requestKey = key || crypto.randomUUID();
    setKey(requestKey);
    setBusy(true);
    setErrors({});
    const data = await send(`scans/${id}/consult`, { ...Object.fromEntries(form), consent: form.has('consent'), key: requestKey });
    setDone(Boolean(data.ok));
    setErrors(data.errors || { general: data.error });
    setBusy(false);
  }
  if (done) return <section className="card success" role="status"><h2>相談を受け付けました</h2><p>担当者からご連絡します。</p></section>;
  const clearError = (field) => setErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
  const errorFor = (field) => errors[field] && <span className="error" id={`error-${field}`} role="alert">{errors[field]}</span>;
  const field = (name, label, placeholder) => <label>{label}
    <input name={name} placeholder={placeholder} onChange={() => clearError(name)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} />
    {errorFor(name)}
  </label>;
  return <form className="consult-form" onSubmit={submit} noValidate>
    <fieldset onChange={() => clearError('kind')}>
      <legend>相談したいこと</legend>
      <div className="choice-grid">
        <label className="choice card"><input type="radio" name="kind" value="diagnosis" defaultChecked={kind === 'diagnosis'} />
          <span><strong>詳細診断を申し込む</strong><small>外から見えない部分まで、調べる範囲をご相談ください。</small></span>
        </label>
        <label className="choice card"><input type="radio" name="kind" value="rebuild" defaultChecked={kind === 'rebuild'} />
          <span><strong>建て替え・開発の相談</strong><small>今のシステムを新しくする場合の進め方を相談できます。</small></span>
        </label>
      </div>
      {errorFor('kind')}
    </fieldset>
    <div className="card form-body">
      <div className="field-grid">{field('company', '会社名', '株式会社サンプル')}{field('person', 'お名前', '山田 花子')}</div>
      {field('contact', '連絡先（メールまたは電話番号）', 'name@example.co.jp / 090-0000-0000')}
      <label>相談内容 <span className="badge lilac">診断結果から作成した下書き・編集可</span>
        <textarea name="note" rows="5" defaultValue={draft} onChange={() => clearError('note')} aria-invalid={Boolean(errors.note)} />
        {errorFor('note')}
      </label>
      <fieldset><legend>ご希望の連絡方法</legend><div className="actions">
        {['対面', 'オンライン', '電話', 'メール'].map((channel) => <label className="radio-chip" key={channel}>
          <input type="radio" name="channel" value={channel} defaultChecked={channel === '対面'} />{channel}
        </label>)}
      </div></fieldset>
      <label className="check"><input type="checkbox" name="consent" onChange={() => clearError('consent')} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'error-consent' : undefined} />診断結果をMOGCIAの担当者に共有することに同意します</label>
      {errorFor('consent')}{errorFor('general')}
      <button className="button pink" disabled={busy}>{busy ? '送信中…' : 'この内容で相談する'}</button>
    </div>
  </form>;
}

export function Login({ configured }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="card form-body" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = await send('session', Object.fromEntries(new FormData(event.currentTarget)));
    if (data.ok) { window.location.replace('/'); return; }
    setError(data.error);
    setBusy(false);
  }}>
    <h1>スタッフログイン</h1>
    {!configured && <p className="error" role="status">Firebase の接続情報を設定してください。</p>}
    <label>メールアドレス<input name="email" type="email" autoComplete="username" required /></label>
    <label>パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button pink" disabled={!configured || busy}>{busy ? 'ログイン中…' : 'ログイン'}</button>
  </form>;
}

export function Logout() {
  return <button className="button small" onClick={async () => {
    const data = await send('session', { logout: true });
    if (data.ok) window.location.replace('/login');
  }}>ログアウト</button>;
}

const settingLabels = {
  retentionDays: '結果の保存期間（日）', sourceLimit: '接続元ごとの受付上限（1時間）', domainLimit: '対象ごとの受付上限（1時間）',
  cacheMinutes: '結果の再利用時間（分）', highScoreCap: '危険度「高」以上の点数上限', critical: '緊急の減点',
  high: '高の減点', medium: '中の減点', low: '低の減点', info: '情報の減点',
  dangerLevel: '危険のしきい値（1〜5）', cautionLevel: '注意のしきい値（1〜5）', questionLimit: '診断ごとの質問上限',
};
export function AdminSettings({ config }) {
  const [message, setMessage] = useState('');
  return <form className="form-body" onSubmit={async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const data = await send('admin/settings', Object.fromEntries(values));
    setMessage(data.ok ? '設定を保存しました。' : data.error);
  }}>
    <div className="field-grid">{Object.entries(settingLabels).map(([name, label]) =>
      <label key={name}>{label}<input name={name} type="number" min="0" defaultValue={config[name]} required /></label>)}</div>
    <button className="button pink">保存する</button>
    {message && <p role="status">{message}</p>}
  </form>;
}

export function ConsultStatus({ id, status }) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState('');
  return <><select aria-label="対応状況" value={value} onChange={async (event) => {
    const next = event.target.value;
    const data = await send('admin/consult/' + encodeURIComponent(id), { status: next });
    if (data.ok) { setValue(next); setError(''); } else setError(data.error);
  }}>{['未対応', '対応中', '完了'].map((option) => <option key={option}>{option}</option>)}</select>
  {error && <p className="error" role="alert">{error}</p>}</>;
}

export function TrafficImport({ id, source }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="actions">
    <button className="button small" type="button" disabled={busy} onClick={async () => {
      setError('');
      setBusy(true);
      const result = await send(`scans/${id}/traffic`, { source });
      if (result.ok) router.refresh();
      else setError(result.error);
      setBusy(false);
    }}>{busy ? 'アクセス集計を取得中…' : 'アクセス集計を取得'}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
