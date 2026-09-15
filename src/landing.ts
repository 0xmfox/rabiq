import './landing.css';
import { EXPLORER, normalizeAddress, readToken, type ChainFacts } from './lib/chain.ts';
import { blockText, seedBlock } from './lib/live.ts';
import { esc } from './lib/md.ts';
import { launchTokens, readFreshLaunches, readMarket, short, ticker, usd, withSymbols } from './lib/sources.ts';
import { change, mcap, onDesk, rank, stats } from './lib/desk.ts';
import { sparkline, usdShort } from './chart.ts';
import { mountRail } from './docs.ts';

const REPO_URL = 'https://github.com/0xmfox/rabiq';
const X_URL = 'https://x.com/0xMfox';

type Tick = { x: number; symbol: string; graduated: boolean; token: string };
type Track = { deployer: string; launches: number; graduated: number | null; bins: number[] | null; ticks: Tick[] | null };
type LandingData = {
  generatedAt: number;
  head: number;
  anchors: [number, number][];
  stats: { launches: number; deployers: number; repeatWallets: number; contractLaunches: number; walletLaunches: number; launchedBefore: number; launchedBeforePct: number };
  tracks: Track[];
};

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const jump = (id: string, text: string) => `<a href="#/" data-jump="${id}">${text}</a>`;

