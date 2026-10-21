// Lernsets teilen, ganz ohne Konto: als Link (der Inhalt steckt komprimiert im Link selbst) oder als Datei.
// Der eigene Lernfortschritt (Kästen, Fälligkeiten, Klausurversuche) wird nicht mitgeschickt.
import { uid } from './db.js';

export const SHARE_PARAM = 'teilen';
const FORMAT = 'lernomat-set';
// Längere Links kommen in Messengern oft abgeschnitten an. Darüber hinaus lieber als Datei teilen.
export const MAX_LINK = 12000;

// Nur den Inhalt, ohne persönlichen Fortschritt.
export function packSet(set, subj) {
  let data = set.data;
  if (set.type === 'cards') data = { cards: data.cards.map(c => ({ front: c.front, back: c.back, ...(c.topic ? { topic: c.topic } : {}) })) };
  if (set.type === 'plan') data = { ...data, steps: data.steps.map(({ done, ...s }) => s) };
  return { app: FORMAT, v: 1, type: set.type, title: set.title, subject: subj ? { name: subj.name, emoji: subj.emoji, color: subj.color } : null, focus: set.focus || [], data };
}

export function unpackSet(pack, subjectId) {
  if (!pack || pack.app !== FORMAT || !['cards', 'summary', 'exam', 'plan'].includes(pack.type)) throw new Error('Das ist kein Lernomat-Lernset.');
  const base = { id: uid(), subjectId, type: pack.type, title: String(pack.title || 'Geteiltes Lernset').slice(0, 120), created: Date.now(), focus: pack.focus || [], shared: true };
  const d = pack.data || {};
  if (pack.type === 'cards') {
    const cards = (d.cards || []).filter(c => c && c.front && c.back).map(c => ({ front: String(c.front), back: String(c.back), topic: c.topic ? String(c.topic) : '', id: uid(), box: 0, seen: 0 }));
    if (!cards.length) throw new Error('In diesem Set sind keine Karten.');
    return { ...base, data: { cards } };
  }
  if (pack.type === 'summary') return { ...base, data: { markdown: String(d.markdown || '') } };
  if (pack.type === 'exam') return { ...base, data: { duration: Number(d.duration) || 30, questions: d.questions || [] }, attempts: [] };
  return { ...base, data: { overview: String(d.overview || ''), examDate: d.examDate || '', steps: (d.steps || []).map(s => ({ ...s, done: false })) } };
}

// ===== Komprimieren (deflate) + Base64url =====
const b64url = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodePack(pack) {
  const raw = new TextEncoder().encode(JSON.stringify(pack));
  if (typeof CompressionStream === 'function') return 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'j' + b64url(raw);
}

export async function decodePack(code) {
  const kind = code[0], bytes = unb64url(code.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('Dieser Browser kann den Link nicht öffnen. Bitte die App aktualisieren.');
    return JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'))));
  }
  if (kind === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  throw new Error('Der Link ist unvollständig.');
}

export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

export async function shareLink(pack) {
  return `${appUrl()}#${SHARE_PARAM}=${await encodePack(pack)}`;
}

// Liest ein geteiltes Set aus der Adresse (und entfernt es daraus, damit es nicht doppelt importiert wird).
export async function packFromLocation() {
  const m = new RegExp(`[#&]${SHARE_PARAM}=([A-Za-z0-9_-]+)`).exec(location.hash);
  if (!m) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  return decodePack(m[1]);
}

export function packFile(pack) {
  const safe = pack.title.replace(/[^\p{L}\d\- ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Lernset';
  const name = `${safe}.lernomat.json`;
  return new File([JSON.stringify(pack, null, 1)], name, { type: 'application/json' });
}
