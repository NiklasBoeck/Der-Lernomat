// Aufgabenbeschreibungen für die KI, je nach gewähltem Lernbaustein.
function focusText(focus) {
  if (!focus || !focus.length) return 'Behandle den gesamten Stoff aus den Unterlagen.';
  return 'Konzentriere dich ausschließlich auf diese Themen: ' + focus.map(f => `„${f}“`).join(', ') + '.';
}

export function topicsPrompt() {
  return `Analysiere die Unterlagen oben und gliedere den Stoff in 4 bis 12 sinnvolle Lernthemen (z. B. Kapitel oder Themenblöcke), in der Reihenfolge der Unterlagen.
Für jedes Thema: ein kurzer Titel (max. 5 Wörter) und eine Beschreibung in einem Satz, was dazugehört.`;
}

export function summaryPrompt({ focus, length }) {
  const styles = {
    kompakt: 'Kompakt: das Wichtigste auf etwa 1–2 Seiten, klare Stichpunkte.',
    ausfuehrlich: 'Ausführlich: alle wichtigen Inhalte gut erklärt, mit Beispielen, gern mehrere Seiten.',
    spickzettel: 'Spickzettel: extrem verdichtet, nur Kernbegriffe, Formeln, Definitionen und Merksätze, in Tabellen und Stichpunkten.',
  };
  return `Erstelle eine Lern-Zusammenfassung der Unterlagen. ${focusText(focus)}
Stil: ${styles[length] || styles.kompakt}
Formatiere in Markdown:
- Beginne mit „# “ und einem passenden Titel.
- Gliedere mit „## “ Abschnitten (ein Abschnitt pro Thema), darunter bei Bedarf „### “.
- Nutze Stichpunkte, **fett** für Schlüsselbegriffe und Tabellen für Vergleiche.
- Setze wichtige Merksätze als Zitat („> 💡 …“).
- Schließe mit „## Das solltest du sicher können“ und 5–8 Prüfungs-Checkpunkten als Liste.
Gib nur die Zusammenfassung aus, ohne Vorrede.`;
}

export function cardsPrompt({ focus, count, style }) {
  const styles = {
    begriffe: 'Vorderseite: ein Fachbegriff, eine Formel oder ein Name. Rückseite: präzise Definition bzw. Erklärung.',
    verstaendnis: 'Vorderseite: eine Verständnisfrage („Warum…?“, „Wie hängt … zusammen?“, „Was passiert, wenn…?“). Rückseite: eine kurze, klare Antwort.',
    gemischt: 'Mische Begriffskarten (Begriff → Definition) und Verständnisfragen.',
  };
  return `Erstelle genau ${count} Karteikarten zum Lernen. ${focusText(focus)}
${styles[style] || styles.gemischt}
Regeln: Jede Karte prüft genau eine Sache. Vorderseite kurz (max. ~20 Wörter). Rückseite verständlich und vollständig, aber knapp (max. ~60 Wörter), gern mit Mini-Beispiel. Keine doppelten Karten.
Wenn in den Unterlagen bereits Karteikarten sind, nutze sie als Vorbild für Stil und Inhalt, verbessere sie aber, wo nötig.
„topic“ ist das Thema, zu dem die Karte gehört. „title“ ist ein kurzer Name für den Kartenstapel.`;
}

export function examPrompt({ focus, count, kind, difficulty }) {
  const kinds = {
    gemischt: 'Mische Multiple-Choice-Fragen (etwa 60 %) und offene Fragen (etwa 40 %).',
    mc: 'Nur Multiple-Choice-Fragen.',
    offen: 'Nur offene Fragen (Erklären, Berechnen, Begründen, Anwenden).',
  };
  return `Erstelle eine realistische Übungsklausur mit genau ${count} Aufgaben. ${focusText(focus)}
${kinds[kind] || kinds.gemischt}
Schwierigkeit: ${difficulty}.
Wenn die Unterlagen echte Übungs- oder Altklausuren enthalten, orientiere dich an deren Stil, Niveau und Themenauswahl, aber kopiere keine Aufgaben wörtlich.
Für jede Aufgabe:
- type: "mc" oder "open"
- question: der Aufgabentext
- mc: "options" mit genau 4 Antwortmöglichkeiten (nur eine richtig, plausible Ablenker), "correct_index" = Index (0–3) der richtigen Antwort
- open: "options" = [] und "correct_index" = -1
- model_answer: Musterlösung (bei mc: kurze Begründung der richtigen Antwort)
- explanation: kurze Erklärung, warum das so ist bzw. typische Fehler
- points: mc 1–2 Punkte, offene Fragen 2–6 Punkte je nach Umfang
- topic: Thema der Aufgabe
"duration_minutes": realistische Bearbeitungszeit. "title": kurzer Titel der Klausur.`;
}

export function gradingPrompt(items) {
  return `Bewerte die Antworten auf diese offenen Klausurfragen fair, wie eine wohlwollende, aber genaue Prüferin.
Teilpunkte sind erlaubt. Rechtschreibung zählt nicht, nur der Inhalt. Eine leere Antwort gibt 0 Punkte.
Gib für jede Frage (index wie unten) die erreichten Punkte und ein kurzes, konstruktives Feedback (was fehlt oder falsch ist, 1–3 Sätze).
"overall_feedback": 2–3 Sätze, woran die Person als Nächstes arbeiten sollte.

${items.map(it => `### Frage ${it.index} (max. ${it.points} Punkte)
Frage: ${it.question}
Musterlösung: ${it.model_answer}
Antwort der Person: ${it.answer || '(keine Antwort)'}`).join('\n\n')}`;
}

export function planPrompt({ focus, examDate, perDay, goal }) {
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Erstelle einen persönlichen Lernplan auf Basis der Unterlagen. ${focusText(focus)}
Heute ist ${today}.
${examDate ? `Die Prüfung ist am ${new Date(examDate).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Es gibt kein festes Prüfungsdatum; plane etwa zwei Wochen.'}
Verfügbare Lernzeit pro Tag: ${perDay}.
${goal ? `Ziel der Person: ${goal}` : ''}
Plane 6–16 konkrete Schritte in sinnvoller Reihenfolge (erst verstehen, dann üben, dann prüfen, mit Wiederholungen).
Jeder Schritt nutzt eine Aktivität der App:
- "summary": Zusammenfassung lesen
- "cards": Karteikarten üben
- "exam": Übungsklausur schreiben
- "review": Wiederholen / Fehler nacharbeiten
"topic": das Thema des Schritts (kurz). "day": wann (z. B. „Tag 1“ oder ein Datum). "minutes": geplante Dauer.
"overview": 2–3 Sätze zur Strategie. "title": kurzer Titel.`;
}

export function chatContextNote(context) {
  return context ? `\n\n(Kontext: Ich bin gerade hier in der App: ${context})` : '';
}
