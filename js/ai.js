// Die KI des Lernomats: Anbindung an die Claude API mit dem eigenen API-Schlüssel.
// Offizielles Anthropic-SDK, lokal gebündelt (funktioniert dadurch auch ohne CDN).
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
export const hasKey = () => !!getSettings().apiKey;

let sdkPromise;
async function client() {
  const { apiKey } = getSettings();
  if (!apiKey) throw new AIError('Bitte hinterlege zuerst deinen API-Schlüssel in den Einstellungen.', 'nokey');
  sdkPromise ||= import(SDK_URL).catch(e => { sdkPromise = null; throw e; });
  let mod;
  try { mod = await sdkPromise; } catch {
    throw new AIError('Die KI konnte nicht geladen werden. Bist du mit dem Internet verbunden?', 'offline');
  }
  const Anthropic = mod.default || mod.Anthropic;
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export class AIError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

function friendly(err) {
  if (err instanceof AIError) return err;
  const status = err?.status;
  const raw = String(err?.message || err);
  if (status === 401) return new AIError('Der API-Schlüssel ist ungültig. Prüfe ihn in den Einstellungen.', 'auth');
  if (status === 403) return new AIError('Dein API-Schlüssel hat keinen Zugriff auf dieses Modell.', 'auth');
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

function baseParams(maxTokens, effort) {
  const { model } = getSettings();
  const p = { model, max_tokens: maxTokens, system: SYSTEM, output_config: { effort } };
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
    if (onText) stream.on('text', (_delta, snapshot) => onText(snapshot));
    return stream.finalMessage();
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
    output_config: { effort, format: { type: 'json_schema', schema } },
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
export async function chat({ fileBlocks = [], history, onText }) {
  const messages = history.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: 'user', content: [...withCache(fileBlocks), { type: 'text', text: m.content }] };
    }
    return { role: m.role, content: m.content };
  });
  const params = { ...baseParams(8000, 'low'), messages };
  const msg = await runStream(params, onText);
  checkStop(msg);
  return textOf(msg);
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
