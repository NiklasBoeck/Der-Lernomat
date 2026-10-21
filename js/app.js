// Der Lernomat – Hauptlogik: Navigation und alle Bildschirme.
import { db, uid, requestPersistence } from './db.js';
import { icon, LOGO, toast, openModal, confirmDialog, relDate, shuffle, getTheme, setTheme, applyTheme } from './ui.js';
import { renderPdf, renderText } from './viewer.js';
import { esc, renderMarkdown } from './markdown.js';
import { playIntro, unlock, audioUnlocked, sfx, soundEnabled, setSoundEnabled } from './audio.js';
import { ingestFile, filesToBlocks, fileBadge, formatSize, totalSize, CATEGORIES, ACCEPT } from './files.js';
import * as AI from './ai.js';
import * as PR from './prompts.js';
import { initChat, setChatContext, showFab } from './chat.js';
import { CLOUD_AI } from './config.js';
import * as Nomi from './nomi/engine.js';
import * as LLM from './nomi/llm.js';

// Ohne Cloud-KI ist Nomi immer bereit, ganz ohne Schlüssel.
const aiReady = () => !CLOUD_AI || AI.hasKey();
const KI = CLOUD_AI ? 'die KI' : 'Nomi';

const app = document.getElementById('app');
let actions = {};
let cleanups = [];
let renderId = 0;

export const TYPES = {
  summary: { name: 'Zusammenfassung', plural: 'Zusammenfassungen', icon: 'summary', cls: 'c-sum', desc: 'Das Wichtigste übersichtlich auf den Punkt gebracht.' },
  cards: { name: 'Karteikarten', plural: 'Karteikarten', icon: 'cards', cls: 'c-cards', desc: 'Begriffe und Fragen zum Umdrehen, mit Lernfortschritt.' },
  exam: { name: 'Übungsklausur', plural: 'Übungsklausuren', icon: 'exam', cls: 'c-exam', desc: 'Realistische Prüfung mit Auswertung und Feedback.' },
  plan: { name: 'Lernplan', plural: 'Lernpläne', icon: 'plan', cls: 'c-plan', desc: 'Dein Weg bis zur Prüfung, Schritt für Schritt.' },
};
const EMOJIS = ['📘', '📗', '📕', '📙', '🧪', '🧬', '⚗️', '🧮', '📐', '💻', '🌍', '🏛️', '⚖️', '💶', '🧠', '🎨', '🎵', '🗣️', '🩺', '📊', '✏️', '🔭'];
const COLORS = ['#4F5BD5', '#7A63D8', '#DE6C5A', '#E59A4B', '#D4B03A', '#47B486', '#2E8F8A', '#4F9FD5', '#C25E9C', '#6C7480'];

// ===== Navigation =====
function go(view, params = {}, { replace = false } = {}) {
  const st = { view, params };
  if (replace) history.replaceState(st, ''); else history.pushState(st, '');
  render(st);
}
function back(fallback = { view: 'home', params: {} }) {
  if (history.state && history.length > 1 && history.state.view !== 'home') history.back();
  else go(fallback.view, fallback.params, { replace: true });
}
window.addEventListener('popstate', e => render(e.state || { view: 'home', params: {} }));

async function render(st) {
  // Zurück auf den Startbildschirm führt direkt ins Hauptmenü.
  if (!st || st.view === 'splash') { st = { view: 'home', params: {} }; history.replaceState(st, ''); }
  const id = ++renderId;
  cleanups.forEach(fn => { try { fn(); } catch { /* egal */ } });
  cleanups = [];
  actions = {};
  window.scrollTo(0, 0);
  const views = { home: viewHome, subject: viewSubject, builder: viewBuilder, set: viewSet, settings: viewSettings, file: viewFile };
  showFab(st.view !== 'splash');
  setChatContext(null);
  try {
    await (views[st.view] || viewHome)(st.params || {}, () => id === renderId);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="screen"><div class="empty"><div class="big">😕</div>Da ist etwas schiefgelaufen.<br><small>${esc(err.message)}</small><div class="mt"><button class="btn primary" data-act="home">Zum Hauptmenü</button></div></div></div>`;
    actions.home = () => go('home', {}, { replace: true });
  }
}

// Ein Klick-Handler für alles: Elemente mit data-act rufen die Aktion des aktuellen Bildschirms auf.
app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || !app.contains(t)) return;
  const fn = actions[t.dataset.act];
  if (fn) { e.preventDefault(); fn(t.dataset, t, e); }
});

const topbar = ({ backTo = true, crumb = '', right = '' } = {}) => `
  <header class="topbar">
    ${backTo ? `<button class="icon-btn" data-act="back" aria-label="Zurück">${icon('back')}</button>` : `<div class="brand"><span class="mini-logo">${LOGO}</span>Der Lernomat</div>`}
    <div class="crumb">${crumb}</div><div class="spacer"></div>${right}
  </header>`;

// ===== Startbildschirm =====
function viewSplash() {
  showFab(false);
  const words = ['Der', 'Lernomat'];
  let n = 0;
  const title = words.map(w => `<span class="word">${[...w].map(ch => `<span class="ch" style="animation-delay:${0.35 + (n++) * 0.07}s">${esc(ch)}</span>`).join('')}</span>`).join('');
  app.innerHTML = `
    <div class="splash" id="splash">
      <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      <button class="sound-pill" id="soundPill" hidden>${icon('volume')} Ton an</button>
      <button class="title-btn" id="titleBtn" aria-label="Der Lernomat öffnen">
        <span class="logo-mark">${LOGO}</span>
        <span class="title-text">${title}</span>
        <span class="subtitle">${CLOUD_AI ? 'Dein KI-Lernbegleiter' : 'Dein Lernbegleiter mit Nomi 🦉'}</span>
      </button>
      <div class="tap-hint">Tippe auf den Titel, um loszulegen</div>
    </div>`;
  const splash = document.getElementById('splash');
  const pill = document.getElementById('soundPill');
  const hint = splash.querySelector('.tap-hint');
  let started = false;
  let startedAt = 0;
  // iPhone und Mac erlauben Ton erst nach dem ersten Tippen. Dann wartet der Startbildschirm darauf
  // und spielt Melodie und Titel-Animation zusammen ab.
  const begin = () => {
    if (started) return;
    started = true;
    startedAt = Date.now();
    splash.classList.remove('waiting');
    pill.hidden = true;
    hint.textContent = 'Tippe auf den Titel, um loszulegen';
    setTimeout(playIntro, 250);
  };
  const tryStart = async () => {
    if (started) return;
    await unlock();
    begin();
  };
  if (!soundEnabled() || audioUnlocked()) begin();
  else {
    splash.classList.add('waiting');
    hint.textContent = 'Tippe, um zu starten';
    // Kurz warten: manche Browser geben Ton auch ohne Tippen frei.
    setTimeout(() => { if (!started && audioUnlocked()) begin(); }, 350);
  }
  splash.addEventListener('touchend', tryStart);
  splash.addEventListener('click', tryStart);
  document.getElementById('titleBtn').addEventListener('click', e => {
    // Der erste Tipp startet nur Melodie und Animation.
    if (!started || Date.now() - startedAt < 700) return;
    e.stopPropagation();
    splash.classList.add('leaving');
    setTimeout(() => go('home', {}, { replace: true }), 480);
  });
  const onKey = e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('titleBtn')?.click(); };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
}

// ===== Hauptmenü =====
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Noch wach? 🌙';
  if (h < 11) return 'Guten Morgen! ☀️';
  if (h < 17) return 'Hallo! 👋';
  if (h < 22) return 'Guten Abend! 🌆';
  return 'Späte Lernrunde? 🌙';
}

function mastery(sets) {
  let total = 0, known = 0;
  for (const s of sets) {
    if (s.type === 'cards') for (const c of s.data.cards) { total++; if (c.box >= 3) known++; }
    if (s.type === 'plan') for (const st of s.data.steps) { total++; if (st.done) known++; }
  }
  return total ? known / total : null;
}

async function viewHome() {
  const [subjects, sets, files] = await Promise.all([db.all('subjects'), db.all('sets'), db.all('files')]);
  subjects.sort((a, b) => (b.lastOpened || b.created) - (a.lastOpened || a.created));
  const recent = [...sets].sort((a, b) => (b.lastOpened || b.created) - (a.lastOpened || a.created)).slice(0, 5);
  const subjById = Object.fromEntries(subjects.map(s => [s.id, s]));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  app.innerHTML = `<div class="screen">
    ${topbar({ backTo: false, right: `<button class="icon-btn" data-act="theme" aria-label="Hell/Dunkel umschalten">${icon(applyTheme() ? 'sun' : 'moon')}</button><button class="icon-btn" data-act="settings" aria-label="Einstellungen">${icon('settings')}</button>` })}
    <section class="hero"><h1>${greeting()}</h1><p>Was möchtest du heute lernen?</p></section>
    ${!aiReady() ? `<div class="notice" style="margin-bottom:16px">${icon('key')}<div><b>Verbinde deine KI.</b> Damit der Lernomat Zusammenfassungen, Karteikarten und Klausuren bauen kann, trage einmal deinen API-Schlüssel ein.<div class="mt" style="margin-top:10px"><button class="btn small primary" data-act="settings">Jetzt einrichten</button></div></div></div>` : ''}
    <div class="quick-actions">
      <button class="card tap qa" data-act="upload"><span class="ico">${icon('upload')}</span><div><b>Dateien hochladen</b><span>Skripte, Klausuren, Karteikarten …</span></div></button>
      <button class="card tap qa" data-act="newSubject"><span class="ico">${icon('folder')}</span><div><b>Neues Fach</b><span>Eigener Ordner mit Titel</span></div></button>
    </div>
    <div class="section-title"><h2>Deine Fächer</h2><span class="hint">${subjects.length ? subjects.length + (subjects.length === 1 ? ' Fach' : ' Fächer') : ''}</span></div>
    <div class="grid">
      ${subjects.map(s => {
        const sSets = sets.filter(x => x.subjectId === s.id);
        const fCount = files.filter(f => f.subjectId === s.id).length;
        const m = mastery(sSets);
        return `<button class="card tap folder" data-act="open" data-id="${s.id}">
          <div class="tab" style="background:${s.color}"></div>
          <div class="body"><div class="emoji">${s.emoji}</div><h3>${esc(s.name)}</h3>
          ${m !== null ? `<div class="progress"><i style="width:${Math.round(m * 100)}%"></i></div>` : ''}
          <div class="meta"><span>${fCount} ${fCount === 1 ? 'Datei' : 'Dateien'}</span><span>${sSets.length} ${sSets.length === 1 ? 'Lernset' : 'Lernsets'}</span>${m !== null ? `<span>${Math.round(m * 100)} % sicher</span>` : ''}</div></div>
        </button>`;
      }).join('')}
      <button class="card tap new-folder" data-act="newSubject">${icon('plus')}<span>Neues Fach anlegen</span></button>
    </div>
    ${recent.length ? `<div class="section-title"><h2>Zuletzt gelernt</h2></div>
      <div class="list">${recent.map(s => setRow(s, subjById[s.subjectId]?.name)).join('')}</div>` : ''}
    ${!standalone ? `<div class="section-title"><h2>Als App nutzen</h2></div>
      <button class="card tap qa" data-act="install" style="width:100%"><span class="ico">${icon('phone')}</span><div><b>Auf iPhone oder Mac installieren</b><span>So hast du den Lernomat wie eine echte App.</span></div></button>` : ''}
  </div>`;

  actions = {
    settings: () => go('settings'),
    theme: (_d, btn) => {
      setTheme(applyTheme() ? 'light' : 'dark');
      btn.innerHTML = icon(applyTheme() ? 'sun' : 'moon');
    },
    open: d => go('subject', { id: d.id }),
    openSet: d => go('set', { id: d.id }),
    newSubject: () => subjectDialog(),
    upload: () => uploadChooser(subjects),
    install: installHelp,
  };
}

function setRow(s, sub) {
  const t = TYPES[s.type];
  let info = relDate(s.lastOpened || s.created);
  if (s.type === 'cards') {
    const known = s.data.cards.filter(c => c.box >= 3).length;
    info = `${s.data.cards.length} Karten · ${known} sicher · ${info}`;
  } else if (s.type === 'exam') {
    const best = Math.max(-1, ...(s.attempts || []).map(a => Math.round(a.score / a.max * 100)));
    info = `${s.data.questions.length} Aufgaben${best >= 0 ? ` · bestes Ergebnis ${best} %` : ''} · ${info}`;
  } else if (s.type === 'plan') {
    info = `${s.data.steps.filter(x => x.done).length}/${s.data.steps.length} Schritte · ${info}`;
  }
  return `<button class="row tap" data-act="openSet" data-id="${s.id}">
    <span class="ico ${t.cls}" style="color:#fff">${icon(t.icon)}</span>
    <span class="main"><b>${esc(s.title)}</b><span>${sub ? esc(sub) + ' · ' : ''}${info}</span></span>
  </button>`;
}

function subjectDialog(existing) {
  let emoji = existing?.emoji || EMOJIS[0];
  let color = existing?.color || COLORS[Math.floor(Math.random() * COLORS.length)];
  return new Promise(resolve => {
    let created = null;
    const m = openModal(`<h2>${existing ? 'Fach bearbeiten' : 'Neues Fach'}</h2>
      <form id="subjForm">
        <div class="field"><label for="sName">Titel</label><input class="input" id="sName" required maxlength="60" placeholder="z. B. Biochemie, Mathe 2, Latein" value="${esc(existing?.name || '')}"></div>
        <div class="field"><label>Symbol</label><div class="emoji-pick">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
        <div class="field"><label>Farbe</label><div class="color-pick">${COLORS.map(c => `<button type="button" aria-label="Farbe" data-c="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}</div></div>
        <div class="btn-row"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary" type="submit">${existing ? 'Speichern' : 'Anlegen'}</button></div>
      </form>`, { onClose: () => resolve(created) });
    const el = m.el;
    setTimeout(() => el.querySelector('#sName').focus(), 50);
    el.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => {
      emoji = b.dataset.e; el.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      color = b.dataset.c; el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b));
    }));
    el.querySelector('#subjForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const name = el.querySelector('#sName').value.trim();
      if (!name) return;
      const subj = existing ? { ...existing, name, emoji, color } : { id: uid(), name, emoji, color, created: Date.now() };
      await db.put('subjects', subj);
      created = subj;
      m.close();
      if (!existing && !m.noNavigate) go('subject', { id: subj.id });
    });
  });
}