export function landingHTML() {
  const row = (key: string, label: string) => `<div class="file-row" data-row="${key}"><dt>${label}</dt><dd><span class="skeleton"></span></dd></div>`;
  const rail = [['file', 'Live file'], ['now', 'Right now'], ['number', 'The number'], ['serial', 'Serial launchers'], ['how', 'How it works'], ['token', '$RABIQ']];
  return `<div class="lp">
  <aside class="rail lp-rail" data-rail><span class="rail-title">Case files</span>${rail.map(([id, label], i) => `<a href="#/" data-jump="${id}"><span>${String(i).padStart(2, '0')}</span><em>${label}</em></a>`).join('')}<i class="rail-fill"></i></aside>
  <section class="lp-hero lp-wrap" id="file">
    <div class="lp-hero-copy">
      <p class="lp-label rv" style="--i:0"><span>File 00</span>Pons V2 · Robinhood Chain</p>
      <h1 class="lp-h1"><span class="rv" style="--i:1">Every deployer</span><span class="rv" style="--i:2">has a history<em>.</em></span></h1>
      <p class="lp-lede rv" style="--i:3">RABIQ opens a dossier on any Robinhood Chain token: the launch record, the market, the repository, and every other token the same wallet launched. Your notes stay next to the facts.</p>
      <div class="lp-cta rv" style="--i:4"><a class="btn primary lg" href="#/app">Open the app</a><a class="btn lg" href="${REPO_URL}" target="_blank" rel="noopener">Read the source</a></div>
    </div>
    <div class="lp-stage rv" style="--i:2">
      <article class="file" aria-live="polite">
        <img class="lp-bunny" src="rabiq-cut.png" alt="RABIQ, a white pixel rabbit holding a lime case file" width="518" height="900">
        <div class="file-bar"><span>File <b data-f="short">reading chain</b></span><span class="file-block"><i></i>Block <b data-block>${blockText()}</b></span></div>
        <div class="file-head"><h3 data-f="symbol">&nbsp;</h3><span data-f="name"></span></div>
        <dl class="file-facts">${row('launchpad', 'Launchpad')}${row('phase', 'Phase')}${row('deployer', 'Deployer')}${row('fee', 'Fee recipient')}${row('market', 'FDV · Liquidity')}</dl>
        <div class="file-history file-row" data-row="history">
          <div class="file-history-head"><span>Deployer history</span><b data-f="count"></b></div>
          <div class="file-chips" data-f="chips"></div>
        </div>
        <div class="stamp" data-f="stamp" hidden></div>
        <form class="file-try"><input class="field" name="ca" placeholder="Paste any Pons V2 contract" autocomplete="off" spellcheck="false"><button class="btn sm">Open file</button></form>
        <a class="file-open" data-f="open" href="#/app">Open the full dossier</a>
      </article>
    </div>
  </section>

  <section class="lp-now lp-wrap" id="now" data-reveal>
    <p class="lp-label rv" style="--i:0"><span>File 01</span>Right now on Pons V2</p>
    <div class="now-grid">
      <div>
        <h2 class="lp-h2 rv" style="--i:1">The last ten minutes on Pons V2.</h2>
        <p class="lp-sub rv" style="--i:2">RABIQ reads every launch and every bonding-curve trade from Robinhood Chain, every five seconds.</p>
        <dl class="now-stats">
          <div class="rv" style="--i:3"><dt>Launches · 10m</dt><dd data-now="launches"><span class="skeleton"></span></dd></div>
          <div class="rv" style="--i:4"><dt>Curve trades · 10m</dt><dd data-now="trades"><span class="skeleton"></span></dd></div>
          <div class="rv" style="--i:5"><dt>Volume · 10m</dt><dd data-now="volume"><span class="skeleton"></span></dd></div>
          <div class="rv" style="--i:6"><dt>From repeat deployers</dt><dd data-now="repeat" class="amber"><span class="skeleton"></span></dd></div>
        </dl>
        <a class="btn primary lg rv" style="--i:7" href="#/app">Open the live desk</a>
      </div>
      <div class="now-board rv" style="--i:3">
        <div class="now-head"><span>Most traded · 10m</span><span class="file-block"><i></i>Block <b data-block>${blockText()}</b></span></div>
        <div data-now="board">${Array.from({ length: 6 }, () => '<div class="now-row"><span class="skeleton"></span></div>').join('')}</div>
      </div>
    </div>
  </section>

  <section class="lp-number lp-wrap" id="number" data-reveal>
    <p class="lp-label rv" style="--i:0"><span>File 02</span>The number</p>
    <div class="num-grid">
      <div class="num-big rv" style="--i:1"><span data-count="launchedBeforePct" data-decimals="1">0</span><small>%</small></div>
      <p class="num-text rv" style="--i:2">of Pons V2 launches from wallets came from a wallet that had already launched a token before.</p>
    </div>
    <dl class="num-row">
      <div class="rv" style="--i:3"><dt>Pons V2 launches</dt><dd data-count="launches">0</dd></div>
      <div class="rv" style="--i:4"><dt>Deployer addresses</dt><dd data-count="deployers">0</dd></div>
      <div class="rv" style="--i:5"><dt>Wallets that launched again</dt><dd data-count="repeatWallets">0</dd></div>
      <div class="rv" style="--i:6"><dt>Launched through contracts</dt><dd data-count="contractLaunches">0</dd><span>left out of the share</span></div>
    </dl>
    <p class="num-source rv" style="--i:7" data-f="source">Counted from every TokenLaunched event of the Pons V2 factory.</p>
  </section>

  <section class="lp-serial lp-wrap" id="serial" data-reveal>
    <p class="lp-label rv" style="--i:0"><span>File 03</span>Serial launchers</p>
    <h2 class="lp-h2 rv" style="--i:1">The same wallets keep launching.</h2>
    <p class="lp-sub rv" style="--i:2" data-f="serial-sub">Each row follows one wallet across the whole life of Pons V2. Lime marks a token that graduated from the bonding curve.</p>
    <div class="tracks" data-f="tracks"></div>
  </section>

  <section class="lp-how lp-wrap" id="how" data-reveal>
    <p class="lp-label rv" style="--i:0"><span>File 04</span>How it works</p>
    <h2 class="lp-h2 rv" style="--i:1">From a contract address to a decision.</h2>
    <ol class="how-steps">
      <li class="rv" style="--i:2"><span class="how-n">01</span><h3>Read the launch</h3><p>The Pons V2 factory record gives the deployer, the fee recipient, the curve, the quote asset and the phase.</p><code>getLaunchedToken(token)</code></li>
      <li class="rv" style="--i:3"><span class="how-n">02</span><h3>Replay every trade</h3><p>Every CurveBuy and CurveSell since launch, then the Uniswap v4 swaps after graduation, drawn as candles.</p><code>CurveBuy · CurveSell · Swap</code></li>
      <li class="rv" style="--i:4"><span class="how-n">03</span><h3>Count the deployer</h3><p>Every TokenLaunched event from the same wallet. The file gets a stamp: first launch, or how many came before.</p><code>TokenLaunched(deployer)</code></li>
      <li class="rv" style="--i:5"><span class="how-n">04</span><h3>Write it down</h3><p>Thesis, open questions, a decision. Next time the deployer launches, RABIQ puts your notes in front of you.</p><code>Watching · Passed · Publish</code></li>
    </ol>
    <div class="how-links rv" style="--i:6"><a class="btn lg" href="#/how">How to use</a><a class="btn ghost lg" href="#/docs">Read the docs</a></div>
  </section>

  <section class="lp-token lp-wrap" id="token" data-reveal>
    <div class="token-card rv" style="--i:0">
      <img src="rabiq-cut.png" alt="" width="518" height="900" class="token-bunny">
      <div>
        <p class="lp-label"><span>File 05</span>The token</p>
        <h2 class="token-name">$RABIQ</h2>
        <dl class="token-facts">
          <div><dt>Chain</dt><dd>Robinhood Chain · 4663</dd></div>
          <div><dt>Launchpad</dt><dd>Pons V2</dd></div>
          <div><dt>Contract</dt><dd>Announced at launch</dd></div>
        </dl>
        <div class="lp-cta"><a class="btn primary lg" href="${X_URL}" target="_blank" rel="noopener">Follow @0xMfox</a><a class="btn lg" href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub</a></div>
      </div>
    </div>
  </section>

  <section class="lp-end lp-wrap" data-reveal>
    <h2 class="lp-h2 rv" style="--i:0">Open a file on the next launch.</h2>
    <div class="lp-cta rv" style="--i:1"><a class="btn primary lg" href="#/app">Open the app</a><a class="btn lg" href="${X_URL}" target="_blank" rel="noopener">Follow on X</a></div>
  </section>

  <footer class="lp-foot"><div class="lp-wrap">
    <span>RABIQ · $RABIQ on Robinhood Chain · contract announced at launch</span>
    <span>A research tool. Nothing here is financial advice.</span>
    <span><a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a> · <a href="${X_URL}" target="_blank" rel="noopener">X</a></span>
  </div></footer>
</div>`;
}

