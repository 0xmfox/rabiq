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
// Space requests out so a full check never looks like a burst.
const GAP_MS = 250;
let nextSlot = 0;
async function spacedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  try {
    const r = await fetch(input, init);
    if (r.status === 429) throttled();
    return r;
  } catch (e) {
    throttled();
    throw e;
  }
}
// a throttled answer (in the browser a 429 arrives as a CORS failure) pauses the whole queue, not just the one caller:
// otherwise every other pending read walks straight into the same limit
const PAUSE_MS = 1_200;
function throttled() {
  nextSlot = Math.max(nextSlot, Date.now() + PAUSE_MS);
}

export const client = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  // a cold whole-history log query can take 10-20 s on the RPC; viem's default 10 s timeout aborted it and the retry hit 429
  transport: http(RPC_URL, { retryCount: 3, retryDelay: 1200, timeout: 30_000, fetchFn: spacedFetch }),
});

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