// Dateien hochladen direkt aus dem Hauptmenü: erst Fach wählen, dann Dateien.
function uploadChooser(subjects) {
  const m = openModal(`<h2>Wohin sollen die Dateien?</h2>
    <p class="muted" style="margin-top:-6px">Wähle das Fach, zu dem die Unterlagen gehören.</p>
    <div class="list">
      ${subjects.map(s => `<button class="row tap" data-s="${s.id}"><span class="ico" style="background:${s.color}22;font-size:20px">${s.emoji}</span><span class="main"><b>${esc(s.name)}</b></span></button>`).join('')}
      <button class="row tap" data-new><span class="ico">${icon('plus')}</span><span class="main"><b>Neues Fach anlegen</b><span>und dann Dateien auswählen</span></span></button>
    </div>
    <div class="btn-row"><button class="btn" data-close>Abbrechen</button></div>`);
  m.el.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    pickFiles(b.dataset.s, () => go('subject', { id: b.dataset.s }));
    m.close();
  }));
  m.el.querySelector('[data-new]').addEventListener('click', async () => {
    m.close();
    const subj = await subjectDialog();
    if (subj) toast('Fach angelegt. Tippe auf „Dateien hinzufügen“.');
  });
}

function pickFiles(subjectId, after) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const list = [...input.files];
    input.remove();
    if (list.length) await handleFiles(list, subjectId);
    after && after();
  });
  input.click();
}

async function handleFiles(list, subjectId) {
  let ok = 0;
  for (const f of list) {
    try {
      const rec = await ingestFile(f, subjectId);
      await db.put('files', rec);
      ok++;
    } catch (err) {
      toast(err.message, 4500);
    }
  }
  if (ok) {
    const subj = await db.get('subjects', subjectId);
    if (subj) await db.put('subjects', { ...subj, topicsKey: null });
    sfx('good');
    toast(ok === 1 ? '1 Datei hinzugefügt' : `${ok} Dateien hinzugefügt`);
  }
  return ok;
}

function installHelp() {
  openModal(`<h2>Der Lernomat als App</h2>
    <div class="stack">
      <div class="card"><b>📱 iPhone / iPad (Safari)</b><ol style="margin:8px 0 0;padding-left:20px">
        <li>Öffne diese Seite in <b>Safari</b>.</li><li>Tippe unten auf <b>Teilen</b> (Quadrat mit Pfeil).</li>
        <li>Wähle <b>„Zum Home-Bildschirm“</b> und tippe auf <b>Hinzufügen</b>.</li></ol></div>
      <div class="card"><b>💻 Mac (Safari)</b><ol style="margin:8px 0 0;padding-left:20px">
        <li>Öffne diese Seite in <b>Safari</b>.</li><li>Menü <b>Ablage → Zum Dock hinzufügen …</b></li>
        <li>Der Lernomat erscheint im Dock und im Launchpad als eigene App.</li></ol></div>
      <p class="muted" style="margin:0;font-size:14px">Deine Fächer und Dateien bleiben nur auf diesem Gerät gespeichert. Mit „Sicherung exportieren“ in den Einstellungen kannst du sie auf ein anderes Gerät übertragen.</p>
    </div>
    <div class="btn-row"><button class="btn primary" data-close>Alles klar</button></div>`);
}

