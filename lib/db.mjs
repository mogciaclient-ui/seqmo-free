import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { firebaseConfigured, firestore } from './firebase.mjs';

const hour = 3600000;
const day = 24 * hour;
const collection = (name) => firestore().collection('seqmo_' + name);
const doc = (name, id) => collection(name).doc(id);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const data = (snapshot) => snapshot.docs.map((entry) => entry.data());

export const defaults = {
  retentionDays: 90, sourceLimit: 5, domainLimit: 3, cacheMinutes: 60,
  highScoreCap: 59, critical: 35, high: 24, medium: 11, low: 4, info: 0,
  dangerLevel: 4, cautionLevel: 3, questionLimit: 8,
};

export async function settings() {
  if (!firebaseConfigured()) return { ...defaults };
  return { ...defaults, ...(await doc('settings', 'phase1').get()).data() };
}

export async function saveSettings(config) {
  await doc('settings', 'phase1').set(config);
}

export async function getScan(id) {
  if (!firebaseConfigured() || !/^[a-f0-9-]{36}$/i.test(id)) return null;
  const row = (await doc('scans', id).get()).data();
  return row && row.expires > Date.now() ? row : null;
}

export async function saveReportAnalysis(id, analysis) {
  await doc('scans', id).update({ 'result.analysis': analysis });
}

export async function savePrivateTraffic(id, source, traffic) {
  const ref = doc('scans', id);
  await ref.update({ [`privateTraffic.${source}`]: traffic });
}

export async function saveInterview(id, answers) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const ref = doc('scans', id);
  return firestore().runTransaction(async (tx) => {
    const scan = (await tx.get(ref)).data();
    if (!scan || scan.expires <= Date.now()) return false;
    tx.update(ref, { interview: answers });
    return true;
  });
}

const rateError = { error: '診断の受付上限に達しました。時間をおいてお試しください。', status: 429 };

function recent(snapshot, since) {
  return (snapshot.data()?.times || []).filter((time) => time > since);
}

export async function enqueue(url, host, source, staff) {
  const id = randomUUID();
  const cancelToken = randomBytes(32).toString('base64url');
  return firestore().runTransaction(async (tx) => {
    const now = Date.now();
    const config = { ...defaults, ...(await tx.get(doc('settings', 'phase1'))).data() };

    const sourceRef = doc('limits', 'source-' + source);
    const hostRef = doc('limits', 'domain-' + hash(host));
    const cacheRef = doc('cache', hash(url));
    let times;
    let domainTimes;
    let cached;
    if (!staff) {
      const [sourceSnap, hostSnap, cacheSnap] = await tx.getAll(sourceRef, hostRef, cacheRef);
      times = recent(sourceSnap, now - hour);
      if (times.length >= config.sourceLimit) return rateError;
      domainTimes = recent(hostSnap, now - hour);
      const pointer = cacheSnap.data();
      if (pointer && pointer.started > now - config.cacheMinutes * 60000 && pointer.expires > now) {
        const record = (await tx.get(doc('scans', pointer.id))).data();
        if (record?.state === 'completed' && Array.isArray(record.result?.categoryGrades)) cached = record.id;
      }
      tx.set(sourceRef, { times: [...times, now], deleteAt: new Date(now + day) });
    }
    tx.set(doc('history', id), { host, source, at: now, deleteAt: new Date(now + 90 * day) });
    if (cached) return { id: cached };
    if (!staff) {
      if (domainTimes.length >= config.domainLimit) return { error: 'このサイトの診断受付上限に達しました。', status: 429 };
      tx.set(hostRef, { times: [...domainTimes, now], deleteAt: new Date(now + day) });
    }
    const expires = now + config.retentionDays * day;
    tx.create(doc('scans', id), {
      id, url, host, started: now, expires, deleteAt: new Date(expires), state: 'queued',
      queuedAt: now, step: 0, result: null, error: null, config, cancelDigest: hash(cancelToken),
    });
    tx.set(cacheRef, { id, started: now, expires, deleteAt: new Date(expires) });
    return { id, cancelToken };
  });
}

