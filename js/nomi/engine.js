// Nomis Lern-Werkstatt: baut aus den Unterlagen Themen, Zusammenfassungen, Karteikarten, Übungsklausuren und Lernpläne.
// Ohne Internet und ohne Sprachmodell: Nomi sucht Definitionen, Schlüsselbegriffe und Kernsätze direkt im Text.
import { fold, stem, words, contentWords, STOP, countTerm, queryTerms, clean, cleanLines, shorten, search, corpora, baseName } from './text.js';
import { uid } from '../db.js';

export class NomiError extends Error {
  constructor(msg, code = 'nomi') { super(msg); this.code = code; }
}

// ===== Definitionen =====
const STARTERS = new Set(['im', 'in', 'es', 'das', 'dies', 'diese', 'dieser', 'dieses', 'hier', 'dann', 'damit', 'er', 'sie', 'wir', 'man', 'ich', 'du', 'auch', 'so', 'was', 'wer', 'wie', 'wo', 'wenn', 'aber', 'denn', 'daher', 'deshalb', 'jetzt', 'heute', 'oft', 'meist', 'manchmal', 'alle', 'jeder', 'jede', 'beide', 'viele', 'einige', 'nach', 'vor', 'bei', 'mit', 'ohne', 'seit', 'ab', 'zum', 'zur', 'am', 'beim', 'durch', 'fuer', 'ueber', 'unter', 'aus', 'von', 'vom', 'gegen', 'ein', 'eine', 'der', 'die', 'als', 'wichtig', 'ziel', 'folge', 'grund', 'beispiel', 'aufgabe', 'loesung', 'antwort', 'frage', 'hinweis', 'achtung', 'merke', 'tipp', 'quelle', 'abbildung', 'tabelle', 'seite', 'kapitel', 'teil', 'folie', 'inhalt', 'it', 'this', 'that', 'there']);
const BAD_DEF_START = /^(nicht|auch|sehr|so|noch|immer|nur|schon|wichtig|klar|gleich|möglich|notwendig|falsch|richtig|egal|bekannt|gut|schlecht|hier|da|dort|es|eben)\b/i;
const TERM = String.raw`[\p{Lu}\d][\p{L}\d\-/]*(?:\s+[\p{L}\d\-/()]+){0,3}?`;
const PATTERNS = [
  [1, /^Unter\s+(?:(?:einer?|einem|dem|der|den|die|das)\s+)?(.{2,50}?)\s+versteh(?:t|en) man\s+(.{10,})$/u],
  [2, /^Als\s+(.{2,50}?)\s+(?:bezeichnet|definiert|versteht|beschreibt) man\s+(.{10,})$/u],
  [0, new RegExp(String.raw`^(?:(?:Der|Die|Das|Ein|Eine)\s+)?(${TERM})\s+(?:ist|sind|bezeichnet|bezeichnen|beschreibt|beschreiben|meint|bedeutet|umfasst|definiert|heißt)\s+(.{12,})$`, 'u')],
  [3, /^(.{2,50}?)\s+(?:nennt man|heißt|wird als|werden als)\s+(.{10,})$/u],
];
const GLOSSARY = /^([^:;\t–—=]{2,48}?)\s*(?::|;|\t|\s[–—=-]\s)\s*(.{6,})$/u;
const NO_TERM = /^(seite|folie|beispiel|bsp|hinweis|merke|achtung|aufgabe|lösung|loesung|antwort|frage|ziel|tipp|wichtig|quelle|abb|abbildung|tabelle|definition|def|note|anmerkung|fazit|achtung|zusammenfassung|ergebnis|datum|name|thema|kapitel|teil|schritt|\d+)\b/i;

function goodTerm(term) {
  term = term.replace(/^[„"»(]+|[“"«),:]+$/g, '').trim();
  if (term.length < 2 || term.length > 50) return null;
  const ws = words(term);
  if (!ws.length || ws.length > 5 || STARTERS.has(ws[0]) || ws.every(w => STOP.has(w))) return null;
  if (NO_TERM.test(term) || /^\d/.test(term) && ws.length === 1) return null;
  return term;
}

