// Robinhood Chain block height for every [data-block] element on the page.
// Re-read every few seconds; between reads it advances at the rate observed across reads.
import { client, retry } from './chain.ts';

let base = 0, baseAt = 0, rate = 0, shown = 0, started = false;

// never runs backwards on screen; each poll re-anchors the estimate
export function blockNow() {
  if (!base) return 0;
  shown = Math.max(shown, Math.floor(base + rate * (performance.now() - baseAt)));
  return shown;
}

export const blockText = () => (base ? blockNow().toLocaleString('en-US') : '—');

/** A block number already read elsewhere (a multicall) can start the counter before the first poll lands. */
export function seedBlock(block: number) {
  if (!base && block) { base = block; baseAt = performance.now(); }
}

export function startBlockTicker() {
  if (started) return;
  started = true;
  const poll = async () => {
    if (!document.hidden || !base) {
      const b = Number(await retry(() => client.getBlockNumber()).catch(() => 0n));
      const now = performance.now();
      if (b && base && b > base) rate = (b - base) / (now - baseAt);
      if (b) { base = b; baseAt = now; }
    }
    setTimeout(poll, 6000);
  };
  poll();
  setInterval(() => {
    if (!base) return;
    const t = blockText();
    document.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => { if (el.textContent !== t) el.textContent = t; });
  }, 150);
}
