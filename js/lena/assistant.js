// Lena beantwortet Fragen zu den Unterlagen: sucht passende Stellen und antwortet mit Links zur Fundstelle.
// Mit Denk-Modus formuliert ein kleines Sprachmodell die Antwort, sonst stellt Lena die passenden Sätze zusammen.
import { corpora, queryTerms, search, bestSentences, citeOf, fold, stem, shorten, clean, baseName, contentWords, withContext, emphasize, coverage } from './text.js';
import { definitionsOf, keywordsOf, grade } from './engine.js';
import * as LLM from './llm.js';
import { tipFor } from './tips.js';

export const NAME = 'Lena';

const RX = {
  greet: /^(hallo|hi|hey|moin|servus|huhu|guten (morgen|tag|abend)|na)\b[\s!.,]*\S{0,20}[\s!.]*$/i,
  thanks: /^(danke|dankeschön|vielen dank|super|cool|perfekt|ok|okay|alles klar)\b[\s!.,]*$/i,
  help: /(was kannst du|wer bist du|wie funktionierst du|hilfe|was machst du)/i,
  where: /\b(wo (steht|finde|kommt|wird|ist|sind)|auf welcher seite|in welcher datei|welche seite|wo im skript)/i,
  quiz: /(übungsfrage|uebungsfrage|frag mich|abfragen|quiz|teste mich|prüf mich|pruef mich|stell mir (eine )?frage|abhören)/i,
  sum: /(zusammenfass|fass\b.*\bzusammen|überblick|ueberblick|worum geht|kurzfassung)/i,
  important: /(wichtig|prüfungsrelevant|klausurrelevant|was muss ich (können|wissen|lernen)|schwerpunkt|worauf .* achten)/i,
  example: /beispiel/i,
  mnemonic: /(eselsbrücke|eselsbruecke|merksatz|merkhilfe|wie (merke|merk) ich mir)/i,
  tip: /(wie (lerne|lern|sollte|soll|kann) ich|tipps?|pomodoro|pause|motivation|keine lust|prokrastin|aufschieb|prüfungsangst|nervös|aufgeregt|blackout|stress|konzentr|ablenkung|vergess|gedächtnis|auswendig|schlaf|lerngruppe|zusammen lernen|zeitmanagement)/i,
  define: /^(was (ist|sind|bedeutet|bedeuten|heißt|heisst|meint man mit|versteht man unter)|wer (ist|war)|definier|erklär(e)?( mir)?( bitte)?( den begriff| kurz| was)?|was genau (ist|sind))\s+/i,
};

function termOf(q) {
  return q.replace(RX.define, '').replace(/[?!.]+$/, '').replace(/^(der|die|das|ein|eine|einen|den|dem)\s+/i, '').replace(/\s+(genau|eigentlich|nochmal|einfach|bitte)$/i, '').trim();
}

const P = (text, cites = []) => ({ text, cites });

async function loadCorpus(files) {
  const cs = await corpora(files);
  return cs.filter(c => c.readable && c.sents.length);
}

// Frage + Kontext + (bei kurzen Nachfragen) die vorige Frage.
function termsFor(q, { history, detail }) {
  let terms = queryTerms(q);
  if (!terms.length) {
    const prev = [...history].reverse().find(h => h.role === 'user' && h.display !== q);
    if (prev) terms = [...terms, ...queryTerms(prev.display || prev.content, 0.6).filter(t => !terms.some(x => x.t === t.t))];
  }
  if (detail) terms = [...terms, ...queryTerms(detail, 0.35).filter(t => !terms.some(x => x.t === t.t))];
  return terms;
}

function fileOf(cs, id) { return cs.find(c => c.file.id === id)?.file; }

// ===== Antworten ohne Sprachmodell =====
function answerWhere(cs, terms) {
  // Nur Stellen, die wirklich passen (nicht alles, wo ein Wort zufällig vorkommt).
  const all = search(cs, terms, { limit: 5 });
  const hits = all.filter(h => h.score >= all[0]?.score * 0.4);
  if (!hits.length) return null;
  const parts = [P('Das habe ich in deinen Unterlagen gefunden:')];
  for (const h of hits) {
    const s = bestSentences([h], terms, { limit: 1 })[0] || h.sents[0];
    const f = h.file;
    parts.push(P(`\n- **${clean(baseName(f.name))}${s.page ? `, Seite ${s.page}` : ''}** (${clean(shorten(h.section.title, 50))}): „${emphasize(clean(shorten(s.text, 160)), terms)}“ `, [citeOf(s, f)]));
  }
  parts.push(P('\n\nTipp auf einen Link, dann springe ich direkt zur Stelle.'));
  return parts;
}

