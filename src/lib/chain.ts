// Robinhood Chain reader over the public RPC.
import { createPublicClient, http, parseAbi, parseAbiItem, getAddress, isAddress, type Address } from 'viem';

export const CHAIN_ID = 4663;
export const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const PONS_V2_FACTORY: Address = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const ZERO = '0x0000000000000000000000000000000000000000';
// Multicall3 is deployed on Robinhood Chain; batching reads into one eth_call keeps us under the public RPC rate limit.
export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
// Robinhood Chain is an Arbitrum chain: block.number inside a contract is the L1 block, ArbSys gives the L2 one.
const ARBSYS: Address = '0x0000000000000000000000000000000000000064';
const arbSysAbi = parseAbi(['function arbBlockNumber() view returns (uint256)']);

/** The public RPC answers 429 to bursts; back off and try again. */
export async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// The public RPC rate-limits bursts, and its throttled responses fail CORS in the browser.
// Every request waits for a slot GAP_MS apart. Two lanes share the slots: what's on screen (live polls, the open
// dossier) always goes before background history scans, so a long scan never delays a fresh launch.
const GAP_MS = 250;
// a throttled answer (in the browser a 429 arrives as a CORS failure) pauses both lanes: otherwise every other
// pending read walks straight into the same limit
const PAUSE_MS = 1_200;
// The limit weighs work, not just request count: back-to-back whole-history scans starve even eth_blockNumber.
// So the background lane gets one slot every BG_GAP_MS and backs off much longer after a throttled answer.
const BG_GAP_MS = 1_500;
const BG_PAUSE_MS = 4_000;
const lanes: (() => void)[][] = [[], []];
let freeAt = 0;
let bgFreeAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
function pump() {
  if (!lanes[0].length && !lanes[1].length) return;
  const at = lanes[0].length ? freeAt : Math.max(freeAt, bgFreeAt);
  if (timer) {
    if (at >= timerAt) return;
    clearTimeout(timer); // a screen read arrived while waiting out a background pause
  }
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    const now = Date.now();
    if (lanes[0].length && now >= freeAt) { freeAt = now + GAP_MS; lanes[0].shift()!(); }
    else if (lanes[1].length && now >= Math.max(freeAt, bgFreeAt)) { freeAt = now + GAP_MS; bgFreeAt = now + BG_GAP_MS; lanes[1].shift()!(); }
    pump();
  }, Math.max(0, at - Date.now()));
}
const throttled = () => {
  freeAt = Math.max(freeAt, Date.now() + PAUSE_MS);
  bgFreeAt = Math.max(bgFreeAt, Date.now() + BG_PAUSE_MS);
};

const laneFetch = (lane: 0 | 1) => async (input: RequestInfo | URL, init?: RequestInit) => {
  await new Promise<void>((r) => { lanes[lane].push(r); pump(); });
  try {
    const r = await fetch(input, init);
    if (r.status === 429) throttled();
    return r;
  } catch (e) {
    throttled();
    throw e;
  }
};

const chain = {
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
// a cold whole-history log query can take 10-20 s on the RPC; viem's default 10 s timeout aborted it and the retry hit 429
const transport = (lane: 0 | 1) => http(RPC_URL, { retryCount: 3, retryDelay: 1200, timeout: 30_000, fetchFn: laneFetch(lane) });
/** Reads for what's on screen. */
export const client = createPublicClient({ chain, transport: transport(0) });
/** Slow history scans; they only get slots the screen isn't using. */
export const bgClient = createPublicClient({ chain, transport: transport(1) });

const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
]);
const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);
export const launchEvent = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
);

export type ChainFacts = {
  block: number;
  name: string;
  symbol: string;
  launchpad: 'pons-v2' | null;
  deployer: string | null;
  feeRecipient: string | null;
  curve: string | null;
  // factory GraduationPhase: NotGraduated, Swept (curve drained, no pool yet), PoolCreated, Rescued
  phase: 'curve' | 'swept' | 'graduated' | 'rescued' | null;
  creatorTaxBps: number | null;
  pairToken?: string | null;
  poolFee?: number | null;
  tickSpacing?: number | null;
};

export const PHASES = ['curve', 'swept', 'graduated', 'rescued'] as const;

export function normalizeAddress(input: string): string | null {
  const s = input.trim();
  return isAddress(s, { strict: false }) ? getAddress(s) : null;
}

const lower = (a: string) => (a === ZERO ? null : a.toLowerCase());

export async function readToken(ca: string): Promise<ChainFacts> {
  const token = getAddress(ca);
  // one eth_call: name, symbol, Pons V2 launch record and the block it was read at
  const [name, symbol, launch, block] = await retry(() =>
    client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: [
        { address: token, abi: erc20Abi, functionName: 'name' },
        { address: token, abi: erc20Abi, functionName: 'symbol' },
        { address: PONS_V2_FACTORY, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] },
        { address: ARBSYS, abi: arbSysAbi, functionName: 'arbBlockNumber' },
      ],
    }),
  );
  const pons = launch.status === 'success' && launch.result.exists ? launch.result : null;
  return {
    block: block.status === 'success' ? Number(block.result) : 0,
    name: name.status === 'success' ? name.result : '',
    symbol: symbol.status === 'success' ? symbol.result : '',
    launchpad: pons ? 'pons-v2' : null,
    deployer: pons ? lower(pons.deployer) : null,
    feeRecipient: pons ? lower(pons.creatorFeeRecipient) : null,
    curve: pons ? lower(pons.curve) : null,
    phase: pons ? PHASES[pons.phase] ?? null : null,
    creatorTaxBps: pons ? Number(pons.creatorTaxBps) : null,
    pairToken: pons ? pons.pairToken.toLowerCase() : null,
    poolFee: pons ? Number(pons.poolFee) : null,
    tickSpacing: pons ? Number(pons.tickSpacing) : null,
  };
}
