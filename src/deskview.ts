// Live desk: the Pons V2 market in a table that updates in place.
import { areaLine, ethShort, mountChart, sparkline, usdShort } from './chart.ts';
import { EXPLORER } from './lib/chain.ts';
import { buys, change, desk, mcap, onDesk, priceOf, quoteSym, rank, stats, traders, usdPer, vol, WINDOW, type Sort, type Tok } from './lib/desk.ts';
import { esc } from './lib/md.ts';
import { blockTime, curveTrades, hasClock, launchBlocks, SUPPLY, type Trade } from './lib/pons.ts';
import { short, ticker } from './lib/sources.ts';

const ETH = '0x0000000000000000000000000000000000000000';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const SORTS: [Sort, string][] = [['hot', 'Most traded'], ['new', 'New launches'], ['near', 'Near graduation'], ['repeat', 'Repeat deployers']];

let sort: Sort = 'hot';
let query = '';
let selected = '';
const seenRows = new Set<string>();
const lastMc = new Map<string, number>();
const history = new Map<string, { trades: Trade[]; loading: boolean }>();

export function ageText(block: number | null) {
  if (block == null || !hasClock()) return '';
  const s = Math.max(0, Date.now() / 1000 - blockTime(block));
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const mcText = (t: Tok) => { const m = mcap(t); return m == null ? `${ethShort(priceOf(t) * SUPPLY)} ${esc(quoteSym(t))}` : usdShort(m); };

export function deskHTML() {
  return `<div class="desk">
    <section class="desk-head">
      <div class="desk-title">
        <p class="label"><span>Live desk</span>Pons V2 · Robinhood Chain</p>
        <h1 class="display">Every launch<em>.</em><br>Every trade<em>.</em></h1>
        <p class="lede">RABIQ reads every Pons V2 launch and every bonding-curve trade from the last ${Math.round((WINDOW * 0.1) / 60)} minutes straight from Robinhood Chain, every five seconds. Pick a row to see its chart and its deployer.</p>
        <form class="dig big" data-form="dig"><input class="field" name="ca" placeholder="0x… any contract address" autocomplete="off" spellcheck="false"><button class="btn primary">Open file</button></form>
      </div>
      <div class="tiles" data-desk="tiles">${tiles(true)}</div>
    </section>
    <section class="desk-main">
      <div class="dt">
        <div class="dt-tools">
          <div class="seg" role="tablist">${SORTS.map(([k, l]) => `<button role="tab" data-sort="${k}" class="${k === sort ? 'on' : ''}">${l}</button>`).join('')}<i class="seg-rail"></i></div>
          <input class="field sm dt-find" data-desk-find placeholder="Filter $ticker or 0x…" value="${esc(query)}" autocomplete="off" spellcheck="false">
          <span class="dt-count" data-desk="count"></span>
        </div>
        <div class="dt-scroll"><div class="dt-table">
          <div class="dt-row dt-headrow"><span>#</span><span>Token</span><span class="r">Mkt cap</span><span class="r">10m</span><span>Curve</span><span class="r">Buys / sells</span><span class="r">Volume</span><span class="r">Traders</span><span>Deployer</span><span></span></div>
          <div data-desk="rows">${Array.from({ length: 12 }, (_, i) => `<div class="dt-row sk" style="--i:${i}"><span></span><span class="skeleton"></span></div>`).join('')}</div>
        </div></div>
      </div>
      <aside class="insp" data-desk="insp"><div class="insp-empty"><img src="rabiq-cut.png" alt="" width="120"><p>Pick a token from the table. Its chart, its curve and its deployer land here.</p></div></aside>
    </section>
    <section class="desk-lower">
      <div class="feed"><div class="feed-head"><span class="label"><span>Trade tape</span>Newest first</span><span class="block-live"><i></i>Block <b data-block>—</b></span></div><div class="feed-list" data-desk="tape"></div></div>
      <div class="feed"><div class="feed-head"><span class="label"><span>Graduations</span>Last 24 hours</span><span class="feed-count" data-desk="gradcount"></span></div><div class="feed-list" data-desk="grads"></div></div>
    </section>
  </div>`;
}

function tiles(skeleton = false) {
  const s = stats();
  const series = perMinute();
  const t = (key: string, label: string, value: string, sub: string, line = '') =>
    `<div class="tile" data-tile="${key}"><span class="tile-label">${label}</span><b class="tile-value">${skeleton ? '<span class="skeleton"></span>' : value}</b><span class="tile-sub">${skeleton ? '&nbsp;' : sub}</span>${line}</div>`;
  return [
    t('launches', 'Launches · 10m', fmt(s.launches), `${(s.launches / 10).toFixed(1)} a minute`, areaLine(series.launches)),
    t('trades', 'Curve trades · 10m', fmt(s.trades), `${fmt(s.tokensTraded)} tokens traded`, areaLine(series.trades)),
    t('volume', 'Volume · 10m', usdShort(s.volumeUsd), `${ethShort(s.volumeEth)} ETH on ETH pairs`, areaLine(series.volume)),
    t('traders', 'Wallets trading · 10m', fmt(s.traders), 'unique buyers and sellers'),
    t('grads', 'Graduations · 24h', fmt(s.graduations), 'curves that reached a v4 pool'),
    t('repeat', 'From repeat deployers', s.repeatShare == null ? 'Counting' : `${s.repeatShare.toFixed(1)}%`, s.repeatShare == null ? 'reading deployer histories' : `of ${fmt(s.repeatCounted)} launches in the window`),
  ].join('');
}

function perMinute() {
  const buckets = 10, span = WINDOW / buckets, floor = desk.head - WINDOW;
  const launches = Array(buckets).fill(0), trades = Array(buckets).fill(0), volume = Array(buckets).fill(0);
  const at = (b: number) => Math.min(buckets - 1, Math.max(0, Math.floor((b - floor) / span)));
  for (const l of desk.launches) launches[at(l.block)]++;
  for (const t of desk.tokens.values()) { const u = usdPer(t) ?? 0; for (const x of t.trades) { trades[at(x.block)]++; volume[at(x.block)] += x.amt * u; } }
  return { launches, trades, volume };
}

function rowsHTML() {
  const q = query.toLowerCase().replace(/^\$/, '');
  const list = rank(sort).filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.token.includes(q) || t.deployer.includes(q)).slice(0, 60);
  const html = list.map((t, i) => {
    const mc = mcap(t) ?? 0, prev = lastMc.get(t.token), ch = change(t), b = buys(t), s = t.trades.length - b;
    const flash = prev && mc && Math.abs(mc / prev - 1) > 0.001 ? (mc > prev ? ' fl-up' : ' fl-down') : '';
    lastMc.set(t.token, mc);
    const isNew = !seenRows.has(t.token) && desk.loadedAt && seenRows.size > 0;
    seenRows.add(t.token);
    const prog = t.phase === 0 && t.state ? t.state.progress : t.phase >= 1 ? 1 : null;
    const dep = t.earlier == null ? '<span class="dep wait">·</span>' : t.earlier === 0 ? '<span class="dep first">First launch</span>' : `<span class="dep warn">${fmt(t.earlier)} earlier</span>`;
    return `<div class="dt-row${isNew ? ' new' : ''}${t.token === selected ? ' on' : ''}" data-token="${t.token}" style="--i:${Math.min(i, 20)}" tabindex="0">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="tok"><b>${esc(ticker(t.symbol))}</b><small>${short(t.token)}${t.quote !== ETH ? `<i class="qt">${esc(quoteSym(t))}</i>` : ''}<em data-age="${t.launchBlock ?? ''}">${ageText(t.launchBlock)}</em></small></span>
      <span class="r mc${flash}">${mcText(t)}</span>
      <span class="r ch ${ch == null ? '' : ch >= 0 ? 'up' : 'down'}">${ch == null ? '—' : `${ch >= 0 ? '+' : ''}${Math.abs(ch) >= 1000 ? fmt(ch) : ch.toFixed(1)}%`}</span>
      <span class="cv">${prog == null ? '<span class="muted">—</span>' : `<span class="curve-bar${prog >= 1 ? ' done' : ''}" style="--p:${prog}"><i></i></span><small>${prog >= 1 ? (t.phase >= 2 ? 'graduated' : 'completed') : `${(prog * 100).toFixed(prog < 0.1 ? 1 : 0)}%`}</small>`}</span>
      <span class="r bs"><b class="lime">${b}</b><i>/</i><b class="red">${s}</b></span>
      <span class="r">${usdPer(t) == null ? `${ethShort(t.trades.reduce((a, x) => a + x.amt, 0))} ${esc(quoteSym(t))}` : usdShort(vol(t))}</span>
      <span class="r">${traders(t)}</span>
      <span>${dep}</span>
      <span class="sp">${sparkline(t.trades.map((x) => x.price))}</span>
    </div>`;
  }).join('');
  return { html: html || `<div class="dt-empty">${desk.ready ? 'Nothing matches.' : ''}</div>`, count: list.length };
}