export function definitionsOf(sents) {
  const out = [];
  for (const s of sents) {
    const t = s.text.replace(/\s+/g, ' ');
    if (t.length > 400 || /\?$/.test(t)) continue;
    let m = null, term = null, def = null, kind = 0;
    for (const [i, re] of PATTERNS) {
      m = re.exec(t);
      if (!m) continue;
      if (i === 3) {
        // „X nennt man Y“: Begriff steht hinten. „Y wird als X bezeichnet“ ebenso.
        const tail = /^(?:auch\s+)?[„"»]?([\p{L}\d\- ]{2,40}?)[“"«]?(?:\s+bezeichnet|\s+definiert)?\.?$/u.exec(m[2]);
        if (!tail) { m = null; continue; }
        term = goodTerm(tail[1]); def = t;
      } else {
        term = goodTerm(m[1]); def = t;
        if (i === 0 && BAD_DEF_START.test(m[2])) term = null;
      }
      if (term) { kind = i; break; }
    }
    if (!term && (s.bullet || s.text.length < 260)) {
      const g = GLOSSARY.exec(t);
      if (g && !/https?:/.test(g[1])) { term = goodTerm(g[1]); def = g[2]; kind = 4; }
    }
    if (!term || !def) continue;
    const back = kind === 4 ? def.charAt(0).toUpperCase() + def.slice(1) : def;
    let score = kind === 1 || kind === 2 ? 3 : kind === 4 ? 2.2 : 2;
    if (kind === 0 && /\b(ist|sind)\s+(ein|eine|der|die|das|jene|alle|diejenige)/i.test(t)) score += 1;
    if (words(term).length > 3) score -= 0.8;
    out.push({ term, def: back.trim(), s, score, kind });
  }
  // Pro Begriff nur die beste Erklärung.
  const best = new Map();
  for (const d of out) {
    const k = stem(fold(d.term));
    if (!best.has(k) || best.get(k).score < d.score) best.set(k, d);
  }
  return [...best.values()];
}

