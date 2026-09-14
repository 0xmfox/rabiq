// The burrow as a graph: dossiers are nodes, links are strings. Drag nodes; positions persist per browser.
import { type Dossier } from './lib/burrow.ts';
import { findLinks } from './lib/links.ts';
import { esc } from './lib/md.ts';

const KEY = 'rabiq.graph.v1';
const COLOR: Record<Dossier['status'], string> = { watching: '#7cc4f5', digging: '#f2c14e', 'in-position': '#b8ef45', passed: '#5f6b58' };
const STATUS_LABEL: Record<Dossier['status'], string> = { watching: 'Watching', digging: 'Researching', 'in-position': 'In position', passed: 'Passed' };

type Edge = { a: string; b: string; confirmed: boolean; label: string; title: string };

export function renderGraph(host: HTMLElement, list: Dossier[], intro = false) {
  // one string per pair: solid if anything is confirmed, label shows the strongest reason
  const pairs = new Map<string, Edge & { labels: string[] }>();
  for (const l of findLinks(list)) {
    const key = [l.a, l.b].sort().join('|');
    const e = pairs.get(key) ?? { a: l.a, b: l.b, confirmed: false, label: '', title: '', labels: [] };
    e.confirmed ||= l.confirmed;
    l.confirmed ? e.labels.unshift(l.label) : e.labels.push(l.label);
    pairs.set(key, e);
  }
  const links: Edge[] = [...pairs.values()].map((e) => ({ ...e, label: e.labels[0] + (e.labels.length > 1 ? `  +${e.labels.length - 1}` : ''), title: e.labels.join('\n') }));
  let pos: Record<string, { x: number; y: number }> = {};
  try { pos = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* empty */ }
  const W = 1000, H = 640;
  list.forEach((d, i) => {
    if (pos[d.id]) return;
    const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
    pos[d.id] = { x: W / 2 + Math.cos(a) * 250, y: H / 2 + Math.sin(a) * 210 };
  });

  if (!list.length) {
    host.innerHTML = '<div class="card"><h2>Graph</h2><p class="muted">Open a few dossiers or load the demo to see connections.</p></div>';
    return;
  }

  // nodes carry their position in the transform attribute, so the entrance animates an inner group
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="${intro ? 'play' : ''}">
    <g class="edges">${links.map((l, i) => `<line class="edge ${l.confirmed ? '' : 'h'}" data-e="${i}" ${l.confirmed ? 'pathLength="1"' : ''} style="--i:${i}"><title>${esc(l.title)}</title></line><text class="edge-label" data-el="${i}" text-anchor="middle" style="--i:${i}">${esc(l.label)}</text>`).join('')}</g>
    <g class="nodes">${list.map((d, i) => `<g class="node st-${d.status}" data-id="${d.id}"><g class="node-body" style="--i:${i}">
      <rect x="-64" y="-25" width="128" height="50" rx="9" fill="#151c12" stroke="rgba(232,240,222,.16)"/>
      <circle cx="-46" cy="0" r="4" fill="${COLOR[d.status]}"/>
      <text x="-34" y="-3">${esc(d.symbol || 'Unknown')}</text>
      <text class="sub" x="-34" y="13">${STATUS_LABEL[d.status]}</text></g></g>`).join('')}</g>
  </svg>
  <div class="legend"><span><i></i>Confirmed: shared deployer, fee recipient or repository</span><span><i class="h"></i>Hypothesis: mentioned in your notes</span><span>Drag to arrange, click to open</span></div>`;

  const svg = host.querySelector('svg')!;
  const place = () => {
    host.querySelectorAll<SVGGElement>('.node').forEach((n) => { const p = pos[n.dataset.id!]; n.setAttribute('transform', `translate(${p.x} ${p.y})`); });
    links.forEach((l, i) => {
      const a = pos[l.a], b = pos[l.b];
      const line = host.querySelector(`[data-e="${i}"]`)!, label = host.querySelector(`[data-el="${i}"]`)!;
      const off = 0;
      line.setAttribute('x1', String(a.x)); line.setAttribute('y1', String(a.y + off));
      line.setAttribute('x2', String(b.x)); line.setAttribute('y2', String(b.y + off));
      label.setAttribute('x', String((a.x + b.x) / 2)); label.setAttribute('y', String((a.y + b.y) / 2 + off - 10));
      label.setAttribute('visibility', Math.hypot(b.x - a.x, b.y - a.y) > 260 ? 'visible' : 'hidden');
    });
  };
  place();

  let drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;
  const toSvg = (e: PointerEvent) => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse()); return { x: p.x, y: p.y }; };
  svg.addEventListener('pointerdown', (e) => {
    const n = (e.target as Element).closest<SVGGElement>('.node');
    if (!n) return;
    const p = toSvg(e), id = n.dataset.id!;
    drag = { id, dx: pos[id].x - p.x, dy: pos[id].y - p.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSvg(e);
    pos[drag.id] = { x: Math.max(70, Math.min(W - 70, p.x + drag.dx)), y: Math.max(34, Math.min(H - 34, p.y + drag.dy)) };
    drag.moved = true;
    place();
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.moved) location.hash = `#/d/${drag.id.split(':')[1]}`;
    else try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* storage blocked */ }
    drag = null;
  });
}
