import { startScanJob } from '../../../lib/cloud-jobs.mjs';
import { fetchTraffic } from '../../../lib/traffic.mjs';
import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { allowLogin, cancelScan, defaults, enqueue, getScan, reserveCounter, saveInterview, savePrivateTraffic, saveSettings, setConsultStatus, settings, submitConsultation } from '../../../lib/db.mjs';
import { firebaseConfigured } from '../../../lib/firebase.mjs';
import { staffCookie, sessionHours, isStaff, login, loginConfigured } from '../../../lib/auth.mjs';
import { normalize } from '../../../lib/target.mjs';
import { parseInterview, interviewContext } from '../../../lib/interview.mjs';
import { selectAnswer } from '../../../lib/ai.mjs';
import { generatePdf } from '../../../lib/pdf.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const respond = (data, status = 200) => NextResponse.json(data, { status, headers });
const staffFor = (request) => isStaff(request.cookies.get(staffCookie)?.value);
const kinds = ['diagnosis', 'rebuild'];
const channels = ['対面', 'オンライン', '電話', 'メール'];
const statuses = ['未対応', '対応中', '完了'];
const email = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const valueOf = (object, name) => typeof object?.[name] === 'string' ? object[name].trim() : '';
const sourceOf = (request) => {
  const secret = process.env.SEQMO_SOURCE_SECRET;
  if (process.env.SEQMO_TRUST_PROXY !== '1' || (secret?.length ?? 0) < 32) return 'shared';
  const source = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  return createHmac('sha256', secret).update(source).digest('hex');
};

function unavailable(error) {
  console.error('seQmo Firebase API error', typeof error?.code === 'number' ? error.code : '');
  return respond({ error: '現在はデータに接続できません。しばらくしてからお試しください。' }, 503);
}

export async function GET(request, context) {
  try { return await get(request, context); } catch (error) { return unavailable(error); }
}

export async function POST(request, context) {
  try { return await post(request, context); } catch (error) { return unavailable(error); }
}

async function get(request, { params }) {
  const [action, id, operation] = (await params).action;
  if (action !== 'scans' || !id) return respond({ error: 'ページが見つかりません。' }, 404);
  const scan = await getScan(id);
  if (!scan) return respond({ error: '診断が見つからないか、閲覧期限が切れています。' }, 404);
  if (operation === 'pdf') {
    if (scan.state !== 'completed') return respond({ error: '診断結果の準備中です。' }, 409);
    try {
      const pdf = await generatePdf(scan);
      return new Response(new Uint8Array(pdf), {
        headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="seqmo-report.pdf"' },
      });
    } catch {
      return respond({ error: 'PDFを作成できませんでした。時間をおいてお試しください。' }, 503);
    }
  }
  if (operation) return respond({ error: 'ページが見つかりません。' }, 404);
  return respond({
    state: scan.state, step: scan.step, good: scan.result?.goodCount ?? scan.result?.good?.length ?? 0,
    issues: scan.result?.issuesCount ?? scan.result?.issues?.length ?? 0, error: scan.error,
  });
}

