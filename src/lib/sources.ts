// Market data (DexScreener), repositories (GitHub REST API) and Pons V2 launch history.
import { client, launchEvent, MULTICALL3, PONS_V2_FACTORY, readToken, retry, type ChainFacts } from './chain.ts';
import { curveStates, curveTrades, loadQuotes, poolId, poolTrades, quoteOf, SUPPLY, type Curve } from './pons.ts';
import { parseAbi, getAddress } from 'viem';

const DAY_BLOCKS = 850_000n; // ~24h at the measured ~0.1 s block time

export type Market = {
  priceUsd: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  url: string;
};

export type RepoFacts = {
  repo: string; // owner/name, lowercase
  sha: string;
  message: string;
  committedAt: string;
  pushedAt: string;
  stars: number;
  branch: string;
};

export type Launch = { token: string; symbol: string };

export type Snapshot = {
  at: number;
  chain: ChainFacts | null;
  market: Market | null;
  repos: RepoFacts[];
  launches: Launch[] | null; // the deployer's latest Pons V2 launches (up to 40), always including this token
  launchTotal?: number | null; // all launches by the deployer
  curve?: Curve | null; // bonding curve state while the token trades on the curve
};

export async function readMarket(ca: string): Promise<Market | null> {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${ca}`);
  if (!res.ok) return null;
  const pairs: any[] = await res.json();
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const p = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    priceUsd: num(p.priceUsd),
    fdv: num(p.fdv ?? p.marketCap),
    liquidityUsd: num(p.liquidity?.usd),
    volume24h: num(p.volume?.h24),
    url: String(p.url ?? ''),
  };
}

/** "https://github.com/Owner/Repo/tree/main" -> "owner/repo" */
export function parseRepo(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (!m || m[2].toLowerCase() === 'orgs') return null;
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`.toLowerCase();
}

async function gh(path: string) {
  const res = await fetch(`https://api.github.com/${path}`, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

export async function readRepo(repo: string): Promise<RepoFacts | null> {
  try {
    const meta = await gh(`repos/${repo}`);
    const [head] = await gh(`repos/${repo}/commits?per_page=1&sha=${encodeURIComponent(meta.default_branch)}`);
    return {
      repo,
      sha: head.sha,
      message: String(head.commit.message).split('\n')[0].slice(0, 140),
      committedAt: head.commit.committer?.date ?? head.commit.author?.date ?? '',
      pushedAt: meta.pushed_at,
      stars: meta.stargazers_count,
      branch: meta.default_branch,
    };
  } catch {
    return null;
  }
}

const symbolAbi = parseAbi(['function symbol() view returns (string)']);


export async function withSymbols(tokens: `0x${string}`[]): Promise<Launch[]> {
  if (!tokens.length) return [];
  const res = await retry(() => client.multicall({ multicallAddress: MULTICALL3, allowFailure: true, contracts: tokens.map((address) => ({ address, abi: symbolAbi, functionName: 'symbol' as const })) }))
    .catch(() => tokens.map(() => ({ status: 'failure' as const, result: undefined })));
  return tokens.map((t, i) => ({ token: t.toLowerCase(), symbol: res[i].status === 'success' ? String(res[i].result) : '?' }));
}

// First TokenLaunched event from the Pons V2 factory is at block 27,027,321.
const PONS_V2_FIRST_BLOCK = 27_000_000n;
const CHUNK = 12_000_000n;

/** Every Pons V2 token this deployer launched, oldest first. Throws when the public RPC keeps throttling. */
export async function launchTokens(deployer: string, headBlock?: number): Promise<`0x${string}`[]> {
  const head = headBlock ? BigInt(headBlock) : await retry(() => client.getBlockNumber());
  const ranges: [bigint, bigint][] = [];
  for (let from = PONS_V2_FIRST_BLOCK; from <= head; from += CHUNK) ranges.push([from, from + CHUNK - 1n > head ? head : from + CHUNK - 1n]);
  // sequential, bounded ranges: the public RPC rate-limits bursts and drops very wide scans
  const tokens: `0x${string}`[] = [];
  for (const [fromBlock, toBlock] of ranges)
    for (const l of await retry(() => client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, args: { deployer: getAddress(deployer) }, fromBlock, toBlock })))
      tokens.push(l.args.token!);
  return tokens;
}

