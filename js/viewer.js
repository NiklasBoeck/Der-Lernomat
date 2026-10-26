// Skript-Ansicht: PDFs, Texte und Bilder direkt in der App lesen, mit Suche und Sprung zur Fundstelle.
import { esc } from './markdown.js';

const PDFJS = './vendor/pdfjs-4.10.38.min.mjs';
const WORKER = new URL('./vendor/pdfjs-4.10.38.worker.min.mjs', import.meta.url).href;
let pdfjsPromise;
export function loadPdfjs() {
  pdfjsPromise ||= import(PDFJS).then(m => { m.GlobalWorkerOptions.workerSrc = WORKER; return m; });
  return pdfjsPromise;
}

// Vergleichsschlüssel: ohne Leerzeichen, Trennstriche und Groß-/Kleinschreibung.
const key = s => String(s || '').toLowerCase().replace(/[\s­\-‐-‒–]+/g, '');

// Findet ein Zitat (oder seinen Anfang) in einem Text-Schlüssel.
function findKey(hay, q) {
  const k = key(q);
  if (!k) return null;
  let i = hay.indexOf(k);
  if (i >= 0) return [i, k.length];
  for (const n of [80, 40, 20]) {
    if (k.length <= n) continue;
    i = hay.indexOf(k.slice(0, n));
    if (i >= 0) return [i, n];
  }
  return null;
}

// ===== PDF =====
// Große Leinwände bringen Safari auf dem iPhone zum Absturz, darum begrenzt.
const MAX_PIXELS = 12e6;