export async function cancelScan(id, token) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return false;
  const ref = doc('scans', id);
  return firestore().runTransaction(async (tx) => {
    const scan = (await tx.get(ref)).data();
    if (!scan || scan.expires <= Date.now() || !/^[a-f0-9]{64}$/.test(scan.cancelDigest || '') ||
        !timingSafeEqual(Buffer.from(scan.cancelDigest, 'hex'), Buffer.from(hash(token), 'hex'))) return false;
    if (scan.state === 'cancelled') return true;
    if (!['queued', 'running'].includes(scan.state)) return false;
    tx.update(ref, { state: 'cancelled', queuedAt: FieldValue.delete(), lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    return true;
  });
}

export async function allowLogin(source) {
  const ref = doc('limits', 'login-' + source);
  return firestore().runTransaction(async (tx) => {
    const now = Date.now();
    const times = recent(await tx.get(ref), now - 900000);
    if (times.length >= 8) return false;
    tx.set(ref, { times: [...times, now], deleteAt: new Date(now + day) });
    return true;
  });
}

export async function reserveCounter(id, limit, expires) {
  const ref = doc('limits', hash(id));
  return firestore().runTransaction(async (tx) => {
    const count = (await tx.get(ref)).data()?.count || 0;
    if (count >= limit) return false;
    tx.set(ref, { count: count + 1, deleteAt: new Date(expires) });
    return true;
  });
}

const dueField = { consult: 'nextConsultAt', email: 'nextEmailAt' };
function delivery(tx, id, kind, body, now) {
  tx.create(doc('deliveries', id), {
    id, kind, body, state: 'pending', attempts: 0, [dueField[kind]]: now, deleteAt: new Date(now + 7 * day),
  });
}

export async function submitConsultation(scan, id, fields) {
  const ref = doc('consultations', id);
  const limitRef = doc('limits', 'consult-' + scan.id);
  return firestore().runTransaction(async (tx) => {
    const [entry, counter, report] = await tx.getAll(ref, limitRef, doc('scans', scan.id));
    if (entry.exists) return true;
    const count = counter.data()?.count || 0;
    const now = Date.now();
    if (count >= 10 || (report.data()?.expires || 0) <= now) return false;
    const { kind, company, channel } = fields;
    tx.create(ref, { id, scan: scan.id, ...fields, consentAt: now, created: now, status: '未対応' });
    tx.set(limitRef, { count: count + 1, deleteAt: new Date(scan.expires) });
    delivery(tx, id, 'consult', { consultationId: id, scanId: scan.id, kind, company, channel }, now);
    return true;
  });
}

export async function submitReportEmail(scan, id, body) {
  const limitRef = doc('limits', 'email-' + scan.id);
  const receiptRef = doc('receipts', id);
  return firestore().runTransaction(async (tx) => {
    const [entry, counter, report] = await tx.getAll(receiptRef, limitRef, doc('scans', scan.id));
    if (entry.exists) return true;
    const count = counter.data()?.count || 0;
    const now = Date.now();
    if (count >= 5 || (report.data()?.expires || 0) <= now) return false;
    tx.create(receiptRef, { deleteAt: new Date(scan.expires) });
    tx.set(limitRef, { count: count + 1, deleteAt: new Date(scan.expires) });
    delivery(tx, id, 'email', body, now);
    return true;
  });
}

export async function dashboard(tab) {
  const scans = collection('scans').where('expires', '>', Date.now());
  if (tab === 'scans') return data(await collection('scans').orderBy('started', 'desc').limit(200).get()).filter((row) => row.expires > Date.now());
  if (tab === 'consult') return data(await collection('consultations').orderBy('created', 'desc').limit(200).get());
  if (tab === 'settings') return settings();
  const [scanCount, consultCount] = await Promise.all([scans.count().get(), collection('consultations').count().get()]);
  return { scans: scanCount.data().count, consultations: consultCount.data().count };
}

export async function setConsultStatus(id, status) {
  if (!/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(id)) return false;
  const ref = doc('consultations', id);
  return firestore().runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) return false;
    tx.update(ref, { status });
    return true;
  });
}