/** The deployer's latest 40 launches plus `self` when it is older, and the total count. */
export async function readLaunches(deployer: string, headBlock?: number, self?: string): Promise<{ list: Launch[]; total: number } | null> {
  try {
    const all = (await launchTokens(deployer, headBlock)).map((t) => t.toLowerCase() as `0x${string}`);
    if (self && !all.includes(self.toLowerCase() as `0x${string}`)) return null;
    // ponytail: one symbol() call per shown launch; the cap keeps serial launchers readable
    const pick = all.slice(-40);
    if (self && !pick.includes(self.toLowerCase() as `0x${string}`)) pick.unshift(self.toLowerCase() as `0x${string}`);
    return { list: await withSymbols(pick), total: all.length };
  } catch {
    return null;
  }
}

/** Newest Pons V2 launches (~20/min on mainnet, so a few thousand blocks is plenty). */
export async function readFreshLaunches(n = 6): Promise<Launch[]> {
  const head = await retry(() => client.getBlockNumber());
  const logs = await retry(() => client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, fromBlock: head - 3000n, toBlock: head }));
  return withSymbols(logs.slice(-n).reverse().map((l) => l.args.token!));
}

export async function takeSnapshot(ca: string, repoUrls: string[]): Promise<Snapshot> {
  const repos = [...new Set(repoUrls.map(parseRepo).filter((r): r is string => !!r))];
  const [chain, market, repoFacts] = await Promise.all([
    readToken(ca).catch(() => null),
    readMarket(ca).catch(() => null),
    Promise.all(repos.map(readRepo)),
  ]);
  // a token is always one of its own deployer's launches; a list without it is a failed read, so try once more
  let launches = chain?.deployer ? await readLaunches(chain.deployer, chain.block, ca) : null;
  if (chain?.deployer && !launches) {
    await new Promise((r) => setTimeout(r, 2000));
    launches = await readLaunches(chain.deployer, chain.block, ca);
  }
  const { curve, market: ponsMarket } = chain?.launchpad ? await ponsMarketOf(ca, chain, market).catch(() => ({ curve: null, market: null })) : { curve: null, market: null };
  return { at: Date.now(), chain, market: market ?? ponsMarket, repos: repoFacts.filter((r): r is RepoFacts => !!r), launches: launches?.list ?? null, launchTotal: launches?.total ?? null, curve };
}

/** DexScreener has no pair while a token is on the curve: price it from the curve reserves and its trades. */
async function ponsMarketOf(ca: string, chain: ChainFacts, dex: Market | null): Promise<{ curve: Curve | null; market: Market | null }> {
  const head = BigInt(chain.block || Number(await client.getBlockNumber()));
  const quoteAddr = chain.pairToken ?? '0x0000000000000000000000000000000000000000';
  await loadQuotes([quoteAddr]);
  const quote = quoteOf(quoteAddr);
  const dec = quote?.decimals ?? 18, usdPer = quote?.usd ?? null;
  const sum = (ts: { amt: number }[]) => ts.reduce((s, t) => s + t.amt, 0);
  if (chain.phase === 'curve' && chain.curve) {
    const [state, trades] = await Promise.all([curveStates([chain.curve], () => dec), curveTrades(chain.curve, head - DAY_BLOCKS, head, dec)]);
    const c = state.get(chain.curve) ?? null;
    if (c) c.quote = quote?.symbol ?? '?';
    if (!c || dex) return { curve: c, market: null };
    return {
      curve: c,
      market: usdPer == null ? null : { priceUsd: c.priceEth * usdPer, fdv: c.priceEth * SUPPLY * usdPer, liquidityUsd: c.raisedEth * usdPer, volume24h: sum(trades) * usdPer, url: '' },
    };
  }
  if (chain.phase === 'graduated' && !dex && chain.poolFee != null && chain.tickSpacing != null && usdPer != null) {
    const trades = await poolTrades(poolId(ca, quoteAddr, chain.poolFee, chain.tickSpacing), ca, quoteAddr, head - DAY_BLOCKS, head, dec);
    const last = trades[trades.length - 1];
    if (!last) return { curve: null, market: null };
    return { curve: null, market: { priceUsd: last.price * usdPer, fdv: last.price * SUPPLY * usdPer, liquidityUsd: null, volume24h: sum(trades) * usdPer, url: '' } };
  }
  return { curve: null, market: null };
}