function tapeHTML(seen: Set<string>) {
  return desk.tape.slice(0, 40).map((x) => {
    const t = desk.tokens.get(x.token);
    const usd = t ? usdPer(t) : null, sym = t ? esc(quoteSym(t)) : '';
    const key = `${x.block}:${x.i}`, isNew = seen.size > 0 && !seen.has(key);
    seen.add(key);
    return `<a class="feed-row${isNew ? ' new' : ''}" href="#/d/${x.token}"><span class="tside ${x.side}">${x.side === 'buy' ? 'Buy' : 'Sell'}</span><b>${esc(ticker(t?.symbol ?? '?'))}</b><span class="r mono">${usd ? usdShort(x.amt * usd) : `${ethShort(x.amt)} ${sym}`}</span><span class="r mono muted">${usd ? usdShort(x.price * SUPPLY * usd) : ''}</span><span class="mono dim">${short(x.who)}</span><span class="r mono dim" data-age="${x.block}">${ageText(x.block)}</span></a>`;
  }).join('') || '<div class="dt-empty">Waiting for the first trades.</div>';
}

function gradsHTML() {
  const list = desk.graduations.slice().sort((a, b) => b.block - a.block).slice(0, 30);
  return list.map((g) => {
    const t = desk.tokens.get(g.token);
    return `<a class="feed-row grad" href="#/d/${g.token}"><span class="tside buy">Pool</span><b>${g.symbol || t?.symbol ? esc(ticker(g.symbol || t!.symbol)) : short(g.token)}</b><span class="mono dim">${short(g.token)}</span><span class="r mono dim" data-age="${g.block}">${ageText(g.block)}</span></a>`;
  }).join('') || '<div class="dt-empty">No graduations read yet.</div>';
}

