import './style.css';
import './desk.css';
import { mountChrome, syncChrome, REPO_URL, X_URL } from './chrome.ts';
import { deskHTML, mountDesk } from './deskview.ts';
import { docsHTML, mountDocs } from './docs.ts';
import { dossierLiveHTML, mountDossierLive } from './dossierlive.ts';
import * as burrow from './lib/burrow.ts';
import { STATUSES, latest, type Dossier } from './lib/burrow.ts';
import { EXPLORER, normalizeAddress } from './lib/chain.ts';
import { demoBurrow } from './lib/demo.ts';
import { findLinks, linksOf, type Link } from './lib/links.ts';
import { esc, md } from './lib/md.ts';
import { adopt, pack, publish, unpack, type Published } from './lib/share.ts';
import { diffSnapshots, readLaunches, short, takeSnapshot, ticker, usd, type Snapshot } from './lib/sources.ts';
import { renderGraph } from './graph.ts';
import { landingHTML, mountLanding } from './landing.ts';
import { seedBlock, startBlockTicker } from './lib/live.ts';

export { REPO_URL, X_URL };
const app = document.querySelector<HTMLDivElement>('#app')!;
const loading = new Set<string>();
const failed = new Set<string>();
let filter = '';
let notesEdit = false;
let shared: Published | null = null;
let unmountLanding: (() => void) | null = null;
let unmountDesk: (() => void) | null = null;
let statusSlide: { id: string; from: number } | null = null;
let justAdded = '';

// render() rebuilds the page on every keystroke, so entrance animations are keyed to events
// (a route opened, a snapshot arrived, a status changed) and play once per key until the route changes.
const played = new Set<string>();
const once = (key: string) => (played.has(key) ? '' : (played.add(key), ' play'));

// ---------- helpers ----------
const statusLabel = (s: Dossier['status']) => STATUSES.find((x) => x.id === s)!.label;
const ago = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const phaseLabel = (p: string | null | undefined) =>
  ({ curve: 'Bonding curve', swept: 'Curve completed · pool pending', graduated: 'Graduated · Uniswap v4 pool', rescued: 'Rescued · reserves released' } as Record<string, string>)[p ?? ''] ?? '—';
const addrLink = (a: string | null | undefined) =>
  a ? `<a href="${EXPLORER}/address/${a}" target="_blank" rel="noopener noreferrer" title="${a}">${short(a)}</a>` : '—';
