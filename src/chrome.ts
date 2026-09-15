// Site chrome that outlives page renders: the header and the ticker tape.
import { blockText } from './lib/live.ts';
import { change, onDesk, priceOf, rank } from './lib/desk.ts';
import { esc } from './lib/md.ts';
import { lastEthUsd, SUPPLY } from './lib/pons.ts';
import { ticker } from './lib/sources.ts';
import { usdShort } from './chart.ts';

export const REPO_URL = 'https://github.com/0xmfox/rabiq';
export const X_URL = 'https://x.com/0xMfox';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ICON = {
  github: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
};

const NAV = [
  ['#/app', 'Live desk', (r: string) => r === '/app'],
  ['#/files', 'Dossiers', (r: string) => r === '/files' || r.startsWith('/d/') || r.startsWith('/s/')],
  ['#/graph', 'Graph', (r: string) => r === '/graph'],
  ['#/how', 'How to use', (r: string) => r === '/how'],
  ['#/docs', 'Docs', (r: string) => r === '/docs'],
] as const;

export function mountChrome(host: HTMLElement, onDig: (ca: string) => void) {
  host.innerHTML = `<header class="top"><div class="row">
      <a class="brand" href="#/"><img src="rabiq-256.png" alt=""><span>RABIQ</span></a>
      <form class="dig" data-chrome-dig><span class="dig-prefix">CA</span><input class="field" name="ca" placeholder="Paste a Robinhood Chain contract address" autocomplete="off" spellcheck="false"><button class="btn primary sm">Open file</button></form>
      <nav class="nav">${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}<i class="nav-rail" aria-hidden="true"></i></nav>
      <div class="top-end">
        <span class="block-live" title="Robinhood Chain block height"><i></i><b data-block>${blockText()}</b></span>
        <a class="icon-btn" href="${REPO_URL}" target="_blank" rel="noopener" aria-label="RABIQ on GitHub" title="GitHub">${ICON.github}</a>
        <a class="icon-btn" href="${X_URL}" target="_blank" rel="noopener" aria-label="@0xMfox on X" title="X">${ICON.x}</a>
        <a class="btn primary sm top-cta" href="#/app">Open app</a>
      </div>
    </div></header>
    <div class="tape" aria-label="Most traded Pons V2 tokens in the last ten minutes">
      <span class="tape-label"><i></i>Hot · 10m</span>
      <div class="tape-viewport"><div class="tape-track"><div class="tape-set">${idle()}</div><div class="tape-set" aria-hidden="true">${idle()}</div></div></div>
    </div>`;

  host.querySelector<HTMLFormElement>('[data-chrome-dig]')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).ca as HTMLInputElement;
    onDig(input.value.trim());
    input.value = '';
    input.blur();
  });

  mountTape(host.querySelector('.tape')!);
}

export function syncChrome(route: string) {
  const top = document.querySelector('#chrome .top');
  if (!top) return;
  top.classList.toggle('on-landing', route === '/' || route === '/how' || route === '/docs');
  const links = [...top.querySelectorAll<HTMLAnchorElement>('.nav a')];
  const i = NAV.findIndex(([, , match]) => match(route));
  links.forEach((a, k) => a.classList.toggle('on', k === i));
  const rail = top.querySelector<HTMLElement>('.nav-rail')!;
  if (i < 0) return void (rail.style.opacity = '0');
  const a = links[i], nav = a.parentElement!.getBoundingClientRect(), r = a.getBoundingClientRect();
  rail.style.opacity = '1';
  rail.style.width = `${r.width}px`;
  rail.style.transform = `translateX(${r.left - nav.left}px)`;
}

// ---------- tape ----------
const idle = () => Array.from({ length: 8 }, () => '<span class="tape-item idle"><b>$····</b><span>reading chain</span></span>').join('');

function tapeItems() {
  const usd = lastEthUsd();
  const hot = rank('hot').slice(0, 32);
  if (hot.length < 4) return null;
  return hot.map((t) => {
    const ch = change(t), p = priceOf(t);
    const mc = usd ? usdShort(p * SUPPLY * usd) : `${(p * SUPPLY).toFixed(2)} ETH`;
    return `<a class="tape-item" href="#/d/${t.token}"><b>${esc(ticker(t.symbol))}</b><span>${mc}</span>${ch == null ? '' : `<em class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${Math.abs(ch) >= 1000 ? ch.toFixed(0) : ch.toFixed(1)}%</em>`}</a>`;
  }).join('');
}

function mountTape(el: HTMLElement) {
  const track = el.querySelector<HTMLElement>('.tape-track')!;
  const sets = el.querySelectorAll<HTMLElement>('.tape-set');
  let pending: string | null = null, first = true;
  const apply = (html: string) => {
    sets.forEach((s) => (s.innerHTML = html));
    // constant speed whatever the content width; capped so a loop (and the next content swap) never takes too long
    track.style.setProperty('--dur', `${Math.min(22, Math.max(10, sets[0].scrollWidth / 55))}s`);
  };
  // swap content only when the loop restarts, so the tape never jumps
  track.addEventListener('animationiteration', () => { if (pending) { apply(pending); pending = null; } });
  onDesk(() => {
    const html = tapeItems();
    if (!html) return;
    if (first || reduced()) { apply(html); first = false; el.classList.add('live'); }
    else pending = html;
  });
}
