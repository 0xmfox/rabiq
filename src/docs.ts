// How to use and Docs pages, plus the section rail shared with the landing page.
import { REPO_URL, X_URL } from './chrome.ts';
import { EXPLORER, MULTICALL3, PONS_V2_FACTORY, RPC_URL } from './lib/chain.ts';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const code = (s: string) => `<code>${s}</code>`;
const ext = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

type Sec = { id: string; title: string; body: string };

const HOW: Sec[] = [
  { id: 'find', title: 'Find a token', body: `
    <p>The <a href="#/app">Live desk</a> lists every Pons V2 token that launched or traded on its bonding curve in the last ten minutes. Four tabs sort it:</p>
    <dl class="doc-dl">
      <dt>Most traded</dt><dd>Dollar volume on the curve in the window.</dd>
      <dt>New launches</dt><dd>Newest launch first.</dd>
      <dt>Near graduation</dt><dd>Curves closest to their graduation threshold.</dd>
      <dt>Repeat deployers</dt><dd>Tokens whose deployer launched before.</dd>
    </dl>
    <p>Already have a contract address? Paste it into the ${code('CA')} field in the header and press Enter.</p>` },
  { id: 'row', title: 'Read a row', body: `
    <dl class="doc-dl">
      <dt>Mkt cap</dt><dd>Curve price × 1,000,000,000 tokens × the USD price of the quote asset. The cell flashes lime or red when it moves. A small tag such as <span class="dep" style="color:var(--sky)">USDG</span> marks launches that trade against something other than ETH.</dd>
      <dt>10m</dt><dd>Price now against the first trade in the window.</dd>
      <dt>Curve</dt><dd>Quote raised against the graduation threshold.</dd>
      <dt>Buys / sells</dt><dd>Trades in the window.</dd>
      <dt>Deployer</dt><dd><span class="dep warn">3 earlier</span> means the wallet launched three tokens before this one. <span class="dep first">First launch</span> means none.</dd>
    </dl>
    <p>Use ${code('↑')} and ${code('↓')} to move through the table and ${code('Enter')} to open a file.</p>` },
  { id: 'inspect', title: 'Inspect', body: `
    <p>Pick a row and the panel on the right loads every trade since launch and draws market cap candles with buy and sell volume underneath. Switch between <b>Trades</b> and <b>Time</b> candles, and hover for open, high, low and close. The panel also shows curve progress, wallets that traded and the deployer.</p>` },
  { id: 'file', title: 'Open the file', body: `
    <p><b>Open the file</b> creates a dossier for the contract. RABIQ reads the launch record, the market, the curve and the deployer's history, then leaves space for your research:</p>
    <ol class="doc-ol"><li>A one-line thesis, arguments for and against.</li><li>Open questions. The first unanswered one is marked <b>next</b>.</li><li>A decision: Watching, Researching, In position or Passed, with a private reason.</li><li>Sources. A GitHub link adds the repository head commit to every check.</li></ol>` },
  { id: 'return', title: 'Come back', body: `
    <p>Open the same contract later and <b>Since your last check</b> lists what moved: market cap, liquidity, graduation, a new fee recipient, new commits, new launches by the deployer.</p>` },
  { id: 'remember', title: 'Meet the deployer again', body: `
    <p>Open a token from a wallet you already researched and <b>RABIQ remembers</b> puts the earlier dossier on top: its decision, its thesis and the question you left open. The <a href="#/graph">Graph</a> draws every dossier and the strings between them.</p>` },
  { id: 'publish', title: 'Publish', body: `
    <p><b>Publish</b> packs a dossier into a link. Status, reason and notes stay out unless you include notes. Whoever opens the link can press <b>Save to my brain</b> to merge it into their own dossiers.</p>` },
  { id: 'cli', title: 'Terminal', body: `
    <p>The same engine runs from a terminal and writes Markdown notes that open in Obsidian.</p>
    <pre class="doc-pre">git clone ${REPO_URL}.git && cd rabiq && npm install
node bin/rabiq.ts dig 0x78F13072B0F6EBC7fD0B5359c9B4E09C6160cff8
node bin/rabiq.ts recall 0x728f38b5800febf4eef37e2a297a0e4d55189810</pre>` },
];

