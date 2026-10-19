// Die KI des Lernomats: Anbindung an die Claude API mit dem eigenen API-Schlüssel.
// Offizielles Anthropic-SDK, lokal gebündelt (funktioniert dadurch auch ohne CDN).
import { SHARED_AI_URL } from './config.js';

const SDK_URL = './vendor/anthropic-sdk-0.131.0.min.js';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Beste Qualität (empfohlen)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Schneller und günstiger' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Am schnellsten und günstigsten' },
];

const SYSTEM = `Du bist „Der Lernomat“, ein freundlicher, präziser Lerncoach für Schüler:innen und Studierende.
Du arbeitest mit den Lernunterlagen, die dir die Person hochgeladen hat (Skripte, Übungsklausuren, Karteikarten, Zusammenfassungen, Fotos von Notizen).
Regeln:
- Antworte immer auf Deutsch, außer die Unterlagen oder die Person verlangen ausdrücklich eine andere Sprache (z. B. Vokabeln).
- Stütze dich in erster Linie auf die Unterlagen. Wenn du Wissen ergänzt, das nicht in den Unterlagen steht, kennzeichne es kurz.
- Erfinde keine Inhalte, Zahlen oder Quellen. Ist etwas unklar oder unleserlich, sag das.
- Erkläre verständlich, mit Beispielen, wo sie helfen. Formeln schreibst du gut lesbar als Text.
- Übungsklausuren in den Unterlagen sind ein starker Hinweis darauf, was prüfungsrelevant ist und in welchem Stil gefragt wird.`;

export function getSettings() {
  return {
    apiKey: localStorage.getItem('lernomat.apiKey') || '',
    model: localStorage.getItem('lernomat.model') || MODELS[0].id,
  };
}
export function saveSettings({ apiKey, model }) {
  if (apiKey !== undefined) localStorage.setItem('lernomat.apiKey', apiKey.trim());
  if (model !== undefined) localStorage.setItem('lernomat.model', model);
}
export const sharedAI = () => !!SHARED_AI_URL;
// Nur echte API-Schlüssel (sk-ant-api…) gelten als eigener Schlüssel; alles andere würde den gemeinsamen Zugang blockieren.
const ownKey = () => { const k = getSettings().apiKey; return /^sk-ant-api/.test(k) ? k : ''; };
export const hasKey = () => !!ownKey() || sharedAI();
// Ohne eigenen Schlüssel läuft alles über den gemeinsamen Zugang, immer mit dem günstigen Haiku.
export const sharedMode = () => !ownKey() && sharedAI();
const SHARED_MODEL = 'claude-haiku-5-5';

let sdkPromise;
let usingShared = false;
async function client() {
  const apiKey = ownKey() || (sharedAI() ? '' : getSettings().apiKey);
  usingShared = !apiKey && sharedAI();
  if (usingShared) {
    // Gemeinsamer Zugang: der echte Schlüssel liegt nur auf dem Server.
    sdkPromise ||= import(SDK_URL).catch(e => { sdkPromise = null; throw e; });
    let m;
    try { m = await sdkPromise; } catch {
      throw new AIError('Die KI konnte nicht geladen werden. Bist du mit dem Internet verbunden?', 'offline');
    }
    const A = m.default || m.Anthropic;
    return new A({ apiKey: 'gemeinsam', baseURL: SHARED_AI_URL.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 1 });
  }
  if (!apiKey) throw new AIError('Bitte hinterlege zuerst deinen API-Schlüssel in den Einstellungen.', 'nokey');
  sdkPromise ||= import(SDK_URL).catch(e => { sdkPromise = null; throw e; });
  let mod;
  try { mod = await sdkPromise; } catch {
    throw new AIError('Die KI konnte nicht geladen werden. Bist du mit dem Internet verbunden?', 'offline');
  }
  const Anthropic = mod.default || mod.Anthropic;
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// Preise in US-Dollar pro 1 Mio. Tokens (Eingabe, Ausgabe); Haiku kostet ab 100.000 Tokens Eingabe mehr.
const PRICES = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5, 0.5, 2.5],
};
export function costOf(model, u) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const read = u.cache_read_input_tokens || 0, write = u.cache_creation_input_tokens || 0, inp = u.input_tokens || 0;
  const big = p.length > 2 && inp + read + write > 100_000;
  const [pi, po] = big ? [p[2], p[3]] : p;
  return ((inp + write * 1.25 + read * 0.1) * pi + (u.output_tokens || 0) * po) / 1e6;
}
function recordUsage(msg) {
  if (!msg?.usage) return;
  const model = msg.model || '';
  const usd = costOf(model, msg.usage);
  const tokens = (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0);
  const day = new Date().toISOString().slice(0, 10);
  let log = {};
  try { log = JSON.parse(localStorage.getItem('lernomat.usage') || '{}'); } catch { /* neu anfangen */ }
  if (log.day !== day) log = { day, usd: 0, count: 0 };
  log.usd += usd; log.count += 1;
  log.last = { model, usd, tokens };
  try { localStorage.setItem('lernomat.usage', JSON.stringify(log)); } catch { /* egal */ }
}
export function usageToday() {
  try {
    const log = JSON.parse(localStorage.getItem('lernomat.usage') || '{}');
    return log.day === new Date().toISOString().slice(0, 10) ? log : null;
  } catch { return null; }
}

