// Nomis Denk-Modus: ein kleines Sprachmodell, das direkt im Browser läuft (WebLLM, braucht WebGPU).
// Einmal herunterladen, danach offline nutzbar. Ohne Denk-Modus arbeitet Nomi trotzdem, nur einfacher.
const LIB = '../vendor/web-llm-0.2.86.min.js';
const KEY = 'lernomat.llm';

export const MODELS = [
  { id: 'Qwen3.5-0.8B', name: 'Klein & schnell', size: 'ca. 0,6 GB', note: 'Für iPhone, iPad und ältere Geräte' },
  { id: 'Qwen3.5-2B', name: 'Schlauer', size: 'ca. 1,5 GB', note: 'Für Mac und neuere Geräte' },
];

let engine = null;
let loading = null;
let state = 'off';
let progress = { text: '', value: 0 };
const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(state, progress); } catch { /* egal */ } });
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const status = () => ({ state, progress, model: chosen() });

export const chosen = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const setChosen = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* egal */ } };
export const ready = () => state === 'ready';

let support;
// Prüft, ob das Gerät WebGPU kann und ob es halbe Genauigkeit (f16) unterstützt.
export function checkSupport() {
  support ||= (async () => {
    if (!navigator.gpu) return { ok: false, why: 'Dein Browser kann noch kein WebGPU. Auf dem iPhone braucht es iOS 26, auf dem Mac Safari 26 oder Chrome.' };
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) return { ok: false, why: 'Auf diesem Gerät ist keine passende Grafikeinheit verfügbar.' };
      return { ok: true, f16: a.features.has('shader-f16') };
    } catch { return { ok: false, why: 'WebGPU ist auf diesem Gerät gesperrt.' }; }
  })();
  return support;
}

async function fullId(base) {
  const s = await checkSupport();
  return `${base}-${s.f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}

// Lädt (und beim ersten Mal: lädt herunter) das gewählte Modell.
export async function load(base = chosen() || MODELS[0].id) {
  if (engine && state === 'ready' && chosen() === base) return engine;
  if (loading) return loading;
  loading = (async () => {
    const s = await checkSupport();
    if (!s.ok) throw new Error(s.why);
    state = 'loading'; progress = { text: 'Starte …', value: 0 }; emit();
    try {
      if (engine) { try { await engine.unload(); } catch { /* egal */ } engine = null; }
      const webllm = await import(LIB);
      const worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, await fullId(base), {
        initProgressCallback: r => {
          progress = { text: germanProgress(r), value: r.progress || 0 };
          emit();
        },
      });
      setChosen(base);
      state = 'ready'; progress = { text: 'Bereit', value: 1 }; emit();
      return engine;
    } catch (err) {
      state = 'error';
      progress = { text: friendly(err), value: 0 };
      emit();
      engine = null;
      throw new Error(progress.text);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function germanProgress(r) {
  const t = String(r.text || '');
  const pct = Math.round((r.progress || 0) * 100);
  if (/fetch|download|Loading model from cache|cache\[/i.test(t)) {
    const mb = /(\d+)MB (?:fetched|loaded)/i.exec(t);
    return /cache/i.test(t) && !/fetch/i.test(t) ? `Lade Modell aus dem Speicher … ${pct} %` : `Lade herunter … ${pct} %${mb ? ` (${mb[1]} MB)` : ''}`;
  }
  if (/shader|gpu|compil/i.test(t)) return 'Bereite die Grafikeinheit vor …';
  return pct ? `Lade … ${pct} %` : 'Starte …';
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/quota|storage|QuotaExceeded/i.test(m)) return 'Auf dem Gerät ist nicht genug Speicherplatz für das Sprachmodell frei.';
  if (/fetch|network|Failed to fetch|Load failed/i.test(m)) return 'Download fehlgeschlagen. Bist du mit dem Internet (am besten WLAN) verbunden?';
  if (/memory|OOM|out of memory|allocation|maxBufferSize|maxStorageBufferBindingSize/i.test(m)) return 'Das Modell braucht mehr Arbeitsspeicher, als dieses Gerät hat. Probier das kleine Modell.';
  if (/WebGPU|gpu/i.test(m)) return 'Die Grafikeinheit dieses Geräts unterstützt das Sprachmodell nicht.';
  return 'Das Sprachmodell konnte nicht gestartet werden: ' + m.slice(0, 160);
}

// Schreibt eine Antwort; meldet den Text stückweise.
export async function generate(messages, { onText, maxTokens = 600, temperature = 0.4 } = {}) {
  const e = await load();
  const stream = await e.chat.completions.create({
    messages, stream: true, max_tokens: maxTokens, temperature, top_p: 0.9,
    extra_body: { enable_thinking: false },
  });
  let acc = '';
  for await (const chunk of stream) {
    acc += chunk.choices?.[0]?.delta?.content || '';
    const shown = acc.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
    onText?.(shown);
  }
  return acc.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

export function stop() { try { engine?.interruptGenerate(); } catch { /* egal */ } }

// Modell vom Gerät löschen (gibt den Speicher frei).
export async function remove() {
  const base = chosen();
  try { await engine?.unload(); } catch { /* egal */ }
  engine = null;
  state = 'off'; progress = { text: '', value: 0 };
  setChosen('');
  if (base) {
    try {
      const webllm = await import(LIB);
      await webllm.deleteModelAllInfoInCache(await fullId(base));
    } catch { /* schon weg */ }
  }
  emit();
}