// ---------- live file ----------
const HEX = '0123456789abcdef';
function scramble(el: Element, text: string) {
  if (reduced()) return void (el.textContent = text);
  const start = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / 420);
    const fixed = Math.floor(text.length * p);
    el.textContent = text.slice(0, fixed) + [...text.slice(fixed)].map((c) => (/[0-9a-f]/i.test(c) ? HEX[(Math.random() * 16) | 0] : c)).join('');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function mountFile(root: HTMLElement, data: Promise<LandingData | null>, alive: () => boolean) {
  const file = root.querySelector<HTMLElement>('.file')!;
  const f = (k: string) => file.querySelector<HTMLElement>(`[data-f="${k}"]`)!;
  const rowEl = (k: string) => file.querySelector<HTMLElement>(`[data-row="${k}"]`)!;
  const setRow = (k: string, html: string) => {
    const r = rowEl(k);
    r.querySelector('dd')!.innerHTML = html;
    r.classList.add('in');
  };
  let run = 0, cycles = 0, timer = 0, pinned = false;

  const addr = (a: string | null) => (a ? `<a href="${EXPLORER}/address/${a}" target="_blank" rel="noopener noreferrer" class="mono">${short(a)}</a>` : '—');

  async function open(ca?: string) {
    const id = ++run;
    clearTimeout(timer);
    const stale = () => id !== run || !alive();
    file.classList.add('busy');
    f('stamp').hidden = true;
    f('stamp').className = 'stamp';
    file.querySelectorAll('.file-row').forEach((r) => r.classList.remove('in'));
    file.querySelectorAll('.file-row dd').forEach((d) => (d.innerHTML = '<span class="skeleton"></span>'));
    f('chips').innerHTML = '';
    f('count').textContent = '';
    try {
      const token = ca ?? (await readFreshLaunches(1))[0]?.token;
      if (stale() || !token) return;
      scramble(f('short'), short(token));
      f('open').setAttribute('href', `#/d/${token.toLowerCase()}`);
      const [chain, market] = await Promise.all([readToken(token), readMarket(token).catch(() => null)]);
      if (stale()) return;
      seedBlock(chain.block);
      f('symbol').textContent = chain.symbol ? ticker(chain.symbol) : 'Unknown token';
      f('name').textContent = chain.name && chain.name !== chain.symbol ? chain.name : '';
      const facts: [string, string][] = [
        ['launchpad', chain.launchpad ? 'Pons V2' : 'Not a Pons V2 launch'],
        ['phase', phaseText(chain)],
        ['deployer', addr(chain.deployer)],
        ['fee', chain.feeRecipient && chain.feeRecipient === chain.deployer ? `${addr(chain.feeRecipient)} <span class="muted">same as deployer</span>` : addr(chain.feeRecipient)],
        ['market', market ? `${usd(market.fdv)} · ${usd(market.liquidityUsd)}` : '<span class="muted">No pool yet</span>'],
      ];
      for (const [i, [k, v]] of facts.entries()) setTimeout(() => !stale() && setRow(k, v), reduced() ? 0 : i * 110);
      if (!chain.deployer) return;
      await history(chain, token, stale);
    } catch {
      if (!stale()) f('symbol').textContent = 'Chain busy, retrying';
    } finally {
      if (!stale()) {
        file.classList.remove('busy');
        // keep the file moving through fresh launches while it is on screen, but stop once the visitor takes over
        if (!pinned && cycles++ < 8) timer = window.setTimeout(() => !document.hidden && alive() && open(), 15_000);
      }
    }
  }

  async function history(chain: ChainFacts, token: string, stale: () => boolean) {
    let tokens: `0x${string}`[] | null = null;
    // the public RPC throttles bursts; one spaced retry covers most of it
    for (let i = 0; i < 2 && !tokens && !stale(); i++) {
      try { tokens = await launchTokens(chain.deployer!, chain.block); } catch { await new Promise((r) => setTimeout(r, 2500)); }
    }
    if (stale()) return;
    if (!tokens) {
      const known = (await data)?.tracks.find((t) => t.deployer === chain.deployer);
      f('count').textContent = known ? `${fmt(known.launches)} launches` : 'Chain busy, open the full dossier';
      rowEl('history').classList.add('in');
      if (known) stamp('Serial launcher', `${fmt(known.launches)} launches`, 'warn');
      return;
    }
    const idx = tokens.findIndex((t) => t.toLowerCase() === token.toLowerCase());
    const earlier = Math.max(0, idx);
    f('count').textContent = `${fmt(tokens.length)} launch${tokens.length === 1 ? '' : 'es'}`;
    const recent = await withSymbols(tokens.slice(-7).reverse()).catch(() => []);
    if (stale()) return;
    f('chips').innerHTML = recent.map((l, i) => `<a href="#/d/${l.token}" class="${l.token === token.toLowerCase() ? 'self' : ''}" style="--i:${i}">${esc(ticker(l.symbol))}</a>`).join('') + (tokens.length > 7 ? `<span class="more">+${fmt(tokens.length - 7)}</span>` : '');
    rowEl('history').classList.add('in');
    if (earlier === 0) stamp('First launch', 'No earlier tokens from this wallet', 'ok');
    else stamp(`${fmt(earlier)} earlier`, `launch${earlier === 1 ? '' : 'es'} from this deployer`, 'warn');
  }

  function stamp(title: string, sub: string, tone: 'ok' | 'warn') {
    setTimeout(() => {
      const s = f('stamp');
      s.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
      s.className = `stamp ${tone}`;
      s.hidden = false;
    }, reduced() ? 0 : 700);
  }

  file.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).ca as HTMLInputElement;
    const ca = normalizeAddress(input.value);
    if (!ca) return void input.classList.add('bad');
    input.classList.remove('bad');
    pinned = true;
    open(ca);
  });

  open();
  return () => { clearTimeout(timer); run++; };
}

