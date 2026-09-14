// Synthetic demo burrow. Every address, number and repo here is invented and labelled DEMO in the UI.
import { blank, type Dossier } from './burrow.ts';
import type { Snapshot } from './sources.ts';

const addr = (tag: string) => `0x${tag.padEnd(40, '0')}`;
const DEP_A = addr('dead00a1'), DEP_B = addr('dead00b2'), FEE_A = addr('fee000a1');
const T = { sniff: addr('de0051ff'), mole: addr('de00301e'), ledgr: addr('de0013d6'), echo: addr('de00ec40') };
const HOUR = 3600_000;

function snap(at: number, symbol: string, deployer: string, fee: string, fdv: number, phase: 'curve' | 'graduated', extra: Partial<Snapshot> = {}): Snapshot {
  return {
    at,
    chain: { block: 62_000_000 + Math.round(at / 1e6), name: symbol, symbol, launchpad: 'pons-v2', deployer, feeRecipient: fee, curve: null, phase, creatorTaxBps: 150 },
    market: { priceUsd: fdv / 1e9, fdv, liquidityUsd: fdv * 0.22, volume24h: fdv * 0.6, url: '' },
    repos: [],
    launches: null,
    ...extra,
  };
}

function make(ca: string, name: string, symbol: string, fill: Partial<Dossier>): Dossier {
  return { ...blank(ca), name, symbol, demo: true, ...fill };
}

export function demoBurrow(now = Date.now()): Dossier[] {
  const yesterday = now - 26 * HOUR;
  const repo = (sha: string, message: string) => ({ repo: 'demo/sniff', sha, message, committedAt: '', pushedAt: '', stars: 41, branch: 'main' });
  const launches = [{ token: T.sniff, symbol: 'SNIFF' }, { token: T.mole, symbol: 'MOLE' }];
  return [
    make(T.sniff, 'Sniff Terminal', 'SNIFF', {
      status: 'digging',
      thesis: 'Wallet-sniffer CLI. Dev ships in public, repo has real commits. Waiting for a working build before sizing in.',
      pros: ['Repo has real history, not a one-commit README', 'Fees go to a separate recipient, not the deployer'],
      cons: ['Deployer already launched a second token (MOLE)'],
      checked: ['Contract is a standard Pons V2 launch', 'README links the official CA'],
      questions: [
        { text: 'Does the CLI actually run, or is it screenshots only?', done: false },
        { text: 'Who controls the fee recipient wallet?', done: true },
      ],
      sources: ['https://github.com/demo/sniff', 'https://x.com/demo_sniff/status/1'],
      notes: 'Come back when a working tool version ships.\n\nSame dev as [[MOLE]]. Keep an eye on fee flows to 0xfee000a100000000000000000000000000000000.',
      snapshots: [
        snap(yesterday, 'SNIFF', DEP_A, FEE_A, 18_400, 'curve', { repos: [repo('a1b2c3d4e5f6', 'README: roadmap')], launches: [launches[0]] }),
        snap(now - 2 * 60_000, 'SNIFF', DEP_A, FEE_A, 42_900, 'graduated', { repos: [repo('f00dcafe1234', 'ship working CLI v0.2')], launches }),
      ],
      log: [{ at: yesterday, text: 'Dossier opened' }, { at: yesterday + 600_000, text: 'Status → Researching' }, { at: now - 120_000, text: 'Refreshed' }],
      createdAt: yesterday,
    }),
    make(T.mole, 'Mole Scanner', 'MOLE', {
      status: 'watching',
      thesis: 'Fresh launch, no repo yet.',
      questions: [{ text: 'Is this a spin-off of the SNIFF community or a quick rotation?', done: false }],
      notes: 'Deployer looks familiar. Check [[SNIFF]] notes before touching this.',
      snapshots: [snap(now - HOUR, 'MOLE', DEP_A, DEP_A, 7_300, 'curve', { launches })],
      createdAt: now - HOUR,
    }),
    make(T.ledgr, 'Ledgr', 'LEDGR', {
      status: 'in-position',
      reason: 'Small size, working product, fees route to a known builder.',
      thesis: 'On-chain receipts tool. Creator fees go to the SNIFF deployer, so same builder, different wallet.',
      pros: ['Working site', 'Liquidity held after graduation'],
      checked: ['Fee recipient traced to SNIFF deployer'],
      questions: [{ text: 'Will the builder keep both tools maintained?', done: false }],
      snapshots: [snap(now - 5 * HOUR, 'LEDGR', DEP_B, DEP_A, 96_000, 'graduated')],
      createdAt: now - 3 * 24 * HOUR,
    }),
    make(T.echo, 'Echo Copytrade', 'ECHO', {
      status: 'passed',
      reason: 'Clone of an existing terminal, no repo, anonymous deployer.',
      thesis: 'Looks like a reskin. Name borrows from $SNIFF marketing.',
      cons: ['No source code', 'Copy-paste README'],
      snapshots: [snap(now - 9 * HOUR, 'ECHO', addr('dead00e3'), addr('dead00e3'), 3_100, 'curve')],
      createdAt: now - 2 * 24 * HOUR,
    }),
  ];
}