async function post(request, { params }) {
  const [action, id, operation] = (await params).action;
  const origin = request.headers.get('origin');
  const expected = process.env.SEQMO_ORIGIN || request.nextUrl.origin;
  if ((origin && origin !== expected) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return respond({ error: '送信元を確認できません。' }, 403);
  }
  if (Number(request.headers.get('content-length') || 0) > 16000) return respond({ error: '入力が長すぎます。' }, 413);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 16000) return respond({ error: '入力が長すぎます。' }, 413);
    body = JSON.parse(raw);
  } catch {
    return respond({ error: '入力内容を確認してください。' }, 400);
  }
  if (!firebaseConfigured()) return respond({ error: 'Firebase の接続設定が必要です。' }, 503);
  const staff = await staffFor(request);

  if (action === 'session' && !id) {
    if (body?.logout === true) {
      const response = respond({ ok: true });
      response.cookies.delete(staffCookie);
      return response;
    }
    if (!loginConfigured()) return respond({ error: 'Firebase のスタッフログイン設定が必要です。' }, 503);
    if (!(await allowLogin(sourceOf(request)))) return respond({ error: '時間をおいて再度お試しください。' }, 429);
    const token = await login(body?.email, body?.password);
    if (!token) return respond({ error: 'スタッフ用のメールアドレスとパスワードを確認してください。' }, 401);
    const response = respond({ ok: true });
    response.cookies.set(staffCookie, token, { httpOnly: true, sameSite: 'strict', secure: expected.startsWith('https:'), path: '/', maxAge: sessionHours * 3600 });
    return response;
  }
  if (action === 'scans' && !id) {
    let url;
    try {
      url = normalize(body?.url);
    } catch (error) {
      return respond({ error: error.message }, 422);
    }
    const result = await enqueue(url.href, url.hostname.replace(/^www\./, ''), sourceOf(request), staff);
    if (result.cancelToken && process.env.SEQMO_CLOUD_RUN_JOB && !(await startScanJob())) {
      console.warn('seQmo Cloud Run Jobsの起動に失敗しました。受付済みの診断はキューに残ります。');
    }
    return respond(result.error ? { error: result.error } : { id: result.id, cancelToken: result.cancelToken }, result.status || 202);
  }
  if (action === 'admin') {
    if (!staff) return respond({ error: 'スタッフログインが必要です。' }, 403);
    if (id === 'settings') {
      const config = await settings();
      for (const [key, fallback] of Object.entries(defaults)) {
        const item = body?.[key];
        if (item === undefined) continue;
        if (typeof fallback === 'boolean' && typeof item === 'boolean') config[key] = item;
        if (typeof fallback === 'number' && item !== '' && item !== null && Number.isInteger(Number(item))) {
          const min = ['critical', 'high', 'medium', 'low', 'info', 'cacheMinutes'].includes(key) ? 0 : 1;
          config[key] = Math.max(min, Math.min(key === 'retentionDays' ? 365 : key.endsWith('Level') ? 5 : key === 'cacheMinutes' ? 1440 : 100, Number(item)));
        }
      }
      if (config.cautionLevel > config.dangerLevel) return respond({ error: '注意のしきい値は危険以下にしてください。' }, 422);
      await saveSettings(config);
      return respond({ ok: true });
    }
    if (id === 'consult' && operation && statuses.includes(body?.status)) {
      if (await setConsultStatus(operation, body.status)) return respond({ ok: true });
      return respond({ error: '相談が見つかりません。' }, 404);
    }
  }

  if (action === 'scans' && id && operation === 'traffic') {
    if (!staff) return respond({ error: '管理者ログインが必要です。' }, 403);
    const scan = await getScan(id);
    if (scan?.state !== 'completed') return respond({ error: '診断結果が見つかりません。' }, 404);
    const source = valueOf(body, 'source');
    if (!['ga4', 'cloudflare'].includes(source)) return respond({ error: '連携先を選んでください。' }, 422);
    if (!(await reserveCounter(`traffic:${id}:${source}`, 5, scan.expires))) return respond({ error: '取得上限に達しました。' }, 429);
    try {
      const traffic = await fetchTraffic(new URL(scan.url).hostname, source);
      if (!traffic) return respond({ error: 'このホストには連携先が設定されていません。' }, 422);
      await savePrivateTraffic(id, source, traffic);
      return respond({ ok: true });
    } catch {
      return respond({ error: 'アクセス集計を取得できませんでした。連携先の権限と取得可能期間を確認してください。' }, 503);
    }
  }

  if (action === 'scans' && id && operation === 'cancel') {
    if (!(await cancelScan(id, body?.token))) return respond({ error: 'この診断を中止できませんでした。' }, 409);
    return respond({ ok: true });
  }

  if (action === 'scans' && id && operation === 'interview') {
    if (!staff) return respond({ error: 'スタッフログインが必要です。' }, 403);
    const answers = parseInterview(body?.answers);
    if (!answers) return respond({ error: '回答を確認してください。' }, 422);
    return await saveInterview(id, answers) ? respond({ ok: true }) : respond({ error: '診断が見つかりません。' }, 404);
  }

  if (action !== 'scans' || !id || !['consult', 'ask'].includes(operation)) return respond({ error: 'ページが見つかりません。' }, 404);
  const scan = await getScan(id);
  if (scan?.state !== 'completed') return respond({ error: '診断結果が見つかりません。' }, 404);
  if (operation === 'consult') {
    const company = valueOf(body, 'company');
    const person = valueOf(body, 'person');
    const contact = valueOf(body, 'contact');
    const note = valueOf(body, 'note');
    const errors = {};
    if (!company || company.length > 150) errors.company = '会社名を150文字以内で入力してください。';
    if (!person || person.length > 100) errors.person = 'お名前を100文字以内で入力してください。';
    if (contact.length > 254 || !(email(contact) || /^\+?[\d() -]{8,26}$/.test(contact) && contact.replace(/\D/g, '').length >= 8)) errors.contact = 'メールアドレスまたは電話番号を入力してください。';
    if (body?.consent !== true) errors.consent = '診断結果の共有への同意が必要です。';
    if (!kinds.includes(body?.kind)) errors.kind = '相談の種類を選んでください。';
    if (note.length > 2000) errors.note = '相談内容は2000文字以内で入力してください。';
    if (Object.keys(errors).length) return respond({ errors }, 422);
    const key = valueOf(body, 'key');
    if (!/^[a-f0-9-]{36}$/i.test(key)) return respond({ error: 'フォームを読み込み直してください。' }, 422);
    const consultationId = `${id}:${key}`;
    const channel = channels.includes(body.channel) ? body.channel : '';
    const accepted = await submitConsultation(scan, consultationId, { kind: body.kind, company, person, contact, channel, note });
    if (!accepted) return respond({ error: 'この診断の相談受付上限に達しました。' }, 429);
    return respond({ ok: true });
  }
  const issue = scan.result.issues.find((item) => item.id === body?.issueId);
  const requestedTopic = body?.topic;
  const question = valueOf(body, 'question');
  if (!issue) return respond({ error: '指摘が見つかりません。' }, 404);
  if (!['what', 'impact', 'fix'].includes(requestedTopic) && (!question || question.length > 300)) {
    return respond({ error: '質問を300文字以内で入力してください。' }, 422);
  }
  const questionLimit = (await settings()).questionLimit;
  if (!(await reserveCounter(`questions:${id}`, questionLimit, scan.expires))) {
    return respond({ error: 'この診断の質問上限に達しました。' }, 429);
  }
  const topic = ['what', 'impact', 'fix'].includes(requestedTopic) ? requestedTopic : await selectAnswer(issue, question, staff ? interviewContext(scan.interview) : []);
  if (!topic) return respond({ answer: 'この指摘に沿った質問を選択してください。個別の事情についてはMOGCIAにご相談ください。' });
  return respond({ answer: issue[topic], reference: issue.title });
}