export class AIError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

function friendly(err) {
  if (err instanceof AIError) return err;
  const status = err?.status;
  const raw = String(err?.message || err);
  if (usingShared) {
    if (status === 401) return new AIError('Der gemeinsame KI-Zugang ist noch nicht fertig: Bei Cloudflare fehlt der Schlüssel ANTHROPIC_API_KEY oder er ist ungültig.', 'auth');
    if (status === 403 && /Lernomat/.test(raw)) return new AIError('Der gemeinsame KI-Zugang lehnt diese Adresse ab. Bei Cloudflare muss ALLOWED_ORIGIN genau https://niklasboeck.github.io sein.', 'auth');
    if (/Einrichtung:/.test(raw)) return new AIError(raw.match(/Einrichtung:[^"]*/)[0], 'setup');
    if (/fetch|network|Load failed|CORS/i.test(raw)) return new AIError('Der gemeinsame KI-Zugang antwortet nicht. Ist der Worker bei Cloudflare gespeichert und deployt?', 'offline');
  }
  if (status === 401) return new AIError('Der API-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.', 'auth');
  if (status === 403) return new AIError('Dein API-Schlüssel hat keinen Zugriff auf dieses Modell.', 'auth');
  if (/Tageslimit/.test(raw)) return new AIError('Für heute ist das KI-Limit erreicht. Morgen geht es weiter, oder trage in den Einstellungen einen eigenen API-Schlüssel ein.', 'rate');
  if (status === 429) return new AIError('Gerade zu viele Anfragen oder Guthaben aufgebraucht. Versuch es gleich nochmal.', 'rate');
  if (status === 413 || /too large|exceeds|prompt is too long/i.test(raw)) return new AIError('Die ausgewählten Dateien sind zu groß. Wähle weniger Dateien aus.', 'size');
  if (status === 529 || status >= 500) return new AIError('Die KI ist gerade überlastet. Versuch es in einem Moment nochmal.', 'server');
  if (/credit|billing|balance/i.test(raw)) return new AIError('Dein API-Guthaben ist aufgebraucht. Lade es in der Anthropic Console auf.', 'billing');
  if (/fetch|network|Load failed/i.test(raw)) return new AIError('Keine Verbindung zur KI. Bist du online?', 'offline');
  return new AIError('Die KI hat einen Fehler gemeldet: ' + raw.slice(0, 200), 'other');
}

function withCache(fileBlocks) {
  if (!fileBlocks.length) return [];
  const blocks = fileBlocks.map(b => ({ ...b }));
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  return blocks;
}

const CHAT_SYSTEM = SYSTEM + `
Im Chat beantwortest du Fragen zum Lernstoff kurz und klar (lieber ein paar gut erklärte Sätze als lange Texte).
Wenn du dich auf die Unterlagen beziehst, belege deine Aussagen mit Zitaten daraus: Die App zeigt zu jedem Zitat einen Link, der direkt zur Stelle im Skript springt.
Bei Fragen wie „Wo finde ich …?“ nenne Datei und Seite (bzw. Abschnitt) und zitiere die passende Stelle.`;

function baseParams(maxTokens, effort, system = SYSTEM) {
  const model = sharedMode() ? SHARED_MODEL : getSettings().model;
  // Beim gemeinsamen Zugang kurz nachdenken lassen: spart Kosten, Haiku reicht dafür.
  if (sharedMode()) effort = 'low';
  const p = { model, max_tokens: maxTokens, system, output_config: { effort } };
  // Serverseitiger Ersatz, falls ein Sicherheitsfilter fälschlich ablehnt (nicht bei Haiku).
  if (!model.startsWith('claude-haiku')) {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

async function runStream(params, onText) {
  const c = await client();
  const attempt = async p => {
    const stream = c.beta.messages.stream(p);
    let acc = '';
    if (onText) stream.on('text', delta => { acc += delta; onText(acc); });
    const msg = await stream.finalMessage();
    recordUsage(msg);
    return msg;
  };
  try {
    return await attempt(params);
  } catch (err) {
    // Falls das Konto die Ersatz-Funktion nicht kennt: ohne sie erneut versuchen.
    if (err?.status === 400 && /fallback|beta/i.test(String(err.message)) && params.fallbacks) {
      const { betas, fallbacks, ...rest } = params;
      return attempt(rest).catch(e => { throw friendly(e); });
    }
    throw friendly(err);
  }
}

function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw new AIError('Die KI hat diese Anfrage abgelehnt. Versuch es mit anderen Unterlagen oder einer anderen Formulierung.', 'refusal');
}

function textOf(msg) {
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Liefert strukturiertes JSON nach einem festen Schema.
export async function generateJSON({ fileBlocks = [], prompt, schema, maxTokens = 16000, effort = 'medium', onProgress }) {
  const params = {
    ...baseParams(maxTokens, effort),
    output_config: { effort: sharedMode() ? 'low' : effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [...withCache(fileBlocks), { type: 'text', text: prompt }] }],
  };
  const msg = await runStream(params, onProgress ? s => onProgress(s.length) : null);
  checkStop(msg);
  if (msg.stop_reason === 'max_tokens') throw new AIError('Die Antwort war zu lang. Wähle weniger Inhalte oder eine kleinere Anzahl.', 'length');
  try {
    return JSON.parse(textOf(msg));
  } catch {
    throw new AIError('Die Antwort der KI war unvollständig. Bitte nochmal versuchen.', 'parse');
  }
}

// Liefert Fließtext (Markdown) und meldet ihn stückweise, während er entsteht.
export async function generateText({ fileBlocks = [], prompt, maxTokens = 32000, effort = 'medium', onText }) {
  const params = {
    ...baseParams(maxTokens, effort),
    messages: [{ role: 'user', content: [...withCache(fileBlocks), { type: 'text', text: prompt }] }],
  };
  const msg = await runStream(params, onText);
  checkStop(msg);
  return textOf(msg);
}

// Chat mit Verlauf: Unterlagen stehen in der ersten Nachricht, damit sie zwischengespeichert werden.
// Mit Zitaten (citations), damit die App zur Fundstelle im Skript springen kann.
export async function chat({ fileBlocks = [], history, onText }) {
  const docs = fileBlocks.map(b => (b.type === 'document' ? { ...b, citations: { enabled: true } } : b));
  const messages = history.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: 'user', content: [...withCache(docs), { type: 'text', text: m.content }] };
    }
    return { role: m.role, content: m.content };
  });
  const params = { ...baseParams(8000, 'low', CHAT_SYSTEM), messages };
  const msg = await runStream(params, onText);
  checkStop(msg);
  // Textstücke mit ihren Fundstellen zurückgeben.
  return msg.content.filter(b => b.type === 'text').map(b => ({ text: b.text, citations: b.citations || [] }));
}