const route = () => location.hash.replace(/^#/, '') || '/';

function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function download(name: string, text: string, type = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function logEvent(d: Dossier, text: string) {
  d.log.push({ at: Date.now(), text });
}

// ---------- data flow ----------
async function refresh(d: Dossier, force = false) {
  if (d.demo || loading.has(d.id)) return;
  const last = latest(d);
  if (!force && last && Date.now() - last.at < 60_000) return;
  loading.add(d.id);
  failed.delete(d.id);
  render();
  try {
    const snap = await takeSnapshot(d.ca, d.sources);
    if (snap.chain) seedBlock(snap.chain.block);
    const cur = burrow.get(d.id) ?? d;
    if (!snap.chain && !snap.market) failed.add(d.id);
    const prev = latest(cur);
    if (prev?.launches && prev.chain?.deployer === snap.chain?.deployer) { snap.launches = prev.launches; snap.launchTotal = prev.launchTotal; }
    const changes = prev ? diffSnapshots(prev, snap) : [];
    // keep the previous check around until something actually moves, so "since last check" survives reloads
    if (prev && !changes.length && cur.snapshots.length > 1) cur.snapshots[cur.snapshots.length - 1] = snap;
    else cur.snapshots.push(snap);
    cur.symbol ||= snap.chain?.symbol ?? '';
    cur.name ||= snap.chain?.name ?? '';
    if (changes.length) logEvent(cur, `Refreshed: ${changes.length} change${changes.length === 1 ? '' : 's'}`);
    burrow.put(cur);
    // the previous list stays on screen while the whole-history query (one request) reads what's new
    if (snap.chain?.deployer) loadLaunchHistory(d.id, snap, snap.chain.deployer, snap.chain.block, d.ca);
  } finally {
    loading.delete(d.id);
    render();
  }
}

// Deployer history is a slow, bounded log scan; it loads in the background so it never blocks the facts card.
const historyTried = new Set<string>(); // once per check, so a render loop can't turn a failed read into a request storm
async function loadLaunchHistory(id: string, snap: Snapshot, deployer: string, block: number, ca: string) {
  if (historyTried.has(`${id}:${snap.at}`)) return;
  historyTried.add(`${id}:${snap.at}`);
  let launches = await readLaunches(deployer, block, ca);
  if (!launches) { await new Promise((r) => setTimeout(r, 2000)); launches = await readLaunches(deployer, block, ca); }
  if (!launches) return;
  // burrow.get parses storage, so compare checks by timestamp, not identity (identity never matched: history was dropped)
  const cur = burrow.get(id), last = cur && latest(cur);
  if (!last || last.at !== snap.at) return; // dossier gone, or a newer check already replaced this snapshot
  last.launches = launches.list;
  last.launchTotal = launches.total;
  burrow.put(cur);
  render();
}

function dig(input: string) {
  const ca = normalizeAddress(input);
  if (!ca) return toast('Not a valid 0x address');
  const id = burrow.idFor(ca);
  if (!burrow.get(id)) burrow.put(burrow.blank(ca));
  location.hash = `#/d/${ca.toLowerCase()}`;
}

function publishedLinks(d: Dossier, all: Dossier[], links: Link[]): Published['links'] {
  return linksOf(d.id, links).flatMap((l) => {
    const o = all.find((x) => x.id === l.other);
    return o ? [{ ca: o.ca, symbol: o.symbol, label: l.label, confirmed: l.confirmed }] : [];
  });
}

// ---------- views ----------
function shell(main: string, full = false) {
  const all = burrow.all();
  const r = route();
  const q = filter.toLowerCase();
  const list = all.filter((d) => !q || d.symbol.toLowerCase().includes(q) || d.ca.includes(q) || d.name.toLowerCase().includes(q));
  const current = r.startsWith('/d/') ? burrow.idFor(r.slice(3)) : '';
  if (full) return `<div class="layout full"><main class="page${once('page')}">${main}</main></div>`;
  return `
  <div class="layout">
    <aside class="side">
      <div class="side-head"><span>Dossiers</span><span class="count">${all.length}</span></div>
      <input class="field sm" data-filter placeholder="Filter by symbol or address" value="${esc(filter)}">
      <div class="list">${list.map((d) => `
        <a class="item ${d.id === current ? 'on' : ''}" href="#/d/${d.ca}">
          <span class="dot st-${d.status}"></span>
          <span class="sym">${esc(d.symbol || 'Unknown')}</span>
          <span class="ca">${short(d.ca)}${d.demo ? ' · demo' : ''}</span>
        </a>`).join('') || (all.length ? '<div class="empty-line">Nothing matches.</div>' : '<div class="side-empty"><img src="rabiq-cut.png" alt=""><p>No dossiers yet. Paste a contract above or open one from the live wire.</p></div>')}</div>
      <div class="side-actions">
        <button class="btn ghost sm" data-act="demo">Load demo</button>
        <button class="btn ghost sm" data-act="export-all">Export</button>
        <label class="btn ghost sm">Import<input type="file" accept="application/json" data-import hidden></label>
      </div>
    </aside>
    <main class="page${once('page')}">${main}</main>
  </div>`;
}

function filesView() {
  const all = burrow.all().sort((a, b) => (latest(b)?.at ?? b.createdAt) - (latest(a)?.at ?? a.createdAt));
  const cards = all.map((d, i) => {
    const s = latest(d), q = d.questions.find((x) => !x.done);
    return `<a class="fcard" href="#/d/${d.ca}" style="--i:${Math.min(i, 12)}">
      <span class="fcard-top"><b>${esc(ticker(d.symbol || '?'))}</b><span class="tag st-${d.status}">${statusLabel(d.status)}</span></span>
      <span class="fcard-ca mono">${short(d.ca)}${d.demo ? ' · demo' : ''}</span>
      <span class="fcard-thesis">${esc(d.thesis.slice(0, 120) || 'No thesis yet.')}</span>
      <span class="fcard-foot"><span>${s?.market?.fdv != null ? `FDV ${usd(s.market.fdv)}` : 'Not checked'}</span>${s?.launchTotal ? `<span>${s.launchTotal} deployer launches</span>` : ''}${q ? `<span class="q">? ${esc(q.text.slice(0, 48))}</span>` : ''}</span>
    </a>`;
  }).join('');
  return `<div class="home">
    <section class="home-hero${once('home')}">
      <p class="label"><span>File index</span>Your burrow</p>
      <h1 class="display">Open a file<em>.</em></h1>
      <p class="lede">Paste any contract address. RABIQ reads the launch record, the market and the repository, then lists every other token the same wallet launched.</p>
      <form class="dig big" data-form="dig"><input class="field" name="ca" placeholder="0x… contract address" autocomplete="off" spellcheck="false"><button class="btn primary">Open file</button></form>
      <div class="home-alt"><a href="#/app">Pick a token from the live desk</a><button class="link" data-act="demo">Load demo dossiers</button><a href="#/graph">Open the graph</a></div>
      <img class="home-bunny" src="rabiq-cut.png" alt="" width="518" height="900">
    </section>
    <section class="files${once('files')}">
      <div class="wire-head"><span class="label"><span>Dossiers</span>${all.length} in this browser</span><span class="muted small">Stored locally · Export from the sidebar</span></div>
      ${cards ? `<div class="fgrid">${cards}</div>` : '<div class="empty-line" style="padding:22px 0">No dossiers yet. Open a file on any contract, or pick one from the live desk.</div>'}
    </section>
  </div>`;
}

function factsCard(d: Dossier, all: Dossier[]) {
  const s = latest(d);
  const busy = loading.has(d.id);
  const sk = '<span class="skeleton"></span>';
  const v = (x: string) => (busy && !s ? sk : x);
  const c = s?.chain, m = s?.market;
  const known = new Map(all.map((x) => [x.ca, x]));
  const launches = s?.launches
    ? `<div class="launches">${s.launches.map((l) => {
        const k = known.get(l.token);
        return `<a class="${l.token === d.ca ? 'self' : k ? 'known' : ''}" href="#/d/${l.token}" title="${l.token}">${esc(ticker(l.symbol))}</a>`;
      }).join('')}</div>`
    : '—';
  return `<section class="card"><h2>On-chain facts <span class="aside">${busy ? 'Reading chain…' : s ? `Checked ${ago(s.at)}${c ? ` · block ${c.block.toLocaleString()}` : ''}` : 'Not checked yet'}</span></h2>
    ${failed.has(d.id) ? '<p class="red">Could not read this address from Robinhood Chain or DexScreener. Check the CA.</p>' : ''}
    <dl class="facts${s && !busy ? once(`facts:${d.id}:${s.at}`) : ''}">
      <dt>Launchpad</dt><dd>${v(c?.launchpad === 'pons-v2' ? 'Pons V2' : c ? 'Not a Pons V2 launch' : '—')}</dd>
      <dt>Phase</dt><dd>${v(phaseLabel(c?.phase))}${s?.curve && c?.phase === 'curve' ? `<span class="curve-bar" style="--p:${s.curve.progress}"><i></i></span><span class="muted mono small">${s.curve.raisedEth.toLocaleString('en-US', { maximumFractionDigits: 3 })} / ${s.curve.thresholdEth.toLocaleString('en-US')} ${esc(s.curve.quote ?? 'ETH')} to graduate · ${(s.curve.progress * 100).toFixed(1)}%</span>` : ''}</dd>
      <dt>Deployer</dt><dd>${v(addrLink(c?.deployer))}</dd>
      <dt>Fee recipient</dt><dd>${v(c?.feeRecipient === c?.deployer && c?.deployer ? `${addrLink(c?.feeRecipient)} <span class="muted">(deployer)</span>` : addrLink(c?.feeRecipient))}</dd>
      <dt>Creator tax</dt><dd>${v(c?.creatorTaxBps != null ? `${c.creatorTaxBps / 100}%` : '—')}</dd>
      <dt>FDV · Liquidity</dt><dd>${v(m ? `${usd(m.fdv)} · ${usd(m.liquidityUsd)}` : '—')}</dd>
      <dt>Volume 24h</dt><dd>${v(m ? usd(m.volume24h) : '—')}</dd>
      <dt>Deployer launches</dt><dd>${v(s?.launchTotal ? `<span class="launch-total">${s.launchTotal.toLocaleString()} total${s.launchTotal > (s.launches?.length ?? 0) ? ` · latest ${Math.min(40, s.launchTotal)} shown` : ''}</span>${launches}` : launches)}</dd>
      ${s?.repos.map((r) => `<dt>GitHub</dt><dd><a href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a> · <code>${esc(r.sha.slice(0, 7))}</code> · ${esc(r.message)} · ★${r.stars}</dd>`).join('') ?? ''}
    </dl></section>`;
}

function listBlock(d: Dossier, key: 'pros' | 'cons' | 'checked', placeholder: string, locked: boolean) {
  const xs = d[key];
  return `<ul class="items ${key}">${xs.map((x, i) => `<li class="${justAdded === `${key}:${x}` ? 'add' : ''}"><span>${esc(x)}</span>${locked ? '' : `<button class="x" data-act="del-item" data-list="${key}" data-i="${i}" title="Remove">✕</button>`}</li>`).join('') || `<li class="empty-line">None yet</li>`}</ul>
    ${locked ? '' : `<form class="adder" data-form="add" data-list="${key}"><input class="field" name="text" placeholder="${placeholder}" autocomplete="off"><button class="btn sm">Add</button></form>`}`;
}

function dossierView(d: Dossier, opts: { locked?: boolean; publishedLinks?: Published['links'] } = {}) {
  const all = burrow.all();
  const links = findLinks(opts.locked ? all.concat(all.some((x) => x.id === d.id) ? [] : [d]) : all);
  const mine = linksOf(d.id, links);
  const ro = !!opts.locked;
  const s = latest(d), prev = d.snapshots[d.snapshots.length - 2];
  const changes = s && prev ? diffSnapshots(prev, s) : [];
  const firstOpen = d.questions.findIndex((q) => !q.done);
  const resolve = (ref: string) => {
    const hit = all.find((x) => x.symbol.toLowerCase() === ref.toLowerCase() || x.ca === ref.toLowerCase());
    return hit ? `#/d/${hit.ca}` : null;
  };

  const memoryHits = ro ? [] : mine.filter((l) => l.confirmed).map((l) => ({ l, o: all.find((x) => x.id === l.other)! })).filter((h) => h.o);
  const memory = memoryHits.length
    ? `<section class="memory${once(`memory:${d.id}:${memoryHits.length}`)}"><h3>RABIQ remembers</h3><p class="sub">You already have ${memoryHits.length} dossier${memoryHits.length === 1 ? '' : 's'} connected to this deployer.</p>${memoryHits.map(({ l, o }) => {
        const q = o.questions.find((x) => !x.done);
        return `<div class="hit"><a href="#/d/${o.ca}">${esc(ticker(o.symbol))}</a><span>${esc(l.label)} <span class="sep">/</span> <span class="st-${o.status} stx">${statusLabel(o.status)}</span>${o.reason ? ` <span class="muted">${esc(o.reason)}</span>` : ''}</span>
          <span></span><span class="muted">${esc(o.thesis.slice(0, 180) || 'No thesis written.')}</span>${q ? `<span></span><span class="q">${esc(q.text)}</span>` : ''}</div>`;
      }).join('')}</section>`
    : '';

  const since = s && prev && changes.length
    ? `<section class="since${once(`since:${d.id}:${s.at}`)}"><h3>Since your last check <span class="muted">${ago(prev.at)}</span></h3>${changes.length ? `<ul>${changes.map((c) => `<li class="${c.tone}">${c.href ? `<a href="${c.href}" target="_blank" rel="noopener noreferrer">${esc(c.text)}</a>` : esc(c.text)}</li>`).join('')}</ul>` : '<span class="muted">No changes.</span>'}</section>`
    : '';

  const connections = opts.publishedLinks
    ? opts.publishedLinks.map((l) => `<a class="conn" href="#/d/${l.ca}"><span class="kind ${l.confirmed ? 'c' : 'h'}">${l.confirmed ? 'Confirmed' : 'Hypothesis'}</span><span class="sym">${esc(ticker(l.symbol))}</span><span class="via">${esc(l.label)}</span></a>`).join('')
    : mine.filter((l) => l.confirmed || !mine.some((x) => x.confirmed && x.other === l.other)).map((l) => {
        const o = all.find((x) => x.id === l.other)!;
        return `<a class="conn" href="#/d/${o.ca}"><span class="kind ${l.confirmed ? 'c' : 'h'}">${l.confirmed ? 'Confirmed' : 'Hypothesis'}</span><span class="sym">${esc(ticker(o.symbol || '???'))}</span><span class="via">${esc(l.label)}${l.via ? ` · ${esc(short(l.via))}` : ''}</span></a>`;
      }).join('');

  return `<div class="dossier">
    ${d.demo ? '<div class="demo-flag">Demo dossier. Addresses, numbers and repositories are invented.</div>' : ''}
    <section class="dhead${once(`dhead:${d.id}`)}">
      <div class="dhead-main">
        <p class="label"><span>File <b>${short(d.ca)}</b></span>${d.name && d.name !== d.symbol ? esc(d.name) : 'Robinhood Chain'}</p>
        <h1 class="display">${esc(d.symbol || 'Unknown')}</h1>
        <div class="ca"><code>${d.ca}</code><button class="copy" data-act="copy" data-text="${d.ca}">Copy</button>
          <a href="${EXPLORER}/token/${d.ca}" target="_blank" rel="noopener noreferrer">Blockscout ↗</a>
          <a href="https://dexscreener.com/robinhood/${d.ca}" target="_blank" rel="noopener noreferrer">DexScreener ↗</a></div>
        ${ro ? '' : `<div class="meta"><span>Opened ${ago(d.createdAt)}</span>${s ? `<span>Checked ${ago(s.at)}</span>` : ''}${d.origin ? `<span>Saved from @${esc(d.origin.author || 'anon')}</span>` : ''}</div>`}
      </div>
      ${ro ? '' : `<div class="dhead-side">
        <div class="verdict st-${d.status}${once(`verdict:${d.id}:${d.status}`)}" title="Your decision">${statusLabel(d.status)}</div>
        <div class="actions">
          <button class="btn sm${loading.has(d.id) ? ' busy' : ''}" data-act="refresh" ${d.demo ? 'disabled' : ''}>${loading.has(d.id) ? '<i class="spin"></i>Reading chain' : 'Refresh'}</button>
          <button class="btn sm primary" data-act="publish">Publish</button>
          <button class="btn sm" data-act="export">Export .md</button>
          <button class="btn sm ghost danger" data-act="delete">Delete</button>
        </div>
      </div>`}
    </section>
    ${ro ? '' : dossierLiveHTML(d.ca, s, once(`dlive:${d.id}`) !== '')}
    ${memory}${since}
    <div class="grid">
      <div class="col">
        ${ro ? '' : `<section class="card"><h2>Decision</h2>
          <div class="statuses${statusSlide?.id === d.id ? ' slide' : ''}" style="--idx:${STATUSES.findIndex((st) => st.id === d.status)};--from:${statusSlide?.id === d.id ? statusSlide.from : 0}">${STATUSES.map((st) => `<button class="st-${st.id} ${d.status === st.id ? 'on' : ''}" data-act="status" data-status="${st.id}">${st.label}</button>`).join('')}</div>
          <input class="field" data-field="reason" placeholder="Reason (private)" value="${esc(d.reason)}"></section>`}
        <section class="card"><h2>Thesis</h2>${ro ? `<div class="notes-view">${md(d.thesis || '—', resolve)}</div>` : `<textarea class="field" data-field="thesis" placeholder="What is this project and how do you know?">${esc(d.thesis)}</textarea>`}</section>
        <section class="card two">
          <div><h2>For</h2>${listBlock(d, 'pros', 'Add an argument for', ro)}</div>
          <div><h2>Against</h2>${listBlock(d, 'cons', 'Add an argument against', ro)}</div>
        </section>
        <section class="card"><h2>Open questions</h2>
          <ul class="items">${d.questions.map((q, i) => `<li class="${q.done ? 'done' : ''} ${i === firstOpen ? 'pick' : ''} ${justAdded === `q:${q.text}` ? 'add' : ''}"><input type="checkbox" ${q.done ? 'checked' : ''} ${ro ? 'disabled' : ''} data-act="q-toggle" data-i="${i}"><span>${esc(q.text)}</span>${ro ? '' : `<button class="x" data-act="del-q" data-i="${i}">✕</button>`}</li>`).join('') || '<li class="empty-line">No open questions.</li>'}</ul>
          ${ro ? '' : '<form class="adder" data-form="add-q"><input class="field" name="text" placeholder="Add a question" autocomplete="off"><button class="btn sm">Add</button></form>'}
        </section>
        <section class="card"><h2>Checked</h2>${listBlock(d, 'checked', 'Add something you verified', ro)}</section>
        <section class="card"><h2>Notes <span class="aside">Markdown · [[SYMBOL]] links</span>${ro ? '' : `<button class="btn sm ghost" data-act="notes-mode">${notesEdit ? 'Preview' : 'Edit'}</button>`}</h2>
          ${!ro && notesEdit ? `<textarea class="field" data-field="notes" rows="10" placeholder="Anything. Paste addresses, write [[MOLE]] to link another dossier.">${esc(d.notes)}</textarea>` : `<div class="notes-view">${md(d.notes || (ro ? '—' : 'No notes.'), resolve)}</div>`}
        </section>
      </div>
      <div class="col">
        ${factsCard(d, all)}
        <section class="card"><h2>Connections <span class="aside">${opts.publishedLinks ? opts.publishedLinks.length : mine.length}</span></h2>
          <div class="conns">${connections || '<div class="empty-line">No connections. Dossiers connect through a shared deployer, fee recipient, repository or your notes.</div>'}</div></section>
        <section class="card"><h2>Sources</h2>
          <ul class="items sources">${d.sources.map((u, i) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>${ro ? '' : `<button class="x" data-act="del-item" data-list="sources" data-i="${i}">✕</button>`}</li>`).join('') || '<li class="empty-line">No sources.</li>'}</ul>
          ${ro ? '' : '<form class="adder" data-form="add" data-list="sources"><input class="field" name="text" placeholder="Add a link" autocomplete="off"><button class="btn sm">Add</button></form>'}
        </section>
        ${ro ? '' : `<section class="card"><h2>Timeline</h2><div class="log">${d.log.slice().reverse().map((e) => `<div><b>${new Date(e.at).toLocaleString()}</b> · ${esc(e.text)}</div>`).join('')}</div></section>`}
      </div>
    </div>
  </div>`;
}

function sharedView(p: Published) {
  // preview of the author's dossier as they wrote it; attribution is added only on save
  const temp = { ...adopt(p, undefined), checked: p.checked, origin: undefined };
  const mineAlready = burrow.get(temp.id);
  return `<div class="dossier">
    <section class="shared${once('shared')}"><span class="verdict published">Published</span><div class="grow"><h3>Published dossier${p.author ? ` by @${esc(p.author)}` : ''}</h3><span class="muted">${p.at ? new Date(p.at).toLocaleString() : ''} · Status and private notes are not included unless the author added them</span></div>
      <button class="btn primary" data-act="adopt">${mineAlready ? 'Merge into my dossier' : 'Save to my brain'}</button></section>
    ${dossierView(temp, { locked: true, publishedLinks: p.links })}
  </div>`;
}

function publishDialog(d: Dossier) {
  const { handle } = burrow.settings();
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h3>Publish ${esc(d.symbol || 'dossier')}</h3>
    <p class="muted">The link contains the dossier. Status, reason and notes are excluded unless you include notes.</p>
    <label>X handle <input class="field" name="handle" value="${esc(handle)}" placeholder="yourhandle" style="flex:1"></label>
    <label><input type="checkbox" name="notes"> include my notes</label>
    <textarea class="field" name="link" readonly rows="3" style="margin-top:12px"></textarea>
    <div class="row"><button class="btn primary" data-dlg="copy">Copy link</button><a class="btn" data-dlg="post" target="_blank" rel="noopener">Post on X</a><button class="btn ghost" data-dlg="close">Close</button></div>`;
  document.body.appendChild(dlg);
  const handleIn = dlg.querySelector<HTMLInputElement>('[name=handle]')!;
  const notesIn = dlg.querySelector<HTMLInputElement>('[name=notes]')!;
  const linkOut = dlg.querySelector<HTMLTextAreaElement>('[name=link]')!;
  const post = dlg.querySelector<HTMLAnchorElement>('[data-dlg=post]')!;
  const update = async () => {
    const author = handleIn.value.replace(/[^\w.-]/g, '').slice(0, 40);
    burrow.saveSettings({ handle: author });
    const all = burrow.all();
    const url = `${location.origin}${location.pathname}#/s/${await pack(publish(d, author, publishedLinks(d, all, findLinks(all)), notesIn.checked))}`;
    linkOut.value = url;
    const open = d.questions.filter((q) => !q.done).length;
    post.href = `https://x.com/intent/post?text=${encodeURIComponent(`$${d.symbol} dossier on RABIQ: ${d.checked.length} checked, ${open} open question${open === 1 ? '' : 's'}.`)}&url=${encodeURIComponent(url)}`;
  };
  handleIn.addEventListener('input', update);
  notesIn.addEventListener('change', update);
  dlg.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-dlg]')?.dataset.dlg;
    if (act === 'copy') { await navigator.clipboard.writeText(linkOut.value); toast('Link copied'); }
    if (act === 'close' || e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  update();
  dlg.showModal();
}