function answerDefine(cs, term, terms) {
  const tt = queryTerms(term);
  if (!tt.length) return null;
  const hits = search(cs, tt, { limit: 10 });
  if (!hits.length) return null;
  const sents = hits.flatMap(h => h.sents);
  const key = stem(fold(term));
  const defs = definitionsOf(sents).filter(d => { const k = stem(fold(d.term)); return k === key || k.includes(key) || key.includes(k); });
  defs.sort((a, b) => b.score - a.score);
  const parts = [];
  const used = new Set();
  if (defs[0]) {
    const d = defs[0];
    // Mit dem Satz davor oder danach, wenn er dazugehört (z. B. „Dabei …“).
    const full = d.kind === 4 ? (used.add(d.s), d.def) : withContext(d.s, 520, used);
    parts.push(P(`**${clean(d.term)}:** ${clean(full)} `, [citeOf(d.s, fileOf(cs, d.s.fileId))]));
  }
  const more = bestSentences(hits, tt, { limit: defs[0] ? 2 : 3, bonus: s => (/\b(ist|sind|bezeichnet|bedeutet|versteht man)\b/.test(s.text) ? 0.5 : 0) }).filter(s => !used.has(s));
  if (!more.length && !parts.length) return null;
  if (more.length) parts.push(P(parts.length ? '\n\nAußerdem steht dazu in deinen Unterlagen:' : `Das steht zu „${clean(term)}“ in deinen Unterlagen:`));
  for (const s of more) {
    const t = withContext(s, 420, used);
    if (t) parts.push(P(`\n- ${emphasize(clean(shorten(t, 340)), tt)} `, [citeOf(s, fileOf(cs, s.fileId))]));
  }
  void terms;
  return parts;
}

function answerSummary(cs, terms, only = null) {
  const hits = only ? only.map(p => ({ ...p, score: 1 })) : terms.length ? search(cs, terms, { limit: 8 }) : cs.flatMap(c => c.passages).slice(0, 8).map(p => ({ ...p, score: 1 }));
  if (!hits.length) return null;
  const sents = hits.flatMap(h => h.sents);
  const kws = keywordsOf(sents, cs.flatMap(c => c.passages), 12);
  const w = new Map(kws.map((k, i) => [k.k, 1 + (12 - i) / 12]));
  const scored = sents.filter(s => s.text.length > 35 && s.text.length < 380).map(s => ({ s, sc: contentWords(s.text).map(stem).reduce((a, t) => a + (w.get(t) || 0), 0) / Math.sqrt(contentWords(s.text).length || 1) }));
  scored.sort((a, b) => b.sc - a.sc);
  const pick = scored.slice(0, 5).map(x => x.s).sort((a, b) => a.fileId === b.fileId ? a.i - b.i : 0);
  const parts = [P('Kurz zusammengefasst:')];
  for (const s of pick) parts.push(P(`\n- ${clean(shorten(s.text, 260))} `, [citeOf(s, fileOf(cs, s.fileId))]));
  if (kws.length) parts.push(P(`\n\n**Schlüsselbegriffe:** ${kws.slice(0, 6).map(k => clean(k.word)).join(', ')}`));
  return parts;
}

function answerImportant(cs, terms) {
  const all = cs.flatMap(c => c.sents);
  const scope = terms.length ? search(cs, terms, { limit: 12 }).flatMap(h => h.sents) : all;
  const src = scope.length > 20 ? scope : all;
  const kws = keywordsOf(src, cs.flatMap(c => c.passages), 8);
  const defs = definitionsOf(src).sort((a, b) => b.score - a.score).slice(0, 4);
  const parts = [P('Darauf würde ich mich konzentrieren:')];
  for (const d of defs) parts.push(P(`\n- **${clean(d.term)}:** ${clean(shorten(d.def, 200))} `, [citeOf(d.s, fileOf(cs, d.s.fileId))]));
  if (kws.length) parts.push(P(`\n\n**Diese Begriffe tauchen besonders oft auf:** ${kws.map(k => clean(k.word)).join(', ')}`));
  if (cs.some(c => c.file.category === 'Übungsklausur')) parts.push(P('\n\nIn deinen Unterlagen ist eine Übungsklausur. Die ist der beste Hinweis darauf, was drankommt: Lass dir daraus eine Übungsklausur bauen.'));
  else parts.push(P('\n\nAm besten prüfst du dich mit einer Übungsklausur, dann siehst du, wo es noch hakt.'));
  return parts;
}

