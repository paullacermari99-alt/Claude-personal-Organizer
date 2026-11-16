// P Organizer — envía los recordatorios aunque la app esté cerrada.
// Se ejecuta cada minuto (supabase/cron.sql). Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET.
// "Verify JWT" debe estar desactivado: la protege la cabecera x-cron-secret.
import webpush from 'npm:web-push@3.6.7';

const URL_ = Deno.env.get('SUPABASE_URL')!;
function secretKey(): string {
  try {
    const all = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = all.default || Object.values(all)[0];
    if (k) return k as string;
  } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const KEY = secretKey();
webpush.setVapidDetails('https://paullacermari99-alt.github.io/Claude-personal-Organizer/', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}), 'Content-Type': 'application/json', ...(init.headers || {}) } });

// ---- Fechas en la zona horaria del usuario ----
const pad = (n: number) => String(n).padStart(2, '0');
function nowIn(tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t: string) => p.find(x => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
}
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const dow = (s: string) => parse(s).getUTCDay();
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

// deno-lint-ignore no-explicit-any
type Any = any;
function eventsOn(st: Any, d: string) {
  const out: Any[] = [];
  for (const e of st.events || []) {
    if (!e.recurrence) { if (e.date === d) out.push(e); continue; }
    const r = e.recurrence;
    if (d < e.date || (r.until && d > r.until) || (e.exceptions || []).includes(d)) continue;
    if (r.days && r.days.length && !r.days.includes(dow(d))) continue;
    out.push({ ...e, date: d, id: `${e.id}@${d}` });
  }
  return out;
}
function routineDueOn(r: Any, d: string) {
  if (d < r.startDate) return false;
  if ((r.pauses || []).some((p: Any) => d >= p.from && (!p.to || d < p.to))) return false;
  return !r.days || !r.days.length || r.days.includes(dow(d));
}
function pendingRoutines(st: Any, today: string) {
  let n = 0;
  for (const r of st.routines || []) {
    const tasks = new Map((st.tasks || []).filter((t: Any) => t.routineId === r.id).map((t: Any) => [t.routineDate, t]));
    const skip = new Set(r.skipped || []);
    for (let d = r.startDate; d <= today; d = addDays(d, 1)) {
      if (!routineDueOn(r, d) || skip.has(d)) continue;
      const t: Any = tasks.get(d);
      if (!t || !t.done) n++;
    }
  }
  return n;
}
function inQuiet(r: Any, hm: string) {
  const a = r.quietFrom, b = r.quietTo;
  if (!a || !b || a === b) return false;
  return a < b ? hm >= a && hm < b : hm >= a || hm < b;
}
const relDay = (today: string, d: string) => d === today ? 'hoy' : d === addDays(today, 1) ? 'mañana' : d;

function remindersFor(st: Any) {
  const r = st.settings?.reminders || {};
  if (!r.enabled) return [];
  const { date: today, hm } = nowIn(st.settings?.timezone || 'Europe/Madrid');
  if (inQuiet(r, hm)) return [];
  const out: { key: string; title: string; body: string }[] = [];
  if (r.blocks) for (const e of eventsOn(st, today)) {
    const diff = toMin(e.start) - toMin(hm);
    if (diff >= 0 && diff <= r.blocks) out.push({ key: `ev:${e.id}:${today}`, title: e.title, body: `Empieza a las ${e.start}` });
  }
  if (r.deadlines && r.deadlines !== 'off' && hm >= (r.deadlineTime || '09:00')) {
    const target = r.deadlines === 'day-before' ? addDays(today, 1) : today;
    for (const t of st.tasks || []) if (!t.done && !t.routineId && t.due === target) out.push({ key: `due:${t.id}:${target}`, title: `Plazo ${relDay(today, target)}`, body: t.title });
    for (const g of st.goals || []) if (g.status !== 'cumplido' && g.due === target) out.push({ key: `goal:${g.id}:${target}`, title: `Objetivo: plazo ${relDay(today, target)}`, body: g.title });
  }
  if (r.dailySummary && hm >= r.dailySummary) {
    const n = pendingRoutines(st, today);
    if (n) out.push({ key: `sum:${today}`, title: 'Diarias pendientes', body: `Tienes ${n} pendiente${n === 1 ? '' : 's'}.` });
  }
  return out;
}

Deno.serve(async req => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const subs: Any[] = await (await db('push_subscriptions?select=*')).json();
  const byUser = new Map<string, Any[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);
  let sent = 0;
  for (const [uid, list] of byUser) {
    const rows: Any[] = await (await db(`organizer_state?select=data&user_id=eq.${uid}`)).json();
    if (!rows[0]) continue;
    const due = remindersFor(rows[0].data);
    if (!due.length) continue;
    const done: Any[] = await (await db(`sent_reminders?select=key&user_id=eq.${uid}&key=in.(${due.map(d => `"${d.key}"`).join(',')})`)).json();
    const already = new Set(done.map(d => d.key));
    for (const n of due.filter(d => !already.has(d.key))) {
      await db('sent_reminders', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ user_id: uid, key: n.key }) });
      for (const s of list) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: n.title, body: n.body, tag: n.key }));
          sent++;
        } catch (e: Any) {
          if (e.statusCode === 404 || e.statusCode === 410) await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
        }
      }
    }
  }
  return new Response(JSON.stringify({ users: byUser.size, sent }), { headers: { 'Content-Type': 'application/json' } });
});