// ===== Schlüsselbegriffe =====
export function keywordsOf(sents, allPassages, limit = 30) {
  const tf = new Map(), forms = new Map();
  for (const s of sents) {
    const toks = s.text.match(/[\p{L}][\p{L}\d\-]{3,}/gu) || [];
    toks.forEach((w, i) => {
      const f = fold(w);
      if (STOP.has(f) || f.length < 4) return;
      const cap = /^\p{Lu}/u.test(w);
      if (!cap && i === 0) return;
      const k = stem(f);
      tf.set(k, (tf.get(k) || 0) + (cap && i > 0 ? 1.4 : cap ? 0.8 : 0.5));
      const fm = forms.get(k) || new Map();
      fm.set(w, (fm.get(w) || 0) + 1);
      forms.set(k, fm);
    });
  }
  for (const sec of new Set(sents.map(s => s.section))) {
    for (const w of contentWords(sec.title || '')) { const k = stem(w); if (tf.has(k)) tf.set(k, tf.get(k) + 2); }
  }
  const N = Math.max(1, allPassages.length);
  const scored = [...tf.entries()].filter(([, v]) => v >= 1.4).map(([k, v]) => {
    const df = allPassages.filter(p => p.fold.includes(k)).length || 1;
    return { k, score: v * Math.log(1 + N / df), word: [...forms.get(k).entries()].sort((a, b) => b[1] - a[1])[0][0] };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ===== Wichtige Sätze =====
const MERK = /\b(merke|wichtig|beachte|gilt|grundsätzlich|regel|entscheidend|zentral|kernaussage|faustregel|zusammengefasst|immer dann)\b/i;
function rankSentences(sents, kws, defSet) {
  const w = new Map(kws.map((k, i) => [k.k, 1 + (kws.length - i) / kws.length]));
  return sents.map(s => {
    const toks = contentWords(s.text).map(stem);
    let sc = 0;
    for (const t of new Set(toks)) sc += w.get(t) || 0;
    sc /= Math.sqrt(Math.max(4, toks.length));
    if (defSet.has(s)) sc += 1.2;
    if (MERK.test(s.text)) sc += 0.6;
    if (s.section.sents[0] === s) sc += 0.3;
    if (s.text.length < 35) sc -= 0.8;
    if (s.text.length > 380) sc -= 0.5;
    if (/\?$/.test(s.text)) sc -= 0.6;
    if ((s.text.match(/\d/g) || []).length > s.text.length / 4) sc -= 0.6;
    if (!/\p{Ll}{3}/u.test(s.text)) sc -= 1;
    return { s, sc };
  });
}

// ===== Auswahl (Dateien + Themen) =====
async function material(files, focus = []) {
  const cs = await corpora(files);
  const readable = cs.filter(c => c.readable && c.sents.length);
  if (!readable.length) {
    const imgs = files.every(f => f.kind === 'image');
    throw new NomiError(imgs
      ? 'Fotos kann Nomi noch nicht lesen. Lade das Skript bitte als PDF, Word- oder Textdatei hoch.'
      : 'In diesen Dateien hat Nomi keinen lesbaren Text gefunden. Eingescannte PDFs (nur Bilder) kann Nomi noch nicht lesen.');
  }
  const allPassages = readable.flatMap(c => c.passages);
  let sections = readable.flatMap(c => c.sections.filter(s => s.sents.length));
  let sents = readable.flatMap(c => c.sents);
  const f = focus.map(x => x.trim()).filter(Boolean);
  if (f.length) {
    const ff = f.map(fold);
    const pick = new Set();
    // Abschnitte, deren Überschrift zum Thema passt, kommen komplett rein.
    for (const sec of sections) {
      const t = fold(sec.title);
      if (ff.some(x => t.includes(x) || (x.length > 5 && x.includes(t) && t.length > 4))) {
        sec.sents.forEach(s => pick.add(s));
        // Unterkapitel (2.1, 2.2 … zu Kapitel 2) gehören dazu.
        if (sec.num) sections.filter(x => x.fileId === sec.fileId && x.num?.startsWith(sec.num + '.')).forEach(x => x.sents.forEach(s => pick.add(s)));
      }
    }
    // Dazu die besten Suchtreffer.
    const terms = f.flatMap(x => queryTerms(x));
    for (const h of search(readable, terms, { limit: 14 })) h.sents.forEach(s => pick.add(s));
    if (pick.size < 2) throw new NomiError(`Zum Thema „${f.join(', ')}“ hat Nomi in den Unterlagen nichts gefunden. Probier ein anderes Stichwort oder wähle „Alles“.`);
    sents = sents.filter(s => pick.has(s));
    sections = sections.filter(sec => sec.sents.some(s => pick.has(s)));
  }
  const defs = definitionsOf(sents);
  const kws = keywordsOf(sents, allPassages);
  const ranked = rankSentences(sents, kws, new Set(defs.map(d => d.s)));
  const rank = new Map(ranked.map(r => [r.s, r.sc]));
  const fileById = Object.fromEntries(files.map(x => [x.id, x]));
  return { cs: readable, sents, sections, defs, kws, rank, allPassages, fileById, focus: f };
}

const where = (m, s) => {
  const f = m.fileById[s.fileId];
  return s.page ? `${baseName(f?.name)}, S. ${s.page}` : baseName(f?.name);
};
const pageTag = s => (s.page ? ` *(S. ${s.page})*` : '');

// Abschnitte zusammenfassen, die gleich heißen (z. B. Folien mit derselben Überschrift).
function groupSections(m, maxGroups) {
  const groups = [];
  for (const sec of m.sections) {
    const sents = sec.sents.filter(s => m.rank.has(s));
    if (!sents.length) continue;
    const last = groups[groups.length - 1];
    if (last && fold(last.title) === fold(sec.title)) last.sents.push(...sents);
    else groups.push({ title: sec.title, sents: [...sents], level: sec.level });
  }
  if (groups.length <= maxGroups) return groups;
  // Zu viele: kleine Abschnitte an den vorherigen anhängen, bis es passt.
  const weight = g => g.sents.reduce((s, x) => s + Math.max(0, m.rank.get(x)), 0);
  while (groups.length > maxGroups) {
    let mi = 1, mw = Infinity;
    for (let i = 1; i < groups.length; i++) { const w = weight(groups[i]) + weight(groups[i - 1]) * 0.3; if (w < mw) { mw = w; mi = i; } }
    groups[mi - 1].sents.push(...groups[mi].sents);
    groups.splice(mi, 1);
  }
  return groups;
}

function topSents(m, list, n) {
  return [...list].sort((a, b) => m.rank.get(b) - m.rank.get(a)).slice(0, n).filter(s => m.rank.get(s) > 0.15).sort((a, b) => a.i - b.i || 0);
}

function boldTerms(text, terms) {
  let done = 0;
  for (const t of terms) {
    if (done >= 2) break;
    const re = new RegExp(`(^|[^\\p{L}])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^\\p{L}]|$)`, 'u');
    if (re.test(text) && !text.includes('**' + t)) { text = text.replace(re, '$1**$2**'); done++; }
  }
  return text;
}

// ===== Themen =====
export async function topics(files) {
  const cs = (await corpora(files)).filter(c => c.readable);
  const secs = cs.flatMap(c => c.sections.filter(s => s.title && s.sents.length >= 1 && !/, S\. \d+$/.test(s.title) && s.title !== baseName(c.file.name)));
  let out = [];
  for (const lvl of [1, 2, 3]) {
    const pick = secs.filter(s => (s.level || 2) <= lvl);
    const uniq = [];
    for (const s of pick) if (!uniq.some(u => fold(u.title) === fold(s.title))) uniq.push(s);
    out = uniq;
    if (uniq.length >= 4) break;
  }
  if (out.length > 12) {
    const size = s => s.sents.length;
    const keep = new Set([...out].sort((a, b) => size(b) - size(a)).slice(0, 12));
    out = out.filter(s => keep.has(s));
  }
  if (out.length >= 3) {
    return { topics: out.map(s => ({ title: shorten(s.title, 50), description: shorten(s.sents.find(x => x.text.length > 40)?.text || s.sents[0]?.text || '', 120) })) };
  }
  // Keine Überschriften: die wichtigsten Begriffe werden zu Themen.
  const sents = cs.flatMap(c => c.sents);
  const kws = keywordsOf(sents, cs.flatMap(c => c.passages), 8);
  return { topics: kws.map(k => ({ title: k.word, description: shorten(sents.find(s => s.fold.includes(k.k) && s.text.length > 40)?.text || `Alles rund um ${k.word}`, 120) })) };
}

// ===== Zusammenfassung =====
export async function summary(files, { focus = [], length = 'kompakt', name = '' } = {}) {
  const m = await material(files, focus);
  const name2 = (m.focus.length ? m.focus.join(', ') : name || (files.length === 1 ? baseName(files[0].name) : 'deine Unterlagen'));
  const md = [`# Zusammenfassung: ${clean(name2)}`, ''];
  const kwWords = m.kws.slice(0, 20).map(k => k.word);
  const defBySent = new Map(m.defs.map(d => [d.s, d]));

  if (length === 'spickzettel') {
    const defs = [...m.defs].sort((a, b) => b.score - a.score).slice(0, 30).sort((a, b) => a.s.i - b.s.i);
    if (defs.length) {
      md.push('## Begriffe', '', '| Begriff | Bedeutung |', '|---|---|');
      for (const d of defs) md.push(`| **${clean(d.term).replace(/\|/g, '/')}** | ${clean(shorten(d.def, 180)).replace(/\|/g, '/')} |`);
      md.push('');
    }
    const formulas = m.sents.filter(s => /[=≈≤≥]/.test(s.text) && s.text.length < 140 && /\p{L}/u.test(s.text)).slice(0, 12);
    if (formulas.length) { md.push('## Formeln', ''); formulas.forEach(s => md.push(`- ${clean(s.text)}`)); md.push(''); }
    md.push('## Kernaussagen', '');
    for (const g of groupSections(m, 12)) {
      const best = topSents(m, g.sents.filter(s => !defBySent.has(s)), 1)[0];
      if (best) md.push(`- **${clean(shorten(g.title, 50))}:** ${clean(shorten(best.text, 200))}`);
    }
    md.push('');
  } else {
    const long = length === 'ausfuehrlich';
    const groups = groupSections(m, long ? 20 : 10);
    for (const g of groups) {
      const n = long ? Math.min(8, Math.max(3, Math.round(g.sents.length / 3))) : Math.min(4, Math.max(2, Math.round(g.sents.length / 5)));
      const best = topSents(m, g.sents, n);
      if (!best.length) continue;
      md.push(`## ${clean(shorten(g.title, 70))}`, '');
      let tip = null;
      for (const s of best) {
        const d = defBySent.get(s);
        if (!tip && MERK.test(s.text) && !d) { tip = s; continue; }
        const text = d?.kind === 4 ? `**${clean(d.term)}:** ${clean(shorten(d.def, long ? 400 : 260))}`
          : d ? boldTerms(clean(shorten(d.def, long ? 400 : 260)), [d.term, ...kwWords])
          : boldTerms(clean(shorten(s.text, long ? 400 : 260)), kwWords);
        md.push(`- ${text}${pageTag(s)}`);
      }
      if (tip) md.push('', `> 💡 ${clean(shorten(tip.text, 260))}`);
      md.push('');
    }
  }
  // Checkpunkte zum Schluss.
  const checks = [...m.defs].sort((a, b) => b.score - a.score).slice(0, 5).map(d => `„${clean(d.term)}“ in eigenen Worten erklären`);
  for (const k of m.kws) {
    if (checks.length >= 7) break;
    if (!checks.some(c => fold(c).includes(k.k))) checks.push(`Wissen, was es mit „${clean(k.word)}“ auf sich hat`);
  }
  if (checks.length) md.push('## Das solltest du sicher können', '', ...checks.map(c => `- ${c}`), '');
  md.push('*Von Nomi direkt aus deinen Unterlagen zusammengestellt. Die Seitenzahlen zeigen, wo du mehr dazu findest.*');
  return md.join('\n');
}

// ===== Karteikarten =====
// Vorhandene Karteikarten (z. B. „Begriff; Erklärung“ oder „Frage: … Antwort: …“) direkt übernehmen.
function parseCardFile(c) {
  const out = [];
  const text = c.file.text || c.paras.map(p => p.text).join('\n');
  const qa = [...text.matchAll(/(?:^|\n)\s*(?:F|Frage|Q)\s*[:.]\s*([\s\S]+?)\n\s*(?:A|Antwort)\s*[:.]\s*([\s\S]+?)(?=\n\s*(?:F|Frage|Q)\s*[:.]|$)/gi)];
  for (const m of qa) out.push({ front: m[1].trim(), back: m[2].trim() });
  if (!out.length) {
    for (const line of text.split('\n')) {
      const m = /^\s*([^;\t]{2,200})[;\t]\s*([^;\t]{1,600})\s*$/.exec(line);
      if (m) out.push({ front: m[1].trim(), back: m[2].trim() });
    }
  }
  return out.slice(0, 400);
}

const BLANK = '＿＿＿＿';
const CAUSE = /^(.{15,}?),\s*(?:weil|da|denn|sodass|so dass|wodurch|damit)\s+(.{8,})$/u;
const LEADS = /^(.{8,}?)\s+(?:führt|führen|bewirkt|bewirken|verursacht|verursachen|sorgt|sorgen)\s+(?:zu|dafür|für)?\s*(.{6,})$/u;

function clozeOf(s, kws, avoid) {
  for (const k of kws) {
    if (avoid.has(k.k)) continue;
    const re = new RegExp(`(^|[^\\p{L}])(${k.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}{0,3})(?=[^\\p{L}]|$)`, 'u');
    const mm = re.exec(s.text);
    if (!mm || mm.index < 2 && s.text.length < 50) continue;
    return { k, word: mm[2], text: s.text.replace(re, '$1' + BLANK) };
  }
  return null;
}

export async function cards(files, { focus = [], count = 20, style = 'gemischt', name = '' } = {}) {
  count = Number(count) || 20;
  const m = await material(files, focus);
  const out = [];
  const used = new Set();
  const add = (front, back, s, key) => {
    const k = key || fold(front).slice(0, 60);
    if (used.has(k) || out.length >= count) return;
    used.add(k);
    out.push({ front: clean(shorten(front, 200)), back: cleanLines(shorten(back, 420)).replace(/∗∗/g, '**'), topic: clean(shorten(s?.section?.title || '', 50)) });
  };
  // 1. Karten aus vorhandenen Karteikarten-Dateien.
  for (const c of m.cs.filter(c => c.file.category === 'Karteikarten')) {
    for (const x of parseCardFile(c)) if (!m.focus.length || m.focus.some(f => fold(x.front + ' ' + x.back).includes(fold(f)))) add(x.front, x.back, c.sents[0]);
  }
  const defs = [...m.defs].sort((a, b) => b.score - a.score);
  const ranked = [...m.sents].sort((a, b) => m.rank.get(b) - m.rank.get(a)).filter(s => m.rank.get(s) > 0.3 && s.text.length >= 40 && s.text.length <= 320);
  const defCards = () => defs.forEach(d => add(style === 'begriffe' ? d.term : `Was versteht man unter „${d.term}“?`, d.def, d.s, 'd:' + stem(fold(d.term))));
  const whyCards = () => {
    for (const s of ranked) {
      const a = CAUSE.exec(s.text);
      if (a && /^(sie|er|es|dies|das|diese|dieser|dadurch|deshalb|daher)\b/i.test(a[1])) continue;
      if (a) { add(`Warum gilt: „${a[1].replace(/^\p{Ll}/u, x => x.toUpperCase())}“?`, s.text, s); continue; }
      const b = LEADS.exec(s.text);
      if (b && words(b[1]).length <= 8) add(`Was bewirkt ${b[1].replace(/^(Die|Der|Das|Ein|Eine)\s/, x => x.toLowerCase())}?`, s.text, s);
    }
  };
  const clozeCards = () => {
    const per = new Map();
    for (const s of ranked) {
      const c = clozeOf(s, m.kws.slice(0, 25), new Set());
      if (!c) continue;
      const n = per.get(c.k.k) || 0;
      if (n >= 2) continue;
      per.set(c.k.k, n + 1);
      add(`Ergänze: ${c.text}`, `**${c.word}**\n\n${s.text}`, s);
    }
  };
  const sectionCards = () => {
    for (const g of groupSections(m, 20)) {
      const best = topSents(m, g.sents, 3);
      if (best.length >= 2 && !/, S\. \d+$/.test(g.title)) add(`Was sind die wichtigsten Punkte zu „${g.title}“?`, best.map(s => '- ' + shorten(s.text, 140)).join('\n'), best[0]);
    }
  };
  if (style === 'begriffe') { defCards(); clozeCards(); }
  else if (style === 'verstaendnis') { whyCards(); sectionCards(); clozeCards(); defCards(); }
  else {
    // Gemischt: abwechselnd Begriffe, Lückentexte und Warum-Fragen.
    const want = count;
    count = Math.ceil(want * 0.5); defCards();
    count = Math.ceil(want * 0.75); whyCards();
    count = want; clozeCards(); sectionCards(); defCards();
  }
  if (out.length < 3) throw new NomiError('Aus diesen Unterlagen konnte Nomi kaum Karteikarten bauen. Klappt am besten mit Skripten, in denen Begriffe erklärt werden.');
  const title = m.focus.length ? m.focus.join(', ') : name || (files.length === 1 ? baseName(files[0].name) : 'Alle Unterlagen');
  return { title: `Karteikarten: ${shorten(title, 60)}`, cards: out };
}

// ===== Übungsklausur =====
function pickOthers(list, n, near) {
  const others = list.filter(x => x !== near.item);
  // Ablenker bevorzugt aus demselben Abschnitt (schwerer) oder zufällig (leichter).
  others.sort((a, b) => (near.hard ? (b.s?.section === near.item.s?.section) - (a.s?.section === near.item.s?.section) : 0) || Math.random() - 0.5);
  return others.slice(0, n);
}
const mask = (text, term) => text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{L}{0,3}', 'giu'), '…');
function shuffled(arr) { return arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]); }
function mc(question, right, wrong, extra) {
  const opts = shuffled([right, ...wrong]);
  return { type: 'mc', question, options: opts, correct_index: opts.indexOf(right), points: 1, ...extra };
}

// Fragen aus echten Übungsklausuren in den Unterlagen.
function examQuestions(m) {
  const out = [];
  for (const c of m.cs.filter(c => c.file.category === 'Übungsklausur')) {
    for (const p of c.paras) {
      const t = p.text.replace(/^(Aufgabe|Frage)\s*\d+[a-z]?[.):]?\s*/i, '').trim();
      if (t.length >= 25 && t.length <= 400 && (/\?$/.test(t) || /^(Erkläre|Erläutere|Beschreibe|Nenne|Begründe|Berechne|Vergleiche|Definiere|Skizziere|Bestimme|Diskutiere|Stelle)/.test(t))) out.push({ text: t, p });
    }
  }
  return out;
}

