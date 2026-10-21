// Denk-Modus: Das Sprachmodell verfeinert, was Lena gebaut hat (Erklärungen in Zusammenfassungen, Feedback bei offenen Antworten).
// Ohne Denk-Modus wird nichts davon gebraucht; bei Fehlern bleibt einfach das Ergebnis ohne Verfeinerung.
import * as LLM from './llm.js';
import { clean } from './text.js';

const SKIP = /^(Begriffe|Formeln|Kernaussagen|Das solltest du sicher können)$/;

// Fügt unter jeder Überschrift eine kurze Erklärung in einfachen Worten ein.
export async function explainSummary(md, onStatus) {
  if (!LLM.ready()) return md;
  const lines = md.split('\n');
  const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^## /.test(l) && !SKIP.test(l.slice(3).trim())).slice(0, 8);
  const inserts = [];
  for (const [n, [line, i]] of heads.entries()) {
    const body = [];
    for (let j = i + 1; j < lines.length && !/^## /.test(lines[j]); j++) if (lines[j].trim()) body.push(lines[j].replace(/^[-*>]\s*/, '').replace(/\*\(S\. \d+\)\*/g, ''));
    if (!body.length) continue;
    onStatus?.(`Lena erklärt Abschnitt ${n + 1} von ${heads.length} …`);
    try {
      const text = await LLM.generate([
        { role: 'system', content: 'Du bist Lena, eine Lernassistentin. Antworte auf Deutsch in genau 2 kurzen, einfachen Sätzen. Nutze nur den gegebenen Text, erfinde nichts.' },
        { role: 'user', content: `Abschnitt „${line.slice(3)}“:\n${body.join('\n').slice(0, 2500)}\n\nErkläre in 2 einfachen Sätzen, worum es hier geht.` },
      ], { maxTokens: 140, temperature: 0.3 });
      if (text) inserts.push([i, `*Kurz erklärt:* ${clean(text)}`]);
    } catch (err) { console.warn(err); break; }
  }
  for (const [i, t] of inserts.reverse()) lines.splice(i + 1, 0, '', t);
  return lines.join('\n');
}

// Zweite Meinung zu offenen Antworten: Punkte aus Schlüsselbegriffen und Sprachmodell werden gemittelt.
export async function refineGrading(items, graded, onStatus) {
  if (!LLM.ready()) return graded;
  for (const [n, it] of items.entries()) {
    const r = graded.results.find(x => x.index === it.index);
    if (!r || !String(it.answer || '').trim()) continue;
    onStatus?.(`Lena prüft Antwort ${n + 1} von ${items.length} …`);
    try {
      const out = await LLM.generate([
        { role: 'system', content: 'Du bist eine faire Prüferin. Bewerte nur den Inhalt, nicht die Rechtschreibung. Antworte genau in diesem Format:\nPunkte: <Zahl>\nFeedback: <ein bis zwei Sätze auf Deutsch, was fehlt oder gut ist>' },
        { role: 'user', content: `Frage: ${it.question}\nMusterlösung: ${it.model_answer}\nAntwort: ${it.answer}\nHöchstpunktzahl: ${it.points}` },
      ], { maxTokens: 120, temperature: 0.2 });
      const pts = Number((/Punkte:\s*(\d+(?:[.,]\d+)?)/i.exec(out) || [])[1]?.replace(',', '.'));
      const fb = (/Feedback:\s*([\s\S]+)/i.exec(out) || [])[1]?.trim();
      if (Number.isFinite(pts)) r.points_awarded = Math.round((r.points_awarded + Math.max(0, Math.min(it.points, pts))) / 2);
      if (fb) r.feedback = clean(fb);
    } catch (err) { console.warn(err); break; }
  }
  return graded;
}
