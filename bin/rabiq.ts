#!/usr/bin/env node
// RABIQ CLI: token dossiers as plain markdown files.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blank, factsMarkdown, FACTS_END, FACTS_START, toMarkdown } from '../src/lib/burrow.ts';
import { normalizeAddress } from '../src/lib/chain.ts';
import { demoBurrow } from '../src/lib/demo.ts';
import { diffSnapshots, readLaunches, short, takeSnapshot, usd, type Snapshot } from '../src/lib/sources.ts';

const dir = process.env.RABIQ_BURROW ?? join(process.cwd(), 'burrow');
const snapDir = join(dir, '.snapshots');
const [cmd, ...args] = process.argv.slice(2);
const c = { lime: '\x1b[38;5;155m', dim: '\x1b[2m', red: '\x1b[38;5;203m', amber: '\x1b[38;5;221m', b: '\x1b[1m', x: '\x1b[0m' };

const notes = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []);
const front = (text: string, key: string) => text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';

function banner() {
  console.log(`${c.lime}${c.b}  (\\(\\   RABIQ${c.x}${c.dim}  every CA is a rabbit hole${c.x}\n${c.lime}  ( -.-)${c.x}${c.dim}  burrow: ${dir}${c.x}\n${c.lime}  o_(")(")${c.x}\n`);
}

/** Every note whose frontmatter or body mentions one of these addresses. */
function recall(addresses: string[], skipCa = '') {
  const want = addresses.filter(Boolean).map((a) => a.toLowerCase());
  const hits: { file: string; symbol: string; status: string; open: string; why: string }[] = [];
  for (const file of notes()) {
    const text = readFileSync(join(dir, file), 'utf8');
    const ca = front(text, 'ca');
    if (ca === skipCa) continue;
    const lower = text.toLowerCase();
    const why = want.find((a) => lower.includes(a));
    if (!why) continue;
    const role = front(text, 'deployer') === why ? 'deployer' : front(text, 'fee_recipient') === why ? 'fee recipient' : ca === why ? 'contract' : 'mentioned in notes';
    hits.push({ file, symbol: front(text, 'symbol'), status: front(text, 'status'), open: text.match(/^- \[ \] (.+)$/m)?.[1] ?? '', why: `${short(why)} is the ${role}` });
  }
  return hits;
}

function printHits(hits: ReturnType<typeof recall>) {
  if (!hits.length) return console.log(`${c.dim}  no earlier dossier shares this deployer or fee recipient${c.x}`);
  console.log(`${c.lime}${c.b}  RABIQ REMEMBERS${c.x}`);
  for (const h of hits) {
    console.log(`  ${c.lime}$${h.symbol}${c.x} ${c.dim}(${h.status})${c.x}  ${h.why}  ${c.dim}${h.file}${c.x}`);
    if (h.open) console.log(`    ${c.amber}? ${h.open}${c.x}`);
  }
}