function answerExample(cs, terms) {
  // Beispiele stehen oft im Satz nach dem Begriff, deshalb zählt das ganze passende Häppchen.
  const EX = /(z\.\s?B\.|zum Beispiel|beispielsweise|Bsp\.|Beispiel)/i;
  const hits = search(cs, terms.filter(t => !/^beispiel/.test(t.t)), { limit: 6 });
  const real = hits.flatMap(h => h.sents.filter(s => EX.test(s.text))).slice(0, 3);
  if (!real.length) return null;
  const parts = [P('Diese Beispiele stehen in deinen Unterlagen:')];
  for (const s of real) parts.push(P(`\n- ${clean(shorten(s.text, 300))} `, [citeOf(s, fileOf(cs, s.fileId))]));
  return parts;
}

function answerDefault(cs, terms) {
  const hits = search(cs, terms, { limit: 6 });
  if (!hits.length) return null;
  const best = bestSentences(hits, terms, { limit: 4 });
  if (!best.length) return null;
  // Passt die beste Stelle nur zu einem Teil der Frage, sagt Lena das ehrlich.
  const strong = terms.filter(t => t.w >= 1);
  const weak = strong.length > 1 && coverage(hits[0], strong) < 0.5;
  const parts = [P(weak ? 'Genau dazu habe ich nichts gefunden. Am nächsten kommt das hier:' : 'Dazu steht in deinen Unterlagen:')];
  // Sätze aus demselben Abschnitt in der Reihenfolge des Skripts, damit sie sich wie ein Text lesen.
  const order = new Map();
  best.forEach((s, i) => { if (!order.has(s.section)) order.set(s.section, i); });
  best.sort((a, b) => a.section === b.section ? a.i - b.i : order.get(a.section) - order.get(b.section));
  const used = new Set();
  for (const s of best) {
    const t = withContext(s, 420, used);
    if (t) parts.push(P(`\n- ${emphasize(clean(shorten(t, 360)), terms)} `, [citeOf(s, fileOf(cs, s.fileId))]));
  }
  const files = new Set(best.map(s => s.fileId));
  parts.push(P(`\n\n${files.size > 1 ? `Gefunden in ${files.size} Dateien. ` : ''}Tipp auf 📄, dann springe ich zur Stelle im Skript.`));
  return parts;
}

// Übungsfrage stellen: eine Definition oder ein Lückentext aus den Unterlagen.
function makeQuiz(cs, terms) {
  const pool = terms.length ? search(cs, terms, { limit: 10 }).flatMap(h => h.sents) : cs.flatMap(c => c.sents);
  const defs = definitionsOf(pool.length > 5 ? pool : cs.flatMap(c => c.sents));
  if (!defs.length) return null;
  const d = defs[Math.floor(Math.random() * Math.min(defs.length, 12))];
  return {
    parts: [P(`Okay, hier ist deine Frage:\n\n**Was versteht man unter „${clean(d.term)}“?**\n\nSchreib mir deine Antwort, ich sage dir dann, wie nah du dran bist.`)],
    quiz: { term: d.term, answer: d.def, cite: citeOf(d.s, fileOf(cs, d.s.fileId)) },
  };
}

function checkQuiz(quiz, answer) {
  const g = grade([{ index: 0, answer, model_answer: quiz.answer, points: 4 }]).results[0];
  const mood = g.points_awarded >= 3 ? 'Richtig gut! 🎉' : g.points_awarded >= 2 ? 'Fast! 👍' : 'Noch nicht ganz. 💪';
  return [P(`${mood} ${g.feedback}\n\n**Musterlösung:** ${clean(quiz.answer)} `, [quiz.cite]), P('\n\nSchreib „noch eine Frage“, wenn du weitermachen willst.')];
}

const HELP = [P(`Ich bin **Lena**, deine Lernassistentin. 🦉 Ich lese deine Unterlagen direkt auf deinem Gerät, kostenlos und ohne Internet.

So kannst du mich fragen:
- „Was ist …?“ oder „Erklär mir …“
- „Wo steht etwas zu …?“ (ich springe zur Stelle im Skript)
- „Fass … zusammen“ oder „Was ist wichtig?“
- „Frag mich ab“ für eine Übungsfrage
- „Eselsbrücke für …“ oder Lerntipps wie „Wie kann ich mich besser konzentrieren?“

Zusammenfassungen, Karteikarten, Übungsklausuren und Lernpläne baue ich dir im Fach über die großen Knöpfe.`)];