// ---------- inspector ----------
async function loadHistory(t: Tok, repaint: () => void) {
  const h = history.get(t.token);
  if (h?.loading) return;
  history.set(t.token, { trades: h?.trades ?? t.trades.slice(), loading: true });
  try {
    const head = BigInt(desk.head);
    let from = t.launchBlock;
    if (from == null) from = (await launchBlocks([t.token], head)).get(t.token)?.block ?? desk.head - WINDOW;
    t.launchBlock ??= from;
    const trades = await curveTrades(t.curve, BigInt(from), head, t.dec);
    history.set(t.token, { trades, loading: false });
  } catch {
    history.set(t.token, { trades: h?.trades ?? t.trades.slice(), loading: false });
  }
  repaint();
}

function mergeLive(t: Tok) {
  const h = history.get(t.token);
  if (!h || h.loading) return;
  const lastB = h.trades[h.trades.length - 1];
  for (const x of t.trades) if (!lastB || x.block > lastB.block || (x.block === lastB.block && x.i > lastB.i)) h.trades.push(x);
}

let chartCleanup: (() => void) | null = null;
function renderInspector(root: HTMLElement, intro: boolean) {
  const el = root.querySelector<HTMLElement>('[data-desk="insp"]')!;
  const t = desk.tokens.get(selected);
  if (!t) return;
  const usd = usdPer(t), sym = esc(quoteSym(t)), ch = change(t), st = t.state;
  const h = history.get(t.token);
  mergeLive(t);
  const all = h && !h.loading ? h.trades : t.trades;
  const allBuys = all.filter((x) => x.side === 'buy').length;
  el.innerHTML = `<div class="insp-card${intro ? ' play' : ''}">
    <p class="label"><span>File <b>${short(t.token)}</b></span>${t.name && t.name !== t.symbol ? esc(t.name) : 'Pons V2'}</p>
    <div class="insp-top"><h2 class="display">${esc(ticker(t.symbol))}</h2>${t.earlier == null ? '' : `<span class="stamp-sm ${t.earlier ? 'warn' : 'ok'}">${t.earlier ? `${fmt(t.earlier)} earlier` : 'First launch'}</span>`}</div>
    <div class="insp-price"><b>${mcText(t)}</b><span class="muted">market cap${t.quote !== ETH ? ` · paired with ${sym}` : ''}</span>${ch == null ? '' : `<em class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% · 10m</em>`}</div>
    <div class="insp-chart" data-chart></div>
    ${t.phase === 0 && st ? `<div class="insp-curve"><div class="insp-curve-head"><span>Bonding curve</span><b>${(st.progress * 100).toFixed(1)}%</b></div><span class="curve-bar big" style="--p:${st.progress}"><i></i></span><span class="muted mono small">${ethShort(st.raisedEth)} of ${fmt(st.thresholdEth, st.thresholdEth < 10 ? 2 : 0)} ${sym} raised</span></div>` : `<div class="insp-curve"><div class="insp-curve-head"><span>${t.phase >= 2 ? 'Graduated to a Uniswap v4 pool' : 'Curve completed, pool pending'}</span></div></div>`}
    <dl class="insp-stats">
      <div><dt>Trades${h && !h.loading ? ' · all' : ' · 10m'}</dt><dd>${fmt(all.length)}</dd></div>
      <div><dt>Buys / sells</dt><dd><span class="lime">${allBuys}</span> / <span class="red">${all.length - allBuys}</span></dd></div>
      <div><dt>Volume</dt><dd>${usd ? usdShort(all.reduce((s, x) => s + x.amt, 0) * usd) : `${ethShort(all.reduce((s, x) => s + x.amt, 0))} ${sym}`}</dd></div>
      <div><dt>Wallets</dt><dd>${fmt(new Set(all.map((x) => x.who)).size)}</dd></div>
      <div><dt>Age</dt><dd data-age="${t.launchBlock ?? ''}">${ageText(t.launchBlock) || '—'}</dd></div>
      <div><dt>Deployer launches</dt><dd>${t.total == null ? '…' : fmt(t.total)}</dd></div>
    </dl>
    <div class="insp-dep"><span>Deployer</span><a class="mono" href="${EXPLORER}/address/${t.deployer}" target="_blank" rel="noopener noreferrer">${short(t.deployer)}</a></div>
    <div class="insp-actions"><a class="btn primary" href="#/d/${t.token}">Open the file</a><a class="btn" href="https://www.ponsfamily.com/launchpad/${t.token}" target="_blank" rel="noopener noreferrer">Pons ↗</a><a class="btn ghost" href="${EXPLORER}/token/${t.token}" target="_blank" rel="noopener noreferrer">Blockscout ↗</a></div>
  </div>`;
  chartCleanup?.();
  const chartEl = el.querySelector<HTMLElement>('[data-chart]')!;
  if (h?.loading || !h) chartEl.innerHTML = '<div class="chart-empty"><span class="spin"></span> Reading every trade since launch</div>';
  else chartCleanup = mountChart(chartEl, all, { usd, quote: quoteSym(t), intro });
}

