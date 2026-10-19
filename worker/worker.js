// Gemeinsamer KI-Zugang für den Lernomat (Cloudflare Worker).
// Der API-Schlüssel liegt nur hier als Secret, nie in der App. Jede Person hat ein Tageslimit.
//
// Benötigte Einstellungen (siehe worker/ANLEITUNG.md):
//   Secret  ANTHROPIC_API_KEY  – dein Schlüssel von console.anthropic.com
//   KV      LIMITS             – Speicher für die Tageszähler
//   Vars    ALLOWED_ORIGIN, DAILY_LIMIT, ALLOWED_MODELS, DEFAULT_MODEL

const json = (status, obj, cors) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...cors },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'access-control-allow-headers': 'content-type, anthropic-version, anthropic-beta, x-api-key, anthropic-dangerous-direct-browser-access, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-max-age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return json(404, { type: 'error', error: { type: 'not_found_error', message: 'Nicht gefunden' } }, cors);
    if (allowed.length && !allowed.includes(origin)) return json(403, { type: 'error', error: { type: 'permission_error', message: 'Nur für den Lernomat freigegeben.' } }, cors);

    // Tageslimit pro Person (nach IP-Adresse).
    const ip = request.headers.get('cf-connecting-ip') || 'unbekannt';
    const day = new Date().toISOString().slice(0, 10);
    const limitKey = `${day}:${ip}`;
    const limit = Number(env.DAILY_LIMIT || 40);
    const used = Number(await env.LIMITS.get(limitKey)) || 0;
    if (used >= limit) {
      return json(429, { type: 'error', error: { type: 'rate_limit_error', message: `Tageslimit erreicht (${limit} KI-Anfragen). Morgen geht es weiter, oder trage in den Einstellungen einen eigenen API-Schlüssel ein.` } }, cors);
    }
    await env.LIMITS.put(limitKey, String(used + 1), { expirationTtl: 60 * 60 * 36 });

    const body = await request.json();
    const models = (env.ALLOWED_MODELS || 'claude-haiku-5-5').split(',').map(s => s.trim());
    if (!models.includes(body.model)) body.model = env.DEFAULT_MODEL || models[0];
    body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 32000);
    let beta = request.headers.get('anthropic-beta') || '';
    if (body.model.startsWith('claude-haiku')) {
      // Haiku kennt keine serverseitigen Ersatzmodelle.
      delete body.fallbacks;
      beta = beta.split(',').map(s => s.trim()).filter(b => !b.startsWith('server-side-fallback')).join(',');
    }

    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
    };
    if (beta) headers['anthropic-beta'] = beta;
    const upstream = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const out = new Headers(cors);
    out.set('content-type', upstream.headers.get('content-type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
