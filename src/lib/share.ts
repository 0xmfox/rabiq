// Published dossiers travel inside the link itself (deflate + base64url). No server stores them.
import { blank, type Dossier, type Question } from './burrow.ts';
import type { Snapshot } from './sources.ts';
import { PHASES } from './chain.ts';

export type Published = {
  v: 1;
  author: string;
  at: number;
  ca: string;
  symbol: string;
  name: string;
  thesis: string;
  pros: string[];
  cons: string[];
  checked: string[];
  questions: Question[];
  sources: string[];
  notes?: string;
  snapshot?: Snapshot;
  links: { ca: string; symbol: string; label: string; confirmed: boolean }[];
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, t: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(t)).arrayBuffer());
}

// btoa/atob work in every browser and Node 16+; Uint8Array.toBase64 is still missing in older runtimes
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function pack(p: Published): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(p)), new CompressionStream('deflate-raw'));
  return toBase64Url(bytes);
}

export async function unpack(s: string): Promise<Published | null> {
  try {
    const bytes = fromBase64Url(s);
    const json = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'))));
    return sanitize(json);
  } catch {
    return null;
  }
}

// Trust boundary: a shared link is someone else's data. Keep only known fields with sane types and sizes.
const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const strs = (v: unknown, n = 50) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, 500)).filter(Boolean) : []);
const isCa = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const addrOrNull = (v: unknown) => (isCa(v) ? v.toLowerCase() : null);

function snapshotOf(s: any): Snapshot | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const c = s.chain, m = s.market;
  return {
    at: num(s.at) ?? 0,
    chain: c && typeof c === 'object' ? {
      block: num(c.block) ?? 0, name: str(c.name, 80), symbol: str(c.symbol, 24),
      launchpad: c.launchpad === 'pons-v2' ? 'pons-v2' : null,
      deployer: addrOrNull(c.deployer), feeRecipient: addrOrNull(c.feeRecipient), curve: addrOrNull(c.curve),
      phase: PHASES.includes(c.phase) ? c.phase : null, creatorTaxBps: num(c.creatorTaxBps),
    } : null,
    market: m && typeof m === 'object' ? {
      priceUsd: num(m.priceUsd), fdv: num(m.fdv), liquidityUsd: num(m.liquidityUsd), volume24h: num(m.volume24h),
      url: /^https:\/\/dexscreener\.com\//.test(str(m.url)) ? str(m.url, 300) : '',
    } : null,
    repos: (Array.isArray(s.repos) ? s.repos.slice(0, 10) : []).map((r: any) => ({
      repo: str(r?.repo, 140).toLowerCase().replace(/[^\w./-]/g, ''), sha: str(r?.sha, 40).replace(/[^0-9a-f]/gi, ''),
      message: str(r?.message, 140), committedAt: str(r?.committedAt, 40), pushedAt: str(r?.pushedAt, 40), stars: num(r?.stars) ?? 0, branch: str(r?.branch, 80),
    })),
    launchTotal: num(s.launchTotal),
    curve: s.curve && typeof s.curve === 'object' && num(s.curve.priceEth) != null ? { priceEth: num(s.curve.priceEth)!, raisedEth: num(s.curve.raisedEth) ?? 0, thresholdEth: num(s.curve.thresholdEth) ?? 0, progress: Math.max(0, Math.min(1, num(s.curve.progress) ?? 0)), quote: str(s.curve.quote, 16) } : null,
    launches: Array.isArray(s.launches) ? s.launches.slice(0, 41).filter((l: any) => isCa(l?.token)).map((l: any) => ({ token: l.token.toLowerCase(), symbol: str(l.symbol, 24) })) : null,
  };
}

export function sanitize(raw: any): Published | null {
  if (!raw || raw.v !== 1 || !isCa(raw.ca)) return null;
  return {
    v: 1,
    author: str(raw.author, 40).replace(/[^\w.-]/g, ''),
    at: Number(raw.at) || 0,
    ca: raw.ca.toLowerCase(),
    symbol: str(raw.symbol, 24),
    name: str(raw.name, 80),
    thesis: str(raw.thesis),
    pros: strs(raw.pros),
    cons: strs(raw.cons),
    checked: strs(raw.checked),
    questions: (Array.isArray(raw.questions) ? raw.questions.slice(0, 50) : [])
      .map((q: any) => ({ text: str(q?.text, 500), done: !!q?.done }))
      .filter((q: Question) => q.text),
    sources: strs(raw.sources).filter((u) => /^https?:\/\//i.test(u)),
    notes: raw.notes ? str(raw.notes, 20000) : undefined,
    snapshot: snapshotOf(raw.snapshot),
    links: (Array.isArray(raw.links) ? raw.links.slice(0, 50) : [])
      .filter((l: any) => isCa(l?.ca))
      .map((l: any) => ({ ca: l.ca.toLowerCase(), symbol: str(l.symbol, 24), label: str(l.label, 120), confirmed: !!l.confirmed })),
  };
}

/** Private by default: status, reason and notes stay home unless the owner opts in. */
export function publish(d: Dossier, author: string, related: Published['links'], includeNotes: boolean): Published {
  const s = d.snapshots[d.snapshots.length - 1];
  return {
    v: 1, author, at: Date.now(), ca: d.ca, symbol: d.symbol, name: d.name,
    thesis: d.thesis, pros: d.pros, cons: d.cons, checked: d.checked, questions: d.questions, sources: d.sources,
    notes: includeNotes ? d.notes : undefined,
    snapshot: s && { ...s, launches: s.launches?.slice(-10) ?? null },
    links: related,
  };
}

/** "Save to my brain": merge a published dossier into yours without overwriting your own thinking. */
export function adopt(p: Published, mine: Dossier | undefined): Dossier {
  const d = mine ? structuredClone(mine) : blank(p.ca);
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  const who = p.author ? `@${p.author}` : 'a researcher';
  d.symbol ||= p.symbol;
  d.name ||= p.name;
  d.thesis = d.thesis ? `${d.thesis}\n\n— ${who}: ${p.thesis}` : p.thesis;
  d.pros = merge(d.pros, p.pros);
  d.cons = merge(d.cons, p.cons);
  d.checked = merge(d.checked, p.checked.map((c) => `${c} (checked by ${who})`));
  for (const q of p.questions) if (!d.questions.some((x) => x.text === q.text)) d.questions.push(q);
  d.sources = merge(d.sources, p.sources);
  if (p.notes) d.notes = `${d.notes}\n\n## Notes from ${who}\n${p.notes}`.trim();
  if (p.snapshot && !d.snapshots.length) d.snapshots.push(p.snapshot);
  d.origin ??= { author: p.author, at: p.at };
  d.log.push({ at: Date.now(), text: `Saved research from ${who}` });
  return d;
}
