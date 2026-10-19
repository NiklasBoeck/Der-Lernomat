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
export async function renderPdf(container, blob, { onPage } = {}) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const width = () => Math.min(container.clientWidth, 1000);
  const pages = [];
  container.innerHTML = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.page = n;
    el.style.height = Math.round(width() * base.height / base.width) + 'px';
    el.innerHTML = `<span class="pdf-num">${n}</span>`;
    container.appendChild(el);
    pages.push({ el, rendered: null, textDivs: [] });
  }

  const renderPage = n => {
    const p = pages[n - 1];
    if (p.rendered) return p.rendered;
    p.rendered = (async () => {
      const page = await doc.getPage(n);
      const scale = width() / page.getViewport({ scale: 1 }).width;
      const vp = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = vp.width + 'px';
      canvas.style.height = vp.height + 'px';
      p.el.style.height = vp.height + 'px';
      p.el.style.setProperty('--scale-factor', scale);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      const tl = document.createElement('div');
      tl.className = 'textLayer';
      p.el.replaceChildren(canvas, tl);
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await layer.render();
      p.textDivs = layer.textDivs;
    })();
    return p.rendered;
  };

  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) renderPage(Number(e.target.dataset.page));
  }, { rootMargin: '900px 0px' });
  pages.forEach(p => io.observe(p.el));

  let current = 1;
  const onScroll = () => {
    const mid = window.innerHeight / 2;
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) {
        const n = Number(p.el.dataset.page);
        if (n !== current) { current = n; onPage && onPage(n, doc.numPages); }
        break;
      }
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onPage && onPage(1, doc.numPages);

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

  const goTo = async (n, q) => {
    n = Math.max(1, Math.min(doc.numPages, Number(n) || 1));
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
    goTo, search,
    destroy() { io.disconnect(); window.removeEventListener('scroll', onScroll); doc.destroy(); },
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
