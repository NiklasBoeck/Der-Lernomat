// Einlesen hochgeladener Dateien und Umwandeln in Bausteine für die KI.
import { uid, db } from './db.js';
import { loadPdfjs } from './viewer.js';
import { sharedMode } from './ai.js';

export const CATEGORIES = ['Lernskript', 'Übungsklausur', 'Karteikarten', 'Zusammenfassung', 'Sonstiges'];
export const ACCEPT = '.pdf,.txt,.md,.markdown,.csv,.json,.docx,.pptx,.rtf,image/*,application/pdf,text/plain';

const JSZIP_URL = new URL('./vendor/jszip-3.10.1.min.js', import.meta.url).href;
let jszipLoading;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  jszipLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { jszipLoading = null; reject(new Error('Word/PowerPoint-Unterstützung konnte nicht geladen werden.')); };
    document.head.appendChild(s);
  });
  return jszipLoading;
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/klausur|prüfung|pruefung|exam|test|probe/.test(n)) return 'Übungsklausur';
  if (/karteikart|flashcard|anki|vokabel|karten/.test(n)) return 'Karteikarten';
  if (/zusammenfass|summary|überblick|ueberblick|cheat/.test(n)) return 'Zusammenfassung';
  return 'Lernskript';
}

function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function xmlText(xml, tag) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [];
  const pTag = tag === 'w' ? 'w:p' : 'a:p';
  const tTag = tag === 'w' ? 'w:t' : 'a:t';
  for (const p of doc.getElementsByTagName(pTag)) {
    const t = [...p.getElementsByTagName(tTag)].map(n => n.textContent).join('');
    if (t.trim()) paras.push(t);
  }
  return paras.join('\n');
}

async function officeText(file, type) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  if (type === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error('Word-Datei konnte nicht gelesen werden.');
    return xmlText(xml, 'w');
  }
  const slides = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const [i, p] of slides.entries()) {
    parts.push(`--- Folie ${i + 1} ---\n` + xmlText(await zip.file(p).async('string'), 'a'));
  }
  return parts.join('\n\n');
}

// Bilder verkleinern, damit sie unter den Grenzen der KI bleiben.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const max = 1800;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 3_500_000 && /jpe?g|png|webp|gif/.test(file.type)) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(res => canvas.toBlob(b => res(b || file), 'image/jpeg', 0.85));
}

export async function ingestFile(file, subjectId) {
  const e = ext(file.name);
  const base = {
    id: uid(), subjectId, name: file.name, size: file.size, added: Date.now(),
    category: guessCategory(file.name),
  };
  if (e === 'pdf' || file.type === 'application/pdf') {
    return { ...base, kind: 'pdf', mime: 'application/pdf', blob: file };
  }
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(e)) {
    const blob = await shrinkImage(file);
    return { ...base, kind: 'image', mime: blob.type || 'image/jpeg', blob, size: blob.size };
  }
  if (e === 'docx' || e === 'pptx') {
    const text = await officeText(file, e);
    return { ...base, kind: 'text', mime: file.type, blob: file, text };
  }
  if (['txt', 'md', 'markdown', 'csv', 'json', 'rtf'].includes(e) || file.type.startsWith('text/')) {
    return { ...base, kind: 'text', mime: file.type || 'text/plain', blob: file, text: await file.text() };
  }
  if (['doc', 'ppt', 'pages', 'key'].includes(e)) {
    throw new Error(`„${file.name}“: Bitte als PDF exportieren (Datei → Exportieren als PDF), dann klappt es.`);
  }
  throw new Error(`„${file.name}“ wird nicht unterstützt. Möglich sind PDF, Bilder, Word, PowerPoint und Text.`);
}

export function fileBadge(f) {
  if (f.kind === 'pdf') return 'PDF';
  if (f.kind === 'image') return 'BILD';
  const e = ext(f.name).toUpperCase();
  return e.slice(0, 4) || 'TXT';
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Text jeder PDF-Seite (einmal ausgelesen, dann am Gerät gespeichert).
async function pdfPages(f) {
  if (Array.isArray(f.pages)) return f.pages;
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim());
  }
  doc.destroy();
  f.pages = pages;
  try { const rec = await db.get('files', f.id); if (rec) await db.put('files', { ...rec, pages }); } catch { /* nur Zwischenspeicher */ }
  return pages;
}

// Wandelt die gewählten Dateien in Inhaltsblöcke für die Claude API um.
// Beim gemeinsamen Zugang gehen PDFs als reiner Text (Seite für Seite) raus: viel günstiger als Seitenbilder.
export async function filesToBlocks(files, { lean = sharedMode() } = {}) {
  const blocks = [];
  for (const f of files) {
    const title = `${f.name} (${f.category})`;
    if (f.kind === 'pdf' && lean) {
      const pages = await pdfPages(f).catch(() => null);
      // Eingescannte PDFs haben kaum Text: dann doch das PDF selbst schicken.
      if (pages?.length && pages.join('').length / pages.length >= 80) {
        blocks.push({ type: 'document', title, source: { type: 'content', content: pages.map((t, i) => ({ type: 'text', text: `[Seite ${i + 1}]\n${t || '(kein Text auf dieser Seite)'}` })) } });
        continue;
      }
    }
    if (f.kind === 'pdf') {
      blocks.push({ type: 'document', title, source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(f.blob) } });
    } else if (f.kind === 'image') {
      blocks.push({ type: 'text', text: `Bild: ${title}` });
      const mt = /image\/(jpeg|png|gif|webp)/.test(f.mime) ? f.mime : 'image/jpeg';
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: await blobToBase64(f.blob) } });
    } else {
      blocks.push({ type: 'document', title, source: { type: 'text', media_type: 'text/plain', data: f.text || '(leer)' } });
    }
  }
  return blocks;
}

export function totalSize(files) {
  return files.reduce((s, f) => s + (f.size || 0), 0);
}
