# Der Lernomat

Dein persönlicher KI-Lernbegleiter als App für iPhone, iPad und Mac.

Lade Lernskripte, Übungsklausuren, Karteikarten oder Zusammenfassungen hoch, und die KI baut dir daraus:

- **Zusammenfassungen** (kompakt, ausführlich oder als Spickzettel)
- **Karteikarten** mit Lernfortschritt (Karteikasten-Prinzip, Wischen wie bei Tinder)
- **Übungsklausuren** mit Zeitlimit, automatischer Korrektur, Note und Feedback
- **Lernpläne** bis zu deinem Prüfungstermin

Deine hochgeladenen Skripte kannst du direkt in der App lesen und durchsuchen (PDF, Word, PowerPoint, Text, Fotos).

Jedes Fach bekommt einen eigenen Ordner. Über den Knopf **„KI fragen“** ist die KI auf jedem Bildschirm einen Klick entfernt und kennt die Unterlagen des Fachs, in dem du gerade bist (am Mac auch mit ⌘K). Antworten mit Bezug auf dein Skript enthalten Links wie „📄 skript.pdf · S. 12“, die direkt zur markierten Stelle im Skript springen.

Hell- oder Dunkelmodus stellst du über das Sonne/Mond-Symbol im Hauptmenü oder in den Einstellungen ein.

## Öffnen

Die App läuft über GitHub Pages: **https://niklasboeck.github.io/Der-Lernomat/**

### Als App installieren

- **iPhone / iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **Mac:** Seite in Safari öffnen → Menü „Ablage“ → „Zum Dock hinzufügen …“.

## KI einrichten

Der Lernomat nutzt Claude von Anthropic mit deinem eigenen API-Schlüssel:

1. Auf [console.anthropic.com](https://console.anthropic.com/settings/keys) anmelden und Guthaben aufladen.
2. Unter „API Keys“ einen Schlüssel erstellen.
3. Im Lernomat auf das Einstellungs-Symbol tippen, Schlüssel einfügen, „Verbindung testen“.

Der Schlüssel, deine Fächer und Dateien werden nur lokal auf dem jeweiligen Gerät gespeichert. Dateien gehen nur dann an die KI, wenn du etwas erstellen lässt oder eine Frage stellst. Mit „Sicherung exportieren/importieren“ in den Einstellungen überträgst du deine Daten zwischen iPhone und Mac.

## Technik

Reine Web-App (HTML, CSS, JavaScript ohne Build-Schritt), offlinefähig per Service Worker. Daten in IndexedDB. KI über das offizielle Anthropic-SDK (`js/vendor/`, gebündelt). Melodie und Klänge werden mit Web Audio erzeugt.