// ===== Fach (Ordner) =====
async function viewSubject({ id }) {
  const subj = await db.get('subjects', id);
  if (!subj) return go('home', {}, { replace: true });
  db.put('subjects', { ...subj, lastOpened: Date.now() });
  const [files, sets] = await Promise.all([db.bySubject('files', id), db.bySubject('sets', id)]);
  files.sort((a, b) => a.added - b.added);
  sets.sort((a, b) => (b.lastOpened || b.created) - (a.lastOpened || a.created));
  setChatContext({ subjectId: id, label: subj.name, detail: () => `im Fach „${subj.name}“` });

  app.innerHTML = `<div class="screen">
    ${topbar({ crumb: 'Hauptmenü', right: `<button class="icon-btn" data-act="menu" aria-label="Fach-Optionen">${icon('more')}</button>` })}
    <section class="hero"><div style="font-size:42px;line-height:1">${subj.emoji}</div><h1 style="margin-top:8px">${esc(subj.name)}</h1>
      <p>${files.length ? `${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} · ${formatSize(totalSize(files))}` : `Lade deine Unterlagen hoch, dann legt ${KI} los.`}</p></section>

    <div class="section-title"><h2>Was soll ${KI} für dich bauen?</h2></div>
    <div class="builders">
      ${Object.entries(TYPES).map(([k, t]) => `<button class="card tap builder" data-act="build" data-type="${k}">
        <span class="ico ${t.cls}">${icon(t.icon)}</span><b>${t.name}</b><span>${t.desc}</span></button>`).join('')}
    </div>

    <div class="section-title"><h2>Unterlagen</h2><button class="btn small" data-act="add">${icon('plus')} Hinzufügen</button></div>
    ${files.length ? `<div class="list">${files.map(f => `<div class="row">
        <span class="ico">${fileBadge(f)}</span>
        <button class="main" data-act="viewFile" data-id="${f.id}" style="text-align:left"><b>${esc(f.name)}</b><span>Ansehen · ${formatSize(f.size)}</span></button>
        <select data-file="${f.id}" aria-label="Art der Datei">${CATEGORIES.map(c => `<option ${c === f.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <button class="icon-btn plain" data-act="delFile" data-id="${f.id}" aria-label="Löschen" style="color:var(--bad)">${icon('trash')}</button>
      </div>`).join('')}</div>` : ''}
    <div class="dropzone" id="drop" data-act="add">${icon('upload')}<div><b>Dateien hierher ziehen</b> oder tippen zum Auswählen</div><small>PDF, Fotos, Word, PowerPoint, Text</small></div>

    <div class="section-title"><h2>Deine Lernsets</h2></div>
    ${sets.length ? `<div class="list">${sets.map(s => setRow(s)).join('')}</div>` : `<div class="empty card"><div class="big">✨</div>Noch nichts erstellt. Wähle oben aus, was ${KI} dir bauen soll.</div>`}
  </div>`;

  const drop = document.getElementById('drop');
  const over = on => e => { e.preventDefault(); drop.classList.toggle('over', on); };
  drop.addEventListener('dragover', over(true));
  drop.addEventListener('dragleave', over(false));
  drop.addEventListener('drop', async e => {
    over(false)(e);
    if (await handleFiles([...e.dataTransfer.files], id)) render(history.state);
  });
  app.querySelectorAll('select[data-file]').forEach(sel => sel.addEventListener('change', async () => {
    const f = await db.get('files', sel.dataset.file);
    await db.put('files', { ...f, category: sel.value });
    toast('Gespeichert');
  }));

  actions = {
    back: () => back(),
    add: () => pickFiles(id, () => render(history.state)),
    build: d => {
      if (!files.length) { toast('Lade zuerst mindestens eine Datei hoch.'); return; }
      go('builder', { subjectId: id, type: d.type });
    },
    openSet: d => go('set', { id: d.id }),
    viewFile: d => go('file', { id: d.id }),
    delFile: async d => {
      const f = files.find(x => x.id === d.id);
      if (await confirmDialog(`„${f.name}“ wird aus diesem Fach entfernt.`, { ok: 'Löschen', danger: true })) {
        await db.del('files', d.id);
        await db.put('subjects', { ...subj, topicsKey: null });
        render(history.state);
      }
    },
    menu: () => {
      const m = openModal(`<h2>${esc(subj.name)}</h2><div class="list">
        <button class="row tap" data-x="edit"><span class="ico">${icon('edit')}</span><span class="main"><b>Titel, Symbol & Farbe ändern</b></span></button>
        <button class="row tap" data-x="del"><span class="ico" style="color:var(--bad)">${icon('trash')}</span><span class="main"><b style="color:var(--bad)">Fach löschen</b><span>inklusive aller Dateien und Lernsets</span></span></button>
      </div><div class="btn-row"><button class="btn" data-close>Schließen</button></div>`);
      m.el.querySelector('[data-x="edit"]').addEventListener('click', async () => {
        m.close();
        if (await subjectDialog(subj)) render(history.state);
      });
      m.el.querySelector('[data-x="del"]').addEventListener('click', async () => {
        m.close();
        if (await confirmDialog(`„${subj.name}“ mit allen Dateien und Lernsets wird endgültig gelöscht.`, { ok: 'Endgültig löschen', danger: true })) {
          await db.deleteSubject(id);
          toast('Fach gelöscht');
          go('home', {}, { replace: true });
        }
      });
    },
  };
}

// ===== Untermenü: Was möchtest du gerade lernen? =====
const OPTIONS = {
  summary: [{ key: 'length', label: 'Umfang', values: [['kompakt', 'Kompakt'], ['ausfuehrlich', 'Ausführlich'], ['spickzettel', 'Spickzettel']] }],
  cards: [
    { key: 'count', label: 'Anzahl Karten', values: [['10', '10'], ['20', '20'], ['30', '30'], ['50', '50']], def: '20' },
    { key: 'style', label: 'Art der Karten', values: [['gemischt', 'Gemischt'], ['begriffe', 'Begriffe & Definitionen'], ['verstaendnis', 'Verständnisfragen']] },
  ],
  exam: [
    { key: 'count', label: 'Anzahl Aufgaben', values: [['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']], def: '10' },
    { key: 'kind', label: 'Aufgabentypen', values: [['gemischt', 'Gemischt'], ['mc', 'Multiple Choice'], ['offen', 'Offene Fragen']] },
    { key: 'difficulty', label: 'Schwierigkeit', values: [['leicht', 'Leicht'], ['mittel', 'Mittel'], ['schwer', 'Schwer (Prüfungsniveau+)']], def: 'mittel' },
  ],
  plan: [{ key: 'perDay', label: 'Zeit pro Tag', values: [['30 Minuten', '30 Min'], ['1 Stunde', '1 Std'], ['2 Stunden', '2 Std'], ['3 Stunden oder mehr', '3 Std+']], def: '1 Stunde' }],
};

async function viewBuilder({ subjectId, type, preset }, alive) {
  const subj = await db.get('subjects', subjectId);
  if (!subj) return go('home', {}, { replace: true });
  const t = TYPES[type];
  const [files, allSets] = await Promise.all([db.bySubject('files', subjectId), db.bySubject('sets', subjectId)]);
  const sets = allSets.filter(s => s.type === type).sort((a, b) => b.created - a.created);
  const fileKey = files.map(f => f.id).sort().join(',');
  const sel = {
    topics: new Set(preset?.topics || []),
    custom: preset?.custom || '',
    files: new Set(files.map(f => f.id)),
    opts: Object.fromEntries((OPTIONS[type] || []).map(o => [o.key, o.def || o.values[0][0]])),
    examDate: '', goal: '',
  };
  let topics = subj.topicsKey === fileKey ? (subj.topics || []) : null;
  let topicsLoading = false;
  setChatContext({ subjectId, label: subj.name, detail: () => `im Fach „${subj.name}“, beim Erstellen: ${t.name}` });

  const draw = () => {
    if (!alive()) return;
    app.innerHTML = `<div class="screen">
      ${topbar({ crumb: `${subj.emoji} ${esc(subj.name)}` })}
      <section class="hero"><span class="ico ${t.cls}" style="width:52px;height:52px;border-radius:15px;display:grid;place-items:center;color:#fff">${icon(t.icon)}</span>
        <h1 style="margin-top:12px">${t.name}</h1><p>Was möchtest du gerade lernen?</p></section>

      <div class="opt-block"><label>Themen</label>
        <div class="chips">
          <button class="chip ${sel.topics.size === 0 ? 'on' : ''}" data-act="allTopics">Alles</button>
          ${topics ? topics.map(tp => `<button class="chip ${sel.topics.has(tp.title) ? 'on' : ''}" data-act="topic" data-t="${esc(tp.title)}" title="${esc(tp.description)}">${esc(tp.title)}</button>`).join('')
            : topicsLoading ? `<span class="chip dashed">${CLOUD_AI ? 'KI erkennt' : 'Nomi sucht'} Themen …</span>` : ''}
          ${aiReady() && !topicsLoading ? `<button class="chip dashed" data-act="detect">${topics ? '↻ Themen neu erkennen' : '✨ Themen erkennen'}</button>` : ''}
        </div>
        <input class="input mt" id="custom" placeholder="Oder eigenes Thema, z. B. „Kapitel 3“ oder „Zellatmung“" value="${esc(sel.custom)}" style="margin-top:12px">
      </div>

      ${(OPTIONS[type] || []).map(o => `<div class="opt-block"><label>${o.label}</label><div class="seg">
        ${o.values.map(([v, l]) => `<button data-act="opt" data-k="${o.key}" data-v="${v}" class="${sel.opts[o.key] === v ? 'on' : ''}">${l}</button>`).join('')}
      </div></div>`).join('')}
      ${type === 'plan' ? `<div class="opt-block"><label for="examDate">Prüfungsdatum (optional)</label><input type="date" class="input" id="examDate" value="${sel.examDate}"></div>
        <div class="opt-block"><label for="goal">Dein Ziel (optional)</label><input class="input" id="goal" placeholder="z. B. Note 2 oder besser, Fokus auf Rechenaufgaben" value="${esc(sel.goal)}"></div>` : ''}

      <div class="opt-block"><label>Unterlagen</label><div class="list">
        ${files.map(f => `<label class="row check-row"><input type="checkbox" data-f="${f.id}" ${sel.files.has(f.id) ? 'checked' : ''}><span class="main"><b>${esc(f.name)}</b><span>${f.category} · ${formatSize(f.size)}</span></span></label>`).join('')}
      </div></div>

      <button class="btn primary block" data-act="create" style="min-height:54px;font-size:17px">${icon('sparkle')} ${t.name} erstellen</button>
      ${!aiReady() ? `<p class="muted center" style="font-size:14px">Dafür brauchst du zuerst einen API-Schlüssel in den <a href="#" data-act="settings">Einstellungen</a>.</p>` : ''}

      ${sets.length ? `<div class="section-title"><h2>Bereits erstellt</h2></div><div class="list">${sets.map(s => setRow(s)).join('')}</div>` : ''}
    </div>`;
    app.querySelector('#custom').addEventListener('input', e => { sel.custom = e.target.value; });
    app.querySelector('#examDate')?.addEventListener('input', e => { sel.examDate = e.target.value; });
    app.querySelector('#goal')?.addEventListener('input', e => { sel.goal = e.target.value; });
    app.querySelectorAll('[data-f]').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? sel.files.add(cb.dataset.f) : sel.files.delete(cb.dataset.f);
    }));
  };

  const detect = async () => {
    topicsLoading = true; draw();
    try {
      const res = CLOUD_AI ? await AI.generateJSON({ fileBlocks: await filesToBlocks(files), prompt: PR.topicsPrompt(), schema: AI.SCHEMAS.topics, maxTokens: 6000, effort: 'low' })
        : await Nomi.topics(files);
      topics = res.topics;
      const fresh = await db.get('subjects', subjectId);
      await db.put('subjects', { ...fresh, topics, topicsKey: fileKey });
    } catch (err) {
      toast(err.message, 4500);
    }
    topicsLoading = false; draw();
  };

  actions = {
    back: () => back(),
    settings: () => go('settings'),
    allTopics: () => { sel.topics.clear(); draw(); },
    topic: d => { sel.topics.has(d.t) ? sel.topics.delete(d.t) : sel.topics.add(d.t); draw(); },
    detect,
    opt: d => { sel.opts[d.k] = d.v; draw(); },
    openSet: d => go('set', { id: d.id }),
    create: async () => {
      if (!aiReady()) { go('settings'); return; }
      const chosen = files.filter(f => sel.files.has(f.id));
      if (!chosen.length) { toast('Wähle mindestens eine Datei aus.'); return; }
      if (CLOUD_AI && totalSize(chosen) > 24 * 1024 * 1024) { toast('Zusammen über 24 MB: bitte weniger Dateien auswählen.', 4000); return; }
      const focus = [...sel.topics, sel.custom.trim()].filter(Boolean);
      await runGeneration({ subj, type, alive, focus, opts: { ...sel.opts, examDate: sel.examDate, goal: sel.goal }, files: chosen, onFail: draw });
    },
  };
  draw();
  if (!topics && aiReady() && files.length) detect();
}

const WAIT_LINES = {
  summary: ['Lese deine Unterlagen …', 'Sortiere die wichtigsten Punkte …', 'Formuliere verständlich …'],
  cards: ['Lese deine Unterlagen …', 'Suche die wichtigsten Begriffe …', 'Schreibe Vorder- und Rückseiten …', 'Mische den Stapel …'],
  exam: ['Lese deine Unterlagen …', 'Schaue mir Prüfungsstil und Niveau an …', 'Formuliere Aufgaben …', 'Schreibe Musterlösungen …'],
  plan: ['Lese deine Unterlagen …', 'Schätze den Umfang ab …', 'Plane deine Lernschritte …'],
};

// Lässt die KI das gewünschte Lernset bauen und öffnet es danach.
// files: die gewählten Dateien; extra: zusätzliche Texte (z. B. eine Zusammenfassung oder die eigenen Fehler).
async function runGeneration({ subj, type, alive, focus, opts, files = [], extra = [], onFail }) {
  const t = TYPES[type];
  app.innerHTML = `<div class="screen">${topbar({ crumb: `${subj.emoji} ${esc(subj.name)}` })}
    <div class="thinking"><div class="orb"></div><b>${t.name} wird erstellt</b><p id="waitLine">${WAIT_LINES[type][0]}</p></div>
    <div id="live"></div></div>`;
  let busy = true;
  actions.back = async () => {
    if (!busy || await confirmDialog((CLOUD_AI ? 'Die KI' : 'Nomi') + ' arbeitet noch. Wenn du zurückgehst, wird das Ergebnis trotzdem gespeichert.', { ok: 'Zurück', title: 'Zurückgehen?' })) back();
  };
  let li = 0;
  const timer = setInterval(() => {
    const el = document.getElementById('waitLine');
    if (el) el.textContent = WAIT_LINES[type][++li % WAIT_LINES[type].length];
  }, 3500);
  cleanups.push(() => clearInterval(timer));
  try {
    let set;
    const base = { id: uid(), subjectId: subj.id, type, created: Date.now(), focus };
    if (!CLOUD_AI) {
      // Nomi baut das Lernset direkt auf dem Gerät. Kurz warten, damit die Animation sichtbar wird.
      const pseudo = extra.map((x, i) => ({ id: 'extra-' + i, name: x.title, kind: 'text', text: x.text, category: 'Zusammenfassung', size: x.text.length, added: 0 }));
      const src = [...files, ...pseudo];
      await new Promise(r => setTimeout(r, 600));
      if (type === 'summary') {
        const md = await Nomi.summary(src, { focus, length: opts.length, name: subj.name });
        set = { ...base, title: ((/^#\s+(.+)$/m.exec(md) || [])[1] || `Zusammenfassung ${subj.name}`).replace(/\*\*/g, ''), data: { markdown: md } };
      } else if (type === 'cards') {
        const res = await Nomi.cards(extra.length && !files.length ? pseudo : src, { focus: extra.length ? [] : focus, count: opts.count, style: opts.style, name: subj.name });
        set = { ...base, title: res.title, data: { cards: res.cards.map(c => ({ ...c, id: uid(), box: 0, seen: 0 })) } };
      } else if (type === 'exam') {
        const res = await Nomi.exam(src, { focus, count: opts.count, kind: opts.kind, difficulty: opts.difficulty, name: subj.name });
        set = { ...base, title: res.title, data: { duration: res.duration_minutes, questions: res.questions }, attempts: [] };
      } else {
        const res = await Nomi.plan(src, { focus, examDate: opts.examDate, perDay: opts.perDay, goal: opts.goal, name: subj.name });
        set = { ...base, title: res.title, data: { overview: res.overview, steps: res.steps.map(s => ({ ...s, done: false })) } };
      }
    } else {
    const fileBlocks = [...await filesToBlocks(files, { focus }), ...extra.map(x => ({ type: 'document', title: x.title, source: { type: 'text', media_type: 'text/plain', data: x.text } }))];
    if (type === 'summary') {
      let last = 0;
      const md = await AI.generateText({
        fileBlocks, prompt: PR.summaryPrompt({ focus, length: opts.length }), effort: 'medium',
        onText: snap => {
          if (!alive() || Date.now() - last < 250) return;
          last = Date.now();
          const live = document.getElementById('live');
          if (live) live.innerHTML = `<article class="reader">${renderMarkdown(snap).html}</article>`;
        },
      });
      const title = (/^#\s+(.+)$/m.exec(md) || [])[1] || `Zusammenfassung ${subj.name}`;
      set = { ...base, title: title.replace(/\*\*/g, ''), data: { markdown: md } };
    } else if (type === 'cards') {
      const res = await AI.generateJSON({ fileBlocks, prompt: PR.cardsPrompt({ focus, count: opts.count, style: opts.style }), schema: AI.SCHEMAS.cards, maxTokens: 24000 });
      set = { ...base, title: res.title || `Karteikarten ${subj.name}`, data: { cards: res.cards.map(c => ({ ...c, id: uid(), box: 0, seen: 0 })) } };
    } else if (type === 'exam') {
      const res = await AI.generateJSON({ fileBlocks, prompt: PR.examPrompt({ focus, count: opts.count, kind: opts.kind, difficulty: opts.difficulty }), schema: AI.SCHEMAS.exam, maxTokens: 32000 });
      const questions = res.questions.map(q => q.type === 'mc' && (q.options.length < 2 || q.correct_index < 0 || q.correct_index >= q.options.length) ? { ...q, type: 'open', options: [], correct_index: -1 } : q);
      set = { ...base, title: res.title || `Übungsklausur ${subj.name}`, data: { duration: res.duration_minutes || questions.length * 4, questions }, attempts: [] };
    } else {
      const res = await AI.generateJSON({ fileBlocks, prompt: PR.planPrompt({ focus, examDate: opts.examDate, perDay: opts.perDay, goal: opts.goal }), schema: AI.SCHEMAS.plan, maxTokens: 12000 });
      set = { ...base, title: res.title || `Lernplan ${subj.name}`, data: { overview: res.overview, steps: res.steps.map(s => ({ ...s, done: false })) } };
    }
    }
    await db.put('sets', set);
    busy = false;
    sfx('done');
    if (alive()) go('set', { id: set.id }, { replace: true });
    else toast(`Fertig: ${set.title}`);
  } catch (err) {
    busy = false;
    clearInterval(timer);
    if (!alive()) { toast(err.message, 5000); return; }
    app.querySelector('.thinking').innerHTML = `<div class="big" style="font-size:44px">😕</div><b>Das hat nicht geklappt</b><p>${esc(err.message)}</p>
      <div class="btn-row" style="justify-content:center"><button class="btn" data-act="retryBack">Zurück</button>${err.code === 'nokey' || err.code === 'auth' ? '<button class="btn primary" data-act="settings">Einstellungen</button>' : ''}</div>`;
    actions.retryBack = () => onFail ? onFail() : back();
    actions.settings = () => go('settings');
  }
}

// ===== Lernsets =====
async function viewSet({ id }, alive) {
  const set = await db.get('sets', id);
  if (!set) return go('home', {}, { replace: true });
  const subj = await db.get('subjects', set.subjectId);
  set.lastOpened = Date.now();
  db.put('sets', set);
  const views = { summary: viewSummary, cards: viewCards, exam: viewExam, plan: viewPlan };
  await views[set.type](set, subj, alive);
}

const setTopbar = (set, subj) => topbar({
  crumb: `${subj?.emoji || ''} ${esc(subj?.name || '')}`,
  right: `<button class="icon-btn" data-act="setMenu" aria-label="Optionen">${icon('more')}</button>`,
});

function setMenu(set, extra = []) {
  const m = openModal(`<h2>${esc(set.title)}</h2><div class="list">
    ${extra.map((x, i) => `<button class="row tap" data-i="${i}"><span class="ico">${icon(x.icon)}</span><span class="main"><b>${x.label}</b></span></button>`).join('')}
    <button class="row tap" data-x="rename"><span class="ico">${icon('edit')}</span><span class="main"><b>Umbenennen</b></span></button>
    <button class="row tap" data-x="del"><span class="ico" style="color:var(--bad)">${icon('trash')}</span><span class="main"><b style="color:var(--bad)">Löschen</b></span></button>
  </div><div class="btn-row"><button class="btn" data-close>Schließen</button></div>`);
  m.el.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { m.close(); extra[b.dataset.i].run(); }));
  m.el.querySelector('[data-x="rename"]').addEventListener('click', () => {
    m.close();
    const r = openModal(`<h2>Umbenennen</h2><form><input class="input" id="rn" value="${esc(set.title)}" maxlength="100">
      <div class="btn-row"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`);
    r.el.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      set.title = r.el.querySelector('#rn').value.trim() || set.title;
      await db.put('sets', set);
      r.close();
      render(history.state);
    });
  });
  m.el.querySelector('[data-x="del"]').addEventListener('click', async () => {
    m.close();
    if (await confirmDialog(`„${set.title}“ wird gelöscht.`, { ok: 'Löschen', danger: true })) {
      await db.del('sets', set.id);
      back({ view: 'subject', params: { id: set.subjectId } });
    }
  });
}

// --- Zusammenfassung ---
function viewSummary(set, subj, alive) {
  const { html, headings } = renderMarkdown(set.data.markdown);
  setChatContext({ subjectId: set.subjectId, label: subj?.name, detail: () => `beim Lesen der Zusammenfassung „${set.title}“` });
  app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
    ${headings.length > 1 ? `<nav class="toc">${headings.map(h => `<button class="chip" data-act="jump" data-id="${h.id}">${esc(h.text)}</button>`).join('')}</nav>` : ''}
    <article class="reader">${html}</article>
    <div class="btn-row mt" style="justify-content:center">
      <button class="btn" data-act="toCards">${icon('cards')} Karteikarten daraus machen</button>
      <button class="btn" data-act="share">${icon('share')} Teilen</button>
    </div></div>`;
  actions = {
    back: () => back({ view: 'subject', params: { id: set.subjectId } }),
    jump: d => document.getElementById(d.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    setMenu: () => setMenu(set),
    share: async () => {
      if (navigator.share) { try { await navigator.share({ title: set.title, text: set.data.markdown }); } catch { /* abgebrochen */ } } else {
        await navigator.clipboard.writeText(set.data.markdown);
        toast('In die Zwischenablage kopiert');
      }
    },
    toCards: () => {
      if (!aiReady()) return go('settings');
      runGeneration({ subj, type: 'cards', alive, focus: set.focus || [], opts: { count: '20', style: 'gemischt' }, extra: [{ title: set.title, text: set.data.markdown.replace(/[*>|]/g, ' ') }] });
    },
  };
}

// --- Karteikarten ---
function viewCards(set, subj, alive, mode = 'all') {
  const cards = set.data.cards;
  const pool = mode === 'weak' ? cards.filter(c => c.box < 3) : cards;
  // Unsichere Karten zuerst, innerhalb gleicher Stufe gemischt.
  let queue = [0, 1, 2, 3, 4].flatMap(b => shuffle(pool.filter(c => c.box === b)));
  let flipped = false;
  let doneCount = 0;
  const startLen = queue.length;
  setChatContext({
    subjectId: set.subjectId, label: subj?.name,
    detail: () => queue[0] ? `bei der Karteikarte „${queue[0].front}“ (Rückseite: „${queue[0].back}“)` : `beim Kartenstapel „${set.title}“`,
  });

  const save = () => db.put('sets', set);
  const draw = () => {
    if (!alive()) return;
    const known = cards.filter(c => c.box >= 3).length;
    const c = queue[0];
    if (!c) {
      sfx('done');
      app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
        <div class="thinking"><div style="font-size:56px">🎉</div><b>Runde geschafft!</b>
        <p>${known} von ${cards.length} Karten sitzen schon sicher.</p>
        <div class="btn-row" style="justify-content:center">
          ${known < cards.length ? '<button class="btn primary" data-act="weak">Nur unsichere üben</button>' : ''}
          <button class="btn" data-act="all">Alle nochmal</button></div></div></div>`;
      return;
    }
    app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
      <div class="fc-wrap">
        <div class="fc-stats"><div class="progress"><i style="width:${startLen ? doneCount / startLen * 100 : 0}%"></i></div><span>${doneCount}/${startLen}</span></div>
        <div class="flashcard ${flipped ? 'flipped' : ''}" id="fc" role="button" tabindex="0" aria-label="Karte umdrehen">
          <div class="inner">
            <div class="face front"><div class="label">Frage</div><div class="content">${esc(c.front)}</div>
              <div class="sets-row"><span class="topic">${esc(c.topic || '')}</span><span class="spacer" style="flex:1"></span><span class="boxes">${[1, 2, 3, 4].map(b => `<i class="${c.box >= b ? 'on' : ''}"></i>`).join('')}</span></div></div>
            <div class="face back"><div class="label">Antwort</div><div class="content"><div>${renderMarkdown(c.back).html}</div></div></div>
          </div>
        </div>
        <div class="fc-actions" id="fcAnswer" ${flipped ? '' : 'hidden'}><button class="btn again" data-act="again">Nochmal</button><button class="btn know" data-act="know">Gewusst ${icon('check')}</button></div>
        <button class="btn primary" id="fcShow" data-act="flip" style="width:100%;max-width:560px;min-height:56px" ${flipped ? 'hidden' : ''}>Antwort zeigen</button>
        <div class="fc-hint">Tippen zum Umdrehen · Wischen nach rechts = gewusst, nach links = nochmal</div>
        <div class="muted" style="font-size:14px">${known} von ${cards.length} Karten sicher</div>
      </div></div>`;
    const fc = document.getElementById('fc');
    fc.addEventListener('click', () => flip());
    let x0 = null;
    fc.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    fc.addEventListener('touchend', e => {
      if (x0 === null || !flipped) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 70) answer(dx > 0);
    });
  };
  const flip = () => {
    flipped = !flipped;
    sfx('flip');
    document.getElementById('fc')?.classList.toggle('flipped', flipped);
    const ans = document.getElementById('fcAnswer');
    const show = document.getElementById('fcShow');
    if (ans) ans.hidden = !flipped;
    if (show) show.hidden = flipped;
  };
  const answer = good => {
    const c = queue.shift();
    if (!c) return;
    c.seen = (c.seen || 0) + 1;
    if (good) { c.box = Math.min(4, c.box + 1); doneCount++; sfx('good'); } else {
      c.box = 0; sfx('bad');
      queue.splice(Math.min(3, queue.length), 0, c);
    }
    save();
    const fc = document.getElementById('fc');
    flipped = false;
    if (fc) { fc.classList.add(good ? 'swipe-right' : 'swipe-left'); setTimeout(draw, 260); } else draw();
  };
  const onKey = e => {
    if (document.querySelector('.modal-bg') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    if (flipped && e.key === 'ArrowRight') answer(true);
    if (flipped && e.key === 'ArrowLeft') answer(false);
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  actions = {
    back: () => back({ view: 'subject', params: { id: set.subjectId } }),
    flip, know: () => answer(true), again: () => answer(false),
    weak: () => { cleanups.forEach(f => f()); cleanups = []; viewCards(set, subj, alive, 'weak'); },
    all: () => { cleanups.forEach(f => f()); cleanups = []; viewCards(set, subj, alive, 'all'); },
    setMenu: () => setMenu(set, [
      { icon: 'shuffle', label: 'Nur unsichere Karten üben', run: () => actions.weak() },
      { icon: 'refresh', label: 'Lernfortschritt zurücksetzen', run: async () => { cards.forEach(c => { c.box = 0; }); await save(); actions.all(); } },
      { icon: 'summary', label: 'Alle Karten als Liste ansehen', run: () => cardList(set) },
    ]),
  };
  draw();
}

function cardList(set) {
  openModal(`<h2>${esc(set.title)}</h2><div class="list">${set.data.cards.map(c => `<div class="row" style="align-items:flex-start"><span class="main" style="white-space:normal"><b style="white-space:normal">${esc(c.front)}</b><span style="white-space:normal">${esc(c.back)}</span></span><span class="boxes">${[1, 2, 3, 4].map(b => `<i class="${c.box >= b ? 'on' : ''}"></i>`).join('')}</span></div>`).join('')}</div>
    <div class="btn-row"><button class="btn primary" data-close>Schließen</button></div>`, { wide: true });
}

// --- Übungsklausur ---
function noteFor(pct) {
  const steps = [[95, '1,0'], [90, '1,3'], [85, '1,7'], [80, '2,0'], [75, '2,3'], [70, '2,7'], [65, '3,0'], [60, '3,3'], [55, '3,7'], [50, '4,0']];
  return (steps.find(([p]) => pct >= p) || [0, '5,0'])[1];
}

function viewExam(set, subj, alive) {
  const qs = set.data.questions;
  const maxPts = qs.reduce((s, q) => s + (q.points || 1), 0);
  const attempts = set.attempts || [];
  const best = attempts.length ? Math.max(...attempts.map(a => Math.round(a.score / a.max * 100))) : null;
  setChatContext({ subjectId: set.subjectId, label: subj?.name, detail: () => `bei der Übungsklausur „${set.title}“` });
  actions = { back: () => back({ view: 'subject', params: { id: set.subjectId } }), setMenu: () => setMenu(set) };
  let timed = true;
  app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
    <section class="hero"><span class="ico c-exam" style="width:52px;height:52px;border-radius:15px;display:grid;place-items:center;color:#fff">${icon('exam')}</span>
      <h1 style="margin-top:12px">${esc(set.title)}</h1>
      <p>${qs.length} Aufgaben · ${maxPts} Punkte · ca. ${set.data.duration} Minuten</p></section>
    ${best !== null ? `<div class="card" style="margin-bottom:14px"><b>Bisher:</b> ${attempts.length} ${attempts.length === 1 ? 'Versuch' : 'Versuche'}, bestes Ergebnis ${best} % (Note ${noteFor(best)})</div>` : ''}
    <div class="card"><label class="check-row"><input type="checkbox" id="timed" checked><span><b>Mit Zeitlimit</b><br><span class="muted" style="font-size:14px">Wie in der echten Prüfung: ${set.data.duration} Minuten</span></span></label></div>
    <button class="btn primary block mt" data-act="start" style="min-height:54px;font-size:17px">${icon('play')} Klausur starten</button>
    ${attempts.length ? `<button class="btn block mt" data-act="last">Letzte Auswertung ansehen</button>` : ''}
  </div>`;
  app.querySelector('#timed').addEventListener('change', e => { timed = e.target.checked; });
  actions.start = () => runExam(set, subj, alive, timed);
  actions.last = () => examResult(set, subj, alive, attempts[attempts.length - 1]);
}

function runExam(set, subj, alive, timed) {
  const qs = set.data.questions;
  const answers = qs.map(() => null);
  const start = Date.now();
  const limit = set.data.duration * 60;
  setChatContext({
    subjectId: set.subjectId, label: subj?.name,
    detail: () => `beim Schreiben der Übungsklausur „${set.title}“. Wichtig: Verrate keine Lösungen der Klausur, gib höchstens Denkanstöße.`,
  });
  app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
    <div class="exam-head"><h2 style="flex:1">${esc(set.title)}</h2><span class="timer" id="timer">${icon('clock')}</span></div>
    ${qs.map((q, i) => `<div class="card q" id="q${i}">
      <div class="qnum"><span>Aufgabe ${i + 1}${q.topic ? ' · ' + esc(q.topic) : ''}</span><span>${q.points} P.</span></div>
      <div class="qtext">${esc(q.question)}</div>
      ${q.type === 'mc' ? q.options.map((o, j) => `<button class="opt" data-act="pick" data-q="${i}" data-o="${j}"><span class="dot"></span><span>${esc(o)}</span></button>`).join('')
        : `<textarea class="input" data-open="${i}" placeholder="Deine Antwort …"></textarea>`}
    </div>`).join('')}
    <button class="btn primary block" data-act="submit" style="min-height:54px;font-size:17px">Abgeben</button>
  </div>`;
  const timerEl = document.getElementById('timer');
  const tick = () => {
    const el = Math.floor((Date.now() - start) / 1000);
    const s = timed ? Math.max(0, limit - el) : el;
    timerEl.innerHTML = `${icon('clock')} ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    timerEl.style.color = timed && s < 300 ? 'var(--bad)' : '';
    if (timed && s === 0) { clearInterval(iv); toast('Die Zeit ist um!'); submit(true); }
  };
  timerEl.style.display = 'inline-flex'; timerEl.style.gap = '6px'; timerEl.style.alignItems = 'center';
  const iv = setInterval(tick, 1000);
  tick();
  cleanups.push(() => clearInterval(iv));
  app.querySelectorAll('[data-open]').forEach(ta => ta.addEventListener('input', () => { answers[ta.dataset.open] = ta.value; }));

  const submit = async force => {
    const missing = answers.filter(a => a === null || a === '').length;
    if (!force && missing && !await confirmDialog(`${missing} ${missing === 1 ? 'Aufgabe ist' : 'Aufgaben sind'} noch offen. Trotzdem abgeben?`, { ok: 'Abgeben', title: 'Abgeben?' })) return;
    clearInterval(iv);
    const seconds = Math.floor((Date.now() - start) / 1000);
    const results = qs.map((q, i) => q.type === 'mc'
      ? { points: answers[i] === q.correct_index ? q.points : 0, answer: answers[i] }
      : { points: 0, answer: answers[i] || '', feedback: '' });
    const open = qs.map((q, i) => ({ ...q, index: i, answer: answers[i] })).filter(q => q.type === 'open');
    let overall = '';
    if (open.length) {
      app.innerHTML = `<div class="screen">${setTopbar(set, subj)}<div class="thinking"><div class="orb"></div><b>Deine Antworten werden korrigiert</b><p>${CLOUD_AI ? 'Die KI' : 'Nomi'} vergleicht deine Antworten mit der Musterlösung …</p></div></div>`;
      try {
        const g = CLOUD_AI ? await AI.generateJSON({ prompt: PR.gradingPrompt(open), schema: AI.SCHEMAS.grading, maxTokens: 8000, effort: 'low' })
          : (await new Promise(r => setTimeout(r, 700)), Nomi.grade(open));
        for (const r of g.results) {
          if (results[r.index] && qs[r.index].type === 'open') {
            results[r.index].points = Math.max(0, Math.min(qs[r.index].points, r.points_awarded));
            results[r.index].feedback = r.feedback;
          }
        }
        overall = g.overall_feedback;
      } catch (err) {
        overall = 'Die offenen Fragen konnten nicht automatisch korrigiert werden (' + err.message + '). Vergleiche deine Antworten mit der Musterlösung.';
        results.forEach((r, i) => { if (qs[i].type === 'open') r.selfGrade = true; });
      }
    }
    const score = results.reduce((s, r) => s + r.points, 0);
    const max = qs.reduce((s, q) => s + q.points, 0);
    const attempt = { date: Date.now(), seconds, results, score, max, overall };
    set.attempts = [...(set.attempts || []), attempt];
    await db.put('sets', set);
    if (alive()) examResult(set, subj, alive, attempt);
  };

  actions = {
    back: async () => { if (await confirmDialog('Dein Fortschritt in dieser Klausur geht verloren.', { ok: 'Abbrechen', danger: true, title: 'Klausur abbrechen?' })) back({ view: 'subject', params: { id: set.subjectId } }); },
    setMenu: () => setMenu(set),
    pick: (d) => {
      const i = Number(d.q);
      answers[i] = Number(d.o);
      app.querySelectorAll(`[data-q="${i}"]`).forEach(b => b.classList.toggle('sel', b.dataset.o === d.o));
      sfx('tap');
    },
    submit: () => submit(false),
  };
}

function examResult(set, subj, alive, attempt) {
  const qs = set.data.questions;
  const pct = Math.round(attempt.score / attempt.max * 100);
  const weak = [...new Set(qs.filter((q, i) => attempt.results[i].points < q.points).map(q => q.topic).filter(Boolean))];
  setChatContext({
    subjectId: set.subjectId, label: subj?.name,
    detail: () => `bei der Auswertung der Übungsklausur „${set.title}“ (${pct} %). Schwache Themen: ${weak.join(', ') || 'keine'}.`,
  });
  if (pct >= 50) sfx('done');
  const R = 64, C = 2 * Math.PI * R;
  app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
    <div class="card result-head">
      <div class="score-ring"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" stroke="var(--surface-2)" stroke-width="12" fill="none"/>
        <circle cx="75" cy="75" r="${R}" stroke="${pct >= 50 ? 'var(--good)' : 'var(--bad)'}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" style="transition:stroke-dashoffset 1s ease"/></svg>
        <div class="num">${pct} %</div></div>
      <h2>${pct >= 85 ? 'Hervorragend! 🌟' : pct >= 65 ? 'Gut gemacht! 💪' : pct >= 50 ? 'Bestanden! 👍' : 'Da geht noch was! 📚'}</h2>
      <p>${attempt.score} von ${attempt.max} Punkten · ${Math.round(attempt.seconds / 60)} Minuten</p>
      <span class="grade">Note ungefähr ${noteFor(pct)}</span>
      ${attempt.overall ? `<div class="feedback" style="text-align:left;margin-top:16px">${esc(attempt.overall)}</div>` : ''}
    </div>
    <div class="btn-row mt" style="justify-content:center">
      ${weak.length ? `<button class="btn primary" data-act="weakCards">${icon('cards')} Karteikarten zu meinen Fehlern</button>` : ''}
      <button class="btn" data-act="retry">${icon('refresh')} Nochmal schreiben</button>
    </div>
    <div class="section-title"><h2>Auswertung</h2></div>
    ${qs.map((q, i) => {
      const r = attempt.results[i];
      const full = r.points >= q.points;
      return `<div class="card q">
        <div class="qnum"><span>Aufgabe ${i + 1}${q.topic ? ' · ' + esc(q.topic) : ''}</span><span style="color:${full ? 'var(--good)' : r.points ? 'var(--warn)' : 'var(--bad)'}">${r.selfGrade ? '?' : r.points}/${q.points} P.</span></div>
        <div class="qtext">${esc(q.question)}</div>
        ${q.type === 'mc' ? q.options.map((o, j) => `<div class="opt ${j === q.correct_index ? 'right' : j === r.answer ? 'wrong' : ''}"><span class="dot">${j === q.correct_index ? '✓' : j === r.answer ? '✗' : ''}</span><span>${esc(o)}</span></div>`).join('')
          : `<div class="feedback"><b>Deine Antwort:</b>\n${esc(r.answer || '(keine Antwort)')}</div>
             ${r.feedback ? `<div class="feedback ${full ? 'good' : 'bad'}"><b>Feedback:</b> ${esc(r.feedback)}</div>` : ''}
             <div class="feedback good"><b>Musterlösung:</b>\n${esc(q.model_answer)}</div>`}
        ${q.explanation ? `<div class="feedback"><b>Erklärung:</b> ${esc(q.explanation)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
  actions = {
    back: () => back({ view: 'subject', params: { id: set.subjectId } }),
    setMenu: () => setMenu(set),
    retry: () => viewExam(set, subj, alive),
    weakCards: async () => {
      if (!aiReady()) return go('settings');
      const files = await db.bySubject('files', set.subjectId);
      const mistakes = qs.map((q, i) => ({ q, r: attempt.results[i] })).filter(x => x.r.points < x.q.points)
        .map(x => `- ${x.q.question}\n  Musterlösung: ${x.q.model_answer}`).join('\n');
      // Für Nomi: die Musterlösungen als Lernstoff, daraus werden die Karten.
      const mistakesText = qs.map((q, i) => ({ q, r: attempt.results[i] })).filter(x => x.r.points < x.q.points).map(x => x.q.model_answer).join('\n\n');
      runGeneration({ subj, type: 'cards', alive, focus: weak, opts: { count: '20', style: 'gemischt' }, files: CLOUD_AI ? files : [], extra: [{ title: 'Meine Fehler in der Übungsklausur', text: CLOUD_AI ? mistakes : mistakesText }] });
    },
  };
}

// --- Lernplan ---
function viewPlan(set, subj) {
  const steps = set.data.steps;
  const done = steps.filter(s => s.done).length;
  setChatContext({ subjectId: set.subjectId, label: subj?.name, detail: () => `beim Lernplan „${set.title}“` });
  const actName = { summary: 'Zusammenfassung', cards: 'Karteikarten', exam: 'Übungsklausur', review: 'Wiederholen' };
  app.innerHTML = `<div class="screen">${setTopbar(set, subj)}
    <section class="hero"><h1>${esc(set.title)}</h1><p>${esc(set.data.overview)}</p></section>
    <div class="fc-stats" style="max-width:none;margin-bottom:16px"><div class="progress"><i style="width:${done / steps.length * 100}%"></i></div><span>${done}/${steps.length}</span></div>
    <div class="stack">${steps.map((s, i) => `<div class="card plan-step ${s.done ? 'done' : ''}">
      <button class="num" data-act="toggle" data-i="${i}" aria-label="Erledigt">${s.done ? '✓' : i + 1}</button>
      <div class="main"><b>${esc(s.title)}</b><p>${esc(s.description)}</p>
        <span class="tag">${esc(s.day)}</span><span class="tag">${s.minutes} Min</span><span class="tag">${actName[s.activity] || ''}</span>
        ${!s.done && s.activity !== 'review' ? `<div style="margin-top:10px"><button class="btn small" data-act="do" data-i="${i}">${icon(TYPES[s.activity]?.icon || 'play')} Los geht's</button></div>` : ''}
      </div></div>`).join('')}</div>
  </div>`;
  actions = {
    back: () => back({ view: 'subject', params: { id: set.subjectId } }),
    setMenu: () => setMenu(set),
    toggle: async d => {
      steps[d.i].done = !steps[d.i].done;
      if (steps[d.i].done) sfx('good');
      await db.put('sets', set);
      viewPlan(set, subj);
    },
    do: d => {
      const s = steps[d.i];
      go('builder', { subjectId: set.subjectId, type: s.activity, preset: { custom: s.topic } });
    },
  };
}

// ===== Skript ansehen =====
let fileCtl = null;
let fileCtlId = null;

// Öffnet eine Datei an einer bestimmten Stelle (z. B. aus einem Zitat der KI).
function openFile(params) {
  if (history.state?.view === 'file' && fileCtlId === params.id && fileCtl) {
    fileCtl.jump(params);
  } else {
    go('file', params);
  }
}

async function viewFile({ id, page, q, char }, alive) {
  const f = await db.get('files', id);
  if (!f) return go('home', {}, { replace: true });
  const subj = await db.get('subjects', f.subjectId);
  let pageInfo = '';
  let curPage = null;
  app.innerHTML = `<div class="screen viewer-screen">
    ${topbar({ crumb: `${subj?.emoji || ''} ${esc(subj?.name || '')}`, right: `<button class="icon-btn" data-act="download" aria-label="Datei öffnen">${icon('share')}</button>` })}
    <div class="viewer-head"><h2>${esc(f.name)}</h2><span class="muted" id="pageInfo"></span></div>
    ${f.kind !== 'image' ? `<form class="viewer-search" id="vSearch"><input class="input" id="vTerm" type="search" placeholder="Im Skript suchen …" enterkeyhint="search"><button class="btn small" type="submit">Suchen</button></form>` : ''}
    <div id="hitInfo" class="notice" hidden></div>
    <div id="doc" class="doc-area"><div class="thinking"><div class="orb"></div><p>Skript wird geladen …</p></div></div>
  </div>`;
  const docEl = document.getElementById('doc');
  const info = document.getElementById('pageInfo');
  const hitInfo = document.getElementById('hitInfo');
  const showHit = (ok, q2) => {
    if (!q2) { hitInfo.hidden = true; return; }
    hitInfo.hidden = false;
    hitInfo.innerHTML = ok ? `${icon('sparkle')}<div>Gefunden: <i>„${esc(q2.length > 140 ? q2.slice(0, 140) + '…' : q2)}“</i></div>`
      : `${icon('info')}<div>Die genaue Stelle konnte nicht markiert werden${page ? `, sie steht auf Seite ${page}` : ''}.</div>`;
  };
  setChatContext({
    subjectId: f.subjectId, label: subj?.name,
    detail: () => `beim Lesen der Datei „${f.name}“${pageInfo ? `, gerade auf ${pageInfo}` : ''}`,
    suggestions: ['Wo im Skript finde ich …', 'Erklär mir die Seite, die ich gerade lese.', 'Was ist in diesem Skript am wichtigsten?', 'Fass dieses Kapitel kurz zusammen.'],
    nomiSuggestions: ['Fass die Seite zusammen, die ich gerade lese.', 'Was ist …', 'Wo steht etwas zu …', 'Was ist besonders wichtig?', 'Frag mich ab!'],
    here: () => ({ fileId: f.id, page: curPage }),
  });
  actions = {
    back: () => back({ view: 'subject', params: { id: f.subjectId } }),
    download: () => {
      const url = URL.createObjectURL(f.blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };
  let ctl;
  try {
    if (f.kind === 'pdf') {
      ctl = await renderPdf(docEl, f.blob, { onPage: (n, total) => { pageInfo = `Seite ${n}`; curPage = n; info.textContent = `Seite ${n} von ${total}`; } });
    } else if (f.kind === 'image') {
      const url = URL.createObjectURL(f.blob);
      docEl.innerHTML = `<img class="doc-img" src="${url}" alt="${esc(f.name)}">`;
      cleanups.push(() => URL.revokeObjectURL(url));
      ctl = { goTo: () => false, search: () => false, destroy() {} };
    } else {
      docEl.innerHTML = '';
      if (/\.(docx|pptx)$/i.test(f.name)) info.textContent = 'Textansicht';
      ctl = renderText(docEl, f.text || '');
    }
  } catch (err) {
    docEl.innerHTML = `<div class="empty">😕 Die Datei konnte nicht angezeigt werden.<br><small>${esc(err.message)}</small><div class="mt"><button class="btn" data-act="download">Mit anderer App öffnen</button></div></div>`;
    return;
  }
  if (!alive()) { ctl.destroy(); return; }
  fileCtlId = id;
  const jump = async p => {
    const ok = f.kind === 'pdf' ? await ctl.goTo(p.page || 1, p.q) : ctl.goTo(p.q, p.char);
    showHit(ok, p.q);
  };
  fileCtl = { jump };
  cleanups.push(() => { ctl.destroy(); fileCtl = null; fileCtlId = null; });
  document.getElementById('vSearch')?.addEventListener('submit', async e => {
    e.preventDefault();
    const term = document.getElementById('vTerm').value;
    const ok = await ctl.search(term);
    hitInfo.hidden = true;
    if (!ok) toast(`„${term}“ nicht gefunden`);
  });
  if (page || q || char != null) await jump({ page, q, char });
}

// ===== Einstellungen =====
function centText(usd) {
  const c = usd * 100;
  return (c < 0.1 ? '< 0,1' : c.toFixed(c < 10 ? 1 : 0).replace('.', ',')) + ' Cent';
}
function usageLine() {
  const u = AI.usageToday();
  if (!u) return '';
  const name = AI.MODELS.find(m => m.id === u.last?.model)?.name || u.last?.model || '';
  const k = Math.round((u.last.tokens || 0) / 1000);
  return `<p class="muted" style="font-size:13px;margin:12px 0 0">Heute: ${u.count} KI-Anfragen, ca. ${centText(u.usd)} (US-Cent). Letzte Anfrage: ca. ${centText(u.last.usd)} mit ${esc(name)}, ${k}.000 Tokens gelesen.</p>`;
}

async function viewSettings() {
  const s = AI.getSettings();
  app.innerHTML = `<div class="screen">${topbar({ crumb: 'Hauptmenü' })}
    <section class="hero"><h1>Einstellungen</h1><p class="muted" style="margin:4px 0 0">Version 11</p></section>
    ${CLOUD_AI ? '' : `<div class="card">
      <h2 style="font-size:18px;margin-bottom:6px">🦉 Nomi, dein Lernassistent</h2>
      <p class="muted" style="margin-top:0;font-size:15px">Nomi arbeitet direkt auf deinem Gerät: kostenlos für alle, ohne Konto, ohne Schlüssel und auch offline. Deine Dateien verlassen dein Gerät nie.</p>
      <h3 style="font-size:16px;margin:16px 0 4px">✨ Denk-Modus (freiwillig)</h3>
      <p class="muted" style="margin-top:0;font-size:15px">Im Denk-Modus lädt Nomi einmalig ein kleines Sprachmodell auf dein Gerät. Dann beantwortet Nomi Fragen im Chat in eigenen Worten statt mit Sätzen aus dem Skript. Das braucht ein neueres Gerät und für den Download am besten WLAN.</p>
      <div id="llmBox"><p class="muted">Prüfe dein Gerät …</p></div>
    </div>`}
    <div class="card" ${CLOUD_AI ? '' : 'hidden'}>
      <h2 style="font-size:18px;margin-bottom:6px">🧠 Deine KI</h2>
      ${AI.sharedAI() ? `<div class="notice" style="margin-bottom:12px">${icon('check')}<div>Die KI ist schon eingerichtet und für dich kostenlos (mit Tageslimit). Einen eigenen Schlüssel brauchst du nur, wenn du mehr nutzen willst.</div></div>` : ''}
      <p class="muted" style="margin-top:0;font-size:15px">Der Lernomat nutzt Claude von Anthropic. ${AI.sharedAI() ? 'Optional mit eigenem' : 'Du brauchst einen eigenen'} API-Schlüssel: auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> anmelden, Guthaben aufladen und unter „API Keys“ einen Schlüssel erstellen. Er wird nur auf diesem Gerät gespeichert.</p>
      <div class="field"><label for="key">API-Schlüssel</label><input class="input" id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(s.apiKey)}"></div>
      <div class="field"><label for="model">Modell</label><select class="input" id="model" ${AI.sharedMode() ? 'disabled' : ''}>${AI.sharedMode() ? '<option>Claude Haiku 5.5 – gemeinsamer Zugang</option>' : AI.MODELS.map(m => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.name} – ${m.note}</option>`).join('')}</select>${AI.sharedMode() ? '<p class="muted" style="font-size:13px;margin:6px 0 0">Mit dem gemeinsamen Zugang wird immer das günstige Modell Haiku genutzt. Andere Modelle gibt es nur mit eigenem Schlüssel.</p>' : ''}</div>
      <div class="btn-row"><button class="btn primary" data-act="saveKey">Speichern</button><button class="btn" data-act="test">Verbindung testen</button></div>
      ${usageLine()}
    </div>
    <div class="card mt">
      <h2 style="font-size:18px;margin-bottom:10px">🌗 Design</h2>
      <div class="seg" id="themeSeg">${[['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<button data-act="setTheme" data-v="${v}" class="${getTheme() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card mt">
      <h2 style="font-size:18px;margin-bottom:10px">🔊 Ton</h2>
      <label class="check-row"><input type="checkbox" id="sound" ${soundEnabled() ? 'checked' : ''}><span>Startmelodie und Klänge abspielen</span></label>
    </div>
    <div class="card mt">
      <h2 style="font-size:18px;margin-bottom:6px">💾 Daten</h2>
      <p class="muted" style="margin-top:0;font-size:15px">Alle Fächer, Dateien und Lernsets liegen nur auf diesem Gerät. Mit einer Sicherung kannst du sie auf iPhone oder Mac übertragen.</p>
      <div class="btn-row"><button class="btn" data-act="export">${icon('download')} Sicherung exportieren</button><button class="btn" data-act="import">${icon('upload')} Sicherung importieren</button></div>
      <div class="btn-row mt"><button class="btn danger" data-act="wipe">${icon('trash')} Alle Daten löschen</button></div>
    </div>
    <div class="card mt"><h2 style="font-size:18px;margin-bottom:6px">📱 Als App installieren</h2>
      <button class="btn" data-act="install">Anleitung für iPhone & Mac</button></div>
    <p class="muted center" style="font-size:13px;margin-top:24px">Der Lernomat · Version 1.0</p>
  </div>`;
  app.querySelector('#sound').addEventListener('change', e => { setSoundEnabled(e.target.checked); if (e.target.checked) unlock().then(() => sfx('good')); });
  const save = () => AI.saveSettings({ apiKey: app.querySelector('#key').value, model: app.querySelector('#model').disabled ? undefined : app.querySelector('#model').value });
  app.querySelector('#model').addEventListener('change', save);
  if (!CLOUD_AI) llmSettings(app.querySelector('#llmBox'));
  actions = {
    back: () => back(),
    install: installHelp,
    setTheme: d => {
      setTheme(d.v);
      app.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === d.v));
    },
    saveKey: () => { save(); toast('Gespeichert'); },
    test: async (_d, btn) => {
      save();
      btn.disabled = true; btn.textContent = 'Teste …';
      try { await AI.testConnection(); toast('✅ Verbindung klappt! Deine KI ist bereit.'); sfx('good'); } catch (err) { toast(err.message, 5000); }
      btn.disabled = false; btn.textContent = 'Verbindung testen';
    },
    export: exportBackup,
    import: importBackup,
    wipe: async () => {
      if (!await confirmDialog(`Alle Fächer, Dateien und Lernsets werden von diesem Gerät gelöscht.${CLOUD_AI ? ' Dein API-Schlüssel bleibt erhalten.' : ''}`, { ok: 'Alles löschen', danger: true })) return;
      await Promise.all(['subjects', 'files', 'sets'].map(s => db.clear(s)));
      toast('Alle Daten gelöscht');
      go('home', {}, { replace: true });
    },
  };
}

// Denk-Modus: Sprachmodell herunterladen, starten oder löschen.
let llmPick = null;
async function llmSettings(box) {
  const sup = await LLM.checkSupport();
  if (!box.isConnected) return;
  if (!sup.ok) {
    box.innerHTML = `<div class="notice">${icon('info')}<div>${esc(sup.why)} Nomi funktioniert trotzdem, nur im Schnell-Modus.</div></div>`;
    return;
  }
  llmPick ||= LLM.chosen() || (/iPhone|iPad|Android/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? LLM.MODELS[0].id : LLM.MODELS[1].id);
  const draw = () => {
    if (!box.isConnected) { off(); return; }
    const st = LLM.status();
    const model = LLM.MODELS.find(x => x.id === (st.model || llmPick)) || LLM.MODELS[0];
    if (st.state === 'loading') {
      box.innerHTML = `<div class="progress" style="margin:8px 0"><i style="width:${Math.round(st.progress.value * 100)}%"></i></div><p class="muted" style="margin:0;font-size:14px">${esc(st.progress.text)}</p>
        <p class="muted" style="font-size:13px">Du kannst die App dabei weiter benutzen. Lass sie nur geöffnet, bis der Download fertig ist.</p>`;
    } else if (st.state === 'ready') {
      box.innerHTML = `<div class="notice">${icon('check')}<div><b>Denk-Modus ist an</b> (${esc(model.name)}). Nomi antwortet im Chat jetzt in eigenen Worten.</div></div>
        <div class="btn-row"><button class="btn danger" data-llm="remove">${icon('trash')} Sprachmodell löschen</button></div>`;
    } else if (st.model) {
      box.innerHTML = `${st.state === 'error' ? `<div class="notice" style="margin-bottom:10px">${icon('info')}<div>${esc(st.progress.text)}</div></div>` : ''}
        <p style="margin:0 0 8px">Heruntergeladen: <b>${esc(model.name)}</b>. Es startet automatisch, wenn du Nomi fragst.</p>
        <div class="btn-row"><button class="btn primary" data-llm="start">Jetzt starten</button><button class="btn danger" data-llm="remove">${icon('trash')} Löschen</button></div>`;
    } else {
      box.innerHTML = `${st.state === 'error' ? `<div class="notice" style="margin-bottom:10px">${icon('info')}<div>${esc(st.progress.text)}</div></div>` : ''}
        <div class="seg" style="margin-bottom:10px">${LLM.MODELS.map(x => `<button data-pick="${x.id}" class="${x.id === llmPick ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>
        <p class="muted" style="margin:0 0 10px;font-size:14px">${esc(model.note)} · Download ${esc(model.size)}</p>
        <div class="btn-row"><button class="btn primary" data-llm="start">${icon('download')} Denk-Modus herunterladen</button></div>`;
    }
    box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { llmPick = b.dataset.pick; draw(); }));
    box.querySelector('[data-llm="start"]')?.addEventListener('click', () => {
      LLM.load(LLM.status().model || llmPick).then(() => { toast('✨ Denk-Modus ist bereit!'); sfx('good'); }).catch(() => {});
    });
    box.querySelector('[data-llm="remove"]')?.addEventListener('click', async () => {
      if (!await confirmDialog('Das Sprachmodell wird vom Gerät gelöscht. Nomi arbeitet dann wieder im Schnell-Modus.', { ok: 'Löschen', danger: true })) return;
      await LLM.remove();
      toast('Sprachmodell gelöscht');
    });
  };
  const off = LLM.onChange(draw);
  cleanups.push(off);
  draw();
}

async function exportBackup() {
  toast('Sicherung wird erstellt …');
  const { blobToBase64 } = await import('./files.js');
  const [subjects, sets, files] = await Promise.all([db.all('subjects'), db.all('sets'), db.all('files')]);
  const filesOut = [];
  for (const f of files) filesOut.push({ ...f, blob: undefined, blobData: f.blob ? await blobToBase64(f.blob) : null, blobType: f.blob?.type || f.mime });
  const data = JSON.stringify({ app: 'lernomat', version: 1, exported: Date.now(), subjects, sets, files: filesOut });
  const blob = new Blob([data], { type: 'application/json' });
  const name = `Lernomat-Sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch { /* Fallback: Download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (data.app !== 'lernomat') throw new Error('Das ist keine Lernomat-Sicherung.');
      for (const s of data.subjects) await db.put('subjects', s);
      for (const s of data.sets) await db.put('sets', s);
      for (const f of data.files) {
        const { blobData, blobType, ...rest } = f;
        let blob = null;
        if (blobData) {
          const bin = atob(blobData);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          blob = new Blob([arr], { type: blobType });
        }
        await db.put('files', { ...rest, blob });
      }
      toast(`Importiert: ${data.subjects.length} Fächer`);
      go('home', {}, { replace: true });
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message, 4500);
    }
  });
  input.click();
}

// ===== Start =====
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
requestPersistence();
initChat({ goSettings: () => go('settings'), openFile });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
history.replaceState({ view: 'splash', params: {} }, '');
viewSplash();
