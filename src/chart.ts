// Hand-drawn SVG charts: row sparklines and a candle chart with volume and a crosshair.
import { blockTime, candles, SUPPLY, tradeCandles, type Candle, type Trade } from './lib/pons.ts';

const W = 96, H = 26;
export function sparkline(prices: number[]) {
  const p = prices.filter((x) => x > 0);
  if (p.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="spark-flat"/></svg>`;
  const pts = p.length > 48 ? p.filter((_, i) => i % Math.ceil(p.length / 48) === 0 || i === p.length - 1) : p;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || hi || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 2 - ((v - lo) / span) * (H - 4)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const up = pts[pts.length - 1] >= pts[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${W} ${H}L0 ${H}Z" class="spark-fill"/><path d="${d}" class="spark-line"/></svg>`;
}

export const usdShort = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
};
export const ethShort = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n > 0 ? n.toFixed(4) : '0');

const BUCKETS = [5, 15, 30, 60, 300, 900, 3600, 4 * 3600, 86400];
const bucketLabel = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${s / 60}m` : s < 86400 ? `${s / 3600}h` : '1d');

type Opts = { usd: number | null; quote: string; intro?: boolean; marks?: { block: number; label: string }[] };
let mode: 'trades' | 'time' = 'trades';

/** Candles over all trades, sized so the whole history fits in ~70 candles. Returns a cleanup. */
export function mountChart(el: HTMLElement, trades: Trade[], opts: Opts): () => void {
  const priced = trades.filter((t) => t.price > 0);
  if (priced.length < 2) {
    el.innerHTML = `<div class="chart-empty">${priced.length ? 'One trade so far. The chart starts with the second.' : 'No trades yet.'}</div>`;
    return () => {};
  }
  const span = blockTime(priced[priced.length - 1].block) - blockTime(priced[0].block);
  const bucket = BUCKETS.find((b) => span / b <= 72) ?? 86400;
  const per = Math.max(1, Math.ceil(priced.length / 64));
  let cs: Candle[] = [];
  const mcap = (p: number) => (opts.usd ? p * SUPPLY * opts.usd : p * SUPPLY);
  const unit = opts.usd ? usdShort : (n: number) => `${ethShort(n)} ${opts.quote}`;
  const label = () => (mode === 'trades' ? `${per === 1 ? 'one trade' : `${per} trades`} per candle` : `${bucketLabel(bucket)} candles`);

  el.innerHTML = `<div class="chart${opts.intro ? ' play' : ''}"><div class="chart-modes" role="tablist"><button data-mode="trades">Trades</button><button data-mode="time">Time</button></div><svg role="img"></svg>
    <div class="chart-tip" hidden></div><div class="chart-meta"><span data-cmeta></span><span>${priced.length.toLocaleString()} trades</span></div></div>`;
  const svg = el.querySelector('svg')!, tip = el.querySelector<HTMLElement>('.chart-tip')!;
  let w = 0;

  const draw = () => {
    cs = mode === 'trades' ? tradeCandles(priced, per) : candles(priced, bucket);
    el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    el.querySelector('[data-cmeta]')!.textContent = `${label()} · market cap${opts.usd ? ' in USD' : ` in ${opts.quote}`}`;
    svg.setAttribute('aria-label', `Market cap candles, ${label()}`);
    w = el.clientWidth;
    const h = Math.max(220, Math.min(360, w * 0.46));
    const padR = 64, padB = 22, volH = h * 0.2, top = 10;
    const plotH = h - padB - volH - top - 8;
    const lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    const bottom = Math.max(0, lo - pad), ceil = hi + pad;
    const y = (v: number) => top + (1 - (v - bottom) / (ceil - bottom)) * plotH;
    const step = (w - padR) / cs.length, bw = Math.max(1.5, Math.min(14, step * 0.64));
    const vmax = Math.max(...cs.map((c) => c.buy + c.sell)) || 1;
    const x = (i: number) => i * step + step / 2;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const v = bottom + (ceil - bottom) * (1 - k), yy = top + k * plotH;
      return `<line x1="0" x2="${w - padR}" y1="${yy}" y2="${yy}" class="g"/><text x="${w - padR + 8}" y="${yy + 4}" class="ax">${unit(mcap(v))}</text>`;
    }).join('');
    const times = [0, Math.floor(cs.length / 2), cs.length - 1].map((i) => `<text x="${Math.min(w - padR - 40, Math.max(0, x(i) - 20))}" y="${h - 6}" class="ax">${new Date(cs[i].t * 1000).toLocaleTimeString([], span > 86400 ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' })}</text>`).join('');
    const bodies = cs.map((c, i) => {
      const up = c.c >= c.o, cls = up ? 'up' : 'down';
      const yo = y(c.o), yc = y(c.c);
      const vb = ((c.buy + c.sell) / vmax) * volH, vy = h - padB - vb;
      return `<g class="cd ${cls}" style="--i:${i}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(c.h)}" y2="${y(c.l)}"/><rect x="${x(i) - bw / 2}" y="${Math.min(yo, yc)}" width="${bw}" height="${Math.max(1, Math.abs(yc - yo))}" rx="1"/><rect class="v" x="${x(i) - bw / 2}" y="${vy}" width="${bw}" height="${Math.max(0.5, vb)}"/></g>`;
    }).join('');
    const marks = (opts.marks ?? []).map((m) => {
      const t = blockTime(m.block), next = cs.findIndex((c) => c.t > t), i = mode === 'trades' ? (next < 0 ? cs.length - 1 : Math.max(0, next - 1)) : cs.findIndex((c) => c.t + bucket > t);
      return i < 0 ? '' : `<g class="mark"><line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${h - padB}"/><text x="${x(i) + 6}" y="${top + 12}">${m.label}</text></g>`;
    }).join('');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.height = `${h}px`;
    svg.innerHTML = `${grid}${marks}<g class="cds">${bodies}</g>${times}<line class="cross" x1="0" x2="0" y1="${top}" y2="${h - padB}" visibility="hidden"/><rect class="hit" x="0" y="0" width="${w - padR}" height="${h}" fill="transparent"/>`;
    return { step, x, y };
  };
  let geo = draw();

  const onMove = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(cs.length - 1, Math.floor((e.clientX - r.left) / geo.step)));
    const c: Candle = cs[i];
    const cross = svg.querySelector<SVGLineElement>('.cross')!;
    cross.setAttribute('x1', String(geo.x(i)));
    cross.setAttribute('x2', String(geo.x(i)));
    cross.setAttribute('visibility', 'visible');
    const chg = ((c.c / c.o - 1) * 100);
    tip.innerHTML = `<b>${new Date(c.t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: mode === 'trades' || bucket < 60 ? '2-digit' : undefined })}</b>
      <span>O ${unit(mcap(c.o))}</span><span>H ${unit(mcap(c.h))}</span><span>L ${unit(mcap(c.l))}</span><span>C ${unit(mcap(c.c))} <i class="${chg >= 0 ? 'lime' : 'red'}">${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</i></span>
      <span class="lime">Buys ${opts.usd ? usdShort(c.buy * opts.usd) : `${ethShort(c.buy)} ${opts.quote}`}</span><span class="red">Sells ${opts.usd ? usdShort(c.sell * opts.usd) : `${ethShort(c.sell)} ${opts.quote}`}</span>`;
    tip.hidden = false;
    const left = geo.x(i) + 14;
    tip.style.transform = `translate(${left + tip.offsetWidth > w - 64 ? geo.x(i) - tip.offsetWidth - 14 : left}px, 36px)`;
  };
  const onLeave = () => { tip.hidden = true; svg.querySelector('.cross')?.setAttribute('visibility', 'hidden'); };
  el.querySelector('.chart-modes')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode as typeof mode;
    el.querySelector('.chart')?.classList.add('play');
    geo = draw();
  });
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
  const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 4) { el.querySelector('.chart')?.classList.remove('play'); geo = draw(); } });
  ro.observe(el);
  return () => { ro.disconnect(); };
}

/** Area line of cumulative values, used for small stat tiles. */
export function areaLine(values: number[], w = 160, h = 36) {
  if (values.length < 2) return '';
  const hi = Math.max(...values) || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * w, h - 1 - (v / hi) * (h - 3)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return `<svg class="tile-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${w} ${h}L0 ${h}Z" class="spark-fill"/><path d="${d}" class="spark-line"/></svg>`;
}
