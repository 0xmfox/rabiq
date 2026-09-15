// Live Pons V2 market: every launch and every curve trade in a rolling window, polled from the public RPC.
import { parseAbiItem, type Address } from 'viem';
import { bgClient, client, launchEvent, PONS_V2_FACTORY } from './chain.ts';
import { noteBlock } from './live.ts';
import {
  calibrate, curveBuy, curveSell, curveStates, curveTokens, deployerLaunches, ETH_QUOTE, launchRecords, loadQuotes, logsSplit, normTrade, quoteOf, toTrade,
  type Curve, type Trade,
} from './pons.ts';

export const WINDOW = 6_000; // blocks, ~10 minutes at ~0.1 s
const POLL_MS = 2_000; // a poll is ~4 requests now; launches land every ~2.5 s
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
const deployers = new Map<string, { token: string; block: number }[]>(); // deployer -> launches, oldest first
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

  // launches, graduations and every curve trade since the previous poll in ONE request: the three event
  // signatures OR'd in topic0. Launch and graduation logs are kept only when the factory emitted them.
  const logs = await logsSplit((a, b) => client.getLogs({ events: [launchEvent, gradEvent, curveBuy, curveSell], fromBlock: a, toBlock: b }), from, head);
  const factory = PONS_V2_FACTORY.toLowerCase();
  const fresh: Tok[] = [];
  const trades: Trade[] = [];
  for (const l of logs as any[]) {
    if (!l.args) continue;
    const fromFactory = String(l.address).toLowerCase() === factory;
    if (l.eventName === 'TokenLaunched' && fromFactory) {
      const token = String(l.args.token).toLowerCase(), deployer = String(l.args.deployer).toLowerCase(), block = Number(l.blockNumber);
      const t = addTok(token, String(l.args.curve).toLowerCase(), deployer, block, String(l.args.pairToken ?? ETH_QUOTE).toLowerCase());
      fresh.push(t);
      desk.launches.push({ token, block });
      // blocks the desk watched itself extend a deployer's known history
      const known = deployers.get(deployer);
      if (known && !known.some((x) => x.token === token)) known.push({ token, block });
    } else if (l.eventName === 'PoolGraduated' && fromFactory) {
      const token = String(l.args.token).toLowerCase();
      desk.graduations.push({ token, block: Number(l.blockNumber) });
      const t = desk.tokens.get(token);
      if (t) t.phase = 2;
    } else if (l.eventName === 'CurveBuy' || l.eventName === 'CurveSell') {
      trades.push(toTrade(l));
    }
  }
  for (const tr of trades) {
    const token = byCurve.get(tr.curve);
    if (!token) { pendingCurves.add(tr.curve); continue; }
    const t = desk.tokens.get(token)!;
    t.trades.push(normTrade(tr, t.dec));
  }
  last = head; // everything in the range is attached; a later failure must not read it twice
  desk.head = Number(head);

  // symbols for new launches (and anything a failed poll left unnamed), graduations in the same multicall
  const unnamed = [...desk.tokens.values()].filter((t) => !t.symbol);
  const ungradNamed = desk.graduations.filter((g) => g.symbol === undefined);
  if (unnamed.length || ungradNamed.length) {
    const recs = await launchRecords([...new Set([...unnamed.map((t) => t.token), ...ungradNamed.map((g) => g.token)])]);
    for (const t of unnamed) {
      const r = recs.get(t.token);
      if (r) { t.symbol = r.symbol; t.name = r.name; t.phase = Math.max(t.phase, r.phase); t.threshold = r.threshold; }
    }
    for (const g of ungradNamed) g.symbol = recs.get(g.token)?.symbol ?? desk.tokens.get(g.token)?.symbol ?? '';
  }

  // curve state for everything that moved, then paint: a launch is on screen one poll after it happens
  await quotesFor(fresh);
  const moved = [...new Set([...fresh.map((t) => t.curve), ...trades.map((t) => t.curve)])].filter((c) => byCurve.has(c));
  await readStates(first ? [...desk.tokens.values()].map((t) => t.curve) : moved);
  prune(head);
  publish();

  // curves trading in the window whose launch is older than the window: resolved after the paint above
  if (pendingCurves.size) {
    const curves = [...pendingCurves].slice(0, 200); // spread over polls: a 600-curve multicall is heavy enough to trip the limit
    const map = await curveTokens(curves);
    const recs = await launchRecords([...map.values()]);
    const added: string[] = [];
    for (const c of curves) {
      pendingCurves.delete(c);
      const token = map.get(c), rec = token ? recs.get(token) : null;
      if (!rec || rec.curve !== c) continue; // same event signature from a contract outside Pons V2
      const t = addTok(token!, c, rec.deployer, null, rec.pairToken);
      t.symbol = rec.symbol; t.name = rec.name; t.phase = rec.phase; t.threshold = rec.threshold;
      added.push(c);
    }
    for (const tr of trades) {
      const token = byCurve.get(tr.curve);
      const t = token ? desk.tokens.get(token) : null;
      if (t && !t.trades.some((x) => x.block === tr.block && x.i === tr.i)) t.trades.push(normTrade(tr, t.dec));
    }
    for (const t of desk.tokens.values()) t.trades.sort((a, b) => a.block - b.block || a.i - b.i);
    await quotesFor([...desk.tokens.values()]);
    await readStates(added);
    publish();
  }

  enrich(head);
  if (first) backfillGraduations(head);
}

