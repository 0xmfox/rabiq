// Live Pons V2 market: every launch and every curve trade in a rolling window, polled from the public RPC.
import { parseAbiItem, type Address } from 'viem';
import { client, launchEvent, PONS_V2_FACTORY } from './chain.ts';
import { noteBlock } from './live.ts';
import {
  allTrades, calibrate, curveStates, curveTokens, deployerLaunches, ETH_QUOTE, launchBlocks, launchRecords, loadQuotes, logsSplit, normTrade, quoteOf,
  type Curve, type Trade,
} from './pons.ts';

export const WINDOW = 6_000; // blocks, ~10 minutes at ~0.1 s
const POLL_MS = 5_000;
const gradEvent = parseAbiItem('event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)');

export type Tok = {
  token: string;
  curve: string;
  deployer: string;
  symbol: string;
  name: string;
  phase: number;
  quote: string; // quote asset address, zero for ETH
  threshold: number | null; // raw graduation threshold from the launch record
  dec: number; // decimals the trades are normalized with
  launchBlock: number | null;
  earlier: number | null; // deployer launches before this one
  total: number | null; // all launches by the deployer
  state: Curve | null;
  trades: Trade[]; // in the window, oldest first
  seenAt: number; // ms, when the desk first saw it
};

export type Desk = {
  head: number;
  tokens: Map<string, Tok>;
  launches: { token: string; block: number }[]; // in the window
  tape: (Trade & { token: string })[]; // newest first
  graduations: { token: string; block: number; symbol?: string }[]; // last ~24h
  ready: boolean;
  loadedAt: number;
};

export const desk: Desk = { head: 0, tokens: new Map(), launches: [], tape: [], graduations: [], ready: false, loadedAt: 0 };
const byCurve = new Map<string, string>();
const deployers = new Map<string, number[]>(); // deployer -> launch blocks, oldest first
const pendingCurves = new Set<string>();
const listeners = new Set<() => void>();
let last = 0n;
let running = false;
let timer = 0;

export function onDesk(fn: () => void) {
  listeners.add(fn);
  start();
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

function start() {
  if (running) return;
  running = true;
  const loop = async () => {
    if (!document.hidden || !desk.ready) {
      try { await poll(); } catch { /* the next tick retries */ }
    }
    timer = window.setTimeout(loop, POLL_MS);
  };
  loop();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && desk.ready) { clearTimeout(timer); loop(); }
  });
}

function addTok(token: string, curve: string, deployer: string, block: number | null, quote: string) {
  let t = desk.tokens.get(token);
  if (!t) {
    t = { token, curve, deployer, symbol: '', name: '', phase: 0, quote, threshold: null, dec: quoteOf(quote)?.decimals ?? 18, launchBlock: block, earlier: null, total: null, state: null, trades: [], seenAt: Date.now() };
    desk.tokens.set(token, t);
    byCurve.set(curve, token);
  }
  if (block != null) t.launchBlock = block;
  return t;
}

