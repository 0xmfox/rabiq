// Builds public/landing.json: every Pons V2 launch, who launched it, and which launchers keep coming back.
// Run: node scripts/landing-data.ts   (raw logs are cached in .cache/, delete it to rescan from scratch)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseAbi } from 'viem';
import { client, launchEvent, MULTICALL3, PONS_V2_FACTORY, RPC_URL } from '../src/lib/chain.ts';

const FIRST_BLOCK = 27_027_321n;
const CACHE = '.cache/launches.json';
const BINS = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = [token: string, deployer: string, block: number];

async function scan(): Promise<{ rows: Row[]; head: number }> {
  const cached = existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, 'utf8')) as { rows: Row[]; head: number }) : { rows: [], head: Number(FIRST_BLOCK) - 1 };
  const head = await client.getBlockNumber();
  let from = BigInt(cached.head + 1), step = 200_000n;
  while (from <= head) {
    const to = from + step - 1n > head ? head : from + step - 1n;
    try {
      const logs = await client.getLogs({ address: PONS_V2_FACTORY, event: launchEvent, fromBlock: from, toBlock: to });
      for (const l of logs) cached.rows.push([l.args.token!.toLowerCase(), l.args.deployer!.toLowerCase(), Number(l.blockNumber)]);
      cached.head = Number(to);
      from = to + 1n;
      if (logs.length < 2500) step *= 2n;
      process.stdout.write(`\rblock ${to} · ${cached.rows.length} launches   `);
    } catch {
      step = step / 2n || 1n;
    }
    await sleep(300);
  }
  mkdirSync('.cache', { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cached));
  console.log();
  return cached;
}

async function rpcBatch(calls: { method: string; params: unknown[] }[]): Promise<any[]> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: '2.0', id, ...c }))) });
      const out = await res.json();
      // a throttled batch comes back as a single error object instead of an array
      if (!Array.isArray(out) || out.some((r) => r.error)) throw new Error(JSON.stringify(out).slice(0, 160));
      return out.sort((a, b) => a.id - b.id).map((r) => r.result);
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(3000 * i);
    }
  }
}

// Runtime placed at a scratch address with a state override: for every 20-byte address in calldata it
// stores EXTCODESIZE(address) at mem[k*32] and returns the array. One eth_call covers thousands of addresses.
//   i=0; loop: if !(calldatasize > i) goto end; mem[i/20*32] = extcodesize(calldataload(i) >> 96); i += 20; goto loop
//   end: return(0, i/20*32)
const CODESIZE_RUNTIME = '0x60005b80361115601f57803560601c3b8160149004602002526014016002565b602060148204026000f3';
const SCRATCH = '0x00000000000000000000000000000000000fabcd';
// EOAs have no code; EIP-7702 wallets expose their 23-byte delegation designator. Both are keyed accounts.
const isWalletSize = (n: number) => n === 0 || n === 23;

async function codeSizes(addrs: string[]): Promise<number[]> {
  const [res] = await rpcBatch([{ method: 'eth_call', params: [{ to: SCRATCH, data: '0x' + addrs.map((a) => a.slice(2)).join(''), gas: '0x2faf080' }, 'latest', { [SCRATCH]: { code: CODESIZE_RUNTIME } }] }]);
  return (res as string).slice(2).match(/.{64}/g)!.map((w) => parseInt(w, 16));
}

async function contractsAmong(addrs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < addrs.length; i += 1500) {
    const part = addrs.slice(i, i + 1500);
    (await codeSizes(part)).forEach((n, j) => !isWalletSize(n) && found.add(part[j]));
    process.stdout.write(`\rcodesize ${i + part.length}/${addrs.length} · ${found.size} contracts   `);
    await sleep(400);
  }
  console.log();
  return found;
}

const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
  'function symbol() view returns (string)',
]);

