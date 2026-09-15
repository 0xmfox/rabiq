// The market block of a dossier: every trade since launch as candles, and the deployer's launches as a constellation.
import { ethShort, mountChart, usdShort } from './chart.ts';
import { client } from './lib/chain.ts';
import { desk } from './lib/desk.ts';
import { esc } from './lib/md.ts';
import {
  calibrate, curveTrades, launchBlocks, launchRecords, loadQuotes, poolId, poolTrades, quoteOf, SUPPLY,
  type Quote, type Trade,
} from './lib/pons.ts';
import { short, ticker, type Snapshot } from './lib/sources.ts';

type Live = { trades: Trade[]; poolFrom: number | null; quote: Quote | null; phases: Map<string, number>; launchBlock: number | null; loading: boolean; failed: boolean; at: number };
const cache = new Map<string, Live>();
const fmt = (n: number) => n.toLocaleString('en-US');

export function dossierLiveHTML(ca: string, s: Snapshot | undefined, intro: boolean) {
  const c = s?.chain;
  if (!c?.launchpad) return '';
  return `<section class="dlive${intro ? ' play' : ''}" data-dlive="${ca}">
    <div class="dlive-stats" data-dstats>${statsHTML(ca, s)}</div>
    <div class="dlive-grid">
      <div class="dlive-chart"><div class="dlive-head"><span class="label"><span>Chart</span>Every trade since launch</span><span class="muted small" data-dnote></span></div><div data-dchart><div class="chart-empty"><span class="spin"></span> Reading every trade since launch</div></div></div>
      <div class="dlive-const"><div class="dlive-head"><span class="label"><span>Deployer</span>${c.deployer ? short(c.deployer) : '—'}</span><span class="muted small">${s?.launchTotal ? `${fmt(s.launchTotal)} launches · last 2 days` : ''}</span></div><div data-dconst>${constellationHTML(ca, s, cache.get(ca), intro)}</div></div>
    </div>
  </section>`;
}