export async function exam(files, { focus = [], count = 10, kind = 'gemischt', difficulty = 'mittel', name = '' } = {}) {
  count = Number(count) || 10;
  const m = await material(files, focus);
  const hard = difficulty === 'schwer';
  const defs = shuffled(m.defs.filter(d => d.def.length >= 20)).sort((a, b) => b.score - a.score);
  const mcs = [], opens = [];
  const src = s => `Nachzulesen in ${where(m, s)}.`;

  // Multiple Choice aus Definitionen.
  defs.forEach((d, i) => {
    if (defs.length < 4) return;
    const others = pickOthers(defs, 3, { item: d, hard });
    if (i % 2 === 0) {
      // Den Begriff in den Antworten verstecken, sonst verrät er die Lösung.
      const opt = o => clean(shorten(mask(o.def, o.term), 170));
      mcs.push(mc(`Was versteht man unter „${clean(d.term)}“?`, opt(d), others.map(opt),
        { topic: d.s.section.title, model_answer: clean(d.def), explanation: src(d.s) }));
    } else {
      const masked = mask(d.def, d.term);
      if (masked === d.def && d.def.toLowerCase().includes(d.term.toLowerCase())) return;
      mcs.push(mc(`Welcher Begriff ist gemeint? „${clean(shorten(masked, 220))}“`, clean(d.term), others.map(o => clean(o.term)),
        { topic: d.s.section.title, model_answer: `${clean(d.term)}: ${clean(d.def)}`, explanation: src(d.s) }));
    }
  });
  // Multiple Choice als Lückentext.
  const ranked = [...m.sents].sort((a, b) => m.rank.get(b) - m.rank.get(a)).filter(s => m.rank.get(s) > 0.4 && s.text.length >= 50 && s.text.length <= 300);
  const kwList = m.kws.slice(0, 30);
  const usedK = new Set();
  for (const s of ranked) {
    if (kwList.length < 4) break;
    const c = clozeOf(s, kwList, usedK);
    if (!c) continue;
    usedK.add(c.k.k);
    const wrong = shuffled(kwList.filter(k => k.k !== c.k.k && !s.fold.includes(k.k))).slice(0, 3).map(k => k.word);
    if (wrong.length < 3) continue;
    mcs.push(mc(`Welches Wort gehört in die Lücke? „${clean(c.text)}“`, c.k.word, wrong, { topic: s.section.title, model_answer: clean(s.text), explanation: src(s) }));
  }
  // Offene Fragen.
  for (const q of examQuestions(m)) {
    const hits = search(m.cs.filter(c => c.file.category !== 'Übungsklausur'), queryTerms(q.text), { limit: 2 });
    const ans = hits.flatMap(h => h.sents).filter(s => s.text.length > 30).slice(0, 3);
    if (ans.length) opens.push({ type: 'open', question: clean(q.text), options: [], correct_index: -1, points: 4, topic: ans[0].section.title, model_answer: ans.map(s => clean(s.text)).join(' '), explanation: `Diese Frage stammt aus deiner Übungsklausur. ${src(ans[0])}` });
  }
  defs.slice(0, 12).forEach(d => opens.push({ type: 'open', question: `Erkläre den Begriff „${clean(d.term)}“.`, options: [], correct_index: -1, points: hard ? 3 : 2, topic: d.s.section.title, model_answer: clean(d.def), explanation: src(d.s) }));
  for (const s of ranked) {
    const a = CAUSE.exec(s.text);
    if (a && !/^(sie|er|es|dies|das|diese|dieser|dadurch|deshalb|daher)\b/i.test(a[1])) opens.push({ type: 'open', question: `Begründe: Warum gilt „${clean(a[1])}“?`, options: [], correct_index: -1, points: hard ? 4 : 3, topic: s.section.title, model_answer: clean(s.text), explanation: src(s) });
  }
  for (const g of groupSections(m, 12)) {
    const best = topSents(m, g.sents, 3);
    if (best.length >= 2 && !/, S\. \d+$/.test(g.title)) opens.push({ type: 'open', question: `Beschreibe die wichtigsten Aspekte von „${clean(g.title)}“.`, options: [], correct_index: -1, points: hard ? 6 : 4, topic: g.title, model_answer: best.map(s => clean(s.text)).join(' '), explanation: src(best[0]) });
  }

  const share = kind === 'mc' ? 1 : kind === 'offen' ? 0 : difficulty === 'leicht' ? 0.75 : hard ? 0.45 : 0.6;
  let nMc = Math.min(mcs.length, Math.round(count * share));
  let nOpen = Math.min(opens.length, count - nMc);
  if (kind !== 'offen' && nMc + nOpen < count) nMc = Math.min(mcs.length, count - nOpen);
  if (kind !== 'mc' && nMc + nOpen < count) nOpen = Math.min(opens.length, count - nMc);
  // Fragen aus echten Übungsklausuren zuerst, sonst bunt gemischt.
  const pickedOpen = [...opens.filter(o => o.explanation.startsWith('Diese Frage')), ...shuffled(opens.filter(o => !o.explanation.startsWith('Diese Frage')))].slice(0, nOpen);
  const questions = shuffled([...shuffled(mcs).slice(0, nMc), ...pickedOpen]).map(q => ({ ...q, topic: clean(shorten(q.topic || '', 50)), question: q.question }));
  if (questions.length < 3) throw new NomiError('Aus diesen Unterlagen konnte Nomi nicht genug Aufgaben bauen. Klappt am besten mit Skripten, in denen Begriffe erklärt werden.');
  const pts = questions.reduce((s, q) => s + q.points, 0);
  const title = m.focus.length ? m.focus.join(', ') : name || (files.length === 1 ? baseName(files[0].name) : 'Alle Unterlagen');
  return { title: `Übungsklausur: ${shorten(title, 60)}`, duration_minutes: Math.max(5, Math.round(pts * 1.6 / 5) * 5), questions };
}

