// Tiny markdown for notes. Escapes first: published dossiers are other people's text.
import { EXPLORER } from './chain.ts';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(s: string, resolve: (ref: string) => string | null) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[([^\]]{1,64})\]\]/g, (m, ref) => {
      const href = resolve(ref);
      return href ? `<a class="wiki" href="${href}">${ref}</a>` : `<span class="wiki missing" title="Not in your burrow yet">${ref}</span>`;
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/(^|[^\w/>"])(0x[0-9a-fA-F]{40})\b/g, (m, pre, a) =>
      `${pre}<a class="addr" href="${EXPLORER}/address/${a}" target="_blank" rel="noopener noreferrer">${a.slice(0, 6)}…${a.slice(-4)}</a>`);
}

export function md(src: string, resolve: (ref: string) => string | null = () => null): string {
  const out: string[] = [];
  let list = false;
  for (const line of src.split('\n')) {
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (!item && list) { out.push('</ul>'); list = false; }
    if (item) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(item[1], resolve)}</li>`);
    } else if (/^#{1,3}\s/.test(line)) {
      const n = line.match(/^#+/)![0].length;
      out.push(`<h${n + 2}>${inline(line.replace(/^#+\s/, ''), resolve)}</h${n + 2}>`);
    } else if (line.trim()) out.push(`<p>${inline(line, resolve)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
