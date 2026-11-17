/* Boldup — calendarios externos (Google Calendar, Outlook, iCloud) en modo solo lectura.
   Se leen con la «dirección secreta en formato iCal». Los eventos se guardan solo en este dispositivo. */
'use strict';

const EXT_KEY = 'organizador.ext';
const EXT_PAST = 14, EXT_FUTURE = 120;   /* días que se expanden hacia atrás y hacia delante */
let extCache = null, extByDay = null;

function loadExt() {
  if (extCache) return extCache;
  try { extCache = JSON.parse(localStorage.getItem(EXT_KEY)) || {}; } catch { extCache = {}; }
  return extCache;
}
function saveExt() {
  extByDay = null;
  try { localStorage.setItem(EXT_KEY, JSON.stringify(extCache)); } catch {}
}
function extCalendars() { return (state.settings.calendars || []).filter(c => c && c.url); }

/* Eventos externos de un día, ya en tu zona horaria */
function extEventsOn(d) {
  if (!extByDay) {
    extByDay = new Map();
    const cache = loadExt();
    for (const cal of extCalendars()) {
      if (cal.hidden) continue;
      for (const e of ((cache[cal.id] || {}).events || [])) {
        const ev = { ...e, ext: true, calId: cal.id, color: cal.color };
        if (!extByDay.has(e.date)) extByDay.set(e.date, []);
        extByDay.get(e.date).push(ev);
      }
    }
    for (const l of extByDay.values()) l.sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start));
  }
  return extByDay.get(d) || [];
}
function extEventById(id) {
  for (const l of (extByDay || new Map()).values()) { const e = l.find(x => x.id === id); if (e) return e; }
  return null;
}

/* ---------- Leer un archivo .ics ---------- */

function icsUnfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); }
function icsUnescape(v) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
function icsProp(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const head = line.slice(0, i).split(';'), value = line.slice(i + 1);
  const params = {};
  head.slice(1).forEach(p => { const [k, v] = p.split('='); params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); });
  return { name: head[0].toUpperCase(), params, value };
}
/* «20261116T090000» → partes de fecha y hora de pared */
function icsWall(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, utc: !!m[7], dateOnly: !m[4] };
}
/* Diferencia (ms) entre la hora de pared de una zona y UTC en un instante */
function tzOffsetMs(ts, tz) {
  const parts = dtf('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ts));
  const g = t => Number(parts.find(p => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ts;
}
/* Hora de pared en una zona → instante (ms) */
function wallToTs(w, tz) {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  if (w.utc || !tz) return w.utc ? guess : null;
  try {
    let ts = guess - tzOffsetMs(guess, tz);
    ts = guess - tzOffsetMs(ts, tz);
    return ts;
  } catch { return null; }
}
/* Instante → { date, hm } en tu zona */
function tsToLocal(ts) {
  const parts = dtf('en-CA', { timeZone: state.settings.timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
}
const wallKey = w => `${w.y}${pad(w.mo)}${pad(w.d)}`;
const wallYmd = w => `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
function wallAddDays(w, n) { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n)); return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function wallDow(w) { return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay(); }
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/* Fechas (de pared) de cada repetición según RRULE, desde el inicio hasta «hasta» */
function expandRule(start, rule, untilKey, fromKey) {
  const r = Object.fromEntries(rule.split(';').map(x => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ, iv = Math.max(1, Number(r.INTERVAL) || 1), count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? wallKey(icsWall(r.UNTIL)) : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(x => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return m ? { n: m[1] ? Number(m[1]) : 0, wd: BYDAY[m[2]] } : null; }).filter(Boolean) : [];
  const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [];
  const out = [];
  let n = 0;
  const push = w => {
    const k = wallKey(w);
    if (k < wallKey(start)) return true;
    if ((until && k > until) || n >= count) return false;
    n++;
    if (k > untilKey) return false;
    out.push(w);
    return true;
  };
  const monthDays = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  /* Sin COUNT se puede saltar directamente cerca de la ventana (eventos que empezaron hace años) */
  let i0 = 0;
  if (count === Infinity && fromKey) {
    const f = icsWall(fromKey), days = Math.floor((Date.UTC(f.y, f.mo - 1, f.d) - Date.UTC(start.y, start.mo - 1, start.d)) / 86400000);
    const per = freq === 'DAILY' ? iv : freq === 'WEEKLY' ? 7 * iv : freq === 'MONTHLY' ? 28 * iv : freq === 'YEARLY' ? 365 * iv : 0;
    if (per && days > per * 2) i0 = Math.floor(days / per) - 2;
    if (freq === 'MONTHLY' || freq === 'YEARLY') i0 = Math.max(0, Math.floor(i0 * 28 / (freq === 'MONTHLY' ? 31 : 366)));
  }
  for (let i = i0; i < i0 + 3000; i++) {
    let cands = [];
    if (freq === 'DAILY') cands = [wallAddDays(start, i * iv)];
    else if (freq === 'WEEKLY') {
      const wkStart = wallAddDays(start, i * 7 * iv - ((wallDow(start) + 6) % 7));
      const days = byday.length ? byday.map(b => b.wd) : [wallDow(start)];
      cands = days.map(wd => wallAddDays(wkStart, (wd + 6) % 7)).sort((a, b) => wallKey(a).localeCompare(wallKey(b)));
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const step = freq === 'MONTHLY' ? i * iv : i * iv * 12;
      const t = new Date(Date.UTC(start.y, start.mo - 1 + step, 1));
      const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, len = monthDays(y, mo);
      if (freq === 'YEARLY' && !byday.length && !bymd.length) { if (start.d <= len) cands = [{ ...start, y, mo, d: start.d }]; }
      else if (byday.length) {
        for (const b of byday) {
          const all = [];
          for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.wd) all.push(d);
          const pick = b.n > 0 ? [all[b.n - 1]] : b.n < 0 ? [all[all.length + b.n]] : all;
          pick.filter(Boolean).forEach(d => cands.push({ ...start, y, mo, d }));
        }
      } else {
        (bymd.length ? bymd : [start.d]).forEach(md => { const d = md < 0 ? len + md + 1 : md; if (d >= 1 && d <= len) cands.push({ ...start, y, mo, d }); });
      }
      cands.sort((a, b) => a.d - b.d);
    } else { cands = i === 0 ? [start] : []; }
    if (!cands.length && freq !== 'MONTHLY' && freq !== 'YEARLY') break;
    for (const c of cands) if (!push(c)) return out;
  }
  return out;
}

/* Convierte el texto .ics en eventos por día (en tu zona) dentro de la ventana */
function parseIcs(text, from, to) {
  const lines = icsUnfold(text);
  const vevents = [];
  let cur = null, calTz = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) vevents.push(cur); cur = null; continue; }
    const p = icsProp(line);
    if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-TIMEZONE') calTz = p.value.trim(); continue; }
    if (p.name === 'EXDATE') p.value.split(',').forEach(v => { const w = icsWall(v); if (w) cur.exdates.push(wallKey(w)); });
    else cur.props[p.name] = p;
  }
  const fromKey = from.replace(/-/g, ''), toKey = to.replace(/-/g, '');
  const overrides = new Map();   /* UID → fechas con versión propia */
  vevents.forEach(v => { const rid = v.props['RECURRENCE-ID']; if (rid && v.props.UID) { const w = icsWall(rid.value); if (w) { const u = v.props.UID.value; if (!overrides.has(u)) overrides.set(u, new Set()); overrides.get(u).add(wallKey(w)); } } });
  const out = [];
  for (const v of vevents) {
    const P = v.props;
    if (!P.DTSTART || (P.STATUS && P.STATUS.value === 'CANCELLED')) continue;
    const title = P.SUMMARY ? icsUnescape(P.SUMMARY.value) : '(Sin título)';
    const loc = P.LOCATION ? icsUnescape(P.LOCATION.value) : '';
    const tz = P.DTSTART.params.TZID || calTz;
    const s = icsWall(P.DTSTART.value);
    if (!s) continue;
    const allDay = s.dateOnly || P.DTSTART.params.VALUE === 'DATE';
    let e = P.DTEND ? icsWall(P.DTEND.value) : null;
    let durMin;
    if (allDay) durMin = e ? Math.max(1, Math.round((Date.UTC(e.y, e.mo - 1, e.d) - Date.UTC(s.y, s.mo - 1, s.d)) / 86400000)) * 1440 : 1440;
    else if (e) durMin = Math.round((Date.UTC(e.y, e.mo - 1, e.d, e.h, e.mi) - Date.UTC(s.y, s.mo - 1, s.d, s.h, s.mi)) / 60000);
    else if (P.DURATION) { const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(P.DURATION.value) || []; durMin = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0); }
    else durMin = 60;
    /* Las fechas de una zona distinta a la del evento se calculan en su hora de pared */
    const winEnd = wallKey(icsWall(addDays(to, 1).replace(/-/g, '')));
    const isOverride = !!P['RECURRENCE-ID'];
    const uid = P.UID ? P.UID.value : Math.random().toString(36);
    const skip = (!isOverride && overrides.get(uid)) || new Set();
    const starts = P.RRULE && !isOverride ? expandRule(s, P.RRULE.value, winEnd, fromKey) : [s];
    for (const w of starts) {
      if (v.exdates.includes(wallKey(w)) || skip.has(wallKey(w))) continue;
      if (allDay) {
        for (let k = 0; k < Math.max(1, Math.round(durMin / 1440)); k++) {
          const d = wallYmd(wallAddDays(w, k));
          if (d >= from && d <= to) out.push({ id: `x${hashStr(uid + d)}`, title, loc, date: d, start: '00:00', end: '23:59', allDay: true });
        }
        continue;
      }
      const ts = wallToTs(w, tz);
      let a, b;
      if (ts === null) { a = { date: wallYmd(w), hm: `${pad(w.h)}:${pad(w.mi)}` }; const t2 = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi + durMin)); b = { date: ymd(new Date(t2.getUTCFullYear(), t2.getUTCMonth(), t2.getUTCDate())), hm: `${pad(t2.getUTCHours())}:${pad(t2.getUTCMinutes())}` }; }
      else { a = tsToLocal(ts); b = tsToLocal(ts + durMin * 60000); }
      if (a.date < from || a.date > to) continue;
      const end = b.date > a.date ? '23:59' : (b.hm > a.hm ? b.hm : fmtHM(Math.min(toMin(a.hm) + 15, 1439)));
      out.push({ id: `x${hashStr(uid + a.date + a.hm)}`, title, loc, date: a.date, start: a.hm, end, allDay: false });
    }
  }
  return out;
}
function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/* ---------- Descargar ---------- */

function normalizeIcsUrl(u) { return String(u || '').trim().replace(/^webcal:\/\//i, 'https://'); }
async function fetchIcs(url) {
  url = normalizeIcsUrl(url);
  /* Algunos servidores dejan leer directamente; Google no, así que se pasa por tu función de Supabase */
  if (typeof cloudReady === 'function' && cloudReady() && getSession()) {
    const tok = await accessToken();
    const res = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/ics', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok }, body: JSON.stringify({ url }),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt.slice(0, 160) || 'Error ' + res.status);
    return txt;
  }
  try {
    const res = await fetch(url);
    if (res.ok) return await res.text();
  } catch {}
  throw new Error('Entra en tu cuenta (Ajustes) para poder leer este calendario.');
}
async function refreshCalendar(cal) {
  const cache = loadExt();
  try {
    const txt = await fetchIcs(cal.url);
    if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error('Esa dirección no devuelve un calendario. Copia la «dirección secreta en formato iCal».');
    const today = todayStr();
    cache[cal.id] = { at: Date.now(), events: parseIcs(txt, addDays(today, -EXT_PAST), addDays(today, EXT_FUTURE)), error: '' };
  } catch (e) {
    cache[cal.id] = { ...(cache[cal.id] || { events: [] }), error: e.message, at: (cache[cal.id] || {}).at || 0 };
  }
  saveExt();
  return cache[cal.id];
}
let extRefreshing = null;
/* Actualiza los calendarios que tengan más de 30 min (o todos si force) */
function refreshCalendars(force) {
  if (extRefreshing) return extRefreshing;
  const cache = loadExt();
  const due = extCalendars().filter(c => force || !cache[c.id] || Date.now() - (cache[c.id].at || 0) > 30 * 60000);
  if (!due.length) return Promise.resolve(false);
  extRefreshing = Promise.all(due.map(refreshCalendar)).then(() => true).finally(() => { extRefreshing = null; });
  return extRefreshing;
}
function forgetCalendar(id) { const c = loadExt(); delete c[id]; saveExt(); }
