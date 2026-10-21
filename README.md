# Der Lernomat

Dein persönlicher Lernbegleiter als App für iPhone, iPad und Mac, mit **Lena** 🦉, der eingebauten Lernassistentin.

Lena arbeitet direkt auf deinem Gerät: kostenlos für alle, ohne Konto, ohne API-Schlüssel und auch offline. Lade Lernskripte, Übungsklausuren, Karteikarten oder Zusammenfassungen hoch, und Lena baut dir daraus:

- **Zusammenfassungen** (kompakt, ausführlich oder als Spickzettel)
- **Karteikarten** mit Lernfortschritt (Karteikasten-Prinzip, Wischen wie bei Tinder)
- **Übungsklausuren** mit Zeitlimit, automatischer Korrektur, Note und Feedback
- **Lernpläne** bis zu deinem Prüfungstermin

Deine hochgeladenen Skripte kannst du direkt in der App lesen und durchsuchen (PDF, Word, PowerPoint, Text, Fotos).

Jedes Fach bekommt einen eigenen Ordner. Über den Knopf **„Lena fragen“** ist Lena auf jedem Bildschirm einen Klick entfernt und kennt die Unterlagen des Fachs, in dem du gerade bist (im Hauptmenü alle Unterlagen, am Mac auch mit ⌘K). Antworten enthalten Links wie „📄 skript.pdf · S. 12“, die direkt zur markierten Stelle im Skript springen. Lena kann dich auch abfragen („Frag mich ab!“).

### Die Lernomat-Eule und der Eulen-Blitz

Die Eule ist das Maskottchen der App. Sie begrüßt dich im Hauptmenü, fliegt herein und arbeitet sichtbar mit Stift und Papier, während Lena ein Lernset erstellt oder eine Klausur korrigiert, und sitzt auf dem Knopf „Lena fragen“.

Im **Eulen-Blitz** (Lernspiel, im Hauptmenü und in jedem Fach) beantwortest du in 60 Sekunden so viele Fragen wie möglich. Die Fragen kommen aus deinen Karteikarten, sonst baut Lena sie aus den Unterlagen. Serien geben Bonuspunkte, der Rekord wird pro Fach gespeichert.

### Denk-Modus (freiwillig)

In den Einstellungen lässt sich ein kleines Sprachmodell (Qwen 3.5, über [WebLLM](https://github.com/mlc-ai/web-llm)) einmalig aufs Gerät laden. Dann formuliert Lena Chat-Antworten in eigenen Worten (auch über die Unterlagen hinaus), erklärt Abschnitte in Zusammenfassungen und gibt genaueres Feedback bei offenen Klausurfragen. Das braucht WebGPU (iPhone/iPad mit iOS 26, Mac mit Safari 26 oder Chrome) und einmalig etwa 0,6 bis 1,5 GB Download. Ohne Denk-Modus stellt Lena die passenden Stellen aus dem Skript zusammen.

### Grenzen

Lena liest auch Fotos und eingescannte Seiten (Texterkennung mit [Tesseract](https://github.com/naptha/tesseract.js) auf dem Gerät), bei Handschrift klappt das aber nur mäßig. Zusammenfassungen, Karteikarten und Klausuren entstehen aus Sätzen der Unterlagen (Definitionen, Kernsätze, Lückentexte) und sind deshalb einfacher als bei einer großen Cloud-KI.

Hell- oder Dunkelmodus stellst du über das Sonne/Mond-Symbol im Hauptmenü oder in den Einstellungen ein.

## Öffnen

Die App läuft über GitHub Pages: **https://niklasboeck.github.io/Der-Lernomat/**

### Als App installieren

- **iPhone / iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **Mac:** Seite in Safari öffnen → Menü „Ablage“ → „Zum Dock hinzufügen …“.

## Cloud-KI (zurzeit abgeschaltet)

Früher nutzte der Lernomat Claude von Anthropic. Der Code dafür ist noch da (`js/ai.js`, `worker/`) und lässt sich mit `CLOUD_AI = true` in `js/config.js` wieder einschalten. Dann gilt:

1. Auf [console.anthropic.com](https://console.anthropic.com/settings/keys) anmelden und Guthaben aufladen.
2. Unter „API Keys“ einen Schlüssel erstellen.
3. Im Lernomat auf das Einstellungs-Symbol tippen, Schlüssel einfügen, „Verbindung testen“.

Der Schlüssel, deine Fächer und Dateien werden nur lokal auf dem jeweiligen Gerät gespeichert. Dateien gehen nur dann an die KI, wenn du etwas erstellen lässt oder eine Frage stellst. Mit „Sicherung exportieren/importieren“ in den Einstellungen überträgst du deine Daten zwischen iPhone und Mac.

## Technik

Reine Web-App (HTML, CSS, JavaScript ohne Build-Schritt), offlinefähig per Service Worker. Daten in IndexedDB. Lena steckt in `js/lena/` (Textsuche, Lern-Werkstatt, Chat, Denk-Modus), die Eule in `js/owl.js`, das Lernspiel in `js/game.js`. Bibliotheken liegen gebündelt in `js/vendor/`. Melodie und Klänge werden mit Web Audio erzeugt.