// ---------- mount ----------
export function mountDesk(root: HTMLElement): () => void {
  const q = <T extends HTMLElement>(k: string) => root.querySelector<T>(`[data-desk="${k}"]`)!;
  const tapeSeen = new Set<string>();
  let introDone = false;
  let inspSig = '';
  const sigOf = (t: Tok) => { const h = history.get(t.token); return `${t.token}:${t.trades.length}:${priceOf(t)}:${t.earlier}:${t.total}:${t.phase}:${h?.loading}:${h?.trades.length}`; };

  const placeSeg = () => {
    const on = root.querySelector<HTMLElement>('.seg button.on'), rail = root.querySelector<HTMLElement>('.seg-rail');
    if (!on || !rail) return;
    rail.style.width = `${on.offsetWidth}px`;
    rail.style.transform = `translateX(${on.offsetLeft}px)`;
  };

  const paint = () => {
    if (!desk.ready || !root.isConnected) return;
    const tilesEl = q('tiles');
    tilesEl.innerHTML = tiles();
    if (!introDone) tilesEl.classList.add('play');
    const { html, count } = rowsHTML();
    const rows = q('rows');
    rows.innerHTML = html;
    if (!introDone) rows.parentElement!.classList.add('play');
    q('count').textContent = `${count} shown · ${fmt(desk.tokens.size)} tokens in the window`;
    q('tape').innerHTML = tapeHTML(tapeSeen);
    q('grads').innerHTML = gradsHTML();
    q('gradcount').textContent = `${fmt(desk.graduations.length)} total`;
    const cur = desk.tokens.get(selected);
    if (!cur) { const top = rank('hot')[0]; if (top && fine()) select(top.token, false); }
    else if (sigOf(cur) !== inspSig) { inspSig = sigOf(cur); renderInspector(root, false); }
    if (!introDone) setTimeout(() => { tilesEl.classList.remove('play'); rows.parentElement!.classList.remove('play'); }, 1600);
    introDone = true;
  };

  function select(token: string, scroll: boolean) {
    selected = token;
    root.querySelectorAll('.dt-row.on').forEach((r) => r.classList.remove('on'));
    root.querySelector(`.dt-row[data-token="${token}"]`)?.classList.add('on');
    const t = desk.tokens.get(token);
    if (!t) return;
    renderInspector(root, true);
    inspSig = sigOf(t);
    if (!history.has(token)) loadHistory(t, () => { if (selected === token) { renderInspector(root, false); inspSig = sigOf(t); } });
    if (scroll && innerWidth < 1180) root.querySelector('[data-desk="insp"]')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  const onClick = (e: Event) => {
    const el = e.target as HTMLElement;
    const sortBtn = el.closest<HTMLElement>('[data-sort]');
    if (sortBtn) {
      sort = sortBtn.dataset.sort as Sort;
      root.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b === sortBtn));
      placeSeg();
      seenRows.clear();
      const { html, count } = rowsHTML();
      q('rows').innerHTML = html;
      q('count').textContent = `${count} shown · ${fmt(desk.tokens.size)} tokens in the window`;
      return;
    }
    const row = el.closest<HTMLElement>('.dt-row[data-token]');
    if (row) select(row.dataset.token!, true);
  };
  const onKey = (e: KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.dt-row[data-token]');
    if (!row) return;
    if (e.key === 'Enter') location.hash = `#/d/${row.dataset.token}`;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
      if (next?.dataset.token) { next.focus(); select(next.dataset.token, false); }
    }
  };
  const onInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.deskFind === undefined) return;
    query = el.value;
    const { html, count } = rowsHTML();
    q('rows').innerHTML = html;
    q('count').textContent = `${count} shown · ${fmt(desk.tokens.size)} tokens in the window`;
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('input', onInput);
  requestAnimationFrame(placeSeg);
  addEventListener('resize', placeSeg);

  // ages tick every second between polls
  const ages = setInterval(() => root.querySelectorAll<HTMLElement>('[data-age]').forEach((el) => {
    const b = el.dataset.age;
    if (b) el.textContent = ageText(Number(b));
  }), 1000);

  const off = onDesk(paint);
  paint();
  return () => { off(); clearInterval(ages); chartCleanup?.(); root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); root.removeEventListener('input', onInput); removeEventListener('resize', placeSeg); };
}

const fine = () => matchMedia('(min-width: 1180px)').matches;