export async function renderPdf(container, blob, { onPage, colsFor = () => 1 } = {}) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  let zoom = 1;
  let cols = 1;
  const wrap = document.createElement('div');
  wrap.className = 'pdf-pages';
  container.innerHTML = '';
  container.classList.add('pdf-doc');
  container.appendChild(wrap);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.page = n;
    el.innerHTML = `<span class="pdf-num">${n}</span>`;
    wrap.appendChild(el);
    pages.push({ el, n, ratio: base.height / base.width, rendered: null, gen: 0, task: null, textDivs: [] });
  }

  // Breite, die eine Seite bei Zoom 100 % bekommt (ganze Breite bzw. halbe bei zwei Seiten).
  const fitWidth = () => {
    const cs = getComputedStyle(container);
    return container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const gap = () => parseFloat(getComputedStyle(wrap).columnGap) || 0;
  const pageWidth = () => {
    const w = fitWidth();
    const one = cols === 2 ? (w - gap()) / 2 : Math.min(w, 1000);
    return Math.max(120, Math.floor(one * zoom));
  };
  const layout = () => {
    const w = pageWidth();
    wrap.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
    for (const p of pages) { p.el.style.width = w + 'px'; p.el.style.height = Math.round(w * p.ratio) + 'px'; }
  };

  const freeCanvases = el => el.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; });
  const unload = p => {
    p.gen++;
    p.task?.cancel();
    p.task = null;
    p.rendered = null;
    p.textDivs = [];
    freeCanvases(p.el);
    p.el.classList.remove('stale');
    p.el.innerHTML = `<span class="pdf-num">${p.n}</span>`;
  };

  const renderPage = n => {
    const p = pages[n - 1];
    if (p.rendered) return p.rendered;
    const gen = ++p.gen;
    p.rendered = (async () => {
      const page = await doc.getPage(n);
      if (gen !== p.gen) return;
      const v1 = page.getViewport({ scale: 1 });
      p.ratio = v1.height / v1.width;
      const scale = pageWidth() / v1.width;
      const vp = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      p.el.style.height = Math.round(vp.height) + 'px';
      p.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      try { await p.task.promise; } catch { canvas.width = canvas.height = 0; return; }
      if (gen !== p.gen) { canvas.width = canvas.height = 0; return; }
      p.task = null;
      p.el.style.setProperty('--scale-factor', scale);
      const tl = document.createElement('div');
      tl.className = 'textLayer';
      freeCanvases(p.el);
      p.el.classList.remove('stale');
      p.el.replaceChildren(canvas, tl);
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await layer.render();
      if (gen === p.gen) p.textDivs = layer.textDivs;
    })();
    p.rendered.catch(() => { if (gen === p.gen) p.rendered = null; });
    return p.rendered;
  };

  // Nur Seiten in der Nähe des Bildschirms zeichnen, weit entfernte wieder freigeben.
  let current = 1;
  let raf = 0;
  const update = () => {
    raf = 0;
    const h = window.innerHeight;
    const mid = h / 2;
    let found = 0;
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      if (r.bottom > -h && r.top < h * 2) renderPage(p.n);
      else if ((r.bottom < -h * 4 || r.top > h * 5) && (p.rendered || p.el.firstElementChild?.tagName === 'CANVAS')) unload(p);
      if (!found && r.top <= mid && r.bottom >= mid) found = p.n;
    }
    const se = document.scrollingElement;
    if (se.scrollTop + h >= se.scrollHeight - 4) found = doc.numPages;
    if (found && found !== current) { current = found; onPage && onPage(current, doc.numPages); }
  };
  const onScroll = () => { raf ||= requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('scroll', onScroll, { passive: true });

  // Merkt sich, welcher Punkt einer Seite an einer Bildschirmstelle liegt, damit er nach Zoom oder Drehen dort bleibt.
  const anchor = (x = window.innerWidth / 2, y = window.innerHeight * 0.3) => {
    let best = null;
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      if (r.bottom < y) continue;
      const hit = { p, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y };
      if (r.top > y) { best ||= hit; break; }
      if (!best || (r.left <= x && r.right >= x)) best = hit;
    }
    return best;
  };
  const restore = a => {
    if (!a) return;
    const r = a.p.el.getBoundingClientRect();
    window.scrollBy(0, r.top + a.fy * r.height - a.y);
    container.scrollLeft += r.left + a.fx * r.width - a.x;
  };
  const relayout = a => {
    for (const p of pages) {
      if (!p.rendered && !p.el.querySelector('canvas')) continue;
      p.gen++;
      p.task?.cancel();
      p.task = null;
      p.rendered = null;
      p.el.classList.add('stale');
    }
    layout();
    restore(a);
    update();
  };

  // Auf- und Zuklappen bzw. Drehen: Spaltenzahl neu wählen und an derselben Stelle weiterlesen.
  const pickCols = () => (doc.numPages > 1 && colsFor(fitWidth()) === 2 ? 2 : 1);
  cols = pickCols();
  layout();
  let lastWidth = fitWidth();
  const ro = new ResizeObserver(() => {
    const w = fitWidth();
    if (Math.abs(w - lastWidth) < 2) return;
    lastWidth = w;
    const a = anchor();
    cols = pickCols();
    relayout(a);
  });
  ro.observe(container);
  onPage && onPage(1, doc.numPages);
  update();

  const clearMarks = () => container.querySelectorAll('.textLayer .hl').forEach(s => s.classList.remove('hl'));

  const markOnPage = (n, q) => {
    const divs = pages[n - 1].textDivs;
    let hay = '';
    const ranges = [];
    for (const d of divs) {
      const k = key(d.textContent);
      ranges.push([hay.length, hay.length + k.length, d]);
      hay += k;
    }
    const hit = findKey(hay, q);
    if (!hit) return null;
    const [s, len] = hit;
    let firstEl = null;
    for (const [a, b, d] of ranges) {
      if (b > s && a < s + len && b > a) { d.classList.add('hl'); firstEl ||= d; }
    }
    return firstEl;
  };

  // Text aller Seiten für die Suche (wird bei Bedarf geladen).
  const texts = [];
  const pageText = async n => {
    if (texts[n] === undefined) {
      const tc = await (await doc.getPage(n)).getTextContent();
      texts[n] = key(tc.items.map(i => i.str).join(''));
    }
    return texts[n];
  };

  const clamp = n => Math.max(1, Math.min(doc.numPages, Number(n) || 1));
  const goTo = async (n, q) => {
    n = clamp(n);
    // Steht das Zitat nicht auf der genannten Seite, auf den Nachbarseiten suchen.
    if (q && !findKey(await pageText(n), q)) {
      for (const m of [n + 1, n - 1, n + 2]) {
        if (m >= 1 && m <= doc.numPages && findKey(await pageText(m), q)) { n = m; break; }
      }
    }
    clearMarks();
    pages[n - 1].el.scrollIntoView({ block: 'start' });
    await renderPage(n);
    const el = q ? markOnPage(n, q) : null;
    if (el) el.scrollIntoView({ block: 'center' });
    else pages[n - 1].el.scrollIntoView({ block: 'start' });
    current = n;
    onPage && onPage(n, doc.numPages);
    return !!el || !q;
  };

  // Blättern: eine Seite bzw. eine Doppelseite weiter.
  const step = dir => {
    let n = current;
    if (cols === 2) n -= (n - 1) % 2;
    n = clamp(n + dir * cols);
    pages[n - 1].el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return n;
  };

  let lastHit = 0;
  const search = async (term, dir = 1) => {
    if (!key(term)) return false;
    for (let i = 1; i <= doc.numPages; i++) {
      const n = ((lastHit - 1 + dir * i) % doc.numPages + doc.numPages) % doc.numPages + 1;
      if (findKey(await pageText(n), term)) { lastHit = n; await goTo(n, term); return n; }
    }
    return false;
  };

  return {
    pages: doc.numPages,
    get page() { return current; },
    get zoom() { return zoom; },
    get cols() { return cols; },
    goTo, search, step,
    // Zoom um einen Bildschirmpunkt (from) und diesen Punkt danach an "to" setzen (beim Kneifen wandert die Mitte mit).
    setZoom(z, from, to = from) {
      z = Math.max(0.5, Math.min(5, z));
      if (Math.abs(z - zoom) < 0.01) return zoom;
      const a = from ? anchor(from.x, from.y) : anchor();
      if (a && to) { a.x = to.x; a.y = to.y; }
      zoom = z;
      relayout(a);
      return zoom;
    },
    // Spaltenzahl nach geänderter Vorliebe neu bestimmen.
    refreshCols() {
      const c = pickCols();
      if (c === cols) return;
      const a = anchor();
      cols = c;
      relayout(a);
    },
    get fitWidth() { return fitWidth(); },
    destroy() {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      pages.forEach(unload);
      doc.destroy();
    },
  };
}