async function tokenFacts(tokens: string[]) {
  const out = new Map<string, { graduated: boolean; symbol: string }>();
  for (let i = 0; i < tokens.length; i += 150) {
    const part = tokens.slice(i, i + 150) as `0x${string}`[];
    const res = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: part.flatMap((t) => [
        { address: PONS_V2_FACTORY, abi: factoryAbi, functionName: 'getLaunchedToken' as const, args: [t] as const },
        { address: t, abi: factoryAbi, functionName: 'symbol' as const },
      ]),
    });
    part.forEach((t, j) => {
      const l = res[j * 2], s = res[j * 2 + 1];
      out.set(t, { graduated: l.status === 'success' && (l.result as any).phase !== 0, symbol: s.status === 'success' ? String(s.result).slice(0, 16) : '?' });
    });
    process.stdout.write(`\rphase ${i + part.length}/${tokens.length}   `);
    await sleep(300);
  }
  console.log();
  return out;
}

async function timeAt(blocks: number[]) {
  const stamps = await rpcBatch(blocks.map((b) => ({ method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] })));
  return blocks.map((b, i) => [b, Number(stamps[i].timestamp) * 1000] as [number, number]);
}

const { rows, head } = await scan();
const byDeployer = new Map<string, Row[]>();
for (const r of rows) (byDeployer.get(r[1]) ?? byDeployer.set(r[1], []).get(r[1])!).push(r);

const repeaters = [...byDeployer].filter(([, rs]) => rs.length > 1).map(([d]) => d);
const contracts = await contractsAmong(repeaters);

// Single-launch deployers are not checked for code: a contract among them adds only a first launch to the
// denominator, which can only make the "launched before" share smaller.
const walletLaunches = rows.filter((r) => !contracts.has(r[1])).length;
const repeatWallets = repeaters.filter((d) => !contracts.has(d));
const launchedBefore = repeatWallets.reduce((n, d) => n + byDeployer.get(d)!.length - 1, 0);
const contractLaunches = rows.length - walletLaunches;

// Tracks: the busiest launch wallets, then human-scale serial launchers whose tokens actually graduated.
const ranked = repeatWallets.map((d) => [d, byDeployer.get(d)!.length] as const).sort((a, b) => b[1] - a[1]);
const whales = ranked.slice(0, 2).map(([d]) => d);
const midPool = ranked.filter(([, n]) => n >= 6 && n <= 60).map(([d]) => d);
const facts = await tokenFacts(midPool.flatMap((d) => byDeployer.get(d)!.map((r) => r[0])));
const graduatedCount = (d: string) => byDeployer.get(d)!.filter((r) => facts.get(r[0])?.graduated).length;
const storied = midPool.filter((d) => graduatedCount(d) >= 1).sort((a, b) => graduatedCount(b) - graduatedCount(a) || byDeployer.get(b)!.length - byDeployer.get(a)!.length).slice(0, 4);

const span = head - Number(FIRST_BLOCK);
const x = (b: number) => Math.round(((b - Number(FIRST_BLOCK)) / span) * 10_000) / 10_000;
const track = (d: string) => {
  const rs = byDeployer.get(d)!;
  const bins = new Array(BINS).fill(0);
  for (const r of rs) bins[Math.min(BINS - 1, Math.floor(x(r[2]) * BINS))]++;
  const small = rs.length <= 60;
  return {
    deployer: d,
    launches: rs.length,
    graduated: small ? graduatedCount(d) : null,
    bins: small ? null : bins,
    ticks: small ? rs.map((r) => ({ x: x(r[2]), symbol: facts.get(r[0])?.symbol ?? '?', graduated: !!facts.get(r[0])?.graduated, token: r[0] })) : null,
  };
};

const anchors = await timeAt([Number(FIRST_BLOCK), Math.round(Number(FIRST_BLOCK) + span / 2), head]);
const data = {
  generatedAt: Date.now(),
  head,
  firstBlock: Number(FIRST_BLOCK),
  anchors,
  stats: {
    launches: rows.length,
    deployers: byDeployer.size,
    repeatWallets: repeatWallets.length,
    contractLaunches,
    walletLaunches,
    launchedBefore,
    launchedBeforePct: Math.round((launchedBefore / walletLaunches) * 1000) / 10,
  },
  tracks: [...whales, ...storied].map(track),
};
writeFileSync('public/landing.json', JSON.stringify(data));
console.log(JSON.stringify({ ...data, tracks: data.tracks.map((t) => ({ d: t.deployer, n: t.launches, g: t.graduated })) }, null, 2));
