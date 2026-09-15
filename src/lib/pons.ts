// Pons V2 market reads: bonding curve state, curve trades, graduated v4 pool swaps, deployer launch counts.
import { encodeAbiParameters, getAddress, keccak256, parseAbi, parseAbiItem, type Address } from 'viem';
import { client, launchEvent, MULTICALL3, PONS_V2_FACTORY } from './chain.ts';

export const SUPPLY = 1_000_000_000; // every Pons V2 token mints 1e9 (checked on-chain)
export const FIRST_BLOCK = 27_027_321n;
const POOL_MANAGER: Address = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const MEME_HOOK: Address = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';

export const curveBuy = parseAbiItem('event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)');
export const curveSell = parseAbiItem('event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)');
const poolSwap = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
const curveAbi = parseAbi([
  'function getReserves() view returns (uint256, uint256)',
  'function realQuoteReserve() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function token() view returns (address)',
]);
const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
]);
const symbolAbi = parseAbi(['function symbol() view returns (string)', 'function name() view returns (string)']);
const erc20Meta = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

// q and net are raw quote units; amt and price are whole quote units once the quote's decimals are known
export type Trade = { block: number; i: number; side: 'buy' | 'sell'; q: number; net: number; tokens: number; amt: number; price: number; who: string; curve: string };
// raised and threshold are whole units of the launch's quote asset (ETH for most launches)
export type Curve = { priceEth: number; raisedEth: number; thresholdEth: number; progress: number; quote?: string };
export type Quote = { address: string; symbol: string; decimals: number; usd: number | null };
export const ETH_QUOTE = '0x0000000000000000000000000000000000000000';
export type Candle = { t: number; o: number; h: number; l: number; c: number; buy: number; sell: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => `${(e as any)?.details ?? ''} ${(e as any)?.message ?? e}`;

/** eth_getLogs over [from, to]; halves the range when the RPC answers with a block-range limit (wording has changed before). */
export async function logsSplit<T>(q: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, depth = 0): Promise<T[]> {
  try {
    return await q(from, to);
  } catch (e) {
    if (/exceeds limit|allowed to search|too many blocks|block range/i.test(errText(e)) && to > from && depth < 14) {
      const mid = (from + to) / 2n;
      return [...(await logsSplit(q, from, mid, depth + 1)), ...(await logsSplit(q, mid + 1n, to, depth + 1))];
    }
    await sleep(1600);
    return q(from, to);
  }
}

async function multicall<T = unknown>(contracts: any[]): Promise<{ status: string; result?: T }[]> {
  const out: { status: string; result?: T }[] = [];
  for (let i = 0; i < contracts.length; i += 900) {
    const part = contracts.slice(i, i + 900);
    let res: any[] | null = null;
    for (let k = 0; k < 3 && !res; k++) {
      try { res = await client.multicall({ multicallAddress: MULTICALL3, allowFailure: true, batchSize: 0, contracts: part }); }
      catch { await sleep(1500 * (k + 1)); }
    }
    out.push(...(res ?? part.map(() => ({ status: 'failure' }))));
  }
  return out;
}

// ---------- quote assets ----------
let eth: { at: number; usd: number } | null = null;
export async function ethUsd(): Promise<number | null> {
  if (eth && Date.now() - eth.at < 60_000) return eth.usd;
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    const usd = Number((await r.json())?.data?.amount);
    if (usd > 0) eth = { at: Date.now(), usd };
  } catch { /* keep the last price */ }
  return eth?.usd ?? null;
}
export const lastEthUsd = () => eth?.usd ?? null;

const quotes = new Map<string, Quote>([[ETH_QUOTE, { address: ETH_QUOTE, symbol: 'ETH', decimals: 18, usd: null }]]);
let pricedAt = 0;
export const quoteOf = (address: string | null | undefined): Quote | null => {
  const q = quotes.get((address ?? ETH_QUOTE).toLowerCase());
  if (q?.address === ETH_QUOTE) q.usd = lastEthUsd();
  return q ?? null;
};

