// „Frag Nomi“: der Lernassistent ist von jedem Bildschirm aus mit einem Klick erreichbar.
// Ohne Cloud-KI (CLOUD_AI = false) antwortet Nomi direkt auf dem Gerät, sonst Claude über die API.
import { db } from './db.js';
import { CLOUD_AI } from './config.js';
import * as Nomi from './nomi/assistant.js';
import * as LLM from './nomi/llm.js';
import { icon, openModal, toast } from './ui.js';
import { esc, renderMarkdown } from './markdown.js';
import { filesToBlocks } from './files.js';
import * as AI from './ai.js';
import { chatContextNote } from './prompts.js';

let fab;
let context = null;
let goSettings = () => {};
let openFile = () => {};
const MAX_MESSAGES = 40;

const storeKey = id => 'lernomat.chat.' + (id || 'allgemein');
function loadHistory(id) {
  try { return JSON.parse(localStorage.getItem(storeKey(id))) || []; } catch { return []; }
}
function saveHistory(id, h) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(h.slice(-MAX_MESSAGES))); } catch { /* Speicher voll */ }
}

export function initChat(opts) {
  goSettings = opts.goSettings;
  openFile = opts.openFile;
  fab = document.createElement('button');
  fab.className = 'fab';
  fab.setAttribute('aria-label', CLOUD_AI ? 'KI fragen' : 'Nomi fragen');
  fab.innerHTML = CLOUD_AI ? `${icon('chat')}<span>KI fragen</span>` : `<span class="owl" aria-hidden="true">🦉</span><span>Nomi fragen</span>`;
  fab.hidden = true;
  fab.addEventListener('click', openChat);
  document.body.appendChild(fab);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !fab.hidden) { e.preventDefault(); openChat(); }
  });
}

export function showFab(on) { if (fab) fab.hidden = !on; }
export function setChatContext(ctx) { context = ctx; }

