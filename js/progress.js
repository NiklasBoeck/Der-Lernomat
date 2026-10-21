// Lernfortschritt: Wiederholung mit System (Karteikarten kommen wieder, kurz bevor man sie vergisst),
// Tagesziel mit Serie (Streak) und Erinnerung. Alles bleibt auf dem Gerät.

const DAY = 864e5;
export const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (t, n) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return d.getTime(); };

// ===== Wiederholung mit System =====
// Jede Karte hat einen Abstand in Tagen (ivl) und ein Fälligkeitsdatum (due). Gewusst: Abstand wächst
// (1 → 3 → 7 → 16 → 35 Tage …), Nochmal: die Karte kommt noch in derselben Runde und morgen wieder.
// box (0–4) bleibt als Anzeige der Sicherheit erhalten, so passen alte Lernsets weiter.
const FIRST = [1, 3, 7, 16];

export const isDue = (c, now = Date.now()) => !c.due || c.due <= now;
export const isNew = c => !c.seen;

export function review(c, good, now = Date.now()) {
  c.seen = (c.seen || 0) + 1;
  c.last = now;
  if (good) {
    // In derselben Runde schon einmal falsch? Dann nur einen Tag Abstand.
    const lapsedToday = c.lapse && c.lapse >= dayStart(now);
    const prev = c.ivl || 0;
    c.ivl = lapsedToday ? 1 : prev < FIRST[FIRST.length - 1] ? FIRST.find(x => x > prev) : Math.round(prev * (c.ease || 2.2));
    c.ivl = Math.min(c.ivl, 365);
    c.box = Math.min(4, (c.box || 0) + 1);
    c.due = addDays(now, c.ivl);
  } else {
    c.lapse = now;
    c.ivl = 0;
    c.box = 0;
    c.ease = Math.max(1.5, (c.ease || 2.2) - 0.2);
    c.due = addDays(now, 1);
  }
  return c;
}

export function dueCards(cards, now = Date.now()) { return cards.filter(c => isDue(c, now)); }

// Wann ist die nächste Karte fällig (für „Alles geschafft, morgen geht's weiter“)?
export function nextDue(cards, now = Date.now()) {
  const later = cards.filter(c => c.due && c.due > now).map(c => c.due);
  return later.length ? Math.min(...later) : null;
}

export function whenText(t, now = Date.now()) {
  const d = Math.round((dayStart(t) - dayStart(now)) / DAY);
  if (d <= 0) return 'heute';
  if (d === 1) return 'morgen';
  if (d < 7) return `in ${d} Tagen`;
  return new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
}

// ===== Tagesziel und Serie =====
const KEY = 'lernomat.progress';
const DEFAULT = { goal: 20, days: {}, reminder: { on: false, time: '18:00' } };

export function loadProgress() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT }; }
}
function saveProgress(p) {
  // Nur die letzten 400 Tage aufheben.
  const keys = Object.keys(p.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete p.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* Speicher voll */ }
}
export function setGoal(n) {
  const p = loadProgress();
  p.goal = n;
  if (p.days[dayKey()]) p.days[dayKey()].goal = n;
  saveProgress(p);
}
export function setReminder(r) { const p = loadProgress(); p.reminder = { ...p.reminder, ...r }; saveProgress(p); }

const listeners = new Set();
export const onGoalReached = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// Zählt gelernte Karten und Fragen (Karteikarten, Eulen-Blitz, Klausuraufgaben) für heute.
export function logActivity(n = 1, subjectId = null) {
  const p = loadProgress();
  const k = dayKey();
  const d = p.days[k] || { n: 0, subj: {} };
  const before = d.n;
  d.n += n;
  d.goal = p.goal;
  if (subjectId) d.subj[subjectId] = (d.subj[subjectId] || 0) + n;
  p.days[k] = d;
  saveProgress(p);
  if (before < p.goal && d.n >= p.goal) listeners.forEach(fn => fn(streak().days));
}

