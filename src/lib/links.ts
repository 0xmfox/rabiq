// Red strings: how dossiers in one burrow connect. Confirmed = identical on-chain address or repo.
// Hypothesis = something you wrote in your own notes.
import { latest, type Dossier } from './burrow.ts';
import { parseRepo } from './sources.ts';

export type LinkKind = 'deployer' | 'fee-recipient' | 'deployer-fee' | 'repo' | 'mention';
export type Link = { a: string; b: string; kind: LinkKind; confirmed: boolean; label: string; via?: string };

function facts(d: Dossier) {
  const s = latest(d);
  const text = [d.thesis, d.notes, d.reason, ...d.pros, ...d.cons, ...d.checked, ...d.questions.map((q) => q.text)]
    .join('\n')
    .toLowerCase();
  const repos = new Set([...d.sources.map(parseRepo), ...(s?.repos.map((r) => r.repo) ?? [])].filter(Boolean) as string[]);
  return { deployer: s?.chain?.deployer ?? null, fee: s?.chain?.feeRecipient ?? null, repos, text };
}

function mentions(text: string, d: Dossier, deployer: string | null) {
  if (text.includes(d.ca)) return 'its contract address';
  if (deployer && text.includes(deployer)) return 'its deployer address';
  const sym = d.symbol.toLowerCase();
  if (sym && (text.includes(`[[${sym}]]`) || new RegExp(`\\$${sym.replace(/[^\w]/g, '')}\\b`).test(text))) return `$${d.symbol}`;
  return null;
}

// ponytail: O(n²) pair scan; fine up to a few thousand dossiers, index by address if burrows get huge
export function findLinks(list: Dossier[]): Link[] {
  const f = new Map(list.map((d) => [d.id, facts(d)]));
  const out: Link[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      const a = f.get(A.id)!, b = f.get(B.id)!;
      const add = (kind: LinkKind, confirmed: boolean, label: string, via?: string) =>
        out.push({ a: A.id, b: B.id, kind, confirmed, label, via });
      if (a.deployer && a.deployer === b.deployer) add('deployer', true, 'Same deployer', a.deployer);
      if (a.fee && a.fee === b.fee && a.fee !== a.deployer) add('fee-recipient', true, 'Same fee recipient', a.fee);
      if (a.deployer && a.deployer === b.fee && b.fee !== b.deployer) add('deployer-fee', true, `${A.symbol} deployer receives ${B.symbol} fees`, a.deployer);
      if (b.deployer && b.deployer === a.fee && a.fee !== a.deployer) add('deployer-fee', true, `${B.symbol} deployer receives ${A.symbol} fees`, b.deployer);
      for (const r of a.repos) if (b.repos.has(r)) add('repo', true, 'Same GitHub repo', r);
      const ab = mentions(a.text, B, b.deployer);
      const ba = mentions(b.text, A, a.deployer);
      if (ab) add('mention', false, `Your ${A.symbol || 'notes'} notes mention ${ab}`);
      if (ba) add('mention', false, `Your ${B.symbol || 'notes'} notes mention ${ba}`);
    }
  }
  return out;
}

export const linksOf = (id: string, links: Link[]) =>
  links.filter((l) => l.a === id || l.b === id).map((l) => ({ ...l, other: l.a === id ? l.b : l.a }));