const phaseText = (c: ChainFacts) => (c.phase === 'graduated' ? 'Graduated to Uniswap v4' : c.phase === 'curve' ? 'On the bonding curve' : '—');

// ---------- number + tracks ----------
function countUp(el: HTMLElement, to: number, decimals: number) {
  if (reduced()) return void (el.textContent = fmt(to, decimals));
  const start = performance.now(), dur = 1600;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = fmt(to * (1 - Math.pow(2, -10 * p)) * (p < 1 ? 1 : 1 / (1 - Math.pow(2, -10))), decimals);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to, decimals);
  };
  requestAnimationFrame(step);
}

function tracksHTML(d: LandingData) {
  const [first, mid, last] = d.anchors;
  const rows = d.tracks.map((t, i) => {
    const line = t.bins
      ? (() => {
          const max = Math.max(...t.bins);
          return `<div class="bars">${t.bins.map((b) => `<i style="--h:${b ? Math.max(0.08, Math.sqrt(b / max)).toFixed(3) : 0}"></i>`).join('')}</div>`;
        })()
      : `<div class="ticks">${t.ticks!.map((k) => `<a href="#/d/${k.token}" class="tick ${k.graduated ? 'grad' : ''}" style="left:${(k.x * 100).toFixed(2)}%" data-sym="${esc(ticker(k.symbol))}" aria-label="${esc(ticker(k.symbol))}${k.graduated ? ', graduated' : ''}"></a>`).join('')}</div>`;
    const meta = t.graduated == null ? `${fmt(t.launches)} launches` : `${fmt(t.launches)} launches · <span class="lime">${t.graduated} graduated</span>`;
    return `<div class="track" style="--i:${i}">
      <div class="track-meta"><a href="${EXPLORER}/address/${t.deployer}" target="_blank" rel="noopener noreferrer" class="mono">${short(t.deployer)}</a><span>${meta}</span></div>
      <div class="track-line">${line}</div>
    </div>`;
  }).join('');
  return `${rows}<div class="track axis"><div></div><div class="track-axis"><span>${day(first[1])}</span><span>${day(mid[1])}</span><span>${day(last[1])}</span></div></div>`;
}

