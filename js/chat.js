// „Frag den Lernomat“: die KI ist von jedem Bildschirm aus mit einem Klick erreichbar.
import { db } from './db.js';
import { icon, openModal, toast } from './ui.js';
import { esc, renderMarkdown } from './markdown.js';
import { filesToBlocks } from './files.js';
import * as AI from './ai.js';
import { chatContextNote } from './prompts.js';

let fab;
let context = null;
let goSettings = () => {};
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
  fab = document.createElement('button');
  fab.className = 'fab';
  fab.setAttribute('aria-label', 'KI fragen');
  fab.innerHTML = `${icon('chat')}<span>KI fragen</span>`;
  fab.hidden = true;
  fab.addEventListener('click', openChat);
  document.body.appendChild(fab);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !fab.hidden) { e.preventDefault(); openChat(); }
  });
}

export function showFab(on) { if (fab) fab.hidden = !on; }
export function setChatContext(ctx) { context = ctx; }

function bubble(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.display ?? m.content)}</div>`;
  return `<div class="msg ai">${renderMarkdown(m.content).html}</div>`;
}

const SUGGESTIONS = [
  'Erklär mir das nochmal ganz einfach.',
  'Gib mir ein anschauliches Beispiel.',
  'Was ist hier besonders prüfungsrelevant?',
  'Stell mir eine Übungsfrage dazu.',
];

async function openChat() {
  const ctx = context;
  const subjectId = ctx?.subjectId || null;
  const history = loadHistory(subjectId);
  const m = openModal(`<div class="chat">
      <div class="chat-head"><div><h2 style="margin:0">Frag den Lernomat</h2>
        <small class="muted">${ctx?.label ? `Kennt deine Unterlagen in „${esc(ctx.label)}“` : 'Allgemeine Fragen zum Lernen'}</small></div>
        <button class="icon-btn plain" data-clear aria-label="Verlauf löschen" title="Verlauf löschen">${icon('trash')}</button>
        <button class="icon-btn plain" data-close aria-label="Schließen">${icon('close')}</button></div>
      <div class="chat-log" id="chatLog"></div>
      <div class="chips chat-sugg" id="chatSugg"></div>
      <form class="chat-input" id="chatForm">
        <textarea class="input" id="chatText" rows="1" placeholder="Deine Frage …" enterkeyhint="send"></textarea>
        <button class="icon-btn" style="background:var(--accent);color:var(--on-accent)" aria-label="Senden">${icon('send')}</button>
      </form></div>`, { wide: true });
  m.el.classList.add('chat-modal');
  const log = m.el.querySelector('#chatLog');
  const sugg = m.el.querySelector('#chatSugg');
  const text = m.el.querySelector('#chatText');
  let busy = false;

  const draw = () => {
    log.innerHTML = history.length ? history.map(bubble).join('')
      : `<div class="empty"><div class="big">💬</div>Frag mich alles zu deinem Lernstoff: Erklärungen, Beispiele, Eselsbrücken oder Übungsfragen.</div>`;
    sugg.innerHTML = history.length ? '' : SUGGESTIONS.map(s => `<button type="button" class="chip">${esc(s)}</button>`).join('');
    sugg.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => send(b.textContent)));
    log.scrollTop = log.scrollHeight;
  };

  const send = async q => {
    q = q.trim();
    if (!q || busy) return;
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
      const answer = await AI.chat({
        fileBlocks,
        history: recent.map(h => ({ role: h.role, content: h.content })),
        onText: snap => { live.innerHTML = renderMarkdown(snap).html; log.scrollTop = log.scrollHeight; },
      });
      history.push({ role: 'assistant', content: answer });
      saveHistory(subjectId, history);
    } catch (err) {
      history.pop();
      text.value = q;
      toast(err.message, 4500);
    }
    busy = false;
    draw();
  };

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
  draw();
  setTimeout(() => { if (matchMedia('(pointer: fine)').matches) text.focus(); }, 80);
}