export async function testConnection() {
  const params = { ...baseParams(200, 'low'), messages: [{ role: 'user', content: 'Antworte nur mit: Bereit!' }] };
  const msg = await runStream(params);
  return textOf(msg);
}

// ===== Schemas =====
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };
const int = { type: 'integer' };

export const SCHEMAS = {
  topics: obj({ topics: { type: 'array', items: obj({ title: str, description: str }) } }),
  cards: obj({ title: str, cards: { type: 'array', items: obj({ front: str, back: str, topic: str }) } }),
  exam: obj({
    title: str,
    duration_minutes: int,
    questions: {
      type: 'array',
      items: obj({
        type: { type: 'string', enum: ['mc', 'open'] },
        topic: str,
        question: str,
        options: { type: 'array', items: str },
        correct_index: int,
        model_answer: str,
        explanation: str,
        points: int,
      }),
    },
  }),
  grading: obj({
    results: { type: 'array', items: obj({ index: int, points_awarded: int, feedback: str }) },
    overall_feedback: str,
  }),
  plan: obj({
    title: str,
    overview: str,
    steps: {
      type: 'array',
      items: obj({
        title: str,
        description: str,
        activity: { type: 'string', enum: ['summary', 'cards', 'exam', 'review'] },
        topic: str,
        minutes: int,
        day: str,
      }),
    },
  }),
};