// ===== Eselsbrücke =====
const LETTER = { a: 'Affen', b: 'baden', c: 'Clowns', d: 'drehen', e: 'Elefanten', f: 'fliegen', g: 'Giraffen', h: 'hüpfen', i: 'Igel', j: 'jonglieren', k: 'Katzen', l: 'lachen', m: 'Mäuse', n: 'naschen', o: 'Otter', p: 'Pinguine', q: 'quaken', r: 'rennen', s: 'singen', t: 'Tiger', u: 'Uhus', v: 'Vögel', w: 'winken', x: 'Xylofone', y: 'Yaks', z: 'Zebras', ä: 'Äffchen', ö: 'Ölsardinen', ü: 'Übermut' };
const LETTER2 = { a: 'angeln', b: 'Bären', c: 'chillen', d: 'Dackel', e: 'essen', f: 'Frösche', g: 'gähnen', h: 'Hasen', i: 'immer', j: 'jubeln', k: 'kichern', l: 'Löwen', m: 'malen', n: 'Nashörner', o: 'oft', p: 'pfeifen', r: 'Robben', s: 'Schafe', t: 'tanzen', u: 'überall', v: 'verstecken', w: 'Wale', z: 'zaubern' };
function answerMnemonic(cs, q, detail) {
  const own = queryTerms(q.replace(RX.mnemonic, '').replace(/\b(für|fuer|zu|zum|zur|die|der|das)\b/gi, ''));
  const terms = own.length ? own : queryTerms(detail || '', 0.5);
  const hits = terms.length ? search(cs, terms, { limit: 6 }) : [];
  if (!hits.length) return null;
  // Passt die Frage zu einem Kapitel, kommen dessen Unterkapitel und Begriffe in die Eselsbrücke.
  const secs = cs.flatMap(c => c.sections);
  const main = secs.find(sec => terms.some(t => fold(sec.title).includes(t.t)));
  const subs = main?.num ? secs.filter(x => x.fileId === main.fileId && x.num?.startsWith(main.num + '.')) : [];
  const sents = main ? [main, ...subs].flatMap(x => x.sents) : hits.flatMap(h => h.sents);
  const qset = new Set(terms.map(t => t.t));
  const fresh = t => !qset.has(stem(fold(t))) && !terms.some(x => fold(t).includes(x.t));
  let items = [...definitionsOf(sents).map(d => d.term), ...subs.map(x => x.title)];
  if (items.filter(fresh).length < 3) items = [...items, ...keywordsOf(sents, cs.flatMap(c => c.passages), 6).map(k => k.word)];
  items = [...new Set(items)].filter(fresh).slice(0, 5);
  if (items.length < 2) return null;
  const letters = items.map(t => t[0].toUpperCase());
  const used = new Map();
  const sentence = items.map(t => {
    const l = t[0].toLowerCase(), n = used.get(l) || 0;
    used.set(l, n + 1);
    return (n ? LETTER2[l] : LETTER[l]) || t;
  }).join(' ');
  const s = hits[0].sents[0];
  return [
    P(`Hier ist eine Eselsbrücke für ${items.length} Begriffe aus deinen Unterlagen:\n\n**${letters.join('-')}**: ${items.map(t => `**${clean(t[0])}**${clean(t.slice(1))}`).join(', ')}`),
    P(`\n\nMerksatz zum Ausschmücken: *„${sentence.charAt(0).toUpperCase() + sentence.slice(1)}“*\n\nJe verrückter du dir das Bild dazu vorstellst, desto besser bleibt es hängen. Gefunden in: `, [citeOf(s, hits[0].file)]),
  ];
}

// ===== Während einer Klausur: nur Denkanstöße =====
function answerHint(cs, terms) {
  const hits = search(cs, terms, { limit: 3 });
  const base = 'Während der Klausur verrate ich keine Lösungen. 😉';
  if (!hits.length) return [P(`${base} Lies die Aufgabe nochmal in Ruhe und überleg, welches Thema dahintersteckt.`)];
  const kws = keywordsOf(hits.flatMap(h => h.sents), cs.flatMap(c => c.passages), 6).map(k => k.word).filter(w => !terms.some(t => fold(w).includes(t.t))).slice(0, 3);
  return [P(`${base} Ein Denkanstoß: Das gehört zum Thema **${clean(hits[0].section.title)}**.${kws.length ? ` Denk dabei an: ${kws.map(clean).join(', ')}.` : ''} Nach der Abgabe kannst du in der Auswertung alles nachlesen.`)];
}