export function today() {
  const p = loadProgress();
  return { n: p.days[dayKey()]?.n || 0, goal: p.goal };
}

// Serie: Tage hintereinander mit erreichtem Tagesziel. Heute zählt mit, sobald das Ziel geschafft ist;
// solange heute noch offen ist, bleibt die Serie von gestern stehen.
export function streak() {
  const p = loadProgress();
  // Jeder Tag zählt mit dem Ziel, das an dem Tag galt.
  const ok = k => (p.days[k]?.n || 0) >= (p.days[k]?.goal || p.goal);
  let n = 0;
  let t = Date.now();
  const todayOk = ok(dayKey(t));
  if (!todayOk) t = addDays(t, -1);
  while (ok(dayKey(t))) { n++; t = addDays(t, -1); }
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(p.days).sort()) {
    const yesterday = dayKey(addDays(new Date(k + 'T12:00').getTime(), -1));
    run = !ok(k) ? 0 : prev === yesterday && run ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
  }
  return { days: n, todayOk, best: Math.max(best, n) };
}

// Die letzten 7 Tage für die Wochenanzeige.
export function week() {
  const p = loadProgress();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const t = addDays(Date.now(), -i);
    const n = p.days[dayKey(t)]?.n || 0;
    out.push({ label: new Date(t).toLocaleDateString('de-DE', { weekday: 'narrow' }), n, ok: n >= (p.days[dayKey(t)]?.goal || p.goal), today: i === 0 });
  }
  return out;
}

export function learnedOn(subjectId, days = 7) {
  const p = loadProgress();
  let n = 0;
  for (let i = 0; i < days; i++) n += p.days[dayKey(addDays(Date.now(), -i))]?.subj?.[subjectId] || 0;
  return n;
}

// ===== Erinnerung =====
// Web-Apps dürfen auf iPhone und Mac keine Weckzeit im Hintergrund stellen. Deshalb gibt es zwei Wege:
// 1) ein wiederkehrender Kalendertermin mit Alarm (klappt immer, auch wenn die App zu ist),
// 2) eine Mitteilung, wenn die App zur Erinnerungszeit offen ist, und ein Hinweis beim nächsten Öffnen.
export function reminderDue() {
  const p = loadProgress();
  if (!p.reminder.on) return false;
  const [h, m] = p.reminder.time.split(':').map(Number);
  const at = new Date(); at.setHours(h, m, 0, 0);
  return Date.now() >= at.getTime() && today().n < p.goal;
}

let reminderTimer = null;
export function scheduleReminder() {
  clearTimeout(reminderTimer);
  const p = loadProgress();
  if (!p.reminder.on) return;
  const [h, m] = p.reminder.time.split(':').map(Number);
  const at = new Date(); at.setHours(h, m, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  reminderTimer = setTimeout(async () => {
    const t = today();
    if (t.n < t.goal) await notify('Zeit für deine Lernrunde 🦉', `Noch ${t.goal - t.n} Karten bis zu deinem Tagesziel.${streak().days ? ` Halte deine Serie von ${streak().days} Tagen!` : ''}`);
    scheduleReminder();
  }, Math.min(at.getTime() - Date.now(), 2 ** 31 - 1));
}

async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'lernomat-reminder' });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch { /* Mitteilungen nicht möglich */ }
}

export async function askNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') { try { return await Notification.requestPermission(); } catch { return 'denied'; } }
  return Notification.permission;
}

// Kalendertermin (.ics) für jeden Tag zur Erinnerungszeit, mit Alarm.
export function reminderIcs(time, url) {
  const [h, m] = time.split(':');
  const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Der Lernomat//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:lernomat-erinnerung-${ymd}@lernomat`, `DTSTAMP:${stamp}`, `DTSTART:${ymd}T${h}${m}00`, `DURATION:PT15M`, 'RRULE:FREQ=DAILY',
    'SUMMARY:🦉 Lernomat: Tagesziel', `DESCRIPTION:Zeit für deine Lernrunde im Lernomat. ${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Zeit für deine Lernrunde im Lernomat', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