export type Change = { text: string; tone: 'up' | 'down' | 'info' | 'warn'; href?: string };

const pct = (a: number, b: number) => ((b - a) / a) * 100;

/** What moved between two checks of the same token. Pure; tested in test/logic.test.ts. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): Change[] {
  const out: Change[] = [];
  const pm = prev.market, nm = next.market;
  if (pm?.fdv && nm?.fdv && Math.abs(pct(pm.fdv, nm.fdv)) >= 5) {
    const d = pct(pm.fdv, nm.fdv);
    out.push({ text: `FDV ${usd(pm.fdv)} → ${usd(nm.fdv)} (${d > 0 ? '+' : ''}${d.toFixed(0)}%)`, tone: d > 0 ? 'up' : 'down' });
  }
  if (pm?.liquidityUsd && nm?.liquidityUsd && Math.abs(pct(pm.liquidityUsd, nm.liquidityUsd)) >= 10) {
    const d = pct(pm.liquidityUsd, nm.liquidityUsd);
    out.push({ text: `Liquidity ${usd(pm.liquidityUsd)} → ${usd(nm.liquidityUsd)}`, tone: d > 0 ? 'up' : 'down' });
  }
  if (!pm && nm) out.push({ text: `Market appeared: FDV ${usd(nm.fdv)}`, tone: 'info' });
  if (prev.chain?.phase === 'curve' && next.chain?.phase === 'swept')
    out.push({ text: 'Curve completed: reserves swept, Uniswap v4 pool pending', tone: 'up' });
  if (prev.chain?.phase !== 'graduated' && prev.chain?.phase && next.chain?.phase === 'graduated')
    out.push({ text: 'Graduated from the Pons curve to a Uniswap v4 pool', tone: 'up' });
  if (prev.chain?.feeRecipient && next.chain?.feeRecipient && prev.chain.feeRecipient !== next.chain.feeRecipient)
    out.push({ text: `Fee recipient changed to ${short(next.chain.feeRecipient)}`, tone: 'warn' });
  for (const r of next.repos) {
    const old = prev.repos.find((p) => p.repo === r.repo);
    if (old && old.sha !== r.sha)
      out.push({
        text: `${r.repo} moved ${old.sha.slice(0, 7)} → ${r.sha.slice(0, 7)} · “${r.message}”`,
        tone: 'info',
        href: `https://github.com/${r.repo}/compare/${old.sha}...${r.sha}`,
      });
  }
  // an empty previous list means that check failed to read history (the token itself is always one of its deployer's launches)
  if (prev.launches?.length && next.launches) {
    const fresh = next.launches.filter((l) => !prev.launches!.some((p) => p.token === l.token));
    if (fresh.length)
      out.push({ text: `Deployer launched ${fresh.length} new token${fresh.length === 1 ? '' : 's'}: ${fresh.map((f) => '$' + f.symbol).join(', ')}`, tone: 'warn' });
  }
  return out;
}

export function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "$PEPE" and "PEPE" both render as "$PEPE". */
export const ticker = (symbol: string) => `$${symbol.replace(/^\$+/, "")}`;
