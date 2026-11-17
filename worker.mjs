import { setTimeout as delay } from 'node:timers/promises';
import { claimDelivery, claimScan, cleanup, cleanupAuxiliary, finishDelivery, saveReportAnalysis, updateScan } from './lib/db.mjs';
import { firebaseConfigured, firestore } from './lib/firebase.mjs';
import { scanSite } from './lib/scan.mjs';
import { analyzeReport } from './lib/report-analysis.mjs';
import { badAddress } from './lib/target.mjs';

async function deliver(kind, webhook) {
  if (!webhook) return;
  const row = await claimDelivery(kind);
  if (!row) return;
  let success = false;
  try {
    const result = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': row.id },
      body: JSON.stringify(row.body), signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    success = result.ok;
  } catch {
    // Firestore keeps the delivery scheduled for retry.
  }
  await finishDelivery(row, success);
}

async function runScan(row) {
  try {
    const result = await scanSite(row, row.config, async (step, issues, good) => {
      const updated = await updateScan(row, { step, result: { issuesCount: issues, goodCount: good } });
      if (!updated) throw new Error('診断の処理権限が失効しました。');
    });
    const pending = { status: 'pending', checkedAt: new Date().toISOString() };
    if (await updateScan(row, { step: 5, state: 'completed', result: { ...result, analysis: pending } })) {
      let analysis;
      try {
        analysis = await analyzeReport(result);
      } catch {
        analysis = { status: 'unavailable' };
      }
      try {
        await saveReportAnalysis(row.id, analysis);
      } catch {
        console.warn('seQmo AI総合分析の保存に失敗しました。');
      }
    }
  } catch (error) {
    await updateScan(row, {
      state: 'failed', result: null,
      error: error.message === badAddress ? badAddress : '診断の処理中にエラーが発生しました。',
    });
  }
}

if (!firebaseConfigured()) {
  console.error('先に .env.local の FIREBASE_PROJECT_ID と Firebase の認証情報を設定してください。');
  process.exit(1);
}

const job = process.argv.includes('--job');
const jobDeadline = Date.now() + 180000;
let jobScans = 0;
console.log(job ? 'seQmo. Firestore job ready' : 'seQmo. Firestore worker ready');
let lastCleanup = 0;
let lastAuxiliaryCleanup = 0;
while (true) {
  try {
    const now = Date.now();
    if (now - lastCleanup > 60000) { await cleanup(); lastCleanup = now; }
    if (now - lastAuxiliaryCleanup > 3600000) { await cleanupAuxiliary(); lastAuxiliaryCleanup = now; }
    const row = await claimScan();
    if (row) { await runScan(row); jobScans++; }
    await Promise.all([
      deliver('consult', process.env.SEQMO_CONSULT_WEBHOOK),
      deliver('email', process.env.SEQMO_EMAIL_WEBHOOK),
    ]);
    if (job && (!row || jobScans >= 3 || Date.now() >= jobDeadline)) break;
    if (!row) await delay(5000);
  } catch {
    console.error('Firestore の処理に失敗しました。接続先とサービスアカウントの権限を確認してください。');
    if (job) { process.exitCode = 1; break; }
    await delay(10000);
  }
}

if (job) await firestore().terminate();