export async function claimScan() {
  return firestore().runTransaction(async (tx) => {
    const now = Date.now();
    const waiting = await tx.get(collection('scans').where('queuedAt', '<=', now).orderBy('queuedAt').limit(1));
    const entry = waiting.docs[0];
    if (!entry) return null;
    const row = entry.data();
    if (row.expires <= now) { tx.delete(entry.ref); return null; }
    const lease = randomUUID();
    tx.update(entry.ref, {
      queuedAt: FieldValue.delete(), state: 'running', lease, leaseUntil: now + 120000,
    });
    return { ...row, lease };
  });
}

export async function updateScan(row, change) {
  const ref = doc('scans', row.id);
  return firestore().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.state !== 'running' || current.lease !== row.lease) return false;
    const done = ['completed', 'failed'].includes(change.state);
    tx.update(ref, done ? { ...change, lease: FieldValue.delete(), leaseUntil: FieldValue.delete() } : change);
    return true;
  });
}

export async function claimDelivery(kind) {
  const field = dueField[kind];
  return firestore().runTransaction(async (tx) => {
    const now = Date.now();
    const due = await tx.get(collection('deliveries').where(field, '<=', now).orderBy(field).limit(1));
    const entry = due.docs[0];
    if (!entry) return null;
    const row = entry.data();
    if (row.deleteAt.toMillis() <= now || row.attempts >= 5) {
      tx.update(entry.ref, { [field]: FieldValue.delete(), state: 'failed', body: {} });
      return null;
    }
    const attempts = row.attempts + 1;
    tx.update(entry.ref, { [field]: now + 60000, attempts });
    return { ...row, attempts };
  });
}

export async function finishDelivery(row, success) {
  const ref = doc('deliveries', row.id);
  return firestore().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.attempts !== row.attempts || current.state !== 'pending') return;
    if (!success && row.attempts < 5) return;
    tx.update(ref, { [dueField[row.kind]]: FieldValue.delete(), state: success ? 'sent' : 'failed', body: {} });
  });
}

export async function claimRequest(site, scheme, method = 'GET') {
  const ref = doc('limits', 'request-' + hash(site));
  return firestore().runTransaction(async (tx) => {
    const record = (await tx.get(ref)).data();
    const now = Date.now();
    if (record?.until > now) return { wait: record.until - now };
    const lease = randomUUID();
    tx.set(ref, { until: now + 30000, lease, deleteAt: new Date(now + day) });
    tx.create(doc('requests', lease), { at: now, site, scheme, method, deleteAt: new Date(now + 90 * day) });
    return { lease };
  });
}

export async function releaseRequest(site, lease) {
  const ref = doc('limits', 'request-' + hash(site));
  await firestore().runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.lease === lease) tx.update(ref, { until: Date.now() + 1000 });
  });
}

export async function cleanup() {
  const now = Date.now();
  const [expired, stalled] = await Promise.all([
    collection('scans').where('expires', '<=', now).limit(100).get(),
    collection('scans').where('leaseUntil', '<=', now).limit(100).get(),
  ]);
  if (!expired.empty) {
    const batch = firestore().batch();
    expired.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  await Promise.all(stalled.docs.map((entry) => updateScan(entry.data(), {
    state: 'failed', result: null, error: '診断の処理が中断されました。',
  })));
}

export async function cleanupAuxiliary() {
  const expired = await Promise.all(
    ['limits', 'history', 'requests', 'cache', 'receipts', 'deliveries'].map((name) =>
      collection(name).where('deleteAt', '<=', new Date()).limit(75).get()),
  );
  const batch = firestore().batch();
  for (const snapshot of expired) {
    for (const entry of snapshot.docs) {
      batch.delete(entry.ref, { lastUpdateTime: entry.updateTime });
    }
  }
  if (expired.some((snapshot) => !snapshot.empty)) await batch.commit();
}
