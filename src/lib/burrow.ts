// The burrow: every dossier lives in this browser's localStorage. No server, no account.
import { usd, type Snapshot } from './sources.ts';

export type Status = 'watching' | 'digging' | 'in-position' | 'passed';
export const STATUSES: { id: Status; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'digging', label: 'Researching' },
  { id: 'in-position', label: 'In position' },
  { id: 'passed', label: 'Passed' },
];

export type Question = { text: string; done: boolean };

export type Dossier = {
  id: string; // robinhood:0x… lowercase
  ca: string;
  symbol: string;
  name: string;
  status: Status;
  reason: string;
  thesis: string;
  notes: string; // markdown, [[SYMBOL]] links to other dossiers
  pros: string[];
  cons: string[];
  checked: string[];
  questions: Question[];
  sources: string[];
  snapshots: Snapshot[]; // oldest first
  log: { at: number; text: string }[];
  origin?: { author: string; at: number }; // set when saved from someone's published dossier
  demo?: boolean;
  createdAt: number;
  updatedAt: number;
};

const KEY = 'rabiq.burrow.v1';
const SETTINGS = 'rabiq.settings.v1';
const MAX_SNAPSHOTS = 30;

export const idFor = (ca: string) => `robinhood:${ca.toLowerCase()}`;

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}

export function all(): Dossier[] {
  return Object.values(read<Record<string, Dossier>>(KEY, {})).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const get = (id: string): Dossier | undefined => read<Record<string, Dossier>>(KEY, {})[id];

export function put(d: Dossier) {
  const map = read<Record<string, Dossier>>(KEY, {});
  d.updatedAt = Date.now();
  d.snapshots = d.snapshots.slice(-MAX_SNAPSHOTS);
  d.log = d.log.slice(-200);
  map[d.id] = d;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function remove(id: string) {
  const map = read<Record<string, Dossier>>(KEY, {});
  delete map[id];
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function replaceAll(list: Dossier[]) {
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(list.map((d) => [d.id, d]))));
}

export function blank(ca: string): Dossier {
  const now = Date.now();
  return {
    id: idFor(ca), ca: ca.toLowerCase(), symbol: '', name: '',
    status: 'watching', reason: '', thesis: '', notes: '',
    pros: [], cons: [], checked: [], questions: [], sources: [],
    snapshots: [], log: [{ at: now, text: 'Dossier opened' }],
    createdAt: now, updatedAt: now,
  };
}

export const latest = (d: Dossier): Snapshot | undefined => d.snapshots[d.snapshots.length - 1];

export type Settings = { handle: string };
export const settings = (): Settings => ({ handle: '', ...read<Partial<Settings>>(SETTINGS, {}) });
export const saveSettings = (s: Settings) => localStorage.setItem(SETTINGS, JSON.stringify(s));

export const FACTS_START = '<!-- rabiq:facts -->';
export const FACTS_END = '<!-- /rabiq:facts -->';

/** Machine-written block; the CLI rewrites only this part of an existing note. */
export function factsMarkdown(s: Snapshot | undefined): string {
  if (!s) return `${FACTS_START}\n_No chain snapshot yet._\n${FACTS_END}`;
  const c = s.chain, m = s.market;
  const rows = [
    ['Checked', new Date(s.at).toISOString()],
    ['Launchpad', c?.launchpad ?? 'unknown'],
    ['Phase', c?.phase ?? '—'],
    ['Deployer', c?.deployer ?? '—'],
    ['Fee recipient', c?.feeRecipient ?? '—'],
    ['Creator tax', c?.creatorTaxBps != null ? `${c.creatorTaxBps / 100}%` : '—'],
    ['FDV', usd(m?.fdv)],
    ['Liquidity', usd(m?.liquidityUsd)],
    ...s.repos.map((r) => [`Repo ${r.repo}`, `${r.sha.slice(0, 7)} · ${r.message}`]),
    ['Deployer launches', s.launches ? s.launches.map((l) => `$${l.symbol}`).join(', ') || '—' : '—'],
  ];
  return `${FACTS_START}\n| Fact | Value |\n| --- | --- |\n${rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '/')} |`).join('\n')}\n${FACTS_END}`;
}

/** Obsidian-friendly markdown export of one dossier. */
export function toMarkdown(d: Dossier): string {
  const s = latest(d);
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- —');
  return `---
rabiq: 1
chain: robinhood
ca: ${d.ca}
symbol: ${d.symbol}
status: ${d.status}
deployer: ${s?.chain?.deployer ?? ''}
fee_recipient: ${s?.chain?.feeRecipient ?? ''}
updated: ${new Date(d.updatedAt).toISOString()}
---

# $${d.symbol || '?'} — ${d.name}

**Decision:** ${d.status}${d.reason ? ` — ${d.reason}` : ''}

${factsMarkdown(s)}

## Thesis
${d.thesis || '—'}

## For
${list(d.pros)}

## Against
${list(d.cons)}

## Checked
${list(d.checked)}

## Open questions
${d.questions.length ? d.questions.map((q) => `- [${q.done ? 'x' : ' '}] ${q.text}`).join('\n') : '- —'}

## Sources
${list(d.sources)}

## Notes
${d.notes || '—'}
`;
}