const DOCS: Sec[] = [
  { id: 'sources', title: 'Data sources', body: `
    <table class="doc-t"><thead><tr><th>Source</th><th>What RABIQ reads</th></tr></thead><tbody>
      <tr><td>${code(RPC_URL.replace('https://', ''))}</td><td>Pons V2 launch records, curve reserves, curve trades, v4 pool swaps, launch history. Batched through Multicall3.</td></tr>
      <tr><td>${code('api.dexscreener.com')}</td><td>Price, liquidity and volume of graduated pools; USD prices of non-ETH quote assets.</td></tr>
      <tr><td>${code('api.coinbase.com')}</td><td>ETH/USD spot, refreshed every minute, to express ETH amounts in dollars.</td></tr>
      <tr><td>${code('api.github.com')}</td><td>Repository head commit and stars for sources you add.</td></tr>
    </tbody></table>` },
  { id: 'contracts', title: 'Contracts', body: `
    <table class="doc-t"><tbody>
      <tr><td>Pons V2 factory</td><td>${ext(`${EXPLORER}/address/${PONS_V2_FACTORY}`, code(PONS_V2_FACTORY))}</td></tr>
      <tr><td>Uniswap v4 PoolManager</td><td>${ext(`${EXPLORER}/address/0x8366a39CC670B4001A1121B8F6A443A643e40951`, code('0x8366a39CC670B4001A1121B8F6A443A643e40951'))}</td></tr>
      <tr><td>Pons meme hook</td><td>${ext(`${EXPLORER}/address/0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`, code('0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044'))}</td></tr>
      <tr><td>Multicall3</td><td>${code(MULTICALL3)}</td></tr>
      <tr><td>Chain</td><td>Robinhood Chain, chain id 4663</td></tr>
    </tbody></table>` },
  { id: 'numbers', title: 'How the numbers are computed', body: `
    <dl class="doc-dl wide">
      <dt>Curve price</dt><dd>${code('quoteReserve / tokenReserve')} from ${code('getReserves()')} on the token's bonding curve. The quote reserve includes the curve's virtual liquidity.</dd>
      <dt>Quote asset</dt><dd>Most launches trade against ETH. Others pair with USDG, cbBTC or tokenized stocks such as TSLA and NVDA; RABIQ reads the asset's decimals on-chain and prices it from its most liquid DexScreener pair.</dd>
      <dt>Market cap</dt><dd>Price × 1,000,000,000. Every Pons V2 token mints that supply. Dollar values multiply by the quote asset's USD price.</dd>
      <dt>Curve progress</dt><dd>${code('realQuoteReserve / graduationThreshold')}: quote asset actually held by the curve against the amount that triggers graduation.</dd>
      <dt>Trade price</dt><dd>From ${code('CurveBuy')} and ${code('CurveSell')} events: quote that reached the curve, after fee and creator tax, divided by tokens. Graduated pools use ${code('sqrtPriceX96')} from the PoolManager ${code('Swap')} event, filtered by the pool id RABIQ derives from the launch record.</dd>
      <dt>Candles</dt><dd><b>Trades</b> mode groups a fixed number of trades per candle, so a launch that pumped in minutes and then went quiet for days stays readable. <b>Time</b> mode groups by clock time, with the candle size chosen so the whole history fits.</dd>
      <dt>Earlier launches</dt><dd>${code('TokenLaunched')} events from the same deployer at a lower block than this token's launch.</dd>
      <dt>Repeat share</dt><dd>Launches in the window whose deployer had launched before, over launches whose deployer history RABIQ has read so far.</dd>
      <dt>Time</dt><dd>Seconds per block are measured from the timestamps of two blocks 70,000 apart and refreshed every ten minutes. Ages come from that rate.</dd>
    </dl>` },
  { id: 'phases', title: 'Launch phases', body: `
    <table class="doc-t"><thead><tr><th>Phase</th><th>Meaning</th></tr></thead><tbody>
      <tr><td>Bonding curve</td><td>The token trades on its Pons V2 curve.</td></tr>
      <tr><td>Curve completed</td><td>The curve reached its threshold and was swept. The v4 pool does not exist yet.</td></tr>
      <tr><td>Graduated</td><td>The Uniswap v4 pool exists and its position is locked.</td></tr>
      <tr><td>Rescued</td><td>Swept reserves were released manually. Terminal.</td></tr>
    </tbody></table>` },
  { id: 'since', title: 'Since last check', body: `
    <table class="doc-t"><thead><tr><th>Change</th><th>Rule</th></tr></thead><tbody>
      <tr><td>FDV move</td><td>5% or more</td></tr><tr><td>Liquidity move</td><td>10% or more</td></tr>
      <tr><td>Market appeared</td><td>a market exists where the previous check found none</td></tr>
      <tr><td>Curve completed / graduated</td><td>the phase moved forward</td></tr>
      <tr><td>Fee recipient change</td><td>a different creator fee recipient</td></tr>
      <tr><td>New commits</td><td>a tracked repository head moved, with a compare link</td></tr>
      <tr><td>New launches</td><td>the deployer launched tokens missing from the previous list</td></tr>
    </tbody></table>` },
  { id: 'strings', title: 'Strings between dossiers', body: `
    <table class="doc-t"><thead><tr><th>String</th><th>Kind</th></tr></thead><tbody>
      <tr><td>Same deployer</td><td class="lime">confirmed</td></tr><tr><td>Same fee recipient</td><td class="lime">confirmed</td></tr>
      <tr><td>Deployer receives fees</td><td class="lime">confirmed</td></tr><tr><td>Same GitHub repo</td><td class="lime">confirmed</td></tr>
      <tr><td>Mentioned in your notes</td><td style="color:var(--sky)">hypothesis</td></tr>
    </tbody></table>` },
  { id: 'storage', title: 'Storage and links', body: `
    <p>Dossiers live in this browser's ${code('localStorage')}. Export them as JSON or Markdown from the Dossiers sidebar. A published dossier travels inside its link; opening a link uploads nothing. RABIQ treats incoming links as untrusted: it type-checks every field, caps sizes and escapes text before rendering.</p>` },
  { id: 'limits', title: 'Limits', body: `
    <ul class="doc-ul">
      <li>The public RPC returns at most 10,000 logs per request. RABIQ splits wider ranges and retries when the endpoint throttles.</li>
      <li>The Live desk covers curve trades. Graduated tokens show their pool chart inside their file.</li>
      <li>Dollar values depend on ETH/USD from Coinbase and on DexScreener prices for other quote assets. A quote asset without a price shows amounts in its own units.</li>
      <li>A GitHub source without a token allows 60 API requests per hour per IP.</li>
      <li>Nothing here is financial advice.</li>
    </ul>
    <p>Source code: ${ext(REPO_URL, 'github.com/0xmfox/rabiq')} · Updates: ${ext(X_URL, '@0xMfox')}</p>` },
];

