import { test } from 'node:test';
import assert from 'node:assert/strict';

// burrow.ts touches localStorage only inside functions; blank() is pure.
const { blank } = await import('../src/lib/burrow.ts');
const { findLinks } = await import('../src/lib/links.ts');
const { diffSnapshots, parseRepo } = await import('../src/lib/sources.ts');
const { pack, unpack, sanitize, adopt, publish } = await import('../src/lib/share.ts');
const { md } = await import('../src/lib/md.ts');

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40);
const DEP = '0x' + 'd'.repeat(40), FEE = '0x' + 'e'.repeat(40);

function dossier(ca: string, symbol: string, deployer: string | null, fee: string | null, extra = {}) {
  const d = { ...blank(ca), symbol, ...extra };
  d.snapshots = [{
    at: 1, market: null, repos: [], launches: null,
    chain: { block: 1, name: symbol, symbol, launchpad: 'pons-v2', deployer, feeRecipient: fee, curve: null, phase: 'curve', creatorTaxBps: 0 },
  }];
  return d;
}

test('links: shared deployer is confirmed, a note mention is a hypothesis', () => {
  const links = findLinks([
    dossier(A, 'ONE', DEP, FEE),
    dossier(B, 'TWO', DEP, DEP, { notes: 'looks like [[ONE]] again' }),
    dossier(C, 'THREE', FEE, FEE, { sources: ['https://github.com/Foo/Bar'] }),
  ]);
  const kinds = links.map((l) => `${l.kind}:${l.confirmed}`).sort();
  assert.deepEqual(kinds, ['deployer-fee:true', 'deployer:true', 'fee-recipient:true', 'mention:false']);
  assert.equal(parseRepo('https://github.com/Foo/Bar.git/tree/main'), 'foo/bar');
});

test('diff: fdv move, graduation, new commit', () => {
  const prev = dossier(A, 'X', DEP, FEE).snapshots[0];
  const next = structuredClone(prev);
  prev.market = { priceUsd: 1, fdv: 10_000, liquidityUsd: 5000, volume24h: 0, url: '' };
  next.market = { priceUsd: 2, fdv: 25_000, liquidityUsd: 5100, volume24h: 0, url: '' };
  next.chain!.phase = 'graduated';
  prev.repos = [{ repo: 'foo/bar', sha: '1111111aaa', message: 'a', committedAt: '', pushedAt: '', stars: 0, branch: 'main' }];
  next.repos = [{ ...prev.repos[0], sha: '2222222bbb', message: 'ship v2' }];
  const texts = diffSnapshots(prev, next).map((c) => c.text);
  assert.equal(texts.length, 3);
  assert.match(texts[0], /\+150%/);
  assert.match(texts[2], /1111111 → 2222222/);
});

test('share: roundtrip, private fields stay home, hostile input is cleaned', async () => {
  const d = dossier(A, 'ONE', DEP, FEE, { thesis: 'real tool', notes: 'secret size 3 ETH', status: 'in-position' });
  const link = await pack(publish(d, 'anon', [], false));
  const back = await unpack(link);
  assert.equal(back?.thesis, 'real tool');
  assert.equal(back?.notes, undefined);
  assert.equal((back as any).status, undefined);
  assert.equal(await unpack('garbage'), null);
  const evil = sanitize({ v: 1, ca: A, author: '<img onerror=x>', sources: ['javascript:alert(1)', 'https://ok.xyz'] });
  assert.equal(evil?.author, 'imgonerrorx');
  assert.deepEqual(evil?.sources, ['https://ok.xyz']);
  const mine = adopt(back!, { ...blank(A), thesis: 'mine' });
  assert.match(mine.thesis, /^mine\n\n— @anon: real tool$/);
});

test('md: escapes html', () => {
  assert.equal(md('<script>x</script> **b**'), '<p>&lt;script&gt;x&lt;/script&gt; <strong>b</strong></p>');
});

test('logsSplit: one request when allowed, retries a timeout before splitting, splits a result cap at once', async () => {
  const { logsSplit } = await import('../src/lib/pons.ts');
  const calls: string[] = [];
  const ok = await logsSplit(async (a, b) => { calls.push(`${a}-${b}`); return [a]; }, 0n, 1000n);
  assert.deepEqual([ok, calls], [[0n], ['0-1000']]);

  calls.length = 0;
  let timeouts = 1;
  await logsSplit(async (a, b) => { calls.push(`${a}-${b}`); if (timeouts-- > 0) throw new Error('log query timed out'); return []; }, 0n, 1000n);
  assert.deepEqual(calls, ['0-1000', '0-1000'], 'a warm retry answers without splitting');

  calls.length = 0;
  const out = await logsSplit(async (a, b) => { calls.push(`${a}-${b}`); if (b - a > 500n) throw new Error('logs matched by query exceeds limit of 10000'); return [a]; }, 0n, 1000n);
  assert.deepEqual([out, calls], [[0n, 501n], ['0-1000', '0-500', '501-1000']]);
});