// ===== Korrektur offener Antworten =====
export function grade(items) {
  const results = items.map(it => {
    const answer = String(it.answer || '').trim();
    if (!answer) return { index: it.index, points_awarded: 0, feedback: 'Keine Antwort abgegeben.' };
    const key = [...new Set(contentWords(it.model_answer).map(stem))].filter(t => t.length >= 4);
    const af = fold(answer);
    const have = key.filter(t => countTerm(af, t.slice(0, Math.max(4, t.length - 1))));
    const miss = key.filter(t => !have.includes(t));
    const cover = key.length ? have.length / key.length : 0;
    const ratio = Math.min(1, cover * 1.6 + (answer.length > 40 ? 0.1 : 0));
    const pts = Math.round(ratio * it.points);
    const nice = ts => ts.slice(0, 4).map(t => (it.model_answer.match(new RegExp(`[\\p{L}]*${t.slice(0, 4)}[\\p{L}]*`, 'iu')) || [t])[0]).filter((v, i, a) => a.indexOf(v) === i);
    const fb = ratio >= 0.85 ? 'Sehr gut, die wichtigsten Punkte sind drin.'
      : ratio >= 0.4 ? `Teilweise richtig. ${miss.length ? `Es fehlen noch Punkte wie: ${nice(miss).join(', ')}.` : ''}`
      : `Da fehlt noch einiges. Wichtig wären zum Beispiel: ${nice(miss.length ? miss : key).join(', ')}.`;
    return { index: it.index, points_awarded: pts, feedback: fb.trim() };
  });
  const got = results.reduce((s, r) => s + r.points_awarded, 0);
  const max = items.reduce((s, it) => s + it.points, 0) || 1;
  const pct = got / max;
  return {
    results,
    overall_feedback: (pct >= 0.8 ? 'Stark! Die offenen Fragen sitzen gut.' : pct >= 0.5 ? 'Solide Grundlage. Lies bei den Fragen mit Abzug die Musterlösung nach.' : 'Bei den offenen Fragen fehlt noch einiges. Wiederhole die Themen mit den Karteikarten und schreib die Klausur dann nochmal.')
      + ' Nomi vergleicht deine Antwort mit den Schlüsselbegriffen der Musterlösung: Schau bei Abzügen selbst nach, ob du es nur anders formuliert hast.',
  };
}