export function docsHTML(route: string) {
  const how = route === '/how';
  const secs = how ? HOW : DOCS;
  return `<div class="doc${how ? ' how' : ''}">
    <aside class="rail" data-rail><span class="rail-title">${how ? 'How to use' : 'Docs'}</span>${secs.map((s, i) => `<a href="#${route}" data-jump="${s.id}"><span>${String(i + 1).padStart(2, '0')}</span>${s.title}</a>`).join('')}<i class="rail-fill"></i></aside>
    <div class="doc-main">
      <header class="doc-head"><p class="label"><span>${how ? 'Guide' : 'Reference'}</span>RABIQ on Robinhood Chain</p>
        <h1 class="display">${how ? 'How to use RABIQ<em>.</em>' : 'Docs<em>.</em>'}</h1>
        <p class="lede">${how ? 'From a row on the live desk to a dossier you can publish, in eight steps.' : 'Where every number on RABIQ comes from, and how it is computed.'}</p></header>
      ${secs.map((s, i) => `<section class="doc-sec" id="${s.id}"><h2><span>${String(i + 1).padStart(2, '0')}</span>${s.title}</h2>${s.body}</section>`).join('')}
    </div>
  </div>`;
}

export function mountDocs(root: HTMLElement) {
  mountRail(root);
}

/** A sticky list of sections: the current one lights up and a lime bar fills with reading progress. */
export function mountRail(root: HTMLElement): () => void {
  const rail = root.querySelector<HTMLElement>('[data-rail]');
  if (!rail) return () => {};
  const links = [...rail.querySelectorAll<HTMLAnchorElement>('[data-jump]')];
  const secs = links.map((a) => document.getElementById(a.dataset.jump!)).filter((s): s is HTMLElement => !!s);
  const fill = rail.querySelector<HTMLElement>('.rail-fill');
  let raf = 0;
  const update = () => {
    raf = 0;
    if (!rail.isConnected) return removeEventListener('scroll', onScroll);
    const mid = innerHeight * 0.35;
    let cur = 0;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top < mid) cur = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === cur));
    const first = secs[0]?.getBoundingClientRect().top ?? 0, last = secs[secs.length - 1]?.getBoundingClientRect().bottom ?? 1;
    const p = Math.max(0, Math.min(1, (mid - first) / (last - first)));
    fill?.style.setProperty('--p', String(p));
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  const onClick = (e: Event) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-jump]');
    if (!a || !rail.contains(a)) return;
    e.preventDefault();
    document.getElementById(a.dataset.jump!)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  };
  addEventListener('scroll', onScroll, { passive: true });
  rail.addEventListener('click', onClick);
  update();
  return () => { removeEventListener('scroll', onScroll); rail.removeEventListener('click', onClick); };
}
