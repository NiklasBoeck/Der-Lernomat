// Lesemodus für PDF-Skripte: Leiste oben (verschwindet beim Wischen nach oben), Zoom mit zwei Fingern,
// Seitenfarbe (auch dunkel), eine oder zwei Seiten nebeneinander und gemerkter Lesestand.
import { esc } from './markdown.js';
import { icon, toast, openModal } from './ui.js';

const POS_KEY = 'lernomat.lesestand';
const LOOK_KEY = 'lernomat.pdfLook';
const COLS_KEY = 'lernomat.pdfCols';
// Ab dieser Breite (z. B. aufgeklapptes iPhone, iPad, quer) passen zwei Seiten nebeneinander.
const WIDE = 560;

const LOOKS = [
  ['auto', 'Wie die App', 'Hell oder dunkel, je nach Einstellung'],
  ['light', 'Original', 'Weiße Seiten, wie gedruckt'],
  ['dark', 'Dunkel', 'Helle Schrift auf dunklen Seiten'],
  ['sepia', 'Sepia', 'Warmes Papier, schont die Augen'],
];

const load = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

// Lesestand pro Datei: { page, total, at }.
function allPos() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; }
}
export function readPos(id) { return allPos()[id] || null; }
function savePos(id, page, total) {
  const all = allPos();
  all[id] = { page, total, at: Date.now() };
  save(POS_KEY, JSON.stringify(all));
}

export const wantCols = w => (w >= WIDE && load(COLS_KEY, '1') === '2' ? 2 : 1);

export function readerTop(f) {
  return `<header class="reader-top" id="rTop">
    <div class="rt-row">
      <button class="icon-btn plain" data-act="back" aria-label="Zurück">${icon('back')}</button>
      <div class="rt-title"><b>${esc(f.name)}</b><span class="muted" id="pageInfo"></span></div>
      <button class="icon-btn plain" data-r="search" aria-label="Im Skript suchen">${icon('search')}</button>
      <button class="icon-btn plain" data-act="download" aria-label="Datei öffnen">${icon('share')}</button>
    </div>
    <div class="rt-tools">
      <button data-r="prev" aria-label="Vorige Seite">${icon('back')}</button>
      <button class="rt-txt" data-r="jump" aria-label="Zu Seite springen" id="rtPage">1 / 1</button>
      <button data-r="next" aria-label="Nächste Seite">${icon('next')}</button>
      <span class="rt-sep"></span>
      <button data-r="zout" aria-label="Verkleinern">${icon('zoomOut')}</button>
      <button class="rt-txt" data-r="fit" aria-label="Auf Breite zurücksetzen" id="rtZoom">100 %</button>
      <button data-r="zin" aria-label="Vergrößern">${icon('zoomIn')}</button>
      <span class="rt-sep"></span>
      <button data-r="cols" id="rtCols" aria-label="Eine oder zwei Seiten" hidden></button>
      <button data-r="look" aria-label="Seitenfarbe">${icon('contrast')}</button>
      <button data-r="full" id="rtFull" aria-label="Vollbild">${icon('expand')}</button>
    </div>
    <form class="viewer-search rt-search" id="vSearch" hidden><input class="input" id="vTerm" type="search" placeholder="Im Skript suchen …" enterkeyhint="search"><button class="btn small" type="submit">Suchen</button></form>
  </header>
  <div class="reader-progress" aria-hidden="true"><i id="rtProg"></i></div>
  <div class="reader-spacer" id="rSpacer"></div>`;
}