// ---------- right now ----------
function mountNow(root: HTMLElement, alive: () => boolean) {
  const q = (k: string) => root.querySelector<HTMLElement>(`[data-now="${k}"]`)!;
  let counted = false;
  return onDesk(() => {
    if (!alive()) return;
    const st = stats();
    const set = (k: string, v: number, text: (n: number) => string) => {
      const el = q(k);
      if (!counted && !reduced()) {
        const start = performance.now();
        const step = (now: number) => { const p = Math.min(1, (now - start) / 1200); el.textContent = text(v * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      } else el.textContent = text(v);
    };
    set('launches', st.launches, (n) => fmt(n));
    set('trades', st.trades, (n) => fmt(n));
    set('volume', st.volumeUsd, (n) => usdShort(n));
    q('repeat').textContent = st.repeatShare == null ? 'Counting' : `${st.repeatShare.toFixed(1)}%`;
    counted = true;
    q('board').innerHTML = rank('hot').slice(0, 6).map((t, i) => {
      const ch = change(t);
      return `<a class="now-row" href="#/d/${t.token}" style="--i:${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><b>${esc(ticker(t.symbol))}</b><span class="mono">${usdShort(mcap(t))}</span><span class="mono ${ch == null ? '' : ch >= 0 ? 'lime' : 'red'}">${ch == null ? '' : `${ch >= 0 ? '+' : ''}${Math.abs(ch) >= 1000 ? fmt(ch) : ch.toFixed(1)}%`}</span>${sparkline(t.trades.map((x) => x.price))}<span class="dep ${t.earlier ? 'warn' : 'first'}">${t.earlier == null ? '' : t.earlier ? `${fmt(t.earlier)} earlier` : 'First launch'}</span></a>`;
    }).join('');
  });
}

export function mountLanding(root: HTMLElement): () => void {
  let live = true;
  const alive = () => live && root.isConnected;
  const data: Promise<LandingData | null> = fetch('landing.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);

  requestAnimationFrame(() => { if (alive()) root.querySelector('.lp')?.classList.add('ready'); });
  const stopFile = mountFile(root, data, alive);
  const stopNow = mountNow(root, alive);
  const stopRail = mountRail(root);

  data.then((d) => {
    if (!d || !alive()) return;
    root.querySelector('[data-f="tracks"]')!.innerHTML = tracksHTML(d);
    const [a, b] = d.tracks.filter((t) => t.bins);
    const small = d.tracks.filter((t) => t.ticks).map((t) => t.launches);
    if (a && b && small.length) root.querySelector('[data-f="serial-sub"]')!.textContent = `Each row follows one wallet across the whole life of Pons V2. The busiest two launched ${fmt(a.launches)} and ${fmt(b.launches)} tokens, in waves. The other ${['one', 'two', 'three', 'four', 'five', 'six'][small.length - 1] ?? small.length} launched between ${Math.min(...small)} and ${Math.max(...small)} each, and lime marks the ones that graduated from the bonding curve.`;
    root.querySelector('[data-f="source"]')!.innerHTML = `Counted from every TokenLaunched event of the Pons V2 factory up to block ${fmt(d.head)} (${day(d.anchors[2][1])}). Contract launchers are detected by their bytecode. <a href="${REPO_URL}/blob/main/scripts/landing-data.ts" target="_blank" rel="noopener">See how it is counted</a>`;
    root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => (el.dataset.to = String(d.stats[el.dataset.count as keyof LandingData['stats']])));
  });

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const sec = e.target as HTMLElement;
      io.unobserve(sec);
      data.then(() => {
        sec.classList.add('in');
        sec.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => el.dataset.to && countUp(el, Number(el.dataset.to), Number(el.dataset.decimals ?? 0)));
      });
    }
  }, { rootMargin: '0px 0px -18% 0px' });
  root.querySelectorAll('[data-reveal]').forEach((s) => io.observe(s));

  const onJump = (e: Event) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-jump]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.jump!)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' });
  };
  root.addEventListener('click', onJump);

  // the case file leans toward the pointer; the rabbit sits closer to the viewer, so it moves further
  const stage = root.querySelector<HTMLElement>('.lp-stage')!;
  let tx = 0, ty = 0, cx = 0, cy = 0, tilting = 0;
  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    if (!tilting) tilting = requestAnimationFrame(tilt);
  };
  const tilt = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    stage.style.setProperty('--rx', `${(-cy * 3).toFixed(2)}deg`);
    stage.style.setProperty('--ry', `${(cx * 4).toFixed(2)}deg`);
    stage.style.setProperty('--bx', `${(cx * 10).toFixed(1)}px`);
    stage.style.setProperty('--by', `${(cy * 6).toFixed(1)}px`);
    tilting = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 && alive() ? requestAnimationFrame(tilt) : 0;
  };
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine && !reduced()) window.addEventListener('pointermove', onMove, { passive: true });

  return () => {
    live = false;
    stopFile();
    stopNow();
    stopRail();
    io.disconnect();
    root.removeEventListener('click', onJump);
    window.removeEventListener('pointermove', onMove);
  };
}