async function dig(input: string, repos: string[]) {
  const ca = normalizeAddress(input)?.toLowerCase();
  if (!ca) throw new Error(`not an address: ${input}`);
  mkdirSync(snapDir, { recursive: true });
  const snapFile = join(snapDir, `${ca}.json`);
  const existing = notes().find((f) => front(readFileSync(join(dir, f), 'utf8'), 'ca') === ca);
  const known = existing ? readFileSync(join(dir, existing), 'utf8') : '';
  const sources = [...new Set([...repos, ...(known.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? [])])];

  process.stdout.write(`${c.dim}  reading Robinhood Chain, DexScreener${sources.length ? ', GitHub' : ''}…${c.x}\n`);
  const snap = await takeSnapshot(ca, sources);
  // the web app loads deployer history after the facts; the CLI can simply wait for it
  if (snap.chain?.deployer) {
    const hist = await readLaunches(snap.chain.deployer, snap.chain.block, ca);
    if (hist) { snap.launches = hist.list; snap.launchTotal = hist.total; }
  }
  const ch = snap.chain, m = snap.market;
  if (!ch && !m) throw new Error('nothing found for this address on Robinhood Chain');

  console.log(`\n  ${c.b}$${ch?.symbol ?? '?'}${c.x} ${c.dim}${ch?.name ?? ''} · ${ca}${c.x}`);
  const row = (k: string, v: string) => console.log(`  ${c.dim}${k.padEnd(18)}${c.x}${v}`);
  row('launchpad', ch?.launchpad === 'pons-v2' ? `${c.lime}Pons V2${c.x} · ${ch.phase}` : 'not a Pons V2 launch');
  row('deployer', ch?.deployer ?? '—');
  row('fee recipient', ch?.feeRecipient === ch?.deployer && ch?.deployer ? `${ch.feeRecipient} (deployer)` : ch?.feeRecipient ?? '—');
  row('creator tax', ch?.creatorTaxBps != null ? `${ch.creatorTaxBps / 100}%` : '—');
  row('fdv · liquidity', m ? `${usd(m.fdv)} · ${usd(m.liquidityUsd)}` : '—');
  row('deployer launches', snap.launches ? snap.launches.map((l) => (l.token === ca ? `${c.lime}$${l.symbol}${c.x}` : `$${l.symbol}`)).join(' ') : '—');
  for (const r of snap.repos) row('github', `${r.repo} @ ${r.sha.slice(0, 7)} · ${r.message}`);

  if (existsSync(snapFile)) {
    const prev: Snapshot = JSON.parse(readFileSync(snapFile, 'utf8'));
    const changes = diffSnapshots(prev, snap);
    console.log(`\n  ${c.b}SINCE YOUR CHECK${c.x} ${c.dim}${new Date(prev.at).toLocaleString()}${c.x}`);
    if (!changes.length) console.log(`  ${c.dim}nothing moved${c.x}`);
    for (const ch2 of changes) console.log(`  ${ch2.tone === 'up' ? c.lime + '▲' : ch2.tone === 'down' ? c.red + '▼' : ch2.tone === 'warn' ? c.red + '!' : c.amber + '•'}${c.x} ${ch2.text}`);
  }
  writeFileSync(snapFile, JSON.stringify(snap, null, 2));

  console.log('');
  printHits(recall([ch?.deployer ?? '', ch?.feeRecipient ?? ''], ca));

  let file = existing;
  if (known) {
    // only the machine-written facts block and frontmatter addresses are rewritten; your writing stays
    const next = known
      .replace(new RegExp(`${FACTS_START}[\\s\\S]*?${FACTS_END}`), factsMarkdown(snap))
      .replace(/^deployer:.*$/m, `deployer: ${ch?.deployer ?? ''}`)
      .replace(/^fee_recipient:.*$/m, `fee_recipient: ${ch?.feeRecipient ?? ''}`)
      .replace(/^updated:.*$/m, `updated: ${new Date().toISOString()}`);
    writeFileSync(join(dir, existing!), next);
  } else {
    const d = { ...blank(ca), symbol: ch?.symbol ?? '', name: ch?.name ?? '', sources, snapshots: [snap] };
    file = `${(d.symbol || 'token').replace(/[^\w-]/g, '')}-${ca.slice(2, 8)}.md`;
    writeFileSync(join(dir, file), toMarkdown(d));
  }
  console.log(`\n  ${c.lime}✓${c.x} dossier ${existing ? 'updated' : 'created'}: ${join(dir, file!)}\n`);
}

async function main() {
  banner();
  switch (cmd) {
    case 'dig': {
      const repos = args.filter((a, i) => args[i - 1] === '--repo');
      const ca = args.find((a) => /^0x/i.test(a));
      if (!ca) throw new Error('usage: rabiq dig <CA> [--repo https://github.com/owner/name]');
      return dig(ca, repos);
    }
    case 'recall': {
      const a = normalizeAddress(args[0] ?? '');
      if (!a) throw new Error('usage: rabiq recall <address>');
      return printHits(recall([a]));
    }
    case 'demo': {
      mkdirSync(snapDir, { recursive: true });
      for (const d of demoBurrow()) writeFileSync(join(dir, `${d.symbol}-demo.md`), toMarkdown(d));
      console.log(`  ${c.lime}✓${c.x} wrote a synthetic demo burrow (invented addresses) to ${dir}`);
      return printHits(recall(['0xdead00a100000000000000000000000000000000']));
    }
    default:
      console.log(`  rabiq dig <CA> [--repo URL]   open or update a dossier, show what changed and who you have seen before
  rabiq recall <address>        list dossiers that share this deployer / fee recipient / mention
  rabiq demo                    write a synthetic demo burrow

  notes live in ./burrow as markdown (Obsidian-friendly); set RABIQ_BURROW to move them\n`);
  }
}

main().catch((e) => {
  console.error(`${c.red}  ✕ ${e.message}${c.x}`);
  process.exit(1);
});