// ---------- render ----------
async function render() {
  const r = route();
  syncChrome(r);
  if (r === '/') {
    unmountDesk?.();
    unmountDesk = null;
    // the landing runs its own live reads; re-rendering it would restart them
    if (!unmountLanding) { app.innerHTML = landingHTML(); unmountLanding = mountLanding(app); }
    return;
  }
  unmountLanding?.();
  unmountLanding = null;
  const focus = document.activeElement as HTMLInputElement | null;
  const focusKey = focus?.dataset?.filter !== undefined ? 'filter' : null;
  let main = '';
  const full = r === '/app' || r === '/how' || r === '/docs';
  if (r === '/app') main = deskHTML();
  else if (r === '/how' || r === '/docs') main = docsHTML(r);
  else if (r === '/files') main = filesView();
  else if (r === '/graph') main = '<section class="panel graph-wrap" id="graph"></section>';
  else if (r.startsWith('/d/')) {
    const ca = normalizeAddress(r.slice(3));
    if (!ca) main = '<section class="card"><h2>Not an address</h2></section>';
    else {
      let d = burrow.get(burrow.idFor(ca));
      if (!d) { d = burrow.blank(ca); burrow.put(d); }
      main = dossierView(d);
      const snap = latest(d);
      if (!d.demo && !loading.has(d.id) && (!snap || Date.now() - snap.at > 10 * 60_000)) queueMicrotask(() => refresh(d!));
      // a recent check whose deployer history never landed: fetch just that, no full refresh
      else if (!d.demo && snap && !snap.launches && snap.chain?.deployer) loadLaunchHistory(d.id, snap, snap.chain.deployer, snap.chain.block, d.ca);
    }
  } else if (r.startsWith('/s/')) {
    shared ??= await unpack(r.slice(3));
    main = shared ? sharedView(shared) : '<section class="card"><h2>Broken link</h2><p class="muted">This published dossier could not be read.</p></section>';
  }
  unmountDesk?.();
  unmountDesk = null;
  const y = scrollY;
  const graphIntro = r === '/graph' && once('graph') !== '';
  app.innerHTML = shell(main, full);
  scrollTo(0, y);
  if (r === '/app') unmountDesk = mountDesk(app);
  if (r === '/how' || r === '/docs') mountDocs(app);
  if (r.startsWith('/d/')) { const d = burrow.get(burrow.idFor(r.slice(3))); mountDossierLive(app, d && !d.demo ? latest(d) : undefined); }
  justAdded = '';
  statusSlide = null;
  if (r === '/graph') renderGraph(document.getElementById('graph')!, burrow.all(), graphIntro);
  if (focusKey === 'filter') {
    const el = app.querySelector<HTMLInputElement>('[data-filter]')!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function currentDossier(): Dossier | undefined {
  const r = route();
  return r.startsWith('/d/') ? burrow.get(burrow.idFor(r.slice(3))) : undefined;
}

// ---------- events ----------
app.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  const text = String(new FormData(form).get('text') ?? new FormData(form).get('ca') ?? '').trim();
  if (form.dataset.form === 'dig') return dig(text);
  const d = currentDossier();
  if (!d || !text) return;
  if (form.dataset.form === 'add-q') { d.questions.push({ text, done: false }); justAdded = `q:${text}`; }
  if (form.dataset.form === 'add') {
    const key = form.dataset.list as 'pros' | 'cons' | 'checked' | 'sources';
    if (key === 'sources' && !/^https?:\/\//i.test(text)) return toast('Sources must be http(s) links');
    if (d[key].includes(text)) return;
    d[key].push(text);
    justAdded = `${key}:${text}`;
    burrow.put(d);
    if (key === 'sources' && /github\.com/i.test(text)) return void refresh(d, true);
  }
  burrow.put(d);
  render();
  app.querySelector<HTMLInputElement>(`form[data-form="${form.dataset.form}"]${form.dataset.list ? `[data-list="${form.dataset.list}"]` : ''} input`)?.focus();
});

let saveTimer = 0;
app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.filter !== undefined) { filter = el.value; return render(); }
  const field = el.dataset.field as 'thesis' | 'notes' | 'reason' | undefined;
  const d = currentDossier();
  if (!field || !d) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { const cur = burrow.get(d.id)!; cur[field] = el.value; burrow.put(cur); }, 250);
});

