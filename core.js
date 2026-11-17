/* P Organizer — núcleo: datos, fechas, migración, rutinas (diarias) y cálculos.
   Se carga primero; las vistas viven en app.js y calendar.js. */
'use strict';

const STORE_KEY = 'organizador.v1';
const TIMER_KEY = 'organizador.timer';
const COLORS = ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#ff3b30', '#30b0c7', '#a2845e', '#64748b', '#0f766e', '#d97706'];
const PROJECT_ICONS = ['📁', '💼', '📚', '🎓', '💡', '🎯', '🏠', '💰', '🏋️', '❤️', '🎨', '💻', '✈️', '🌱', '🎵', '⭐'];
const HORIZONS = { corto: 'Corto plazo', medio: 'Medio plazo', largo: 'Largo plazo' };
const PRIORITIES = { none: 'Sin prioridad', low: 'Baja', med: 'Media', high: 'Alta' };
const ESTIMATES = [5, 10, 15, 25, 30, 45, 60, 90, 120, 180];

/* Iconos (trazos al estilo SF Symbols) */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  star: svg('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  starFill: svg('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  left: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>', 'stroke-width="2.2"'),
  right: svg('<path d="M9.5 5.5L16 12l-6.5 6.5"/>', 'stroke-width="2.2"'),
  down: svg('<path d="M6 9.5l6 6 6-6"/>', 'stroke-width="2.2"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 'stroke-width="2.2"'),
  shrink: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', 'stroke-width="2.2"'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
  template: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M3.5 9.5h17M9.5 9.5v11"/>'),
  pause: svg('<path d="M8 5.5v13M16 5.5v13"/>', 'stroke-width="3"'),
  reset: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>', 'stroke-width="2.2"'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  cal: svg('<rect x="3.5" y="4.5" width="17" height="16" rx="3.5"/><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4"/>'),
  resched: svg('<rect x="3.5" y="4.5" width="17" height="16" rx="3.5"/><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4M10 15h6M13.5 12.5L16 15l-2.5 2.5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>', 'stroke-width="1.6"'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  repeat: svg('<path d="M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 015-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 01-5 5H4"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', 'stroke-width="2.2"'),
  grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  flag: svg('<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V9M10 13h4"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>', 'stroke-width="2"'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="2.2"'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  review: svg('<path d="M9 11l2.5 2.5L16 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="3"/><path d="M15.5 8.5V6a2.5 2.5 0 00-2.5-2.5H6A2.5 2.5 0 003.5 6v7A2.5 2.5 0 006 15.5h2.5"/>'),
  daily: svg('<path d="M4 12a8 8 0 0113.7-5.6M20 12a8 8 0 01-13.7 5.6"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
};

/* ---------- Utilidades ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = n => String(n).padStart(2, '0');
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Fechas (respetando la zona horaria elegida) ---------- */

/* Crear un Intl.DateTimeFormat es caro (sobre todo en móvil): se crean una vez y se reutilizan,
   y la hora actual se recalcula como mucho una vez por segundo. */
const fmtCache = new Map();
function dtf(locale, opts) {
  const k = locale + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(locale, opts); fmtCache.set(k, f); }
  return f;
}
let nowCache = { key: '', val: null };
function tzNow() {
  const tz = (state && state.settings && state.settings.timezone) || '';
  const key = tz + '|' + Math.floor(Date.now() / 1000);
  if (nowCache.key === key) return nowCache.val;
  let val;
  try {
    const parts = dtf('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t).value;
    val = { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
  } catch {
    const d = new Date();
    val = { date: ymd(d), hm: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }
  nowCache = { key, val };
  return val;
}
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return tzNow().date; }
function nowHHMM() { return tzNow().hm; }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function daysUntil(s) { return daysBetween(todayStr(), s); }
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
const fmtHM = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
function fmtShortDate(s) { return dtf('es-ES', { day: 'numeric', month: 'short' }).format(parseYmd(s)); }
function fmtLongDate(s) { return cap(dtf('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseYmd(s))); }
function dow(s) { return parseYmd(s).getDay(); }
function relDay(s) {
  const n = daysUntil(s);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  if (n > 1 && n < 7) return cap(dtf('es-ES', { weekday: 'long' }).format(parseYmd(s)));
  return fmtShortDate(s);
}
function startOfWeek(s) {
  const ws = state ? state.settings.weekStart : 1;
  const d = parseYmd(s);
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7));
  return ymd(d);
}
function weekDays(ws) { return Array.from({ length: 7 }, (_, i) => addDays(ws, i)); }
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DOW_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/* ---------- Estado ---------- */

function defaultSettings() {
  let tz = 'Europe/Madrid';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
  return {
    timezone: tz, weekStart: 1, focusMinutes: 25, dayStart: '08:00', dayEnd: '21:00', calendars: [],
    reminders: { enabled: false, blocks: 10, deadlines: 'day-before', deadlineTime: '09:00', dailySummary: '', morning: '', quietFrom: '22:00', quietTo: '08:00' },
    ui: { collapsed: {}, projectsView: 'cards', projectsSort: 'manual', projectsArchived: false, tasksTab: 'bandeja', weekMode: '7', goalsHorizon: 'todos', goalsStatus: 'activos', goalsProject: '', lastReview: null },
  };
}
/* Sube este número para empezar de cero en todos los dispositivos (se conservan los ajustes y la cuenta) */
const DATA_EPOCH = 2;
function emptyState() {
  return { version: 2, epoch: DATA_EPOCH, tasks: [], events: [], routines: [], habits: [], goals: [], projects: [], tags: [], dayPlans: {}, weekPlans: {}, journal: {}, focusLog: [], notified: {}, settings: defaultSettings() };
}
function horizonFor(due) {
  if (!due) return 'medio';
  const n = daysUntil(due);
  return n <= 90 ? 'corto' : n <= 365 ? 'medio' : 'largo';
}
function defaultTags() {
  return [
    { id: uid(), name: 'Estudio', color: '#5856d6' },
    { id: uid(), name: 'Trabajo', color: '#ff9500' },
    { id: uid(), name: 'Personal', color: '#34c759' },
  ];
}
function newTask(extra = {}) {
  return { id: uid(), title: '', notes: '', done: false, doneAt: null, createdAt: Date.now(), due: null, priority: 'none', tags: [], estimate: null, projectId: null, goalId: null, subtasks: [], firstStep: '', startedAt: null, routineId: null, routineDate: null, ...extra };
}

/* Convierte datos de versiones anteriores sin perder nada */
function migrate(s) {
  const base = emptyState();
  /* Sin época = datos anteriores a la versión que empezó de cero */
  const epoch = s.epoch || 1;
  if (!s.version || s.version < 2) {
    const tasks = (s.tasks || []).map(t => newTask({
      id: t.id, title: t.title || '', done: !!t.done, doneAt: t.doneAt || null, createdAt: t.createdAt || Date.now(),
      due: t.date || null, projectId: t.projectId || null, goalId: t.goalId || null,
    }));
    const events = (s.blocks || []).map(b => ({ id: b.id, title: b.title, date: b.date, start: b.start, end: b.end, taskId: b.taskId || null, color: null, tagId: null, projectId: b.projectId || null, goalId: b.goalId || null, recurrence: null, exceptions: [] }));
    const goals = (s.goals || []).map(g => ({
      id: g.id, title: g.title, horizon: horizonFor(g.deadline), due: g.deadline || null, description: g.why || '', success: '', projectId: null,
      status: g.status === 'logrado' ? 'cumplido' : 'activo', achievedAt: g.status === 'logrado' ? ymd(new Date()) : null,
      progressMode: 'auto', progress: 0, color: g.color || COLORS[0], createdAt: g.createdAt || Date.now(),
    }));
    const projects = (s.projects || []).map((p, i) => ({
      id: p.id, name: p.name, color: p.color || COLORS[0], icon: '📁', archived: p.status === 'hecho', favorite: false, order: i,
      defaultView: 'resumen', notes: p.notes || '', createdAt: p.createdAt || Date.now(),
    }));
    /* Antes un proyecto apuntaba a un objetivo; ahora el objetivo pertenece al proyecto */
    (s.projects || []).forEach(p => { const g = goals.find(x => x.id === p.goalId); if (g && !g.projectId) g.projectId = p.id; });
    const dayPlans = {};
    (s.tasks || []).filter(t => t.important && t.date).forEach(t => {
      const dp = dayPlans[t.date] = dayPlans[t.date] || { priorities: [] };
      if (dp.priorities.length < 3) dp.priorities.push(t.id);
    });
    s = { ...base, tasks, events, goals, projects, dayPlans, tags: defaultTags(), focusLog: s.focusLog || [],
      settings: { ...base.settings, focusMinutes: (s.settings && s.settings.focusMinutes) || 25 } };
  }
  s = { ...base, ...s, settings: { ...base.settings, ...s.settings, reminders: { ...base.settings.reminders, ...(s.settings || {}).reminders }, ui: { ...base.settings.ui, ...(s.settings || {}).ui } } };
  s.version = 2;
  s.epoch = epoch;
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch (e) { console.warn('No se pudo leer el estado', e); return null; }
}
/* quiet = guardar sin marcarlo como cambio (p. ej. diarias generadas): no pisa datos más nuevos de otro dispositivo */
function save(quiet) {
  if (!quiet) state.updatedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
  if (!quiet && typeof scheduleSync === 'function') scheduleSync();
}

/* ---------- Datos de ejemplo (solo la primera vez) ---------- */

/* Usuario nuevo: empieza vacío, solo con las etiquetas básicas */
function seedState() {
  state = emptyState();
  state.tags = defaultTags();
}
/* Datos de una versión anterior a DATA_EPOCH: se vacían, pero se conservan ajustes y etiquetas */
const isOldEpoch = s => !!s && (s.epoch || 1) < DATA_EPOCH;
function resetForNewEpoch(old) {
  const fresh = emptyState();
  fresh.settings = old.settings || fresh.settings;
  fresh.tags = (old.tags && old.tags.length) ? old.tags : defaultTags();
  fresh.updatedAt = Date.now();
  return fresh;
}

/* ---------- Búsquedas y cálculos ---------- */

const byId = (list, id) => list.find(x => x.id === id);
const task = id => byId(state.tasks, id);
const project = id => byId(state.projects, id);
const goal = id => byId(state.goals, id);
const tag = id => byId(state.tags, id);
const routine = id => byId(state.routines, id);

function isOverdue(t) { return !t.done && t.due && t.due < todayStr(); }
function isRoutineTask(t) { return !!t.routineId; }
function projectOfTask(t) {
  if (t.projectId) return project(t.projectId);
  const g = t.goalId && goal(t.goalId);
  return g && g.projectId ? project(g.projectId) : null;
}
/* Tareas de un proyecto: las suyas y las de sus objetivos */
function tasksOfProject(pid) {
  const gids = new Set(state.goals.filter(g => g.projectId === pid).map(g => g.id));
  return state.tasks.filter(t => !isRoutineTask(t) && (t.projectId === pid || (t.goalId && gids.has(t.goalId))));
}
function tasksOfGoal(gid) { return state.tasks.filter(t => t.goalId === gid && !isRoutineTask(t)); }
function progressOf(tasks) {
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}
function goalProgress(g) {
  if (g.status === 'cumplido') return 100;
  if (g.progressMode === 'manual') return clamp(Number(g.progress) || 0, 0, 100);
  return progressOf(tasksOfGoal(g.id)).pct;
}
function goalStatus(g) {
  if (g.status === 'cumplido') return 'cumplido';
  return g.due && g.due < todayStr() ? 'vencido' : 'activo';
}
const STATUS_LABEL = { activo: 'Activo', vencido: 'Vencido', cumplido: 'Cumplido' };
function sortByDue(a, b) {
  return (a.due || '9999').localeCompare(b.due || '9999') || (PRI_ORDER[b.priority] - PRI_ORDER[a.priority]) || (a.createdAt - b.createdAt);
}
const PRI_ORDER = { high: 3, med: 2, low: 1, none: 0 };
function nextTaskOfGoal(g) { return tasksOfGoal(g.id).filter(t => !t.done).sort(sortByDue)[0] || null; }
function blocksOfTask(tid) { return state.events.filter(e => e.taskId === tid); }
function hasBlockInRange(tid, from, to) { return state.events.some(e => e.taskId === tid && !e.recurrence && e.date >= from && e.date <= to); }

/* Color de un bloque: el suyo › el de su etiqueta › el de su proyecto */
function colorOfEvent(e) {
  if (e.color) return e.color;
  const t = e.taskId && task(e.taskId);
  const tg = (e.tagId && tag(e.tagId)) || (t && t.tags && t.tags.length && tag(t.tags[0]));
  if (tg) return tg.color;
  const p = (e.projectId && project(e.projectId)) || (t && projectOfTask(t)) || (e.goalId && goal(e.goalId) && project(goal(e.goalId).projectId));
  if (p) return p.color;
  return 'var(--accent)';
}
function colorOfTask(t) {
  const tg = t.tags && t.tags.length && tag(t.tags[0]);
  if (tg) return tg.color;
  const p = projectOfTask(t);
  return p ? p.color : 'var(--muted)';
}

/* Eventos de un día, incluidos los horarios recurrentes */
function eventsOn(d) {
  const out = [];
  for (const e of state.events) {
    if (!e.recurrence) { if (e.date === d) out.push(e); continue; }
    const r = e.recurrence;
    if (d < e.date || (r.until && d > r.until) || (e.exceptions || []).includes(d)) continue;
    if (r.days && r.days.length && !r.days.includes(dow(d))) continue;
    out.push({ ...e, date: d, seriesId: e.id, id: `${e.id}@${d}` });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
function overlapIds(d) {
  const evs = eventsOn(d), ids = new Set();
  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
    if (evs[i].start < evs[j].end && evs[j].start < evs[i].end) { ids.add(evs[i].id); ids.add(evs[j].id); }
  }
  return ids;
}
function overlapsWith(d, start, end, ignoreId) {
  return eventsOn(d).filter(e => e.id !== ignoreId && e.seriesId !== ignoreId && start < e.end && e.start < end);
}
/* Tu jornada (Ajustes) y lo que ya está ocupado ese día, incluidos los calendarios externos */
function dayBounds() {
  const st = state.settings;
  const a = toMin(st.dayStart || '08:00'), b = toMin(st.dayEnd || '21:00');
  return b > a ? [a, b] : [8 * 60, 21 * 60];
}
function busyOn(d) {
  const ext = typeof extEventsOn === 'function' ? extEventsOn(d).filter(e => !e.allDay) : [];
  return [...eventsOn(d), ...ext].map(e => [toMin(e.start), toMin(e.end)]);
}
/* Primer hueco libre de un día dentro de tu jornada */
function nextFreeSlot(d, dur = 60) {
  const busy = busyOn(d);
  const [d0, d1] = dayBounds();
  let m = d0;
  if (d === todayStr()) m = Math.max(m, Math.ceil((toMin(nowHHMM()) + 5) / 15) * 15);
  for (; m + dur <= d1; m += 15) {
    if (!busy.some(([s, e]) => m < e && s < m + dur)) return { start: fmtHM(m), end: fmtHM(m + dur) };
  }
  return null;
}

/* ---------- Diarias acumulables ---------- */

function routineDueOn(r, d) {
  if (d < r.startDate) return false;
  if ((r.pauses || []).some(p => d >= p.from && (!p.to || d < p.to))) return false;
  return !r.days || !r.days.length || r.days.includes(dow(d));
}
/* Crea exactamente una tarea por día programado hasta hoy (idempotente) */
function generateRoutines() {
  const today = todayStr();
  let created = 0;
  for (const r of state.routines) {
    const have = new Set(state.tasks.filter(t => t.routineId === r.id).map(t => t.routineDate));
    const skip = new Set(r.skipped || []);
    for (let d = r.startDate; d <= today; d = addDays(d, 1)) {
      if (!routineDueOn(r, d) || have.has(d) || skip.has(d)) continue;
      state.tasks.push(newTask({ title: r.title, due: d, routineId: r.id, routineDate: d, projectId: r.projectId || null, goalId: r.goalId || null, tags: r.tagId ? [r.tagId] : [], createdAt: parseYmd(d).getTime() }));
      created++;
    }
  }
  return created;
}
/* Racha: días programados seguidos cumplidos (hoy cuenta si ya está hecha) */
function routineStats(r) {
  const today = todayStr();
  const byDate = new Map(state.tasks.filter(t => t.routineId === r.id).map(t => [t.routineDate, t]));
  const skip = new Set(r.skipped || []);
  let streak = 0, d = today;
  const t0 = byDate.get(today);
  if (!(t0 && t0.done)) d = addDays(today, -1);
  for (; d >= r.startDate; d = addDays(d, -1)) {
    if (!routineDueOn(r, d) || skip.has(d)) continue;
    const t = byDate.get(d);
    if (t && t.done) streak++; else break;
  }
  let best = 0, run = 0, due30 = 0, done30 = 0;
  const from30 = addDays(today, -29);
  for (let x = r.startDate; x <= today; x = addDays(x, 1)) {
    if (!routineDueOn(r, x) || skip.has(x)) continue;
    const t = byDate.get(x), ok = !!(t && t.done);
    run = ok ? run + 1 : (x === today ? run : 0);
    best = Math.max(best, run);
    if (x >= from30 && x < today) { due30++; if (ok) done30++; }
    if (x === today && ok) { due30++; done30++; }
  }
  return { streak, best: Math.max(best, streak), rate: due30 ? Math.round(done30 / due30 * 100) : null };
}
/* Fecha (en la zona horaria elegida) de una marca de tiempo */
function dateOfTs(ts) {
  try {
    const parts = dtf('en-CA', { timeZone: state.settings.timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
    const g = t => parts.find(p => p.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return ymd(new Date(ts)); }
}
/* Huecos libres de un día dentro de tu jornada (desde ahora si es hoy) */
function freeIntervals(d, minLen = 30) {
  const busy = busyOn(d).sort((a, b) => a[0] - b[0]);
  const [d0, end] = dayBounds();
  let cur = d0;
  if (d === todayStr()) cur = Math.max(cur, Math.ceil(toMin(nowHHMM()) / 15) * 15);
  const out = [];
  for (const [s, e] of busy) { if (s > cur && Math.min(s, end) - cur >= minLen) out.push([cur, Math.min(s, end)]); cur = Math.max(cur, e); }
  if (end - cur >= minLen) out.push([cur, end]);
  return out;
}
function isPaused(r) { return (r.pauses || []).some(p => !p.to); }
function pendingOfRoutine(rid) {
  return state.tasks.filter(t => t.routineId === rid && !t.done && t.routineDate <= todayStr()).sort((a, b) => a.routineDate.localeCompare(b.routineDate));
}

let state = null; /* se inicializa en app.js */
/* Datos de demostración: solo para las pruebas automáticas (localStorage organizador.demo = 1) */
function seedDemo() {
  state = emptyState();
  const s = state, t = todayStr(), now = Date.now();
  s.tags = defaultTags();
  const [tagEst, tagTrab, tagPers] = s.tags;
  const p1 = { id: uid(), name: 'Organizador web', color: COLORS[0], icon: '💻', archived: false, favorite: true, order: 0, defaultView: 'resumen', notes: 'Mi app para planificar el día.', createdAt: now };
  const p2 = { id: uid(), name: 'Salud', color: COLORS[1], icon: '🏋️', archived: false, favorite: false, order: 1, defaultView: 'objetivos', notes: '', createdAt: now };
  s.projects.push(p1, p2);
  const g1 = { id: uid(), title: 'Ponerme en forma', horizon: 'corto', due: addDays(t, 75), description: 'Tener energía para todo lo demás.', success: 'Correr 5 km sin parar.', projectId: p2.id, status: 'activo', achievedAt: null, progressMode: 'auto', progress: 0, color: COLORS[1], createdAt: now };
  const g2 = { id: uid(), title: 'Lanzar mi organizador', horizon: 'corto', due: addDays(t, 30), description: 'Dejar de procrastinar y tener claro qué hacer cada día.', success: 'Lo uso cada día durante 2 semanas.', projectId: p1.id, status: 'activo', achievedAt: null, progressMode: 'auto', progress: 0, color: COLORS[0], createdAt: now };
  s.goals.push(g1, g2);
  let i = 0;
  const mk = (title, extra = {}) => newTask({ title, createdAt: now + i++, ...extra });
  const a = mk('Planificar el día (5 min)', { due: t, tags: [tagPers.id], estimate: 5, firstStep: 'Abrir la app y elegir 3 prioridades' });
  const b = mk('Definir los objetivos del trimestre', { due: addDays(t, 2), goalId: g2.id, tags: [tagTrab.id], priority: 'high', estimate: 45, firstStep: 'Abrir un documento y escribir el título' });
  const c = mk('Repasar apuntes', { due: t, tags: [tagEst.id], estimate: 30 });
  s.tasks.push(a, b, c, mk('Elegir dónde publicar la app', { projectId: p1.id }), mk('Comprar zapatillas de correr', { goalId: g1.id }));
  s.dayPlans[t] = { priorities: [a.id, b.id] };
  s.events.push(
    { id: uid(), title: 'Trabajo profundo', date: t, start: '09:00', end: '10:30', taskId: null, color: null, tagId: tagTrab.id, projectId: null, goalId: null, recurrence: null, exceptions: [] },
    { id: uid(), title: 'Gimnasio', date: t, start: '19:00', end: '20:00', taskId: null, color: null, tagId: null, projectId: p2.id, goalId: null, recurrence: { days: [1, 3, 5], until: null }, exceptions: [] },
  );
  s.routines.push({ id: uid(), title: 'Beber 2 L de agua', days: [], startDate: t, pauses: [], skipped: [], tagId: tagPers.id, projectId: null, goalId: null, createdAt: now });
  generateRoutines();
  save();
  return s;
}