/** Symbol and decimals for new quote assets, then USD prices at most once a minute. */
export async function loadQuotes(addresses: string[]) {
  const fresh = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !quotes.has(a));
  if (fresh.length) {
    const res = await multicall(fresh.flatMap((a) => [
      { address: a as Address, abi: erc20Meta, functionName: 'symbol' },
      { address: a as Address, abi: erc20Meta, functionName: 'decimals' },
    ]));
    fresh.forEach((a, k) => {
      if (res[k * 2 + 1].status !== 'success') return;
      quotes.set(a, { address: a, symbol: res[k * 2].status === 'success' ? String(res[k * 2].result) : '?', decimals: Number(res[k * 2 + 1].result), usd: null });
    });
  }
  await ethUsd();
  if (!fresh.length && Date.now() - pricedAt < 60_000) return;
  pricedAt = Date.now();
  const list = [...quotes.keys()].filter((a) => a !== ETH_QUOTE);
  for (let i = 0; i < list.length; i += 30) {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${list.slice(i, i + 30).join(',')}`);
      const pairs: any[] = r.ok ? await r.json() : [];
      const best = new Map<string, { usd: number; liq: number }>();
      const offer = (addr: string, usd: number, liq: number) => {
        const a = addr.toLowerCase();
        if (!quotes.has(a) || !(usd > 0)) return;
        if (!best.has(a) || liq > best.get(a)!.liq) best.set(a, { usd, liq });
      };
      for (const p of pairs) {
        const liq = Number(p.liquidity?.usd ?? 0), usd = Number(p.priceUsd), native = Number(p.priceNative);
        offer(String(p.baseToken?.address), usd, liq);
        // a quote asset without pairs of its own is priced through the pairs it quotes (USDG)
        if (native > 0) offer(String(p.quoteToken?.address), usd / native, liq);
      }
      for (const [a, b] of best) quotes.get(a)!.usd = b.usd;
    } catch { /* keep the last prices */ }
  }
}

export function normTrade(t: Trade, decimals: number): Trade {
  const scale = 10 ** decimals;
  t.amt = t.q / scale;
  t.price = t.tokens ? t.net / scale / t.tokens : 0;
  return t;
}

// ---------- curve ----------
/** Curve reserves. decimals maps a curve to its quote asset's decimals (18 when absent); a known raw threshold skips one call per curve. */
export async function curveStates(curves: string[], decimals?: (curve: string) => number, threshold?: (curve: string) => number | null): Promise<Map<string, Curve>> {
  const known = (c: string) => threshold?.(c.toLowerCase()) ?? null;
  const calls = curves.flatMap((c) => (known(c) != null ? ['getReserves', 'realQuoteReserve'] as const : ['getReserves', 'realQuoteReserve', 'graduationThreshold'] as const).map((functionName) => ({ address: c as Address, abi: curveAbi, functionName })));
  const res = await multicall(calls);
  const out = new Map<string, Curve>();
  let at = 0;
  curves.forEach((c) => {
    const k = known(c);
    const [r, real, thr] = res.slice(at, at + (k != null ? 2 : 3));
    at += k != null ? 2 : 3;
    if (r.status !== 'success' || real.status !== 'success' || (k == null && thr?.status !== 'success')) return;
    const [q, t] = r.result as [bigint, bigint];
    const scale = 10 ** (decimals?.(c.toLowerCase()) ?? 18);
    const raisedEth = Number(real.result as bigint) / scale, thresholdEth = (k ?? Number(thr.result as bigint)) / scale;
    out.set(c.toLowerCase(), { priceEth: t ? Number(q) / scale / (Number(t) / 1e18) : 0, raisedEth, thresholdEth, progress: thresholdEth ? Math.min(1, raisedEth / thresholdEth) : 0 });
  });
  return out;
}

/** Trade price is the curve price the trade executed at, before fee and creator tax. Normalized as ETH until the quote is known. */
export function toTrade(l: any): Trade {
  const a = l.args;
  const buy = l.eventName === 'CurveBuy';
  const t: Trade = {
    block: Number(l.blockNumber), i: l.logIndex, side: buy ? 'buy' : 'sell',
    q: Number(buy ? a.quoteIn : a.quoteOut), net: Number(buy ? a.quoteIn - a.fee - a.tax : a.quoteOut + a.fee + a.tax),
    tokens: Number(buy ? a.tokensOut : a.tokensIn) / 1e18, amt: 0, price: 0,
    who: String(buy ? a.recipient : a.seller).toLowerCase(), curve: String(l.address).toLowerCase(),
  };
  return normTrade(t, 18);
}

export async function curveTrades(curve: string, from: bigint, to: bigint, decimals = 18): Promise<Trade[]> {
  const logs = await logsSplit((a, b) => client.getLogs({ address: curve as Address, events: [curveBuy, curveSell], fromBlock: a, toBlock: b }), from, to);
  return logs.map((l) => normTrade(toTrade(l), decimals));
}

/** Every curve trade on Pons V2 in the range, all tokens. */
export async function allTrades(from: bigint, to: bigint): Promise<Trade[]> {
  const logs = await logsSplit((a, b) => client.getLogs({ events: [curveBuy, curveSell], fromBlock: a, toBlock: b }), from, to);
  return logs.map(toTrade);
}

// ---------- graduated pool ----------
export function poolId(token: string, pairToken: string, fee: number, tickSpacing: number): `0x${string}` {
  const [c0, c1] = BigInt(token) < BigInt(pairToken) ? [token, pairToken] : [pairToken, token];
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [getAddress(c0), getAddress(c1), fee, tickSpacing, MEME_HOOK],
  ));
}

/** v4 swaps of a graduated Pons pool, priced in the launch's quote asset. */
export async function poolTrades(id: `0x${string}`, token: string, pairToken: string, from: bigint, to: bigint, decimals = 18): Promise<Trade[]> {
  const tokenIs0 = BigInt(token) < BigInt(pairToken);
  const logs = await logsSplit((a, b) => client.getLogs({ address: POOL_MANAGER, event: poolSwap, args: { id }, fromBlock: a, toBlock: b }), from, to);
  return logs.map((l) => {
    const { amount0, amount1, sqrtPriceX96, sender } = l.args as any;
    const [tokAmt, quoteAmt] = tokenIs0 ? [amount0, amount1] : [amount1, amount0];
    // sqrtPriceX96 prices currency1 in currency0, both in raw units
    const raw1per0 = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
    const quotePerToken = (tokenIs0 ? raw1per0 : raw1per0 ? 1 / raw1per0 : 0) * 10 ** (18 - decimals);
    // amounts are the swapper's balance delta: a positive token amount means the swapper received tokens
    const q = Math.abs(Number(quoteAmt));
    return { block: Number(l.blockNumber), i: l.logIndex!, side: tokAmt > 0n ? 'buy' : 'sell', q, net: q, tokens: Math.abs(Number(tokAmt)) / 1e18, amt: q / 10 ** decimals, price: quotePerToken, who: String(sender).toLowerCase(), curve: id };
  });
}

export type Launch = { token: string; curve: string; deployer: string; block: number; pairToken: string; poolFee: number; tickSpacing: number; phase: number; threshold: number; symbol: string; name: string };

/** Launch record + symbol for tokens (and name when asked), one multicall. */
export async function launchRecords(tokens: string[], names = false): Promise<Map<string, Launch>> {
  const per = names ? 3 : 2;
  const res = await multicall(tokens.flatMap((t) => [
    { address: PONS_V2_FACTORY, abi: factoryAbi, functionName: 'getLaunchedToken', args: [t as Address] },
    { address: t as Address, abi: symbolAbi, functionName: 'symbol' },
    ...(names ? [{ address: t as Address, abi: symbolAbi, functionName: 'name' }] : []),
  ]));
  const out = new Map<string, Launch>();
  tokens.forEach((t, k) => {
    const rec = res[k * per];
    const r = rec.status === 'success' ? (rec.result as any) : null;
    if (!r?.exists) return;
    out.set(t.toLowerCase(), {
      token: t.toLowerCase(), curve: String(r.curve).toLowerCase(), deployer: String(r.deployer).toLowerCase(), block: 0,
      pairToken: String(r.pairToken).toLowerCase(), poolFee: Number(r.poolFee), tickSpacing: Number(r.tickSpacing), phase: Number(r.phase), threshold: Number(r.graduationThreshold),
      symbol: res[k * per + 1].status === 'success' ? String(res[k * per + 1].result) : '?', name: names && res[k * 3 + 2].status === 'success' ? String(res[k * 3 + 2].result) : '',
    });
  });
  return out;
}

export async function curveTokens(curves: string[]): Promise<Map<string, string>> {
  const res = await multicall(curves.map((c) => ({ address: c as Address, abi: curveAbi, functionName: 'token' })));
  return new Map(curves.flatMap((c, k) => (res[k].status === 'success' ? [[c.toLowerCase(), String(res[k].result).toLowerCase()] as [string, string]] : [])));
}

const CHUNK = 1_900n; // just under the RPC's per-request block-range cap (it has changed once already)
// ponytail: a full genesis-to-head scan is tens of thousands of requests at a 2000-block cap.
// Bounded to recent history so this finishes in the background; older history needs an indexed API, not brute log scans.
const HISTORY_LOOKBACK = 1_700_000n; // ~2 days at the measured block time

/** Launch blocks of every Pons V2 token by these deployers in the recent history window, oldest first. */
export async function deployerLaunches(deployers: string[], head: bigint): Promise<Map<string, { token: string; block: number }[]>> {
  const out = new Map<string, { token: string; block: number }[]>(deployers.map((d) => [d, []]));
  const start = head - HISTORY_LOOKBACK > FIRST_BLOCK ? head - HISTORY_LOOKBACK : FIRST_BLOCK;
  for (let i = 0; i < deployers.length; i += 40) {
    const group = deployers.slice(i, i + 40).map((d) => getAddress(d));
    for (let from = start; from <= head; from += CHUNK) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      const logs = await logsSplit((a, b) => client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, args: { deployer: group }, fromBlock: a, toBlock: b }), from, to);
      for (const l of logs) out.get(String(l.args.deployer).toLowerCase())?.push({ token: String(l.args.token).toLowerCase(), block: Number(l.blockNumber) });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.block - b.block);
  return out;
}

/** Launch block of tokens in the recent history window (indexed topic filter). */
export async function launchBlocks(tokens: string[], head: bigint): Promise<Map<string, { block: number; deployer: string }>> {
  const out = new Map<string, { block: number; deployer: string }>();
  const start = head - HISTORY_LOOKBACK > FIRST_BLOCK ? head - HISTORY_LOOKBACK : FIRST_BLOCK;
  for (let i = 0; i < tokens.length; i += 60) {
    const group = tokens.slice(i, i + 60).map((t) => getAddress(t));
    for (let from = start; from <= head; from += CHUNK) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      const logs = await logsSplit((a, b) => client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, args: { token: group }, fromBlock: a, toBlock: b }), from, to);
      for (const l of logs) out.set(String(l.args.token).toLowerCase(), { block: Number(l.blockNumber), deployer: String(l.args.deployer).toLowerCase() });
    }
  }
  return out;
}

// ---------- block time ----------
let clock: { block: number; time: number; spb: number } | null = null;
/** Calibrates seconds-per-block from two real block timestamps ~2h apart; refreshed every 10 minutes. */
export async function calibrate(head: bigint) {
  if (clock && Date.now() / 1000 - clock.time < 600) return clock;
  const back = 70_000n;
  const [a, b] = await Promise.all([client.getBlock({ blockNumber: head }), client.getBlock({ blockNumber: head - back })]);
  clock = { block: Number(head), time: Number(a.timestamp), spb: Number(a.timestamp - b.timestamp) / Number(back) };
  return clock;
}
/** Unix seconds for a block, interpolated from the calibration. */
export const blockTime = (block: number) => (clock ? clock.time - (clock.block - block) * clock.spb : Date.now() / 1000);
export const hasClock = () => !!clock;

// ---------- candles ----------
/** Candles of n trades each; t is the time of the candle's first trade. */
export function tradeCandles(trades: Trade[], n: number): Candle[] {
  const out: Candle[] = [];
  let prev = 0;
  for (let i = 0; i < trades.length; i += n) {
    const part = trades.slice(i, i + n).filter((t) => t.price > 0);
    if (!part.length) continue;
    const o = prev || part[0].price, c = part[part.length - 1].price;
    const k: Candle = { t: blockTime(part[0].block), o, h: Math.max(o, ...part.map((t) => t.price)), l: Math.min(o, ...part.map((t) => t.price)), c, buy: 0, sell: 0 };
    for (const t of part) k[t.side] += t.amt;
    out.push(k);
    prev = c;
  }
  return out;
}

export function candles(trades: Trade[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const t of trades) {
    if (!t.price) continue;
    const b = Math.floor(blockTime(t.block) / bucketSec) * bucketSec;
    if (!cur || cur.t !== b) {
      const open: number = cur ? cur.c : t.price;
      cur = { t: b, o: open, h: Math.max(open, t.price), l: Math.min(open, t.price), c: t.price, buy: 0, sell: 0 };
      out.push(cur);
    }
    cur.h = Math.max(cur.h, t.price);
    cur.l = Math.min(cur.l, t.price);
    cur.c = t.price;
    cur[t.side] += t.amt;
  }
  return out;
}