app.addEventListener('change', async (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.import !== undefined && el.files?.[0]) {
    try {
      const list = JSON.parse(await el.files[0].text());
      if (!Array.isArray(list)) throw new Error('not a list');
      const current = Object.fromEntries(burrow.all().map((d) => [d.id, d]));
      for (const d of list) if (d?.id && d?.ca && /^0x[0-9a-f]{40}$/.test(d.ca)) current[d.id] = { ...burrow.blank(d.ca), ...d };
      burrow.replaceAll(Object.values(current));
      toast(`Imported ${list.length} dossier(s)`);
      render();
    } catch { toast('Could not read that file'); }
  }
});

app.addEventListener('click', async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t) return;
  const act = t.dataset.act!;
  const d = currentDossier();
  switch (act) {
    case 'dig': return dig(t.dataset.ca!);
    case 'demo': {
      const current = burrow.all().filter((x) => !x.demo);
      burrow.replaceAll([...current, ...demoBurrow()]);
      toast('Demo dossiers loaded');
      location.hash = '#/d/' + demoBurrow()[1].ca;
      return;
    }
    case 'export-all': return download('rabiq-burrow.json', JSON.stringify(burrow.all(), null, 2), 'application/json');
    case 'copy':
      await navigator.clipboard.writeText(t.dataset.text!);
      t.textContent = 'Copied';
      t.classList.add('done');
      return void setTimeout(() => { t.textContent = 'Copy'; t.classList.remove('done'); }, 1400);
    case 'notes-mode': notesEdit = !notesEdit; return render();
    case 'adopt': {
      if (!shared) return;
      const next = adopt(shared, burrow.get(burrow.idFor(shared.ca)));
      burrow.put(next);
      toast('Saved to your brain');
      location.hash = `#/d/${next.ca}`;
      shared = null;
      return;
    }
  }
  if (!d) return;
  switch (act) {
    case 'refresh': return refresh(d, true);
    case 'status':
      if (d.status === t.dataset.status) return;
      statusSlide = { id: d.id, from: STATUSES.findIndex((st) => st.id === d.status) };
      d.status = t.dataset.status as Dossier['status'];
      logEvent(d, `Status → ${statusLabel(d.status)}`);
      break;
    case 'q-toggle': {
      const q = d.questions[Number(t.dataset.i)];
      q.done = !q.done;
      logEvent(d, `${q.done ? 'Answered' : 'Reopened'}: ${q.text.slice(0, 60)}`);
      break;
    }
    case 'del-q': d.questions.splice(Number(t.dataset.i), 1); break;
    case 'del-item': (d[t.dataset.list as 'pros'] as string[]).splice(Number(t.dataset.i), 1); break;
    case 'export': return download(`${d.symbol || 'token'}-${d.ca.slice(2, 8)}.md`, burrow.toMarkdown(d));
    case 'publish': return publishDialog(d);
    case 'delete':
      if (!confirm(`Delete the $${d.symbol || d.ca} dossier? This cannot be undone.`)) return;
      burrow.remove(d.id);
      location.hash = '#/files';
      return;
    default: return;
  }
  burrow.put(d);
  render();
});

window.addEventListener('hashchange', () => {
  if (!route().startsWith('/s/')) shared = null;
  notesEdit = false;
  played.clear();
  scrollTo(0, 0);
  render();
});

mountChrome(document.getElementById('chrome')!, dig);
startBlockTicker();
render();
addEventListener('resize', () => syncChrome(route()));
document.fonts?.ready.then(() => syncChrome(route()));