async function poll() {
  const head = await client.getBlockNumber();
  if (head <= last) return;
  noteBlock(Number(head));
  const first = !last;
  const from = first ? head - BigInt(WINDOW) : last + 1n;
  if (first) await calibrate(head).catch(() => null);

  // launches and trades since the previous poll
  const [launchLogs, trades] = await Promise.all([
    logsSplit((a, b) => client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, fromBlock: a, toBlock: b }), from, head),
    allTrades(from, head),
  ]);
  const fresh: Tok[] = [];
  for (const l of launchLogs) {
    const token = String(l.args.token).toLowerCase(), deployer = String(l.args.deployer).toLowerCase(), block = Number(l.blockNumber);
    const t = addTok(token, String(l.args.curve).toLowerCase(), deployer, block, String(l.args.pairToken ?? ETH_QUOTE).toLowerCase());
    fresh.push(t);
    desk.launches.push({ token, block });
    // blocks the desk watched itself extend a deployer's known history
    const known = deployers.get(deployer);
    if (known && !known.includes(block)) known.push(block);
  }
  for (const tr of trades) {
    const token = byCurve.get(tr.curve);
    if (!token) { pendingCurves.add(tr.curve); continue; }
    const t = desk.tokens.get(token)!;
    t.trades.push(normTrade(tr, t.dec));
  }

  // curves trading in the window whose launch is older than the window
  if (pendingCurves.size) {
    const curves = [...pendingCurves].slice(0, 600);
    const map = await curveTokens(curves);
    const recs = await launchRecords([...map.values()]);
    for (const c of curves) {
      pendingCurves.delete(c);
      const token = map.get(c), rec = token ? recs.get(token) : null;
      if (!rec || rec.curve !== c) continue; // same event signature from a contract outside Pons V2
      const t = addTok(token!, c, rec.deployer, null, rec.pairToken);
      t.symbol = rec.symbol; t.name = rec.name; t.phase = rec.phase; t.threshold = rec.threshold;
    }
    for (const tr of trades) {
      const token = byCurve.get(tr.curve);
      const t = token ? desk.tokens.get(token) : null;
      if (t && !t.trades.some((x) => x.block === tr.block && x.i === tr.i)) t.trades.push(normTrade(tr, t.dec));
    }
    for (const t of desk.tokens.values()) t.trades.sort((a, b) => a.block - b.block || a.i - b.i);
  }
  if (fresh.length) {
    const recs = await launchRecords(fresh.map((t) => t.token));
    for (const t of fresh) {
      const r = recs.get(t.token);
      if (r) { t.symbol = r.symbol; t.name = r.name; t.phase = r.phase; t.threshold = r.threshold; }
    }
  }

  // graduations in the same window as everything else above; the fuller day of history backfills after ready (below)
  const grads = await logsSplit((a, b) => client.getLogs({ address: PONS_V2_FACTORY, event: gradEvent, fromBlock: a, toBlock: b }), from, head).catch(() => []);
  for (const g of grads) {
    const token = String(g.args.token).toLowerCase();
    desk.graduations.push({ token, block: Number(g.blockNumber) });
    const t = desk.tokens.get(token);
    if (t) t.phase = 2;
  }
  await nameGraduations();

  // prune the window
  const floor = Number(head) - WINDOW;
  desk.launches = desk.launches.filter((l) => l.block > floor);
  desk.graduations = desk.graduations.filter((g) => g.block > Number(head) - 850_000);
  for (const [k, t] of desk.tokens) {
    t.trades = t.trades.filter((x) => x.block > floor);
    if (!t.trades.length && (t.launchBlock == null || t.launchBlock <= floor)) { desk.tokens.delete(k); byCurve.delete(t.curve); }
  }

  // quote assets: decimals first, then prices; trades normalized as ETH get rescaled once decimals are known
  await loadQuotes([...new Set([...desk.tokens.values()].map((t) => t.quote))]).catch(() => null);
  for (const t of desk.tokens.values()) {
    const dec = quoteOf(t.quote)?.decimals ?? 18;
    if (dec !== t.dec) { t.dec = dec; t.trades.forEach((x) => normTrade(x, dec)); }
  }

  // curve state for everything that moved
  const moved = [...new Set([...fresh.map((t) => t.curve), ...trades.map((t) => t.curve)])].filter((c) => byCurve.has(c));
  // swept curves hold nothing worth reading
  const read = (first ? [...desk.tokens.values()].map((t) => t.curve) : moved).filter((c) => desk.tokens.get(byCurve.get(c)!)?.phase === 0);
  const tokOf = (c: string) => desk.tokens.get(byCurve.get(c)!);
  const states = await curveStates(read, (c) => tokOf(c)?.dec ?? 18, (c) => tokOf(c)?.threshold ?? null);
  for (const [c, s] of states) {
    const t = desk.tokens.get(byCurve.get(c)!);
    if (t) t.state = s;
  }

  desk.tape = [...desk.tokens.values()].flatMap((t) => t.trades.map((x) => ({ ...x, token: t.token })))
    .sort((a, b) => b.block - a.block || b.i - a.i).slice(0, 80);
  desk.head = Number(head);
  last = head;
  desk.ready = true;
  desk.loadedAt = Date.now();
  emit();
  enrich(head);
  if (first) backfillGraduations(head);
}

async function nameGraduations() {
  const unnamed = desk.graduations.filter((g) => g.symbol === undefined);
  if (!unnamed.length) return;
  const recs = await launchRecords(unnamed.map((g) => g.token)).catch(() => new Map());
  for (const g of unnamed) g.symbol = recs.get(g.token)?.symbol ?? desk.tokens.get(g.token)?.symbol ?? '';
}

let backfilling = false;
/** A day of graduation history, once. Runs after the desk is already ready, so the first paint never waits on it. */
async function backfillGraduations(head: bigint) {
  if (backfilling) return;
  backfilling = true;
  try {
    const grads = await logsSplit((a, b) => client.getLogs({ address: PONS_V2_FACTORY, event: gradEvent, fromBlock: a, toBlock: b }), head - 850_000n, head).catch(() => []);
    for (const g of grads) {
      const token = String(g.args.token).toLowerCase();
      if (desk.graduations.some((x) => x.token === token && x.block === Number(g.blockNumber))) continue;
      desk.graduations.push({ token, block: Number(g.blockNumber) });
      const t = desk.tokens.get(token);
      if (t) t.phase = 2;
    }
    await nameGraduations();
    desk.graduations = desk.graduations.filter((g) => g.block > Number(head) - 850_000);
    emit();
  } finally {
    backfilling = false;
  }
}