// ===== Mit Sprachmodell =====
const SYSTEM = `Du bist Lena, eine freundliche Lernassistentin in der App „Der Lernomat“. Du duzt die Person und antwortest immer auf Deutsch, kurz und verständlich (höchstens 6 Sätze oder eine kurze Liste).
Stütze dich vor allem auf die nummerierten Auszüge aus den Unterlagen und setze hinter jede Aussage daraus die Nummer in eckigen Klammern, z. B. [1].
Wenn die Auszüge nicht reichen, darfst du allgemeines Wissen ergänzen, schreib dann dazu „(nicht aus deinen Unterlagen)“. Erfinde keine Zahlen, Namen oder Quellen.
Du kannst auch einfache Erklärungen, Beispiele, Eselsbrücken und Übungsfragen geben.`;

async function answerLLM(cs, q, terms, history, onText, { only = null, detail = '', noSolutions = false } = {}) {
  const hits = only ? only.map(p => ({ ...p, score: 1 })) : terms.length ? search(cs, terms, { limit: 5 }) : [];
  const src = [];
  let budget = 4200;
  for (const h of hits) {
    if (budget <= 300) break;
    const text = shorten(h.text, Math.min(1200, budget));
    budget -= text.length;
    src.push({ h, text, s: bestSentences([h], terms, { limit: 1 })[0] || h.sents[0] });
  }
  const excerpt = src.length ? src.map((x, i) => `[${i + 1}] (${baseName(x.h.file.name)}${x.h.page ? `, S. ${x.h.page}` : ''}${x.h.section && !x.h.section.auto ? `, Abschnitt „${x.h.section.title}“` : ''}) ${x.text}`).join('\n\n') : '(Keine passenden Stellen in den Unterlagen.)';
  const system = SYSTEM + (noSolutions ? '\nWICHTIG: Die Person schreibt gerade eine Übungsklausur. Verrate keine Lösungen, gib höchstens kleine Denkanstöße.' : '');
  const prev = history.slice(-5, -1).map(h => ({ role: h.role, content: shorten(h.display || h.content, 500) }));
  const where = detail ? `\n\n(Ich bin gerade in der App ${shorten(detail, 400)})` : '';
  const messages = [{ role: 'system', content: system }, ...prev, { role: 'user', content: `Auszüge aus meinen Unterlagen:\n${excerpt}${where}\n\nMeine Frage: ${q}` }];
  const text = await LLM.generate(messages, { onText });
  // [1], [2] … in Links zur Fundstelle umwandeln.
  const cites = src.map(x => citeOf(x.s, x.h.file));
  const parts = [];
  let used = false;
  const re = /\s*\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;
  let last = 0, mm;
  while ((mm = re.exec(text))) {
    const cs2 = mm[1].split(/[,;]/).map(n => cites[Number(n) - 1]).filter(Boolean);
    parts.push(P(text.slice(last, mm.index) + ' ', cs2));
    if (cs2.length) used = true;
    last = re.lastIndex;
  }
  parts.push(P(text.slice(last)));
  if (!used && cites.length && !noSolutions) parts.push(P('\n\n**Quellen:** ', cites.slice(0, 3)));
  return parts;
}

// ===== Einstieg =====
const HERE = /(diese[rnms]?|die|der) (seite|folie)|gerade (lese|offen|sehe)|hier (steht|auf der seite)/i;

function answerHere(cs, here, terms) {
  const c = cs.find(x => x.file.id === here.fileId);
  const ps = c?.passages.filter(p => !here.page || p.page === here.page) || [];
  if (!ps.length) return null;
  return answerSummary([{ ...c, passages: ps }], terms.length ? terms : [], ps);
}

