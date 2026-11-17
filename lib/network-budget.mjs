import { setTimeout as delay } from 'node:timers/promises';
import { claimRequest, releaseRequest } from './db.mjs';
import { publicAddress } from './target.mjs';

export async function withRequestLimit(url, deadline, method, run) {
  const address = await publicAddress(url.hostname);
  const site = url.hostname.replace(/^www\./, '');
  while (Date.now() < deadline) {
    const slot = await claimRequest(site, url.protocol, method);
    if (slot.lease) {
      try {
        const timeout = Math.min(deadline - Date.now(), 4500);
        if (timeout <= 0) break;
        return await run(address, timeout);
      } finally {
        await releaseRequest(site, slot.lease);
      }
    }
    await delay(Math.min(slot.wait + 5, 1000, Math.max(0, deadline - Date.now())));
  }
  throw new Error('診断時間の上限に達しました。');
}
