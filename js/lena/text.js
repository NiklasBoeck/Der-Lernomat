// Lena liest mit: Text aus den Unterlagen holen, in Absätze, Sätze und Abschnitte teilen und durchsuchen.
// Alles läuft auf dem Gerät, ohne Internet und ohne Kosten.
import { db } from '../db.js';
import { loadPdfjs } from '../viewer.js';
import { readImage, readPdfPages } from './ocr.js';

export const STOP = new Set(`aber alle allem allen aller alles als also am an andere anderem anderen anderer anderes auch auf aus bei beim bin bis bist da dabei dadurch dafuer dagegen daher damit dann daran darauf daraus darf darin darum das dass dein deine dem den denn der deren des dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines einige einigen einmal er es etwa etwas euch euer fuer gegen gibt hab habe haben hat hatte haette hier hin hinter ich ihm ihn ihnen ihr ihre ihren im immer in ins ist ja je jede jedem jeden jeder jedes jedoch jetzt kann kein keine keinen koennen koennte man manche mehr mein meine mich mir mit muss muessen nach neben nicht nichts noch nun nur ob oder ohne sehr seid sein seine seinen seit sich sie sind so solche soll sollen sollte sondern sonst sowie ueber um und uns unser unter viel viele vom von vor wann war waren warum was weil welche welchem welchen welcher welches wenn wer werde werden wie wieder wieso will wir wird wo wobei wurde wurden zu zum zur zwar zwei drei zwischen bzw usw etc ggf evtl bitte mal einfach genau eigentlich erklaer erklaere erklaeren erklaert nochmal frage fragen gib gibt zeig zeige stell stelle bedeutet bedeutung versteht verstehen verstehe definition definiere wichtig wichtige wichtigste wichtigsten beispiel beispiele finde finden findet steht stehen skript unterlagen datei seite seiten thema themen kapitel lernomat lena nomi karte karten genauer naeher denkanstoss tipp gedanke kurz kurze ganz gerade hallo hey danke bitte okay also kannst koenntest moechte wuerde mach mache sag sage the and for with that this from are was were have has not you your can will what which who how why when where`.split(/\s+/));

// Kleinbuchstaben, ohne Akzente (ä → a), ß → ss: so findet „Bewaesserung“ auch „Bewässerung“.
export const fold = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .normalize('NFD').replace(/\p{M}/gu, '');

const SUFFIXES = ['innen', 'ern', 'en', 'er', 'es', 'em', 'e', 'n', 's'];
export function stem(w) {
  for (const s of SUFFIXES) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
}

export const words = s => fold(s).match(/[\p{L}\d]+/gu) || [];
export const contentWords = s => words(s).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

// Suchbegriffe einer Frage (mit Gewicht).
export function queryTerms(q, w = 1) {
  return [...new Set(contentWords(q).map(stem))].map(t => ({ t, w }));
}

// Zählt, wie oft ein Begriff vorkommt (lange Begriffe auch in zusammengesetzten Wörtern: „Membran“ in „Zellmembran“).
const reCache = new Map();
export function countTerm(foldedText, t) {
  if (t.length >= 5) {
    let n = 0, i = foldedText.indexOf(t);
    while (i >= 0) { n++; i = foldedText.indexOf(t, i + t.length); }
    return n;
  }
  let re = reCache.get(t);
  if (!re) { re = new RegExp(`(?<![\\p{L}\\d])${t}`, 'gu'); reCache.set(t, re); }
  return (foldedText.match(re) || []).length;
}

