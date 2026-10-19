# Gemeinsamer KI-Zugang einrichten (Cloudflare, kostenlos)

Damit können alle den Lernomat ohne eigenen API-Schlüssel nutzen. Dein Schlüssel liegt nur bei Cloudflare, nie in der App. Jede Person hat ein Tageslimit (Standard: 40 KI-Anfragen), und es wird das günstige Modell Claude Haiku 5.5 genutzt.

Am besten am Mac oder iPad machen, dauert etwa 10 Minuten.

## 1. Konto anlegen
Auf **https://dash.cloudflare.com/sign-up** ein kostenloses Konto erstellen und die E-Mail bestätigen.

## 2. Speicher für das Tageslimit anlegen
Links **Storage & Databases → Workers KV → Create instance**. Name: `LIMITS` → **Create**.

## 3. Worker anlegen
1. Links **Compute (Workers) → Workers & Pages → Create → Start with Hello World** (bzw. „Create Worker“).
2. Name: `lernomat-ki` → **Deploy**.
3. **Edit code** öffnen, den ganzen Inhalt löschen und den Inhalt von [`worker.js`](worker.js) einfügen (auf GitHub die Datei öffnen → „Copy raw file“). Oben rechts **Deploy**.

## 4. Einstellungen des Workers
Im Worker auf **Settings**:

- **Bindings → Add → KV namespace**: Variable name `LIMITS`, Namespace `LIMITS` → Save.
- **Variables and Secrets → Add**:
  - Typ **Secret**, Name `ANTHROPIC_API_KEY`, Wert: dein Schlüssel (`sk-ant-…`)
  - Typ **Text**, Name `ALLOWED_ORIGIN`, Wert: `https://niklasboeck.github.io`
  - Typ **Text**, Name `DAILY_LIMIT`, Wert: `40`
  - Typ **Text**, Name `ALLOWED_MODELS`, Wert: `claude-haiku-5-5`
  - Speichern / **Deploy**.

## 5. Adresse schicken
Oben im Worker steht die Adresse, z. B. `https://lernomat-ki.DEINNAME.workers.dev`. Schick sie Claude im Projekt-Chat, dann wird sie in der App eingetragen.

## Kosten im Blick behalten
In der Anthropic Console unter **Settings → Limits** kannst du ein monatliches Ausgabenlimit setzen, z. B. 10 €. Dann kann nie mehr verbraucht werden.