function statsHTML(ca: string, s: Snapshot | undefined) {
  const live = cache.get(ca), m = s?.market, cv = s?.curve;
  const trades = live && !live.loading ? live.trades : [];
  const usd = live?.quote?.usd ?? null, sym = live?.quote?.symbol ?? cv?.quote ?? 'ETH';
  const ath = trades.reduce((a, t) => Math.max(a, t.price), 0);
  const last = trades[trades.length - 1]?.price ?? 0;
  const buys = trades.filter((t) => t.side === 'buy').length;
  const wallets = new Set(trades.map((t) => t.who)).size;
  const vol = trades.reduce((a, t) => a + t.amt, 0);
  const cell = (label: string, value: string, sub = '') => `<div><dt>${label}</dt><dd>${value}</dd>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const wait = live?.loading ? '<span class="skeleton" style="width:60px"></span>' : '—';
  return `<dl>
    ${cell('Market cap', m?.fdv != null ? usdShort(m.fdv) : '—', m?.priceUsd != null ? `$${m.priceUsd.toPrecision(3)} per token` : '')}
    ${cell('All-time high', ath && usd ? usdShort(ath * SUPPLY * usd) : ath ? `${ethShort(ath * SUPPLY)} ${esc(sym)}` : wait, ath && last ? `${((last / ath - 1) * 100).toFixed(1)}% from the high` : '')}
    ${cv && s?.chain?.phase === 'curve' ? cell('Curve', `${(cv.progress * 100).toFixed(1)}%`, `${ethShort(cv.raisedEth)} of ${fmt(cv.thresholdEth)} ${esc(cv.quote ?? 'ETH')}`) : cell('Liquidity', m?.liquidityUsd != null ? usdShort(m.liquidityUsd) : '—', s?.chain?.phase === 'graduated' ? 'Uniswap v4 pool' : '')}
    ${cell('Volume · all time', trades.length ? (usd ? usdShort(vol * usd) : `${ethShort(vol)} ${esc(sym)}`) : wait, m?.volume24h != null ? `${usdShort(m.volume24h)} in 24h` : '')}
    ${cell('Trades', trades.length ? fmt(trades.length) : wait, trades.length ? `<b class="lime">${fmt(buys)}</b> buys · <b class="red">${fmt(trades.length - buys)}</b> sells` : '')}
    ${cell('Wallets', trades.length ? fmt(wallets) : wait, 'bought or sold')}
  </dl>`;
}

const CONST_POS_KEY = 'rabiq.const.v1';
function constPos(deployer: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(CONST_POS_KEY) ?? '{}')[deployer.toLowerCase()] ?? {}; } catch { return {}; }
}
function saveConstPos(deployer: string, pos: Record<string, { x: number; y: number }>) {
  try {
    const all = JSON.parse(localStorage.getItem(CONST_POS_KEY) ?? '{}');
    all[deployer.toLowerCase()] = pos;
    localStorage.setItem(CONST_POS_KEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}

function constellationHTML(ca: string, s: Snapshot | undefined, live: Live | undefined, intro: boolean) {
  const list = s?.launches ?? [];
  if (!list.length) return '<div class="chart-empty">Deployer history loads with the next check.</div>';
  const W = 360, H = 300, cx = W / 2, cy = H / 2;
  const self = ca.toLowerCase();
  const saved = s?.chain?.deployer ? constPos(s.chain.deployer) : {};
  // oldest launches sit on the inner ring, newest outside; drag a node and its spot is remembered per deployer
  const nodes = list.map((l, i) => {
    const p = saved[l.token];
    if (p) return { ...l, x: p.x, y: p.y, i };
    const ring = Math.min(2, Math.floor(i / 14));
    const inRing = list.filter((_, k) => Math.min(2, Math.floor(k / 14)) === ring).length;
    const idx = i - ring * 14;
    const r = 58 + ring * 42;
    const a = (idx / inRing) * Math.PI * 2 - Math.PI / 2 + ring * 0.35;
    return { ...l, x: cx + Math.cos(a) * r * 1.25, y: cy + Math.sin(a) * r, i };
  });
  const phase = (t: string) => live?.phases.get(t);
  return `<svg class="const${intro ? ' play' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens launched by this deployer, drag to rearrange">
    ${nodes.map((n) => `<line data-edge="${n.token}" x1="${cx}" y1="${cy}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}" class="const-edge${n.token === self ? ' self' : ''}" pathLength="1" style="--i:${n.i}"/>`).join('')}
    <g class="const-core"><circle cx="${cx}" cy="${cy}" r="18"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">DEP</text></g>
    ${nodes.map((n) => {
      const p = phase(n.token), cls = [n.token === self ? 'self' : '', p != null && p >= 2 ? 'grad' : ''].join(' ');
      return `<g data-node="${n.token}" data-x="${n.x.toFixed(1)}" data-y="${n.y.toFixed(1)}" class="const-node ${cls}" style="--i:${n.i}" transform="translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})"><circle r="${n.token === self ? 7 : p != null && p >= 2 ? 5 : 3.5}"/><title>${esc(ticker(n.symbol))}${p != null && p >= 2 ? ' · graduated' : ''}</title>${n.token === self || nodes.length <= 12 ? `<text x="11" y="4" class="${n.token === self ? '' : 'dim-label'}">${esc(ticker(n.symbol))}</text>` : ''}</g>`;
    }).join('')}
  </svg>
  <div class="const-legend"><span><i class="self"></i>This token</span><span><i class="grad"></i>Graduated</span><span><i></i>Other launch</span><span class="muted">Drag to rearrange</span>${(s?.launchTotal ?? 0) > list.length ? `<span class="muted">Latest ${list.length} of ${fmt(s!.launchTotal!)}</span>` : ''}</div>`;
}

/** Lets nodes be dragged; position persists per deployer in localStorage. Re-wire after every innerHTML replace. */
function wireConstellation(host: HTMLElement, deployer: string | null | undefined) {
  const svg = host.querySelector<SVGSVGElement>('svg.const');
  if (!svg || !deployer) return;
  const toSvg = (e: PointerEvent) => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse()); return { x: p.x, y: p.y }; };
  let drag: { token: string; node: SVGGElement; edge: SVGLineElement | null; moved: boolean } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    const node = (e.target as Element).closest<SVGGElement>('.const-node');
    if (!node) return;
    drag = { token: node.dataset.node!, node, edge: svg.querySelector(`[data-edge="${node.dataset.node}"]`), moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSvg(e);
    drag.node.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    drag.edge?.setAttribute('x2', p.x.toFixed(1));
    drag.edge?.setAttribute('y2', p.y.toFixed(1));
    drag.moved = true;
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.moved) { location.hash = `#/d/${drag.token}`; drag = null; return; }
    const pos = constPos(deployer);
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(drag.node.getAttribute('transform') ?? '');
    if (m) pos[drag.token] = { x: Number(m[1]), y: Number(m[2]) };
    saveConstPos(deployer, pos);
    drag = null;
  });
}