// detail: wo die Person gerade ist (z. B. die Karteikarte auf dem Bildschirm); noSolutions: während einer Klausur.
export async function answer({ question, files, history, detail = '', here = null, noSolutions = false, onText }) {
  const q = question.trim();
  const last = [...history].reverse().find(h => h.role === 'assistant');
  if (RX.greet.test(q)) return { parts: [P(`Hallo! 👋 Ich bin Lena. ${files.length ? 'Frag mich etwas zu deinen Unterlagen oder sag „Frag mich ab“.' : 'Lade Unterlagen hoch, dann kann ich dir Fragen dazu beantworten. Lerntipps gebe ich dir aber jetzt schon gern.'}`)] };
  if (RX.thanks.test(q)) return { parts: [P('Gern! Sag Bescheid, wenn du noch etwas wissen willst. 🦉')] };
  if (RX.help.test(q)) return { parts: HELP };
  const tip = RX.tip.test(q) && !RX.define.test(q) && !RX.where.test(q) ? tipFor(q) : null;
  if (tip) return { parts: [P(tip)] };

  const cs = files.length ? await loadCorpus(files) : [];
  if (!cs.length) {
    // Ohne lesbare Unterlagen: im Denk-Modus aus allgemeinem Wissen, sonst ehrlicher Hinweis.
    if (LLM.ready()) {
      try { return { parts: await answerLLM([], q, [], history, onText, { detail, noSolutions }), llm: true }; } catch (err) { console.warn(err); }
    }
    return { parts: [P(files.length
      ? 'In diesen Unterlagen konnte ich keinen Text erkennen. Bei Fotos hilft ein scharfes, gerades Bild mit gutem Licht.'
      : 'Ich habe hier noch keine Unterlagen. Öffne ein Fach und lade Skripte hoch (PDF, Word, PowerPoint, Text oder Fotos), dann beantworte ich dir Fragen dazu. Für Fragen ohne Unterlagen kannst du in den Einstellungen den Denk-Modus einschalten.')] };
  }
  const terms = termsFor(q, { history, detail });
  if (noSolutions) {
    if (LLM.ready()) { try { return { parts: await answerLLM(cs, q, terms, history, onText, { detail, noSolutions }), llm: true }; } catch (err) { console.warn(err); } }
    return { parts: answerHint(cs, terms) };
  }
  // Antwort auf eine Übungsfrage?
  if (last?.quiz && !RX.quiz.test(q) && !/\?\s*$/.test(q) && !RX.define.test(q)) return { parts: checkQuiz(last.quiz, q) };
  if (RX.quiz.test(q) || /^noch (eine|mal)/i.test(q)) {
    const own = queryTerms(q.replace(RX.quiz, '')).length ? queryTerms(q.replace(RX.quiz, '')) : (detail ? queryTerms(detail, 0.5) : []);
    return makeQuiz(cs, own) || { parts: [P('Dafür habe ich in den Unterlagen keine passenden Begriffe gefunden. Probier es mit einem Thema, z. B. „Frag mich zu …“.')] };
  }
  if (RX.where.test(q)) return { parts: answerWhere(cs, terms) || notFound(q) };
  if (RX.mnemonic.test(q) && !LLM.ready()) { const a = answerMnemonic(cs, q, detail); if (a) return { parts: a }; }
  if (here && HERE.test(q) && !LLM.ready()) { const a = answerHere(cs, here, []); if (a) return { parts: a }; }

  if (LLM.ready()) {
    const only = here && HERE.test(q) ? cs.find(x => x.file.id === here.fileId)?.passages.filter(p => !here.page || p.page === here.page) : null;
    try { return { parts: await answerLLM(cs, q, terms, history, onText, { only: only?.length ? only : null, detail }), llm: true }; } catch (err) { console.warn(err); }
  }
  if (RX.define.test(q)) {
    const t = termOf(q);
    if (t) { const a = answerDefine(cs, t, terms); if (a) return { parts: a }; }
  }
  if (RX.sum.test(q)) return { parts: answerSummary(cs, termsFor(q.replace(RX.sum, ''), { history: [], detail })) || notFound(q) };
  if (RX.important.test(q)) return { parts: answerImportant(cs, queryTerms(q.replace(RX.important, ''))) };
  if (RX.example.test(q)) { const a = answerExample(cs, terms); if (a) return { parts: a }; }
  if (RX.mnemonic.test(q)) { const a = answerMnemonic(cs, q, detail); if (a) return { parts: a }; }
  return { parts: answerDefault(cs, terms) || notFound(q) };
}

function notFound(q) {
  return [P(`Dazu habe ich in deinen Unterlagen nichts gefunden${contentWords(q).length ? '' : ' (die Frage ist mir zu allgemein)'}. Versuch es mit einem anderen Stichwort aus dem Skript, z. B. „Was ist …?“ oder „Wo steht etwas zu …?“${LLM.ready() ? '' : ' Für Fragen über die Unterlagen hinaus kannst du in den Einstellungen den Denk-Modus einschalten.'}`)];
}