export function attachReader({ docEl, ctl, fileId }) {
  const top = document.getElementById('rTop');
  const spacer = document.getElementById('rSpacer');
  const q = id => document.getElementById(id);
  const offs = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };
  document.body.classList.add('reading');

  // ----- Leiste ein- und ausblenden -----
  let hidden = false;
  const setHidden = h => {
    if (h && (top.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
    hidden = h;
    top.classList.toggle('away', h);
    document.body.classList.toggle('reading-away', h);
    wake(h);
  };
  const ro = new ResizeObserver(() => { spacer.style.height = top.offsetHeight + 'px'; });
  ro.observe(top);
  let lastY = window.scrollY;
  let travel = 0;
  let pinching = false;
  // Nach eigenen Sprüngen (Zoom, Blättern) kurz nicht auf Scrollen reagieren.
  let quietUntil = 0;
  const quiet = (ms = 900) => { quietUntil = Date.now() + ms; };
  on(window, 'scroll', () => {
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;
    // Große Sprünge (Seite anspringen, Lesestand) blenden die Leiste nicht aus.
    if (pinching || Date.now() < quietUntil || Math.abs(dy) > window.innerHeight * 0.8) { travel = 0; return; }
    if (y < 60) { travel = 0; if (hidden) setHidden(false); return; }
    // Kleine Zitterbewegungen ignorieren: erst nach einem Stück Weg in eine Richtung umschalten.
    travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
    if (travel > 24 && !hidden) setHidden(true);
    else if (travel < -48 && hidden) setHidden(false);
  }, { passive: true });

  // Bildschirm beim Lesen anlassen (solange die Leiste weg ist).
  let lock = null;
  const wake = async want => {
    try {
      if (want && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } else if (!want && lock) { await lock.release(); lock = null; }
    } catch { lock = null; }
  };
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'visible' && hidden) wake(true); });

  // ----- Seitenanzeige und Lesestand -----
  let saveTimer;
  const page = (n, total) => {
    q('rtPage').textContent = `${n} / ${total}`;
    q('rtProg').style.width = (total > 1 ? (n - 1) / (total - 1) * 100 : 100) + '%';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePos(fileId, n, total), 400);
  };

  // ----- Zoom -----
  const showZoom = () => { q('rtZoom').textContent = Math.round(ctl.zoom * 100) + ' %'; };
  const zoomTo = (z, from, to) => { quiet(); ctl.setZoom(z, from, to); showZoom(); };
  const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // ----- Eine/zwei Seiten (nur wenn breit genug, z. B. aufgeklappt) -----
  const showCols = () => {
    const b = q('rtCols');
    b.hidden = ctl.pages < 2 || ctl.fitWidth < WIDE;
    b.innerHTML = icon(ctl.cols === 2 ? 'twoPages' : 'onePage');
    b.classList.toggle('on', ctl.cols === 2);
  };
  const roDoc = new ResizeObserver(() => showCols());
  roDoc.observe(docEl);

  // ----- Seitenfarbe -----
  const applyLook = () => { docEl.dataset.look = load(LOOK_KEY, 'auto'); };
  applyLook();
  const lookSheet = () => {
    const cur = load(LOOK_KEY, 'auto');
    const m = openModal(`<h2 style="margin:0 0 4px">Seitenfarbe</h2><p class="muted" style="margin:0 0 14px">So sehen die Seiten deiner PDF aus.</p>
      <div class="look-grid">${LOOKS.map(([v, l, d]) => `<button class="look-opt ${v === cur ? 'on' : ''}" data-v="${v}"><span class="look-swatch sw-${v}"><i></i><i></i><i></i></span><b>${l}</b><small>${d}</small></button>`).join('')}</div>`);
    m.el.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
      save(LOOK_KEY, b.dataset.v);
      applyLook();
      m.close();
    }));
  };

  // ----- Zu Seite springen -----
  const jumpSheet = () => {
    const total = ctl.pages;
    const m = openModal(`<h2 style="margin:0 0 14px">Zu Seite springen</h2>
      <div class="jump-row"><input type="range" id="jRange" min="1" max="${total}" value="${ctl.page}"><input class="input" id="jNum" type="number" inputmode="numeric" min="1" max="${total}" value="${ctl.page}"></div>
      <p class="muted" style="margin:8px 0 16px">von ${total} Seiten</p>
      <div class="btn-row"><button class="btn" data-j="1">Anfang</button><button class="btn primary" data-j="go">Los</button></div>`);
    const r = m.el.querySelector('#jRange');
    const num = m.el.querySelector('#jNum');
    r.addEventListener('input', () => { num.value = r.value; });
    num.addEventListener('input', () => { r.value = num.value; });
    const goN = n => { m.close(); quiet(); ctl.goTo(n); };
    m.el.querySelector('[data-j="1"]').addEventListener('click', () => goN(1));
    m.el.querySelector('[data-j="go"]').addEventListener('click', () => goN(num.value));
    num.addEventListener('keydown', e => { if (e.key === 'Enter') goN(num.value); });
  };

  // ----- Vollbild -----
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const toggleFull = async () => {
    if (canFs) {
      try {
        if (fsEl()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
      } catch { /* geht nicht überall */ }
    }
    if (!fsEl()) {
      setHidden(true);
      if (load('lernomat.tipFull', '') !== '1') { toast('Tippe auf die Seite, um die Leiste zurückzuholen'); save('lernomat.tipFull', '1'); }
    }
  };
  const onFs = () => { q('rtFull').innerHTML = icon(fsEl() ? 'shrink' : 'expand'); if (fsEl()) setHidden(true); };
  on(document, 'fullscreenchange', onFs);
  on(document, 'webkitfullscreenchange', onFs);

  // ----- Knöpfe der Leiste -----
  const tools = {
    prev: () => { quiet(); ctl.step(-1); },
    next: () => { quiet(); ctl.step(1); },
    jump: jumpSheet,
    zin: () => zoomTo(ctl.zoom * 1.25),
    zout: () => zoomTo(ctl.zoom / 1.25),
    fit: () => zoomTo(1),
    cols: () => {
      save(COLS_KEY, ctl.cols === 2 ? '1' : '2');
      quiet();
      ctl.refreshCols();
      showCols();
      toast(ctl.cols === 2 ? 'Zwei Seiten nebeneinander' : 'Eine Seite');
    },
    look: lookSheet,
    full: toggleFull,
    search: () => {
      const form = q('vSearch');
      form.hidden = !form.hidden;
      if (!form.hidden) q('vTerm').focus();
    },
  };
  on(top, 'click', e => {
    const b = e.target.closest('[data-r]');
    if (b && tools[b.dataset.r]) tools[b.dataset.r]();
  });

  // ----- Gesten auf den Seiten -----
  const wrap = docEl.querySelector('.pdf-pages');
  // Vorschau beim Kneifen: nur verschieben/skalieren, erst am Ende wirklich neu zeichnen.
  let pz = null;
  const preview = (s, m) => {
    wrap.style.transformOrigin = `${pz.ox}px ${pz.oy}px`;
    wrap.style.transform = `translate(${m.x - pz.m0.x}px, ${m.y - pz.m0.y}px) scale(${s})`;
  };
  const startPreview = m0 => {
    const r = wrap.getBoundingClientRect();
    pz = { m0, ox: m0.x - r.left, oy: m0.y - r.top, z0: ctl.zoom, s: 1, m: m0 };
  };
  const endPreview = () => {
    if (!pz) return;
    const { z0, s, m0, m } = pz;
    pz = null;
    wrap.style.transform = '';
    zoomTo(z0 * s, m0, m);
  };
  const clampS = s => Math.max(0.5 / pz.z0, Math.min(5 / pz.z0, s));
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const midp = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  let d0 = 0;
  on(docEl, 'touchstart', e => {
    if (e.touches.length === 2) {
      pinching = true;
      d0 = dist(e.touches);
      startPreview(midp(e.touches));
    }
  }, { passive: true });
  on(docEl, 'touchmove', e => {
    if (!pz || e.touches.length !== 2) return;
    e.preventDefault();
    pz.s = clampS(dist(e.touches) / d0);
    pz.m = midp(e.touches);
    preview(pz.s, pz.m);
  }, { passive: false });
  const touchEnd = e => {
    if (pz && e.touches.length < 2) {
      endPreview();
      setTimeout(() => { pinching = false; lastY = window.scrollY; }, 200);
    }
  };
  on(docEl, 'touchend', touchEnd);
  on(docEl, 'touchcancel', touchEnd);
  // Safari soll nicht die ganze App vergrößern.
  const noGesture = e => e.preventDefault();
  on(document, 'gesturestart', noGesture);
  on(document, 'gesturechange', noGesture);

  // Trackpad am Mac (Kneifen) bzw. Strg + Mausrad.
  let wheelTimer;
  on(docEl, 'wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const m = { x: e.clientX, y: e.clientY };
    if (!pz) startPreview(m);
    pz.s = clampS(pz.s * Math.exp(-e.deltaY * 0.01));
    preview(pz.s, pz.m);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(endPreview, 160);
  }, { passive: false });

  // Einmal tippen: Leiste zeigen/verstecken. Doppelt tippen: vergrößern bzw. zurück auf Breite.
  let lastTap = null;
  let tapTimer;
  on(docEl, 'click', e => {
    if (e.target.closest('a, button, input')) return;
    if (!window.getSelection()?.isCollapsed) return;
    const t = { x: e.clientX, y: e.clientY, at: Date.now() };
    if (lastTap && t.at - lastTap.at < 320 && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < 40) {
      clearTimeout(tapTimer);
      lastTap = null;
      zoomTo(ctl.zoom > 1.05 ? 1 : 2, t);
      return;
    }
    lastTap = t;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => setHidden(!hidden), 300);
  });

  // Tastatur (iPad mit Tastatur, Mac).
  on(document, 'keydown', e => {
    if (e.target.closest?.('input, textarea, select') || e.metaKey || e.altKey || document.querySelector('.modal-bg')) return;
    const k = e.key;
    if ((k === 'ArrowRight' || k === 'ArrowLeft') && ctl.zoom <= 1.01) { e.preventDefault(); ctl.step(k === 'ArrowRight' ? 1 : -1); }
    else if (k === '+' || k === '=') { e.preventDefault(); tools.zin(); }
    else if (k === '-') { e.preventDefault(); tools.zout(); }
    else if (k === '0') { e.preventDefault(); tools.fit(); }
    else if (k.toLowerCase() === 'f' && !e.ctrlKey) { e.preventDefault(); toggleFull(); }
    else if (k === 'Escape' && hidden) setHidden(false);
  });

  showZoom();
  showCols();
  return {
    page,
    destroy() {
      offs.forEach(f => f());
      ro.disconnect();
      roDoc.disconnect();
      clearTimeout(tapTimer);
      clearTimeout(wheelTimer);
      wake(false);
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
      document.body.classList.remove('reading', 'reading-away');
    },
  };
}