async function load(ca: string, s: Snapshot, repaint: () => void) {
  const c = s.chain!;
  const live: Live = cache.get(ca) ?? { trades: [], poolFrom: null, quote: null, phases: new Map(), launchBlock: null, loading: true, failed: false, at: 0 };
  live.loading = true;
  cache.set(ca, live);
  try {
    const head = await client.getBlockNumber();
    await calibrate(head).catch(() => null);
    const pair = c.pairToken ?? '0x0000000000000000000000000000000000000000';
    await loadQuotes([pair]);
    live.quote = quoteOf(pair);
    const dec = live.quote?.decimals ?? 18;
    // desk already knows the launch block for anything it has seen live; that's free. Otherwise chase it in the
    // background — it is a bounded log scan — and paint immediately with a recent window instead of waiting on it.
    live.launchBlock ??= desk.tokens.get(ca.toLowerCase())?.launchBlock ?? null;
    if (live.launchBlock == null) {
      // cached for the next load (e.g. a manual refresh); this window's chart already painted with the fallback
      launchBlocks([ca], head).then((m) => { const b = m.get(ca.toLowerCase())?.block; if (b != null) live.launchBlock = b; }).catch(() => null);
    }
    const from = BigInt(live.launchBlock ?? Number(head) - 100_000);
    const curve = c.curve ? await curveTrades(c.curve, from, head, dec) : [];
    let pool: Trade[] = [];
    if (c.phase === 'graduated' && c.poolFee != null && c.tickSpacing != null) {
      const start = BigInt(curve[curve.length - 1]?.block ?? Number(from));
      pool = await poolTrades(poolId(ca, pair, c.poolFee, c.tickSpacing), ca, pair, start, head, dec);
      live.poolFrom = pool[0]?.block ?? null;
    }
    live.trades = [...curve, ...pool];
    if (s.launches?.length) {
      const recs = await launchRecords(s.launches.map((l) => l.token));
      for (const [t, r] of recs) live.phases.set(t, r.phase);
    }
    live.failed = false;
  } catch {
    live.failed = true;
  } finally {
    live.loading = false;
    live.at = Date.now();
    repaint();
  }
}

let current: { ca: string; el: HTMLElement; s: Snapshot; cleanup: () => void } | null = null;

function paint(introChart: boolean) {
  if (!current?.el.isConnected) return;
  const { ca, el, s } = current;
  const live = cache.get(ca);
  el.querySelector('[data-dstats]')!.innerHTML = statsHTML(ca, s);
  const constEl = el.querySelector<HTMLElement>('[data-dconst]')!;
  constEl.innerHTML = constellationHTML(ca, s, live, false);
  wireConstellation(constEl, s.chain?.deployer);
  const chart = el.querySelector<HTMLElement>('[data-dchart]')!;
  if (!live || live.loading) return;
  current.cleanup();
  if (live.failed) { chart.innerHTML = '<div class="chart-empty">The chain is busy. Refresh to try again.</div>'; return; }
  const q = live.quote;
  current.cleanup = mountChart(chart, live.trades, { usd: q?.usd ?? null, quote: q?.symbol ?? 'ETH', intro: introChart, marks: live.poolFrom ? [{ block: live.poolFrom, label: 'Uniswap v4 pool' }] : [] });
  el.querySelector('[data-dnote]')!.textContent = live.poolFrom ? 'Curve trades, then pool swaps' : s.chain?.phase === 'curve' ? 'Bonding curve trades' : 'Curve trades';
}

/** Mounts the market block into a freshly rendered dossier; loads once per open and reuses the cache across renders. */
export function mountDossierLive(root: HTMLElement, s: Snapshot | undefined): void {
  const el = root.querySelector<HTMLElement>('[data-dlive]');
  current?.cleanup();
  if (!el || !s?.chain?.launchpad) { current = null; return; }
  const ca = el.dataset.dlive!;
  current = { ca, el, s, cleanup: () => {} };
  const live = cache.get(ca);
  if (!live || (!live.loading && Date.now() - live.at > 60_000)) load(ca, s, () => current?.ca === ca && paint(true));
  else paint(false);
}