let enriching = false;
/** Deployer history and launch blocks, for the most active tokens first; slow, so it runs after the first paint. */
async function enrich(head: bigint) {
  if (enriching) return;
  enriching = true;
  try {
    // hot tokens first, then every launch in the window, so the repeat share covers them all over a few polls
    const ranked = rank('hot').slice(0, 60).concat(rank('new'));
    const needBlock = [...new Set(ranked.filter((t) => t.launchBlock == null).map((t) => t.token))].slice(0, 60);
    if (needBlock.length) {
      const blocks = await launchBlocks(needBlock, head);
      for (const [token, b] of blocks) { const t = desk.tokens.get(token); if (t) t.launchBlock = b.block; }
    }
    const needDep = [...new Set(ranked.filter((t) => !deployers.has(t.deployer)).map((t) => t.deployer))].slice(0, 40);
    if (needDep.length) {
      const hist = await deployerLaunches(needDep, head);
      for (const [d, list] of hist) deployers.set(d, list.map((x) => x.block));
    }
    let changed = false;
    for (const t of desk.tokens.values()) {
      const list = deployers.get(t.deployer);
      if (!list || t.launchBlock == null) continue;
      const earlier = list.filter((b) => b < t.launchBlock!).length;
      if (earlier !== t.earlier || list.length !== t.total) { t.earlier = earlier; t.total = list.length; changed = true; }
    }
    if (changed || needBlock.length) emit();
  } catch { /* throttled: the next poll tries again */ } finally {
    enriching = false;
  }
}

// ---------- derived ----------
export const usdPer = (t: Tok) => quoteOf(t.quote)?.usd ?? null;
export const quoteSym = (t: Tok) => quoteOf(t.quote)?.symbol ?? '?';
/** Volume in dollars; 0 when the quote asset has no price. */
export const vol = (t: Tok) => t.trades.reduce((s, x) => s + x.amt, 0) * (usdPer(t) ?? 0);
export const mcap = (t: Tok) => { const u = usdPer(t); return u == null ? null : priceOf(t) * 1_000_000_000 * u; };
export const buys = (t: Tok) => t.trades.filter((x) => x.side === 'buy').length;
export const traders = (t: Tok) => new Set(t.trades.map((x) => x.who)).size;
// a swept curve holds no reserves, so its last trade is the last curve price
export const priceOf = (t: Tok) => (t.phase === 0 && t.state?.priceEth) || t.trades[t.trades.length - 1]?.price || t.state?.priceEth || 0;
export function change(t: Tok) {
  const p0 = t.trades[0]?.price, p1 = priceOf(t);
  return p0 && p1 ? (p1 / p0 - 1) * 100 : null;
}

export type Sort = 'hot' | 'new' | 'near' | 'repeat';
export function rank(sort: Sort): Tok[] {
  const all = [...desk.tokens.values()].filter((t) => t.symbol);
  if (sort === 'new') return all.filter((t) => t.launchBlock != null && t.launchBlock > desk.head - WINDOW).sort((a, b) => (b.launchBlock ?? 0) - (a.launchBlock ?? 0));
  if (sort === 'near') return all.filter((t) => t.phase === 0 && t.state && t.state.progress < 1 && t.state.raisedEth > 0).sort((a, b) => b.state!.progress - a.state!.progress);
  if (sort === 'repeat') return all.filter((t) => (t.earlier ?? 0) > 0).sort((a, b) => vol(b) - vol(a));
  return all.sort((a, b) => vol(b) - vol(a) || b.trades.length - a.trades.length);
}

export function stats() {
  const all = [...desk.tokens.values()];
  const trades = all.flatMap((t) => t.trades);
  const inWindow = desk.launches.map((l) => desk.tokens.get(l.token)).filter((t): t is Tok => !!t);
  const counted = inWindow.filter((t) => t.earlier != null);
  return {
    launches: desk.launches.length,
    trades: trades.length,
    volumeUsd: all.reduce((s, t) => s + vol(t), 0),
    volumeEth: all.filter((t) => t.quote === ETH_QUOTE).reduce((s, t) => s + t.trades.reduce((a, x) => a + x.amt, 0), 0),
    ethShare: all.length ? all.filter((t) => t.quote === ETH_QUOTE).length / all.length : 1,
    traders: new Set(trades.map((x) => x.who)).size,
    tokensTraded: all.filter((t) => t.trades.length).length,
    graduations: desk.graduations.length,
    repeatShare: counted.length >= 10 ? (counted.filter((t) => t.earlier! > 0).length / counted.length) * 100 : null,
    repeatCounted: counted.length,
  };
}

export const curveAddress = (token: string) => desk.tokens.get(token)?.curve as Address | undefined;
