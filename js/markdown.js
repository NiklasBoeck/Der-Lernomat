// Kleiner, sicherer Markdown-Renderer für KI-Texte (HTML wird immer escaped).
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

export function slug(s, i) {
  return 'h-' + i + '-' + String(s).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').slice(0, 40);
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(h[1].length, 3);
      const id = slug(h[2], headings.length);
      if (level === 2) headings.push({ id, text: h[2].replace(/\*\*/g, '') });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push('<blockquote>' + renderMarkdown(q.join('\n')).html + '</blockquote>');
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      out.push(renderList(lines, i, n => { i = n; }));
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html: out.join('\n'), headings };
}

function renderList(lines, start, setIndex) {
  const indentOf = l => l.match(/^\s*/)[0].length;
  const baseIndent = indentOf(lines[start]);
  const ordered = /^\s*\d+[.)]/.test(lines[start]);
  let i = start;
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      if (i + 1 < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1]) && indentOf(lines[i + 1]) >= baseIndent) { i++; continue; }
      break;
    }
    const ind = indentOf(l);
    const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (m && ind === baseIndent) { items.push({ text: m[2], sub: '' }); i++; continue; }
    if (m && ind > baseIndent && items.length) {
      items[items.length - 1].sub += renderList(lines, i, n => { i = n; });
      continue;
    }
    if (ind > baseIndent && items.length) { items[items.length - 1].text += ' ' + l.trim(); i++; continue; }
    break;
  }
  setIndex(i);
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>` + items.map(it => '<li>' + inline(it.text) + it.sub + '</li>').join('') + `</${tag}>`;
}