/** Quote decimals for new quote assets (trades normalized as ETH get rescaled) and USD prices, at most once a minute. */
async function quotesFor(toks: Tok[]) {
  await loadQuotes([...new Set([ETH_QUOTE, ...toks.map((t) => t.quote)])]).catch(() => null);
  for (const t of desk.tokens.values()) {
    const dec = quoteOf(t.quote)?.decimals ?? 18;
    if (dec !== t.dec) { t.dec = dec; t.trades.forEach((x) => normTrade(x, dec)); }
  }
}

/** Reserves of curves still on the curve; swept curves hold nothing worth reading. */
async function readStates(curves: string[]) {
  const tokOf = (c: string) => desk.tokens.get(byCurve.get(c)!);
  const read = curves.filter((c) => tokOf(c)?.phase === 0);
  if (!read.length) return;
  const states = await curveStates(read, (c) => tokOf(c)?.dec ?? 18, (c) => tokOf(c)?.threshold ?? null).catch(() => new Map<string, Curve>());
  for (const [c, s] of states) { const t = tokOf(c); if (t) t.state = s; }
}

function prune(head: bigint) {
  const floor = Number(head) - WINDOW;
  desk.launches = desk.launches.filter((l) => l.block > floor);
  desk.graduations = desk.graduations.filter((g) => g.block > Number(head) - 850_000);
  for (const [k, t] of desk.tokens) {
    t.trades = t.trades.filter((x) => x.block > floor);
    if (!t.trades.length && (t.launchBlock == null || t.launchBlock <= floor)) { desk.tokens.delete(k); byCurve.delete(t.curve); }
  }
}

function publish() {
  desk.tape = [...desk.tokens.values()].flatMap((t) => t.trades.map((x) => ({ ...x, token: t.token })))
    .sort((a, b) => b.block - a.block || b.i - a.i).slice(0, 80);
  desk.ready = true;
  desk.loadedAt = Date.now();
  emit();
}

let backfilling = false;
/** A day of graduation history, once. Runs after the desk is already ready, so the first paint never waits on it. */
async function backfillGraduations(head: bigint) {
  if (backfilling) return;
  backfilling = true;
  try {
    const grads = await logsSplit((a, b) => bgClient.getLogs({ address: PONS_V2_FACTORY, event: gradEvent, fromBlock: a, toBlock: b }), head - 850_000n, head).catch(() => []);
    for (const g of grads) {
      const token = String(g.args.token).toLowerCase();
      if (desk.graduations.some((x) => x.token === token && x.block === Number(g.blockNumber))) continue;
      desk.graduations.push({ token, block: Number(g.blockNumber) });
      const t = desk.tokens.get(token);
      if (t) t.phase = 2;
    }
    const unnamed = desk.graduations.filter((g) => g.symbol === undefined);
    if (unnamed.length) {
      const recs = await launchRecords(unnamed.map((g) => g.token)).catch(() => new Map());
      for (const g of unnamed) g.symbol = recs.get(g.token)?.symbol ?? desk.tokens.get(g.token)?.symbol ?? '';
    }
    desk.graduations = desk.graduations.filter((g) => g.block > Number(head) - 850_000);
    emit();
  } finally {
    backfilling = false;
  }
}

let enriching = false;
/**
 * Deployer histories, fresh launches first, then the most traded. A deployer's history also carries each token's launch
 * block, so older tokens get their age from it without a lookup of their own. Slow, so it runs after the paint.
 */
async function enrich(head: bigint) {
  if (enriching) return;
  enriching = true;
  try {
    const ranked = rank('new').concat(rank('hot').slice(0, 60));
    const needDep = [...new Set(ranked.filter((t) => !deployers.has(t.deployer)).map((t) => t.deployer))].slice(0, 20);
    if (!needDep.length) return;
    const hist = await deployerLaunches(needDep, head);
    for (const [d, list] of hist) deployers.set(d, list);
    let changed = false;
    for (const t of desk.tokens.values()) {
      const list = deployers.get(t.deployer);
      if (!list) continue;
      t.launchBlock ??= list.find((x) => x.token === t.token)?.block ?? null;
      if (t.launchBlock == null) continue;
      const earlier = list.filter((x) => x.block < t.launchBlock!).length;
      if (earlier !== t.earlier || list.length !== t.total) { t.earlier = earlier; t.total = list.length; changed = true; }
    }
    if (changed) emit();
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