// ===== Lernplan =====
const PER_DAY = { '30 Minuten': 30, '1 Stunde': 60, '2 Stunden': 120, '3 Stunden oder mehr': 180 };
export async function plan(files, { focus = [], examDate = '', perDay = '1 Stunde', goal = '', name = '' } = {}) {
  let tps = (await topics(files)).topics.map(t => t.title);
  if (focus.length) {
    const ff = focus.map(fold);
    const hit = tps.filter(t => ff.some(f => fold(t).includes(f) || f.includes(fold(t))));
    tps = hit.length ? hit : focus;
  }
  if (!tps.length) tps = ['Gesamter Stoff'];
  // Höchstens 6 Lernblöcke, damit der Plan übersichtlich bleibt.
  const blocks = [];
  const per = Math.ceil(tps.length / 6);
  for (let i = 0; i < tps.length; i += per) blocks.push(tps.slice(i, i + per));
  const mins = PER_DAY[perDay] || 60;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exam = examDate ? new Date(examDate + 'T00:00') : null;
  const days = exam && exam > today ? Math.max(1, Math.round((exam - today) / 864e5)) : 14;
  const steps = [];
  blocks.forEach((b, i) => {
    const topic = b.join(', ');
    steps.push({ title: `${shorten(topic, 60)} verstehen`, description: `Lies die Zusammenfassung zu ${shorten(topic, 80)} und markiere, was dir unklar ist. Frag Nomi, wenn etwas hakt.`, activity: 'summary', topic, minutes: Math.min(mins, 40) });
    steps.push({ title: `${shorten(topic, 60)} einprägen`, description: 'Übe die Karteikarten, bis die meisten sicher sitzen.', activity: 'cards', topic, minutes: Math.min(mins, 30) });
    if (i % 2 === 1 || i === blocks.length - 1) steps.push({ title: 'Wiederholen', description: `Geh die unsicheren Karteikarten der letzten Themen nochmal durch: ${shorten(blocks.slice(Math.max(0, i - 1), i + 1).flat().join(', '), 90)}.`, activity: 'review', topic, minutes: Math.min(mins, 20) });
  });
  steps.push({ title: 'Probeklausur schreiben', description: 'Schreib eine Übungsklausur zum gesamten Stoff, am besten mit Zeitlimit.', activity: 'exam', topic: focus.join(', ') || '', minutes: Math.min(Math.max(mins, 30), 90) });
  steps.push({ title: 'Fehler nacharbeiten', description: 'Erstelle aus der Auswertung Karteikarten zu deinen Fehlern und übe sie.', activity: 'review', topic: '', minutes: Math.min(mins, 30) });
  if (days >= 5) steps.push({ title: 'Generalprobe', description: 'Schreib noch eine Übungsklausur und schau, ob du dich verbessert hast.', activity: 'exam', topic: focus.join(', ') || '', minutes: Math.min(Math.max(mins, 30), 90) });
  const fmt = d => d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  const span = exam ? Math.max(1, days - 1) : days;
  steps.forEach((s, i) => {
    const d = Math.min(span - 1, Math.floor(i * span / steps.length));
    s.day = exam ? fmt(new Date(today.getTime() + d * 864e5)) : `Tag ${d + 1}`;
  });
  const title = focus.length ? focus.join(', ') : name || (files.length === 1 ? baseName(files[0].name) : 'deine Prüfung');
  return {
    title: `Lernplan: ${shorten(title, 60)}`,
    overview: `${blocks.length} Lernblöcke in ${days} ${days === 1 ? 'Tag' : 'Tagen'}, mit etwa ${mins >= 180 ? '3 Stunden' : perDay} pro Tag: erst verstehen, dann mit Karteikarten einprägen, zum Schluss mit Übungsklausuren prüfen.${goal ? ` Dein Ziel: ${goal}.` : ''}`,
    steps,
  };
}

export const newId = uid;