// Für Markdown entschärfen, damit Sternchen & Co. aus dem Skript nichts zerschießen.
export const cleanLines = s => String(s || '').replace(/\*/g, '∗').replace(/`/g, '\'').replace(/__/g, '_ _').replace(/==/g, '= =').replace(/[ \t]+/g, ' ').trim();
export const clean = s => cleanLines(s).replace(/\s+/g, ' ');
export function shorten(s, max = 220) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' '));
  return cut.slice(0, at > max * 0.6 ? at : max).replace(/[,;:\s]+$/, '') + ' …';
}

// ===== Einlesen =====
const BULLET = /^([•▪◦●○■□➢►▸\-–—*✓]|\d{1,2}[.)]\s|[a-z][.)]\s|\(\d+\)\s)/u;
const NOT_HEADING = /^(seite|page|folie|abb|abbildung|tabelle|quelle|www\.|http)/i;

function looksLikeHeading(t, prevBlank, nextLine) {
  if (t.length < 3 || t.length > 70 || NOT_HEADING.test(t)) return false;
  if (/[.,;:!?]$/.test(t) && !/^\d+(\.\d+)*\.?\s/.test(t)) return false;
  if (!/^[\p{Lu}\d]/u.test(t) || !/\p{L}{3}/u.test(t)) return false;
  if (/^\d+(\.\d+)*\.?\s+\p{Lu}/u.test(t)) return true;
  const wc = t.split(/\s+/).length;
  return prevBlank && wc <= 8 && (!nextLine || nextLine.length > t.length);
}

// Teilt Text in Absätze; jede Zeile behält ihre Position (für den Sprung zur Stelle).
export function paragraphs(text, { pdfHeads = null } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = null, pos = 0, prevBlank = true;
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null; };
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const start = pos;
    pos += raw.length + 1;
    let t = raw.trim();
    if (!t) { flush(); prevBlank = true; continue; }
    let heading = false, level = 2;
    const md = /^(#{1,4})\s+(.+)$/.exec(t);
    const slide = /^---\s*Folie\s+(\d+)\s*---$/.exec(t);
    if (slide) { flush(); prevBlank = true; continue; }
    if (md) { heading = true; level = md[1].length; t = md[2].replace(/\*\*/g, ''); }
    else if (pdfHeads) heading = pdfHeads.has(t);
    else heading = looksLikeHeading(t, prevBlank || /^---\s*Folie/.test(lines[li - 1] || ''), (lines[li + 1] || '').trim());
    // Aufzählungen und Zeilen wie „Begriff: Erklärung“ oder „Begriff; Erklärung“ bleiben eigene Absätze.
    const bullet = !heading && (BULLET.test(t) || (!pdfHeads && t.length < 300 && /^\p{Lu}[^:;\t]{1,47}(?:[;\t]|:\s)\s*\S/u.test(t)));
    if (heading || bullet || !cur || cur.heading || (/[.!?:]$/.test(cur.text) && cur.text.length > 380)) {
      flush();
      cur = { text: t, char: start, heading, level, bullet };
      if (heading) flush();
    } else if (/[\p{L}]-$/u.test(cur.text) && /^\p{Ll}/u.test(t)) {
      cur.text = cur.text.slice(0, -1) + t;
    } else {
      cur.text += ' ' + t;
    }
    prevBlank = false;
  }
  flush();
  return out;
}

const ABBR = /\b(z|d|u|o|v|s|bzw|ca|vgl|usw|etc|Nr|nr|Abb|Kap|Tab|ggf|evtl|inkl|max|min|sog|bspw|Dr|Prof|St|Jh|Mio|Mrd|Hr|Fr|zB|bzgl|Std|Min|Sek|ff|Bd|Aufl|geb|Jhd)\./g;
export function sentences(text) {
  const prot = text.replace(ABBR, '$1∯').replace(/(\d)\.(?=\d)/g, '$1∯').replace(/\b(\p{L})\.(?=\s?\p{L}\.)/gu, '$1∯');
  return prot.split(/(?<=[.!?])\s+(?=[\p{Lu}\d„"(»])/u).map(s => s.replace(/∯/g, '.').trim()).filter(s => s.length > 1);
}

// PDF Seite für Seite auslesen, dabei große Schrift als Überschrift merken.
async function readPdf(f) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()) }).promise;
  const pages = [], allLines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const lines = [];
    let line = { t: '', h: 0 };
    for (const it of tc.items) {
      const h = Math.abs(it.transform?.[3] || it.height || 0);
      line.t += (it.str || '') + (it.hasEOL ? '' : ' ');
      if ((it.str || '').trim()) line.h = Math.max(line.h, h);
      if (it.hasEOL) { lines.push(line); line = { t: '', h: 0 }; }
    }
    lines.push(line);
    const norm = lines.map(l => ({ t: l.t.replace(/[ \t]+/g, ' ').trim(), h: l.h, page: i }));
    pages.push(norm.map(l => l.t).join('\n').replace(/\n\s*\n+/g, '\n').trim());
    allLines.push(...norm.filter(l => l.t));
  }
  // Eingescannt (kaum Text): Seiten per Texterkennung lesen.
  if (pages.join('').length / Math.max(1, pages.length) < 60) {
    try {
      const ocr = await readPdfPages(doc, f.name);
      doc.destroy();
      return { pages: ocr, heads: [], ocr: true };
    } catch (err) { console.warn('Texterkennung fehlgeschlagen', err); }
  }
  doc.destroy();
  // Typische Schriftgröße des Fließtexts; deutlich größere, kurze Zeilen sind Überschriften.
  const sizes = allLines.flatMap(l => Array(Math.min(l.t.length, 200)).fill(Math.round(l.h * 10) / 10)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 0;
  const heads = [];
  for (const l of allLines) {
    if (body && l.h >= body * 1.18 && l.t.length >= 3 && l.t.length <= 80 && /\p{L}{3}/u.test(l.t) && !NOT_HEADING.test(l.t) && !/[,;]$/.test(l.t)) {
      heads.push({ t: l.t, page: l.page, h: Math.round(l.h * 10) / 10 });
    }
  }
  // Zu viele „Überschriften“ heißt: die Schriftgrößen sagen nichts aus.
  return { pages, heads: heads.length > allLines.length * 0.4 ? [] : heads };
}

async function pdfData(f) {
  const thin = p => p.join('').length / Math.max(1, p.length) < 60;
  if (Array.isArray(f.pages) && Array.isArray(f.heads) && (f.ocr || !thin(f.pages))) return { pages: f.pages, heads: f.heads };
  const d = await readPdf(f);
  f.pages = d.pages; f.heads = d.heads;
  try { const rec = await db.get('files', f.id); if (rec) await db.put('files', { ...rec, pages: d.pages, heads: d.heads, ocr: !!d.ocr }); } catch { /* nur Zwischenspeicher */ }
  return d;
}

// ===== Korpus einer Datei =====
// paras: Absätze mit Fundstelle; sents: Sätze; sections: Abschnitte mit Überschrift; passages: Suchhäppchen.
const cache = new Map();

export async function corpusOf(f) {
  const key = f.id + ':' + f.size + ':' + f.added;
  if (cache.has(key)) return cache.get(key);
  const c = { file: f, paras: [], sents: [], sections: [], passages: [], readable: true };
  try {
    if (f.kind === 'pdf') {
      const { pages, heads } = await pdfData(f);
      const sizes = [...new Set(heads.map(h => h.h))].sort((a, b) => b - a);
      pages.forEach((txt, pi) => {
        const pageHeads = new Set(heads.filter(h => h.page === pi + 1).map(h => h.t));
        for (const p of paragraphs(txt, { pdfHeads: pageHeads })) {
          if (p.heading) p.level = Math.min(3, 1 + sizes.indexOf(heads.find(h => h.page === pi + 1 && h.t === p.text)?.h ?? sizes[0]));
          c.paras.push({ ...p, page: pi + 1, char: null });
        }
      });
      if (pages.join('').length / Math.max(1, pages.length) < 60) c.readable = false;
    } else if (f.kind === 'text') {
      for (const p of paragraphs(f.text || '')) c.paras.push({ ...p, page: null });
    } else if (f.kind === 'image' && f.blob) {
      // Fotos (z. B. von Notizen): einmal Text erkennen und am Gerät merken.
      if (typeof f.ocrText !== 'string') {
        f.ocrText = await readImage(f.blob, `Lena liest das Foto „${f.name}“ …`);
        try { const rec = await db.get('files', f.id); if (rec) await db.put('files', { ...rec, ocrText: f.ocrText }); } catch { /* nur Zwischenspeicher */ }
      }
      for (const p of paragraphs(f.ocrText)) c.paras.push({ ...p, page: null, char: null });
      if (f.ocrText.length < 20) c.readable = false;
    } else {
      c.readable = false;
    }
  } catch (err) {
    console.warn('Lena konnte die Datei nicht lesen', f.name, err);
    c.readable = false;
  }
  build(c);
  cache.set(key, c);
  return c;
}

function build(c) {
  let sec = null;
  const newSec = (title, level, p) => {
    sec = { title, level, page: p?.page ?? null, char: p?.char ?? null, fileId: c.file.id, sents: [], paras: [] };
    c.sections.push(sec);
  };
  for (const p of c.paras) {
    if (p.heading) {
      newSec(p.text.replace(/^\d+(\.\d+)*\.?\s+/, '').trim() || p.text, p.level || 2, p);
      sec.num = (/^(\d+(?:\.\d+)*)\.?\s/.exec(p.text) || [])[1] || null;
      continue;
    }
    if (!sec) newSec(null, 2, p);
    p.section = sec;
    sec.paras.push(p);
    const list = p.bullet ? [p.text.replace(BULLET, '').trim()] : sentences(p.text);
    for (const t of list) {
      if (t.length < 2) continue;
      const s = { text: t, fold: fold(t), page: p.page, char: p.char, para: p, section: sec, fileId: c.file.id, bullet: p.bullet, i: c.sents.length };
      c.sents.push(s);
      sec.sents.push(s);
    }
  }
  c.sections = c.sections.filter(s => s.sents.length || s.title);
  // Abschnitte ohne Überschrift bekommen eine aus Datei und Seite.
  for (const s of c.sections) if (!s.title) s.title = s.page ? `${baseName(c.file.name)}, S. ${s.page}` : baseName(c.file.name);
  // Suchhäppchen: aufeinanderfolgende Sätze derselben Seite, je ca. 700 Zeichen.
  let cur = null;
  for (const s of c.sents) {
    if (!cur || cur.page !== s.page || cur.section !== s.section || cur.text.length > 700) {
      cur = { text: '', page: s.page, char: s.char, section: s.section, fileId: c.file.id, file: c.file, sents: [] };
      c.passages.push(cur);
    }
    cur.text += (cur.text ? ' ' : '') + s.text;
    cur.sents.push(s);
  }
  for (const p of c.passages) { p.fold = fold(p.section.title + ' ' + p.text); p.len = p.fold.length; }
}

export const baseName = n => String(n || '').replace(/\.[a-z0-9]+$/i, '');

export async function corpora(files) {
  const out = [];
  for (const f of files) out.push(await corpusOf(f));
  return out;
}

// ===== Suche (BM25) =====
export function search(cs, terms, { limit = 6 } = {}) {
  const passages = cs.flatMap(c => c.passages);
  if (!passages.length || !terms.length) return [];
  const N = passages.length;
  const avg = passages.reduce((s, p) => s + p.len, 0) / N;
  const stats = terms.map(({ t, w }) => {
    const tf = passages.map(p => countTerm(p.fold, t));
    const df = tf.filter(Boolean).length;
    return { t, w, tf, idf: Math.log(1 + (N - df + 0.5) / (df + 0.5)) };
  });
  const scored = passages.map((p, i) => {
    let score = 0, hit = 0;
    for (const st of stats) {
      const tf = st.tf[i];
      if (!tf) continue;
      hit += st.w;
      score += st.w * st.idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * p.len / avg));
    }
    const total = terms.reduce((s, x) => s + x.w, 0);
    return { p, score: score * (0.5 + hit / total) };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => ({ ...x.p, score: x.score }));
}

// Satzgenaue Treffer innerhalb der besten Häppchen.
export function bestSentences(hits, terms, { limit = 4, bonus = () => 0 } = {}) {
  const out = [];
  for (const h of hits) {
    for (const s of h.sents) {
      let sc = 0;
      for (const { t, w } of terms) if (countTerm(s.fold, t)) sc += w;
      if (!sc && terms.length) continue;
      sc += bonus(s);
      if (s.text.length < 25) sc -= 0.6;
      if (s.text.length > 450) sc -= 0.5;
      if (/\?$/.test(s.text)) sc -= 0.4;
      if (sc > 0) out.push({ s, sc: sc + h.score * 0.15 });
    }
  }
  out.sort((a, b) => b.sc - a.sc);
  const seen = new Set();
  return out.filter(x => { const k = x.s.fold.slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit).map(x => x.s);
}

// Fundstelle für einen Link zur Stelle im Skript.
export function citeOf(s, file) {
  const short = file.name.length > 22 ? file.name.slice(0, 20) + '…' : file.name;
  return { fileId: file.id, page: s.page, char: s.char, q: shorten(s.text, 160).replace(/ …$/, ''), label: s.page ? `${short} · S. ${s.page}` : short };
}
