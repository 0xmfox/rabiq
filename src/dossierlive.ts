// The market block of a dossier: every trade since launch as candles, and the deployer's launches as a constellation.
import { ethShort, mountChart, usdShort } from './chart.ts';
import { client, EXPLORER } from './lib/chain.ts';
import { desk } from './lib/desk.ts';
import { esc } from './lib/md.ts';
import {
  blockTime, calibrate, curveTrades, FIRST_BLOCK, launchRecords, loadQuotes, poolId, poolTrades, quoteOf, SUPPLY,
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
      <div class="dlive-const" data-dconstwrap><div class="dlive-head"><span class="label"><span>Deployer</span>${c.deployer ? short(c.deployer) : '—'}</span><span class="muted small">${s?.launchTotal ? `${fmt(s.launchTotal)} launch${s.launchTotal === 1 ? '' : 'es'}` : ''}</span></div><div data-dconst>${constellationHTML(ca, s, cache.get(ca), intro)}</div></div>
    </div>
    <div data-dflow>${flowHTML(ca, s)}</div>
  </section>`;
}

// ---------- trading analytics: everything below is derived from the trades already loaded for the chart ----------
type Wallet = { who: string; buy: number; sell: number; n: number; first: number };

function wallets(trades: Trade[]): Wallet[] {
  const m = new Map<string, Wallet>();
  for (const t of trades) {
    let w = m.get(t.who);
    if (!w) m.set(t.who, (w = { who: t.who, buy: 0, sell: 0, n: 0, first: t.block }));
    w[t.side] += t.amt;
    w.n++;
  }
  return [...m.values()].sort((a, b) => b.buy + b.sell - (a.buy + a.sell));
}

function flowHTML(ca: string, s: Snapshot | undefined, intro = false) {
  const live = cache.get(ca);
  if (!live || live.loading || live.failed || !live.trades.length) return '';
  const trades = live.trades, q = live.quote, usd = q?.usd ?? null, sym = esc(q?.symbol ?? 'ETH');
  const money = (v: number) => (usd ? usdShort(v * usd) : `${ethShort(v)} ${sym}`);
  // v4 pool swaps name the router as sender, not the trader: wallet figures use curve trades only
  const walletTrades = trades.filter((t) => t.curve.length <= 42);
  const list = wallets(walletTrades);
  const walletVol = list.reduce((a, w) => a + w.buy + w.sell, 0) || 1;
  const buyVol = trades.filter((t) => t.side === 'buy').reduce((a, t) => a + t.amt, 0);
  const sellVol = trades.filter((t) => t.side === 'sell').reduce((a, t) => a + t.amt, 0);
  const total = buyVol + sellVol || 1;
  const top10 = list.slice(0, 10).reduce((a, w) => a + w.buy + w.sell, 0) / walletVol;
  const largest = trades.reduce((a, t) => Math.max(a, t.amt), 0);
  const buyers = list.filter((w) => w.buy > 0).length, sellers = list.filter((w) => w.sell > 0).length;
  const dep = s?.chain?.deployer ?? '', fee = s?.chain?.feeRecipient ?? '';
  const depW = list.find((w) => w.who === dep);
  const early = new Set(walletTrades.slice(0, 20).map((t) => t.who));
  const earlyOut = [...early].filter((w) => { const x = list.find((y) => y.who === w)!; return x.sell >= x.buy * 0.9 && x.sell > 0; }).length;
  const net = buyVol - sellVol;
  const cell = (label: string, value: string, sub = '') => `<div><dt>${label}</dt><dd>${value}</dd>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const tag = (w: string) => (w === dep ? '<em class="wtag dep">Deployer</em>' : w === fee ? '<em class="wtag">Fee recipient</em>' : early.has(w) ? '<em class="wtag early">Early</em>' : '');

  return `<div class="flow${intro ? ' play' : ''}">
    <div class="dlive-head flow-head"><span class="label"><span>Flow</span>Who trades it</span><span class="muted small">${fmt(trades.length)} trades · ${fmt(list.length)} wallets${live.poolFrom ? ' · wallets from curve trades' : ''}</span></div>
    <div class="dlive-stats"><dl>
      ${cell('Bought', `<span class="lime">${money(buyVol)}</span>`, `${((buyVol / total) * 100).toFixed(0)}% of volume`)}
      ${cell('Sold', `<span class="red">${money(sellVol)}</span>`, `net ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`)}
      ${cell('Buyers · sellers', `${fmt(buyers)} <span class="dim">/</span> ${fmt(sellers)}`, `avg trade ${money(total / trades.length)}`)}
      ${cell('Largest trade', money(largest), `${((largest / total) * 100).toFixed(1)}% of volume`)}
      ${cell('Top 10 wallets', `${(top10 * 100).toFixed(0)}%`, 'of all volume')}
      ${cell('Deployer traded', depW ? money(depW.buy + depW.sell) : 'No', depW ? `bought ${money(depW.buy)} · sold ${money(depW.sell)}` : `${earlyOut} of the ${early.size} first wallets exited`)}
    </dl></div>
    <div class="flow-grid">
      <div><div class="dlive-head"><span class="label"><span>Pressure</span>Buys against sells</span><span class="muted small">net flow line</span></div>${pressureSVG(trades)}</div>
      <div><div class="dlive-head"><span class="label"><span>Wallets</span>Map by volume</span><span class="muted small">top ${Math.min(24, list.length)}</span></div>${walletMapSVG(list.slice(0, 24), s, early)}
        <div class="const-legend"><span><i class="self"></i>Net buyer</span><span><i class="sell"></i>Net seller</span><span><i class="dep"></i>Deployer</span><span class="muted">Click opens the wallet</span></div></div>
    </div>
    <div class="dlive-head"><span class="label"><span>Top wallets</span>By volume</span></div>
    <div class="wt-scroll"><table class="wt">
      <thead><tr><th>#</th><th>Wallet</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Net</th><th class="r">Trades</th><th class="r">Share</th></tr></thead>
      <tbody>${list.slice(0, 12).map((w, i) => `<tr>
        <td class="dim">${String(i + 1).padStart(2, '0')}</td>
        <td><a class="mono" href="${EXPLORER}/address/${w.who}" target="_blank" rel="noopener noreferrer">${short(w.who)}</a>${tag(w.who)}</td>
        <td class="r lime">${w.buy ? money(w.buy) : '—'}</td>
        <td class="r red">${w.sell ? money(w.sell) : '—'}</td>
        <td class="r ${w.buy >= w.sell ? 'lime' : 'red'}">${w.buy >= w.sell ? '+' : '−'}${money(Math.abs(w.buy - w.sell))}</td>
        <td class="r">${fmt(w.n)}</td>
        <td class="r"><span class="share" style="--p:${(w.buy + w.sell) / walletVol}"><i></i></span>${(((w.buy + w.sell) / walletVol) * 100).toFixed(1)}%</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

/** Buy volume up, sell volume down per time bucket, with the running net flow drawn across. */
function pressureSVG(trades: Trade[]) {
  const W = 640, H = 220, mid = H / 2, n = Math.min(48, Math.max(8, Math.ceil(trades.length / 6)));
  const t0 = blockTime(trades[0].block), t1 = blockTime(trades[trades.length - 1].block), span = Math.max(1, t1 - t0);
  const b = Array.from({ length: n }, () => ({ buy: 0, sell: 0 }));
  for (const t of trades) b[Math.min(n - 1, Math.floor(((blockTime(t.block) - t0) / span) * n))][t.side] += t.amt;
  const max = Math.max(...b.map((x) => Math.max(x.buy, x.sell)), 1e-18);
  let run = 0;
  const nets = b.map((x) => (run += x.buy - x.sell));
  const nmax = Math.max(...nets.map(Math.abs), 1e-18);
  const bw = W / n;
  const bars = b.map((x, i) => {
    const hb = (x.buy / max) * (mid - 12), hs = (x.sell / max) * (mid - 12);
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(mid - hb).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${hb.toFixed(1)}" class="pb" style="--i:${i}"/><rect x="${(i * bw + 1).toFixed(1)}" y="${mid}" width="${(bw - 2).toFixed(1)}" height="${hs.toFixed(1)}" class="ps" style="--i:${i}"/>`;
  }).join('');
  const line = nets.map((v, i) => `${i ? 'L' : 'M'}${(i * bw + bw / 2).toFixed(1)} ${(mid - (v / nmax) * (mid - 12)).toFixed(1)}`).join(' ');
  const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<svg class="pressure" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Buy and sell volume over time">
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="pmid"/>${bars}
    <path d="${line}" class="pnet" pathLength="1"/>
    <text x="0" y="${H + 14}" class="pt">${clock(t0)}</text><text x="${W}" y="${H + 14}" class="pt" text-anchor="end">${clock(t1)}</text>
    <text x="4" y="14" class="pt">Buys</text><text x="4" y="${H - 4}" class="pt">Sells</text>
  </svg>`;
}

/** Wallets as bubbles around the token: size is volume, colour is which side they ended on. */
function walletMapSVG(list: Wallet[], s: Snapshot | undefined, early: Set<string>) {
  const W = 360, H = 300, cx = W / 2, cy = H / 2;
  const maxV = Math.max(...list.map((w) => w.buy + w.sell), 1e-18);
  const dep = s?.chain?.deployer ?? '';
  const nodes = list.map((w, i) => {
    const ring = i < 8 ? 0 : 1, inRing = ring ? Math.max(1, list.length - 8) : Math.min(8, list.length), idx = ring ? i - 8 : i;
    const a = (idx / inRing) * Math.PI * 2 - Math.PI / 2 + ring * 0.2;
    const r = ring ? 124 : 72;
    return { w, x: cx + Math.cos(a) * r * 1.2, y: cy + Math.sin(a) * r * 0.92, rad: 3.5 + 13 * Math.sqrt((w.buy + w.sell) / maxV), i };
  });
  return `<svg class="wmap const" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wallets by volume">
    ${nodes.map((n) => `<line x1="${cx}" y1="${cy}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}" class="const-edge" style="stroke-width:${(0.6 + 2.4 * ((n.w.buy + n.w.sell) / maxV)).toFixed(2)}"/>`).join('')}
    <g class="const-core"><circle cx="${cx}" cy="${cy}" r="20"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(ticker(s?.chain?.symbol ?? '').slice(0, 6))}</text></g>
    ${nodes.map((n) => `<a href="${EXPLORER}/address/${n.w.who}" target="_blank" rel="noopener noreferrer"><g class="wnode ${n.w.buy >= n.w.sell ? 'buy' : 'sell'}${n.w.who === dep ? ' dep' : ''}" style="--i:${n.i}" transform="translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})"><circle r="${n.rad.toFixed(1)}"/><title>${short(n.w.who)}${n.w.who === dep ? ' · deployer' : early.has(n.w.who) ? ' · early buyer' : ''} · ${fmt(n.w.n)} trades</title>${n.i < 5 ? `<text y="${(n.rad + 12).toFixed(1)}" text-anchor="middle">${n.w.who === dep ? 'DEP' : n.w.who.slice(2, 6)}</text>` : ''}</g></a>`).join('')}
  </svg>`;
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
    // a curve only emits after its launch, so scanning its address from the first Pons V2 block is still one
    // request and needs no launch-block lookup; the desk's known launch block just narrows it
    live.launchBlock ??= desk.tokens.get(ca.toLowerCase())?.launchBlock ?? null;
    const from = live.launchBlock != null ? BigInt(live.launchBlock) : FIRST_BLOCK;
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
  el.querySelector('[data-dflow]')!.innerHTML = flowHTML(ca, s, introChart);
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