// Antwort mit Links zu den Fundstellen im Skript.
function bubble(m, mi) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.display ?? m.content)}</div>`;
  if (!m.parts) return `<div class="msg ai">${renderMarkdown(m.content).html}</div>`;
  const md = m.parts.map((p, i) => p.text + (p.cites.length ? `⟦${i}⟧` : '')).join('');
  const html = renderMarkdown(md).html.replace(/⟦(\d+)⟧/g, (_, i) => m.parts[i].cites.map((c, ci) =>
    `<button class="cite" data-m="${mi}" data-p="${i}" data-c="${ci}" title="${esc(c.q)}">📄 ${esc(c.label)}</button>`).join(''));
  return `<div class="msg ai">${html}</div>`;
}

// Wandelt die Zitate der KI in Sprungziele um (Datei, Seite, Textstelle).
function toParts(blocks, files) {
  const docs = files.filter(f => f.kind !== 'image');
  const byTitle = Object.fromEntries(files.map(f => [`${f.name} (${f.category})`, f]));
  return blocks.map(b => {
    const seen = new Set();
    const cites = [];
    for (const c of b.citations) {
      const f = byTitle[c.document_title] || docs[c.document_index];
      if (!f) continue;
      const page = c.type === 'page_location' ? c.start_page_number
        : c.type === 'content_block_location' && f.kind === 'pdf' ? c.start_block_index + 1 : null;
      const id = f.id + ':' + (page ?? c.start_char_index ?? '');
      if (seen.has(id)) continue;
      seen.add(id);
      const short = f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name;
      cites.push({ fileId: f.id, page, char: c.start_char_index ?? null, q: c.cited_text, label: page ? `${short} · S. ${page}` : short });
    }
    return { text: b.text, cites };
  });
}

const NOMI_SUGGESTIONS = [
  'Was ist …',
  'Wo steht etwas zu …',
  'Was ist besonders wichtig?',
  'Frag mich ab!',
  'Was kannst du?',
];

const DEFAULT_SUGGESTIONS = [
  'Wo im Skript finde ich …',
  'Erklär mir das nochmal ganz einfach.',
  'Gib mir ein anschauliches Beispiel.',
  'Was ist hier besonders prüfungsrelevant?',
  'Stell mir eine Übungsfrage dazu.',
];

async function openChat() {
  const ctx = context;
  const subjectId = ctx?.subjectId || null;
  const history = loadHistory(subjectId);
  let offMode = null;
  const suggestions = (CLOUD_AI ? ctx?.suggestions : ctx?.nomiSuggestions) || (CLOUD_AI ? DEFAULT_SUGGESTIONS : NOMI_SUGGESTIONS);
  const m = openModal(`<div class="chat">
      <div class="chat-head">${CLOUD_AI ? '' : '<span class="nomi-face" aria-hidden="true">🦉</span>'}<div><h2 style="margin:0">${CLOUD_AI ? 'Frag den Lernomat' : 'Nomi'}</h2>
        <small class="muted">${CLOUD_AI ? (ctx?.label ? `Kennt deine Unterlagen in „${esc(ctx.label)}“` : 'Allgemeine Fragen zum Lernen')
          : `Dein Lernassistent · kennt ${ctx?.label ? `„${esc(ctx.label)}“` : 'alle deine Unterlagen'}`}</small>
        ${CLOUD_AI ? '' : '<small class="nomi-mode" id="nomiMode"></small>'}</div>
        <button class="icon-btn plain" data-clear aria-label="Verlauf löschen" title="Verlauf löschen">${icon('trash')}</button>
        <button class="icon-btn plain" data-close aria-label="Schließen">${icon('close')}</button></div>
      <div class="chat-log" id="chatLog"></div>
      <div class="chips chat-sugg" id="chatSugg"></div>
      <form class="chat-input" id="chatForm">
        <textarea class="input" id="chatText" rows="1" placeholder="Deine Frage …" enterkeyhint="send"></textarea>
        <button class="icon-btn" style="background:var(--accent);color:var(--on-accent)" aria-label="Senden">${icon('send')}</button>
      </form></div>`, { wide: true, onClose: () => offMode?.() });
  m.el.classList.add('chat-modal');
  const log = m.el.querySelector('#chatLog');
  const sugg = m.el.querySelector('#chatSugg');
  const text = m.el.querySelector('#chatText');
  let busy = false;

  const draw = () => {
    log.innerHTML = history.length ? history.map((h, i) => bubble(h, i)).join('')
      : CLOUD_AI ? `<div class="empty"><div class="big">💬</div>Frag mich alles zu deinem Lernstoff: Erklärungen, Beispiele, Eselsbrücken oder Übungsfragen.</div>`
      : `<div class="empty"><div class="big">🦉</div>Hallo, ich bin Nomi! Frag mich etwas zu deinen Unterlagen. Ich antworte mit Links, die direkt zur Stelle im Skript springen.</div>`;
    sugg.innerHTML = history.length ? '' : suggestions.map(s => `<button type="button" class="chip">${esc(s)}</button>`).join('');
    // Vorschläge mit „…“ füllen nur das Eingabefeld, die anderen werden direkt gesendet.
    sugg.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      if (b.textContent.endsWith('…')) { text.value = b.textContent.replace(/\s*…$/, ' '); text.focus(); } else send(b.textContent);
    }));
    log.scrollTop = log.scrollHeight;
  };

  // Nomi: Antwort direkt auf dem Gerät.
  const sendLocal = async q => {
    busy = true;
    text.value = '';
    history.push({ role: 'user', content: q, display: q });
    draw();
    const live = document.createElement('div');
    live.className = 'msg ai';
    live.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    log.appendChild(live);
    log.scrollTop = log.scrollHeight;
    try {
      const files = subjectId ? await db.bySubject('files', subjectId) : await db.all('files');
      files.sort((a, b) => a.added - b.added);
      const res = await Nomi.answer({
        question: q, files, history, detail: ctx?.detail ? ctx.detail() : '', here: ctx?.here ? ctx.here() : null,
        onText: snap => { live.innerHTML = renderMarkdown(snap.replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '')).html; log.scrollTop = log.scrollHeight; },
      });
      history.push({ role: 'assistant', content: res.parts.map(p => p.text).join(''), parts: res.parts, quiz: res.quiz });
      saveHistory(subjectId, history);
    } catch (err) {
      console.error(err);
      history.pop();
      text.value = q;
      toast(err.message || 'Da ist etwas schiefgelaufen.', 4500);
    }
    busy = false;
    draw();
  };

  const send = async q => {
    q = q.trim();
    if (!q || busy) return;
    if (!CLOUD_AI) return sendLocal(q);
    if (!AI.hasKey()) { m.close(); toast('Bitte zuerst den API-Schlüssel eintragen.'); goSettings(); return; }
    busy = true;
    text.value = '';
    const detail = ctx?.detail ? ctx.detail() : '';
    history.push({ role: 'user', content: q + chatContextNote(detail), display: q });
    draw();
    const live = document.createElement('div');
    live.className = 'msg ai';
    live.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    log.appendChild(live);
    log.scrollTop = log.scrollHeight;
    try {
      const files = subjectId ? await db.bySubject('files', subjectId) : [];
      files.sort((a, b) => a.added - b.added);
      const fileBlocks = await filesToBlocks(files);
      const recent = history.slice(-MAX_MESSAGES);
      if (recent[0].role !== 'user') recent.shift();
      const blocks = await AI.chat({
        fileBlocks,
        history: recent.map(h => ({ role: h.role, content: h.content })),
        onText: snap => { live.innerHTML = renderMarkdown(snap).html; log.scrollTop = log.scrollHeight; },
      });
      history.push({ role: 'assistant', content: blocks.map(b => b.text).join(''), parts: toParts(blocks, files) });
      saveHistory(subjectId, history);
    } catch (err) {
      history.pop();
      text.value = q;
      toast(err.message, 4500);
    }
    busy = false;
    draw();
  };

  log.addEventListener('click', e => {
    const b = e.target.closest('.cite');
    if (!b) return;
    const c = history[b.dataset.m]?.parts?.[b.dataset.p]?.cites?.[b.dataset.c];
    if (!c) return;
    m.close();
    openFile({ id: c.fileId, page: c.page, q: c.q, char: c.char });
  });
  m.el.querySelector('#chatForm').addEventListener('submit', e => { e.preventDefault(); send(text.value); });
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(text.value); }
  });
  text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; });
  m.el.querySelector('[data-clear]').addEventListener('click', () => {
    history.length = 0;
    saveHistory(subjectId, history);
    draw();
  });
  if (!CLOUD_AI) {
    const mode = m.el.querySelector('#nomiMode');
    const show = () => {
      const st = LLM.status();
      mode.innerHTML = st.state === 'ready' ? '✨ Denk-Modus an'
        : st.state === 'loading' ? `⏳ Denk-Modus startet … ${Math.round(st.progress.value * 100)} %`
        : '⚡ Schnell-Modus · <a href="#" data-mode>Denk-Modus?</a>';
      mode.querySelector('[data-mode]')?.addEventListener('click', e => { e.preventDefault(); m.close(); goSettings(); });
    };
    offMode = LLM.onChange(show);
    show();
    // Einmal heruntergeladenes Sprachmodell im Hintergrund starten.
    if (LLM.chosen() && LLM.status().state === 'off') LLM.checkSupport().then(s => { if (s.ok) LLM.load().catch(() => {}); });
  }
  draw();
  setTimeout(() => { if (matchMedia('(pointer: fine)').matches) text.focus(); }, 80);
}
