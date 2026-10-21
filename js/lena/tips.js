// Lenas Lerntipps: Antworten auf allgemeine Fragen rund ums Lernen, ganz ohne Internet.
const TIPS = [
  {
    rx: /(wie (lerne|lern) ich|wie (sollte|soll) ich lernen|richtig lernen|besser lernen|effektiv|lernmethode|lerntechnik|lerntipps?|tipps? zum lernen)/i,
    text: `So lernst du am wirksamsten:
- **Selbst abfragen statt nur lesen:** Schließ das Skript und erkläre den Stoff aus dem Kopf. Genau das machen Karteikarten und Übungsklausuren.
- **Verteilt wiederholen:** Lieber 5 × 20 Minuten an verschiedenen Tagen als einmal 2 Stunden. Der Karteikasten im Lernomat sortiert dafür unsichere Karten nach vorn.
- **Mischen:** Wechsle zwischen Themen und Aufgabentypen, das trainiert, das Richtige abzurufen.
- **In eigenen Worten erklären** (Feynman-Methode): Wenn du es einem Kind erklären könntest, sitzt es.
- **Prüfungsnah üben:** Schreib Übungsklausuren mit Zeitlimit.`,
  },
  {
    rx: /(pomodoro|pausen?|wie lange (am stück|lernen)|zeitmanagement|zeit einteilen)/i,
    text: `Ein bewährter Rhythmus ist die **Pomodoro-Technik**:
1. 25 Minuten konzentriert lernen (Handy weg, nur eine Aufgabe).
2. 5 Minuten Pause: aufstehen, trinken, nicht aufs Handy.
3. Nach 4 Runden eine längere Pause von 20 bis 30 Minuten.

Für die Planung bis zur Prüfung kann ich dir im Fach einen **Lernplan** bauen.`,
  },
  {
    rx: /(motivation|motiviert|keine lust|aufschieben|prokrastin|anfangen|faul)/i,
    text: `Keine Lust? Ganz normal. Was hilft:
- **Mini-Start:** Nimm dir nur 5 Minuten vor, z. B. 10 Karteikarten. Meist machst du danach weiter.
- **Klare kleine Ziele:** „Kapitel 2 verstehen“ statt „Bio lernen“. Der Lernplan hilft dabei.
- **Fortschritt sehen:** Hake erledigte Schritte im Lernplan ab und schau, wie die Karten in den Karteikasten wandern.
- **Belohnung einplanen:** nach der Lerneinheit etwas Schönes.
- **Ablenkung entfernen:** Handy in einen anderen Raum.`,
  },
  {
    rx: /(prüfungsangst|pruefungsangst|aufgeregt|nervös|nervoes|angst vor der (prüfung|klausur)|panik|blackout|stress)/i,
    text: `Aufregung vor Prüfungen ist normal und sogar hilfreich, solange sie nicht überhandnimmt. Was hilft:
- **Gut vorbereitet sein:** Übungsklausuren unter echten Bedingungen nehmen viel Unsicherheit.
- **Atmen:** 4 Sekunden ein, 6 Sekunden aus, ein paar Mal hintereinander. Das beruhigt den Körper.
- **Bei einem Blackout:** Aufgabe überspringen, mit einer leichten weitermachen und später zurückkommen.
- **Schlaf und Essen:** Ausgeschlafen und mit Frühstück denkst du klarer als nach einer Nachtschicht.

Wenn die Angst dich stark belastet, sprich mit jemandem darüber, z. B. mit der Studienberatung oder Vertrauenslehrkraft.`,
  },
  {
    rx: /(konzentrier|ablenkung|abgelenkt|fokus)/i,
    text: `Für bessere Konzentration:
- **Ein fester Lernplatz** ohne Ablenkung, Handy außer Reichweite.
- **Eine Sache gleichzeitig:** Musik ohne Text ist okay, Serien nebenbei nicht.
- **Kurze Einheiten mit Pausen** (z. B. 25 Minuten lernen, 5 Minuten Pause).
- **Genug trinken, frische Luft, Bewegung in den Pausen.**
- **Aktiv lernen:** Fragen beantworten und Karten üben hält wacher als nur lesen.`,
  },
  {
    rx: /(merken|vergess|gedächtnis|gedaechtnis|merktechnik|auswendig|eselsbrücke(n)? (allgemein|bauen|machen))/i,
    text: `Damit du dir Dinge besser merkst:
- **Wiederholen in wachsenden Abständen:** nach 1 Tag, 3 Tagen, 1 Woche. Karteikarten machen das automatisch.
- **Eselsbrücken:** Anfangsbuchstaben zu einem Wort oder Satz verbinden. Frag mich z. B. „Eselsbrücke für Zellorganellen“.
- **Bilder und Geschichten:** Verknüpfe Begriffe mit einem lustigen Bild im Kopf.
- **Gedächtnispalast:** Lege Begriffe gedanklich an Orten in deiner Wohnung ab und „geh“ sie dann ab.
- **Schlafen:** Im Schlaf wird Gelerntes gefestigt.`,
  },
  {
    rx: /(schlaf|nachts lernen|durchmachen|letzte nacht|vor der prüfung|am tag vor)/i,
    text: `Am Tag vor der Prüfung:
- **Nichts Neues mehr anfangen**, nur noch wiederholen (z. B. Spickzettel-Zusammenfassung und unsichere Karten).
- **Früh schlafen:** Schlaf festigt das Gelernte, eine durchgemachte Nacht kostet mehr, als sie bringt.
- **Sachen packen:** Ausweis, Stifte, Taschenrechner, Wasser.
- **Am Morgen:** Frühstücken und rechtzeitig losgehen.`,
  },
  {
    rx: /(karteikarten (richtig|gut|am besten)|wie (nutze|benutze|übe) ich (die )?karten|karteikasten)/i,
    text: `So übst du mit den Karteikarten am besten:
- **Erst antworten, dann umdrehen:** Sag die Antwort laut oder im Kopf, bevor du die Rückseite ansiehst.
- **Ehrlich bewerten:** Nur „Gewusst“, wenn es wirklich saß.
- **Täglich kurz üben:** Unsichere Karten kommen automatisch öfter dran, sichere wandern im Karteikasten nach hinten.
- **„Nur unsichere üben“** im Menü oben rechts, wenn die Zeit knapp ist.`,
  },
  {
    rx: /(gruppe|zusammen lernen|lerngruppe|mit freunden)/i,
    text: `Lernen in der Gruppe funktioniert gut, wenn ihr:
- **euch gegenseitig abfragt** und Themen erklärt (wer erklärt, lernt am meisten),
- **vorher allein lernt** und die Gruppe zum Üben und Klären nutzt,
- **eine feste Zeit und ein Ziel** vereinbart, damit es nicht nur Plaudern wird.

Tipp: Mit „Sicherung exportieren“ in den Einstellungen könnt ihr eure Fächer teilen.`,
  },
];

export function tipFor(q) {
  return TIPS.find(t => t.rx.test(q))?.text || null;
}