// ===== Text (TXT, Markdown, Word, PowerPoint) =====
export function renderText(container, text) {
  const k = [];
  const pos = [];
  for (let i = 0; i < text.length; i++) {
    const c = key(text[i]);
    if (c) { k.push(c); pos.push(i); }
  }
  const hay = k.join('');
  const show = (start, end) => {
    container.innerHTML = start == null ? `<div class="text-doc">${esc(text)}</div>`
      : `<div class="text-doc">${esc(text.slice(0, start))}<mark class="hl-mark" id="hit">${esc(text.slice(start, end))}</mark>${esc(text.slice(end))}</div>`;
  };
  show();
  let last = -1;
  const goTo = (q, charIndex) => {
    const hit = q ? findKey(hay, q) : null;
    if (hit) show(pos[hit[0]], pos[hit[0] + hit[1] - 1] + 1);
    else if (charIndex != null) show(charIndex, Math.min(text.length, charIndex + 80));
    else return false;
    document.getElementById('hit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  };
  const search = term => {
    const kk = key(term);
    if (!kk) return false;
    let i = hay.indexOf(kk, last + 1);
    if (i < 0) i = hay.indexOf(kk);
    if (i < 0) return false;
    last = i;
    show(pos[i], pos[i + kk.length - 1] + 1);
    document.getElementById('hit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  };
  return { goTo, search, destroy() {} };
}
