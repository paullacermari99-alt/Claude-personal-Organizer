/* Mi Organizador — app de una sola página, sin dependencias.
   Los datos se guardan en localStorage del navegador (clave STORE_KEY). */
'use strict';

const STORE_KEY = 'organizador.v1';
const TIMER_KEY = 'organizador.timer';
const COLORS = ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#ff3b30', '#30b0c7', '#a2845e'];

/* Iconos (trazos al estilo SF Symbols) */
const I = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="white"/></svg>',
};

/* ---------- Estado y persistencia ---------- */

function emptyState() {
  return { version: 1, tasks: [], blocks: [], projects: [], goals: [], focusLog: [], settings: { focusMinutes: 25 } };
}

function normalize(s) {
  return { ...emptyState(), ...s, settings: { ...emptyState().settings, ...(s.settings || {}) } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('No se pudo leer el estado', e);
    return null;
  }
}

let state; /* se inicializa al final del archivo */

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- Fechas ---------- */

const pad = n => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return ymd(new Date()); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
function fmtLongDate(s) { return cap(parseYmd(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })); }
function fmtShortDate(s) { return parseYmd(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
function daysUntil(s) { return Math.round((parseYmd(s) - parseYmd(todayStr())) / 86400000); }
function nowHHMM() { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function relDay(s) {
  const n = daysUntil(s);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  return fmtShortDate(s);
}

/* ---------- Utilidades ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

const byId = (list, id) => list.find(x => x.id === id);
const project = id => byId(state.projects, id);
const goal = id => byId(state.goals, id);
const task = id => byId(state.tasks, id);

function tasksOfProject(pid) { return state.tasks.filter(t => t.projectId === pid); }
function tasksOfGoal(gid) {
  const pids = new Set(state.projects.filter(p => p.goalId === gid).map(p => p.id));
  return state.tasks.filter(t => t.goalId === gid || (t.projectId && pids.has(t.projectId)));
}
function progressOf(tasks) {
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
}
function goalOfTask(t) {
  if (t.goalId) return goal(t.goalId);
  const p = t.projectId && project(t.projectId);
  return p && p.goalId ? goal(p.goalId) : null;
}
/* Orden estable: marcar una tarea como hecha NO la mueve de sitio */
function sortTasks(list) {
  return list.slice().sort((a, b) => (b.important - a.important) || (a.createdAt - b.createdAt));
}

/* ---------- Datos de ejemplo (solo la primera vez) ---------- */

function seedState() {
  const s = emptyState();
  const t = todayStr();
  const now = Date.now();
  const g1 = { id: uid(), title: 'Ponerme en forma', why: 'Tener energía para todo lo demás y sentirme bien conmigo.', deadline: addDays(t, 90), area: 'Salud', status: 'activo', color: COLORS[1], createdAt: now };
  const g2 = { id: uid(), title: 'Lanzar mi organizador personal', why: 'Dejar de procrastinar y tener claro qué hacer cada día.', deadline: addDays(t, 30), area: 'Personal', status: 'activo', color: COLORS[0], createdAt: now };
  const p1 = { id: uid(), name: 'Organizador web', color: COLORS[0], goalId: g2.id, status: 'activo', notes: 'PWA para móvil y ordenador.', createdAt: now };
  s.goals.push(g1, g2);
  s.projects.push(p1);
  let i = 0;
  const mk = (title, extra = {}) => ({ id: uid() + i, title, done: false, date: null, projectId: null, goalId: null, important: false, createdAt: now + i++, doneAt: null, ...extra });
  s.tasks.push(
    mk('Planificar el día (5 min)', { date: t, important: true }),
    mk('Definir mis 3 objetivos del trimestre', { date: t, important: true, projectId: p1.id }),
    mk('Salir a caminar 30 min', { date: t, goalId: g1.id }),
    mk('Elegir dónde publicar la app', { projectId: p1.id }),
    mk('Probar la app en el móvil', { projectId: p1.id }),
  );
  s.blocks.push(
    { id: uid(), date: t, start: '09:00', end: '10:30', title: 'Trabajo profundo', projectId: p1.id, goalId: null },
    { id: uid(), date: t, start: '19:00', end: '19:45', title: 'Ejercicio', projectId: null, goalId: g1.id },
  );
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
  return s;
}

/* ---------- Router ---------- */

let viewDate = todayStr();

function renderView() {
  const hash = location.hash.replace(/^#/, '') || 'hoy';
  const [name, id] = hash.split('/');
  const sec = name === 'proyecto' ? 'proyectos' : name === 'objetivo' ? 'objetivos' : name;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === sec));
  switch (name) {
    case 'proyectos': return viewProjects();
    case 'proyecto': return viewProject(id);
    case 'objetivos': return viewGoals();
    case 'objetivo': return viewGoal(id);
    case 'ajustes': return viewSettings();
    default: return viewToday();
  }
}
function route() { $('#app').innerHTML = renderView(); updateTimerUI(); }
function rerender() { const y = window.scrollY; route(); window.scrollTo(0, y); }

/* Actualiza solo las zonas marcadas con data-live (progreso, selector de enfoque…)
   sin volver a pintar la lista: así nada se mueve al marcar una tarea. */
function refreshLive() {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderView();
  $$('[data-live]').forEach(el => {
    const fresh = tpl.content.querySelector(`[data-live="${el.dataset.live}"]`);
    if (!fresh || fresh.innerHTML === el.innerHTML) return;
    const sel = $('select', el), keep = sel && sel.value;
    el.innerHTML = fresh.innerHTML;
    const nsel = $('select', el);
    if (nsel && keep && [...nsel.options].some(o => o.value === keep)) nsel.value = keep;
  });
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

/* ---------- Componentes ---------- */

function progressBar(pct) { return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`; }
function statRow(key, pr, label) {
  return `<div class="stat-row" data-live="${key}">${progressBar(pr.pct)}<span class="count">${label}</span></div>`;
}

function taskItem(t, opts = {}) {
  const p = t.projectId && project(t.projectId);
  const g = goalOfTask(t);
  const tags = [];
  if (opts.showDate && t.date) {
    const late = !t.done && t.date < todayStr();
    tags.push(`<span class="tag ${late ? 'warn' : ''}">${esc(relDay(t.date))}</span>`);
  }
  if (p && !opts.hideProject) tags.push(`<span class="tag dot" style="--c:${p.color}">${esc(p.name)}</span>`);
  if (g && !opts.hideGoal) tags.push(`<span class="tag dot" style="--c:${g.color}">${esc(g.title)}</span>`);
  return `<li class="task ${t.done ? 'done' : ''}" data-task="${t.id}">
    <input type="checkbox" class="check" data-act="toggle-task" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Completar ${esc(t.title)}">
    <div class="body" data-act="edit-task" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      ${tags.length ? `<div class="meta">${tags.join('')}</div>` : ''}
    </div>
    ${opts.moveToday ? `<button class="btn small" data-act="move-today" data-id="${t.id}">${viewDate === todayStr() ? 'A hoy' : 'Aquí'}</button>` : ''}
    <button class="icon-btn ${t.important ? 'on' : ''}" data-act="star-task" data-id="${t.id}" aria-label="${t.important ? 'Quitar de importantes' : 'Marcar como importante'}">${t.important ? I.starFill : I.star}</button>
  </li>`;
}

function taskList(tasks, opts) {
  if (!tasks.length) return '';
  return `<ul class="tasks glass">${tasks.map(t => taskItem(t, opts)).join('')}</ul>`;
}

function quickAdd(ctx) {
  const attrs = Object.entries(ctx).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<form class="quick-add glass" data-act="quick-add" ${attrs}>
    <input type="text" name="title" placeholder="Nueva tarea" autocomplete="off" enterkeyhint="done" aria-label="Nueva tarea">
    <button class="icon-btn round" type="submit" aria-label="Añadir tarea">${I.plus}</button>
  </form>`;
}

/* ---------- Vista: Hoy ---------- */

function viewToday() {
  const d = viewDate, isToday = d === todayStr();
  const dayTasks = sortTasks(state.tasks.filter(t => t.date === d));
  const important = dayTasks.filter(t => t.important);
  const rest = dayTasks.filter(t => !t.important);
  const overdue = isToday ? state.tasks.filter(t => !t.done && t.date && t.date < d) : [];
  const blocks = state.blocks.filter(b => b.date === d).sort((a, b) => a.start.localeCompare(b.start));
  const prog = progressOf(dayTasks);
  const now = nowHHMM();
  const undated = state.tasks.filter(t => !t.done && !t.date);
  const h = new Date().getHours();
  const greeting = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';

  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">${isToday ? greeting + ', Pau' : relDay(d)}</div>
      <h1>${esc(fmtLongDate(d))}</h1>
    </div>
    <div class="date-nav">
      <button class="icon-btn round" data-act="day" data-n="-1" aria-label="Día anterior">${I.left}</button>
      ${isToday ? '' : `<button class="btn small" data-act="day" data-n="0">Hoy</button>`}
      <button class="icon-btn round" data-act="day" data-n="1" aria-label="Día siguiente">${I.right}</button>
    </div>
  </div>

  ${isToday ? focusCard(dayTasks) : ''}

  ${dayTasks.length ? `<div class="section">${statRow('day-progress', prog, `${prog.done} de ${prog.total}`)}</div>` : ''}

  ${overdue.length ? `<div class="section">
    <div class="section-head"><h2>Atrasadas · ${overdue.length}</h2><button class="btn small ghost" data-act="move-all-today">Pasar a hoy</button></div>
    ${taskList(sortTasks(overdue), { showDate: true, moveToday: true })}
  </div>` : ''}

  <div class="section">
    <div class="section-head"><h2>Las 3 importantes</h2></div>
    ${important.length ? taskList(important) : `<div class="empty">¿Qué 3 cosas harían que hoy fuera un buen día? Toca la estrella de una tarea para traerla aquí.</div>`}
    <div data-live="too-many">${important.filter(t => !t.done).length > 3 ? `<p class="hint">Tienes más de 3 importantes. Elegir menos ayuda a empezar.</p>` : ''}</div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Tareas</h2></div>
    ${taskList(rest)}
    ${quickAdd({ date: d })}
  </div>

  <div class="section">
    <div class="section-head"><h2>Bloques de tiempo</h2><button class="btn small" data-act="new-block">Añadir</button></div>
    ${blocks.length ? `<div class="timeline">${blocks.map(b => blockItem(b, isToday, now)).join('')}</div>`
      : `<div class="empty">Reserva tiempo para lo que importa. Un bloque es una cita contigo.</div>`}
  </div>

  ${undated.length ? `<div class="section">
    <div class="section-head"><h2>Sin fecha · ${undated.length}</h2></div>
    ${taskList(sortTasks(undated).slice(0, 8), { moveToday: true })}
    <p class="hint">Toca «${isToday ? 'A hoy' : 'Aquí'}» para planificarlas este día.</p>
  </div>` : ''}
  `;
}

function blockItem(b, isToday, now) {
  const p = b.projectId && project(b.projectId);
  const g = b.goalId && goal(b.goalId);
  const color = p ? p.color : g ? g.color : 'var(--accent)';
  const isNow = isToday && b.start <= now && now < b.end;
  const isPast = isToday && b.end <= now;
  return `<div class="block glass ${isNow ? 'now' : ''} ${isPast ? 'past' : ''}" style="--c:${color}" data-act="edit-block" data-id="${b.id}" data-start="${b.start}" data-end="${b.end}" role="button" tabindex="0">
    <div class="hours">${esc(b.start)}<span>${esc(b.end)}</span></div>
    <div>
      <div>${esc(b.title)}<span class="now-badge ${isNow ? '' : 'hidden'}">AHORA</span></div>
      ${p || g ? `<div class="meta">${p ? `<span class="tag dot" style="--c:${p.color}">${esc(p.name)}</span>` : ''}${g ? `<span class="tag dot" style="--c:${g.color}">${esc(g.title)}</span>` : ''}</div>` : ''}
    </div>
    <span class="muted small">${durationLabel(b.start, b.end)}</span>
  </div>`;
}
function durationLabel(a, b) {
  const m = toMin(b) - toMin(a);
  if (m <= 0) return '';
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
}
/* Mueve la marca «AHORA» sin volver a pintar la página */
function refreshNow() {
  if (viewDate !== todayStr()) return;
  const now = nowHHMM();
  $$('.block[data-start]').forEach(el => {
    const isNow = el.dataset.start <= now && now < el.dataset.end;
    el.classList.toggle('now', isNow);
    el.classList.toggle('past', el.dataset.end <= now);
    const badge = $('.now-badge', el);
    if (badge) badge.classList.toggle('hidden', !isNow);
  });
}

/* ---------- Temporizador de enfoque ---------- */

function getTimer() { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch { return null; } }
function setTimer(t) { try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); } catch {} }
const RING = 2 * Math.PI * 38;

function focusCard(dayTasks) {
  const open = dayTasks.filter(t => !t.done);
  const timer = getTimer();
  const mins = state.settings.focusMinutes;
  return `<div class="focus glass">
    <div class="ring" aria-hidden="true">
      <svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="38"/><circle class="bar" id="focus-ring" cx="42" cy="42" r="38" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
      <div class="time" id="focus-time">${pad(mins)}:00</div>
    </div>
    <div>
      <div class="label">${timer ? 'Enfocado en' : `Empieza ya: solo ${mins} minutos`}</div>
      <div data-live="focus-select">
        <select id="focus-task" aria-label="Tarea en la que enfocarte" ${timer ? 'disabled' : ''}>
          <option value="">Elige una tarea…</option>
          ${open.map(t => `<option value="${t.id}" ${timer && timer.taskId === t.id ? 'selected' : ''}>${t.important ? '★ ' : ''}${esc(t.title)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="actions">
      ${timer ? `<button class="btn" data-act="focus-stop">Parar</button>` : `<button class="btn primary" data-act="focus-start">Empezar</button>`}
    </div>
  </div>`;
}

function updateTimerUI() {
  const el = $('#focus-time');
  const timer = getTimer();
  if (!timer) { document.title = 'Mi Organizador'; }
  if (!el) { if (timer && timer.endAt <= Date.now()) finishTimer(timer); return; }
  const ring = $('#focus-ring');
  if (!timer) { el.textContent = pad(state.settings.focusMinutes) + ':00'; ring.style.strokeDashoffset = 0; return; }
  const left = Math.max(0, timer.endAt - Date.now());
  el.textContent = `${pad(Math.floor(left / 60000))}:${pad(Math.floor(left / 1000) % 60)}`;
  ring.style.strokeDashoffset = RING * (1 - left / (timer.minutes * 60000));
  document.title = `${el.textContent} · Mi Organizador`;
  if (left <= 0) finishTimer(timer);
}
function finishTimer(timer) {
  setTimer(null);
  document.title = 'Mi Organizador';
  state.focusLog.push({ date: todayStr(), minutes: timer.minutes, taskId: timer.taskId || null });
  save();
  haptic([200, 100, 200]);
  beep();
  const t = timer.taskId && task(timer.taskId);
  toast(`Enfoque completado${t ? ': ' + t.title : ''}. Descansa 5 min.`);
  rerender();
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = .1;
    o.start(); o.stop(ctx.currentTime + .4);
  } catch {}
}
setInterval(updateTimerUI, 1000);

/* ---------- Vista: Proyectos ---------- */

let projectFilter = 'activo';

function viewProjects() {
  const list = state.projects.filter(p => projectFilter === 'todos' || p.status === projectFilter);
  const segs = [['activo', 'Activos'], ['pausado', 'En pausa'], ['hecho', 'Hechos'], ['todos', 'Todos']];
  return `
  <div class="page-head">
    <div><h1>Proyectos</h1><div class="sub">Lo que estás construyendo, paso a paso.</div></div>
    <button class="btn primary" data-act="new-project">Nuevo</button>
  </div>
  <div class="segmented" role="tablist">${segs.map(([v, l]) => `<button role="tab" aria-selected="${projectFilter === v}" class="${projectFilter === v ? 'on' : ''}" data-act="project-filter" data-v="${v}">${l}</button>`).join('')}</div>
  ${list.length ? `<div class="grid">${list.map(projectCard).join('')}</div>` : `<div class="empty">No hay proyectos aquí. Crea uno y divídelo en tareas pequeñas.</div>`}
  `;
}
function projectCard(p) {
  const tasks = tasksOfProject(p.id);
  const pr = progressOf(tasks);
  const g = p.goalId && goal(p.goalId);
  const next = sortTasks(tasks).find(t => !t.done);
  return `<a class="card glass item-card" href="#proyecto/${p.id}" style="--c:${p.color}">
    <div class="top"><div class="swatch">${I.folder}</div><div class="name">${esc(p.name)}</div></div>
    ${g ? `<div class="meta"><span class="tag dot" style="--c:${g.color}">${esc(g.title)}</span></div>` : ''}
    <div class="stat-row">${progressBar(pr.pct)}<span class="count">${pr.done}/${pr.total}</span></div>
    <div class="small muted">${next ? 'Siguiente: ' + esc(next.title) : pr.total ? '¡Todo hecho!' : 'Sin tareas todavía'}</div>
  </a>`;
}

function backLink(href, label) { return `<a class="back" href="${href}">${I.left}${label}</a>`; }

function viewProject(id) {
  const p = project(id);
  if (!p) return `${backLink('#proyectos', 'Proyectos')}<div class="empty">Este proyecto ya no existe.</div>`;
  const tasks = sortTasks(tasksOfProject(id));
  const pr = progressOf(tasks);
  const g = p.goalId && goal(p.goalId);
  const statusLabel = { activo: 'Activo', pausado: 'En pausa', hecho: 'Terminado' }[p.status];
  return `
  ${backLink('#proyectos', 'Proyectos')}
  <div class="page-head">
    <div>
      <h1><span class="title-dot" style="--c:${p.color}"></span>${esc(p.name)}</h1>
      <div class="sub">${statusLabel}${g ? ` · <a href="#objetivo/${g.id}">${esc(g.title)}</a>` : ''}</div>
    </div>
    <button class="btn" data-act="edit-project" data-id="${p.id}">Editar</button>
  </div>
  ${p.notes ? `<div class="card glass notes">${esc(p.notes)}</div>` : ''}
  <div class="section">${statRow('project-progress', pr, `${pr.pct}% · ${pr.done}/${pr.total}`)}</div>
  <div class="section">
    <div class="section-head"><h2>Tareas</h2></div>
    ${tasks.length ? taskList(tasks, { showDate: true, hideProject: true, hideGoal: true }) : `<div class="empty">Divide el proyecto en pasos que puedas hacer en menos de una hora.</div>`}
    ${quickAdd({ project: p.id })}
  </div>`;
}

/* ---------- Vista: Objetivos ---------- */

function viewGoals() {
  const active = state.goals.filter(g => g.status === 'activo').sort((a, b) => (a.deadline || '9').localeCompare(b.deadline || '9'));
  const done = state.goals.filter(g => g.status === 'logrado');
  return `
  <div class="page-head">
    <div><h1>Objetivos</h1><div class="sub">Hacia dónde vas y por qué.</div></div>
    <button class="btn primary" data-act="new-goal">Nuevo</button>
  </div>
  ${active.length ? `<div class="grid">${active.map(goalCard).join('')}</div>` : `<div class="empty">Define un objetivo concreto, con fecha y con un «para qué».</div>`}
  ${done.length ? `<div class="section" style="margin-top:28px"><div class="section-head"><h2>Logrados</h2></div><div class="grid">${done.map(goalCard).join('')}</div></div>` : ''}
  `;
}
function deadlineTag(g) {
  if (!g.deadline) return '';
  const n = daysUntil(g.deadline);
  const txt = n < 0 ? `Venció hace ${-n} d` : n === 0 ? 'Vence hoy' : n === 1 ? 'Queda 1 día' : `Quedan ${n} días`;
  return `<span class="tag ${n <= 7 && g.status === 'activo' ? 'warn' : ''}">${txt}</span>`;
}
function goalCard(g) {
  const pr = progressOf(tasksOfGoal(g.id));
  const nProjects = state.projects.filter(p => p.goalId === g.id).length;
  return `<a class="card glass item-card" href="#objetivo/${g.id}" style="--c:${g.color}">
    <div class="top"><div class="swatch">${I.target}</div><div class="name">${esc(g.title)}</div></div>
    ${g.why ? `<div class="why">${esc(g.why)}</div>` : ''}
    <div class="meta">${g.area ? `<span class="tag">${esc(g.area)}</span>` : ''}${deadlineTag(g)}${nProjects ? `<span class="tag">${nProjects} proyecto${nProjects > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="stat-row">${progressBar(pr.pct)}<span class="count">${pr.pct}%</span></div>
  </a>`;
}

function viewGoal(id) {
  const g = goal(id);
  if (!g) return `${backLink('#objetivos', 'Objetivos')}<div class="empty">Este objetivo ya no existe.</div>`;
  const projects = state.projects.filter(p => p.goalId === id);
  const direct = sortTasks(state.tasks.filter(t => t.goalId === id));
  const pr = progressOf(tasksOfGoal(id));
  return `
  ${backLink('#objetivos', 'Objetivos')}
  <div class="page-head">
    <div>
      <h1><span class="title-dot" style="--c:${g.color}"></span>${esc(g.title)}</h1>
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${g.area ? `<span class="tag">${esc(g.area)}</span>` : ''}${g.deadline ? `<span class="tag">${esc(fmtShortDate(g.deadline))}</span>` : ''}${deadlineTag(g)}</div>
    </div>
    <div style="display:flex;gap:8px">
      ${g.status === 'activo' ? `<button class="btn" data-act="goal-done" data-id="${g.id}">Logrado</button>` : `<button class="btn" data-act="goal-reopen" data-id="${g.id}">Reabrir</button>`}
      <button class="btn" data-act="edit-goal" data-id="${g.id}">Editar</button>
    </div>
  </div>
  ${g.why ? `<div class="why-box"><strong>Para qué</strong>${esc(g.why)}</div>` : ''}
  <div class="section">${statRow('goal-progress', pr, `${pr.pct}% · ${pr.done}/${pr.total}`)}</div>

  <div class="section">
    <div class="section-head"><h2>Proyectos</h2><button class="btn small" data-act="new-project" data-goal="${g.id}">Añadir</button></div>
    ${projects.length ? `<div class="grid">${projects.map(projectCard).join('')}</div>` : `<div class="empty">Sin proyectos vinculados.</div>`}
  </div>

  <div class="section">
    <div class="section-head"><h2>Tareas e hitos</h2></div>
    ${taskList(direct, { showDate: true, hideGoal: true })}
    ${quickAdd({ goal: g.id })}
  </div>`;
}

/* ---------- Vista: Ajustes ---------- */

function viewSettings() {
  const stats = `${state.tasks.length} tareas · ${state.projects.length} proyectos · ${state.goals.length} objetivos`;
  const focusToday = state.focusLog.filter(f => f.date === todayStr()).reduce((a, f) => a + f.minutes, 0);
  return `
  <div class="page-head"><div><h1>Ajustes</h1><div class="sub">${stats}</div></div></div>
  <div class="section">
    <div class="section-head"><h2>Enfoque</h2></div>
    <div class="settings-group glass">
      <div class="item">
        <div>Duración del bloque</div>
        <select data-act="focus-minutes" aria-label="Duración del bloque de enfoque">
          ${[15, 20, 25, 30, 45, 50, 60, 90].map(m => `<option value="${m}" ${state.settings.focusMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}
        </select>
      </div>
      <div class="item"><div>Enfoque de hoy</div><div class="muted">${focusToday} min</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-head"><h2>Tus datos</h2></div>
    <div class="settings-group glass">
      <div class="item"><div>Exportar copia de seguridad</div><button class="btn small" data-act="export">Exportar</button></div>
      <div class="item"><div>Importar copia</div><label class="btn small">Importar<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
      <div class="item"><div class="danger-text" style="color:var(--red)">Borrar todo</div><button class="btn small danger" data-act="reset">Borrar</button></div>
    </div>
    <p class="hint">Tus datos se guardan en este dispositivo. Exporta aquí e importa en el otro para pasarlos.</p>
  </div>
  <div class="section">
    <div class="section-head"><h2>Instalar</h2></div>
    <div class="settings-group glass">
      <div class="item small muted" style="display:block;line-height:1.6">
        <strong style="color:var(--text)">iPhone:</strong> Safari → Compartir → «Añadir a pantalla de inicio».<br>
        <strong style="color:var(--text)">Android:</strong> Chrome → menú ⋮ → «Instalar aplicación».<br>
        <strong style="color:var(--text)">Ordenador:</strong> Chrome o Edge → icono de instalar en la barra de direcciones.
      </div>
      ${deferredInstall ? `<div class="item"><div>Instalar en este dispositivo</div><button class="btn small primary" data-act="install">Instalar</button></div>` : ''}
    </div>
  </div>`;
}

/* ---------- Hojas modales (formularios) ---------- */

const modal = $('#modal');
const modalForm = $('#modal-form');
let modalSubmit = null;
let modalDelete = null;

function openModal(title, body, { onSave, onDelete } = {}) {
  /* El botón Guardar es el único de tipo submit: pulsar Intro siempre guarda */
  modalForm.innerHTML = `
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="btn" data-modal="cancel">Cancelar</button>
      <h3>${title}</h3>
      <button type="submit" class="btn primary">Guardar</button>
    </div>
    ${body}
    ${onDelete ? `<button type="button" class="btn wide danger" data-modal="delete">Eliminar</button>` : ''}`;
  modalSubmit = onSave;
  modalDelete = onDelete;
  modal.showModal();
  modalForm.scrollTop = 0;
  const first = modalForm.querySelector('input[type=text]');
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}
modalForm.addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(modalForm));
  if (modalSubmit && modalSubmit(data) !== false) { modal.close(); save(); rerender(); }
});
modalForm.addEventListener('click', e => {
  const b = e.target.closest('[data-modal]');
  if (!b) return;
  if (b.dataset.modal === 'cancel') modal.close();
  if (b.dataset.modal === 'delete' && modalDelete && modalDelete() !== false) { modal.close(); save(); rerender(); }
});
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

function optionList(items, selected, labelKey, emptyLabel) {
  return `<option value="">${emptyLabel}</option>` + items.map(i => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i[labelKey])}</option>`).join('');
}
function colorPicker(sel) {
  return `<div class="colors">${COLORS.map((c, i) => `<input type="radio" name="color" value="${c}" style="--c:${c}" ${c === sel ? 'checked' : ''} aria-label="Color ${i + 1}">`).join('')}</div>`;
}
function selectableProjects(cur) { return state.projects.filter(p => p.status !== 'hecho' || p.id === cur); }
function selectableGoals(cur) { return state.goals.filter(g => g.status === 'activo' || g.id === cur); }

function taskModal(t) {
  const isNew = !t.id;
  openModal(isNew ? 'Nueva tarea' : 'Tarea', `
    <label class="field">Tarea<input type="text" name="title" required value="${esc(t.title || '')}" enterkeyhint="done"></label>
    <label class="field">Día<input type="date" name="date" value="${esc(t.date || '')}"></label>
    <label class="field toggle-row">Importante<input type="checkbox" class="switch" name="important" value="1" ${t.important ? 'checked' : ''}></label>
    <label class="field">Proyecto<select name="projectId">${optionList(selectableProjects(t.projectId), t.projectId, 'name', 'Ninguno')}</select></label>
    <label class="field">Objetivo<select name="goalId">${optionList(selectableGoals(t.goalId), t.goalId, 'title', 'Ninguno (o el del proyecto)')}</select></label>
  `, {
    onSave: d => {
      const obj = isNew ? { id: uid(), done: false, createdAt: Date.now(), doneAt: null } : task(t.id);
      Object.assign(obj, { title: d.title.trim(), date: d.date || null, important: !!d.important, projectId: d.projectId || null, goalId: d.goalId || null });
      if (isNew) state.tasks.push(obj);
    },
    onDelete: isNew ? null : () => { state.tasks = state.tasks.filter(x => x.id !== t.id); toast('Tarea eliminada'); },
  });
}

function blockModal(b) {
  const isNew = !b.id;
  const dayTasks = state.tasks.filter(t => t.date === (b.date || viewDate) && !t.done);
  openModal(isNew ? 'Nuevo bloque' : 'Bloque', `
    <label class="field">Qué vas a hacer<input type="text" name="title" required value="${esc(b.title || '')}" list="block-suggest" placeholder="Trabajo profundo, gimnasio, estudiar…"></label>
    <datalist id="block-suggest">${dayTasks.map(t => `<option value="${esc(t.title)}">`).join('')}</datalist>
    <div class="row">
      <label class="field">Empieza<input type="time" name="start" required value="${esc(b.start || '')}"></label>
      <label class="field">Termina<input type="time" name="end" required value="${esc(b.end || '')}"></label>
    </div>
    <label class="field">Día<input type="date" name="date" required value="${esc(b.date || viewDate)}"></label>
    <label class="field">Proyecto<select name="projectId">${optionList(selectableProjects(b.projectId), b.projectId, 'name', 'Ninguno')}</select></label>
    <label class="field">Objetivo<select name="goalId">${optionList(selectableGoals(b.goalId), b.goalId, 'title', 'Ninguno')}</select></label>
  `, {
    onSave: d => {
      if (d.end <= d.start) { toast('La hora de fin debe ser posterior al inicio'); return false; }
      const obj = isNew ? { id: uid() } : byId(state.blocks, b.id);
      Object.assign(obj, { title: d.title.trim(), start: d.start, end: d.end, date: d.date, projectId: d.projectId || null, goalId: d.goalId || null });
      if (isNew) state.blocks.push(obj);
    },
    onDelete: isNew ? null : () => { state.blocks = state.blocks.filter(x => x.id !== b.id); toast('Bloque eliminado'); },
  });
}

function suggestBlockTime() {
  const blocks = state.blocks.filter(b => b.date === viewDate).sort((a, b) => a.end.localeCompare(b.end));
  let start = viewDate === todayStr() ? nowHHMM() : '09:00';
  const last = blocks[blocks.length - 1];
  if (last && last.end > start) start = last.end;
  let m = Math.ceil(toMin(start) / 15) * 15;
  if (m > 22 * 60 + 45) m = 9 * 60;
  const f = x => pad(Math.floor(x / 60)) + ':' + pad(x % 60);
  return { start: f(m), end: f(Math.min(m + 60, 23 * 60 + 59)) };
}

function projectModal(p) {
  const isNew = !p.id;
  openModal(isNew ? 'Nuevo proyecto' : 'Proyecto', `
    <label class="field">Nombre<input type="text" name="name" required value="${esc(p.name || '')}"></label>
    <label class="field">Objetivo al que contribuye<select name="goalId">${optionList(selectableGoals(p.goalId), p.goalId, 'title', 'Ninguno')}</select></label>
    <label class="field">Estado<select name="status">
      ${[['activo', 'Activo'], ['pausado', 'En pausa'], ['hecho', 'Terminado']].map(([v, l]) => `<option value="${v}" ${(p.status || 'activo') === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label class="field">Notas<textarea name="notes" placeholder="Qué es y cómo sabrás que está terminado">${esc(p.notes || '')}</textarea></label>
    <div class="field">Color${colorPicker(p.color || COLORS[state.projects.length % COLORS.length])}</div>
  `, {
    onSave: d => {
      const obj = isNew ? { id: uid(), createdAt: Date.now() } : project(p.id);
      Object.assign(obj, { name: d.name.trim(), goalId: d.goalId || null, status: d.status, notes: d.notes.trim(), color: d.color || COLORS[0] });
      if (isNew) { state.projects.push(obj); setTimeout(() => { location.hash = '#proyecto/' + obj.id; }); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('¿Eliminar el proyecto? Sus tareas se conservarán sin proyecto.')) return false;
      state.projects = state.projects.filter(x => x.id !== p.id);
      state.tasks.forEach(t => { if (t.projectId === p.id) t.projectId = null; });
      state.blocks.forEach(b => { if (b.projectId === p.id) b.projectId = null; });
      location.hash = '#proyectos';
      toast('Proyecto eliminado');
    },
  });
}

function goalModal(g) {
  const isNew = !g.id;
  openModal(isNew ? 'Nuevo objetivo' : 'Objetivo', `
    <label class="field">Objetivo (concreto y medible)<input type="text" name="title" required value="${esc(g.title || '')}" placeholder="Correr 10 km en menos de 60 min"></label>
    <label class="field">¿Para qué? (tu motivación)<textarea name="why" placeholder="Lo leerás cuando te cueste empezar">${esc(g.why || '')}</textarea></label>
    <div class="row">
      <label class="field">Fecha límite<input type="date" name="deadline" value="${esc(g.deadline || '')}"></label>
      <label class="field">Área<input type="text" name="area" value="${esc(g.area || '')}" list="areas" placeholder="Salud…"></label>
    </div>
    <datalist id="areas">${['Salud', 'Trabajo', 'Finanzas', 'Relaciones', 'Aprendizaje', 'Personal', 'Ocio'].map(a => `<option value="${a}">`).join('')}</datalist>
    <div class="field">Color${colorPicker(g.color || COLORS[(state.goals.length + 2) % COLORS.length])}</div>
  `, {
    onSave: d => {
      const obj = isNew ? { id: uid(), status: 'activo', createdAt: Date.now() } : goal(g.id);
      Object.assign(obj, { title: d.title.trim(), why: d.why.trim(), deadline: d.deadline || null, area: d.area.trim(), color: d.color || COLORS[0] });
      if (isNew) { state.goals.push(obj); setTimeout(() => { location.hash = '#objetivo/' + obj.id; }); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('¿Eliminar el objetivo? Proyectos y tareas se conservarán sin objetivo.')) return false;
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.projects.forEach(p => { if (p.goalId === g.id) p.goalId = null; });
      state.tasks.forEach(t => { if (t.goalId === g.id) t.goalId = null; });
      state.blocks.forEach(b => { if (b.goalId === g.id) b.goalId = null; });
      location.hash = '#objetivos';
      toast('Objetivo eliminado');
    },
  });
}

/* ---------- Acciones ---------- */

function toggleTask(id, checkbox) {
  const t = task(id);
  if (!t) return;
  t.done = checkbox ? checkbox.checked : !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  /* Actualización en el sitio: la fila no se mueve ni cambia de tamaño */
  $$(`[data-task="${id}"]`).forEach(li => {
    li.classList.toggle('done', t.done);
    const c = $('.check', li); if (c) c.checked = t.done;
  });
  refreshLive();
  haptic();
  if (t.done) toast(pick(['¡Hecho!', '¡Una menos!', '¡Bien! Sigue así.', '¡Genial!']));
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'FORM' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'toggle-task': toggleTask(id, el); return;
    case 'star-task': { const t = task(id); t.important = !t.important; haptic(); break; }
    case 'edit-task': taskModal(task(id)); return;
    case 'move-today': { const t = task(id); t.date = viewDate; toast('Planificada para ' + relDay(viewDate).toLowerCase()); break; }
    case 'move-all-today': state.tasks.forEach(t => { if (!t.done && t.date && t.date < todayStr()) t.date = todayStr(); }); toast('Todas en hoy'); break;
    case 'day': viewDate = el.dataset.n === '0' ? todayStr() : addDays(viewDate, Number(el.dataset.n)); route(); return;
    case 'new-block': blockModal({ date: viewDate, ...suggestBlockTime() }); return;
    case 'edit-block': blockModal(byId(state.blocks, id)); return;
    case 'new-project': projectModal({ goalId: el.dataset.goal || null }); return;
    case 'edit-project': projectModal(project(id)); return;
    case 'project-filter': projectFilter = el.dataset.v; route(); return;
    case 'new-goal': goalModal({}); return;
    case 'edit-goal': goalModal(goal(id)); return;
    case 'goal-done': goal(id).status = 'logrado'; toast('¡Objetivo logrado! 🎉'); break;
    case 'goal-reopen': goal(id).status = 'activo'; break;
    case 'focus-start': {
      const taskId = $('#focus-task').value || null;
      const minutes = state.settings.focusMinutes;
      setTimer({ endAt: Date.now() + minutes * 60000, minutes, taskId });
      toast(`A por ello: ${minutes} minutos solo para esto.`);
      rerender(); return;
    }
    case 'focus-stop': setTimer(null); rerender(); return;
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('¿Seguro? Se borrarán todas tus tareas, proyectos y objetivos de este dispositivo.')) return;
      state = emptyState(); setTimer(null); toast('Todo borrado'); break;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
    default: return;
  }
  save(); rerender();
});

/* Teclado: Intro/espacio abren los bloques (son div con role=button) */
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.block[data-act]')) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.act !== 'quick-add') return;
  e.preventDefault();
  const input = f.elements.namedItem('title');
  const title = input.value.trim();
  if (!title) return;
  state.tasks.push({
    id: uid(), title, done: false, important: false, createdAt: Date.now(), doneAt: null,
    date: f.dataset.date || null, projectId: f.dataset.project || null, goalId: f.dataset.goal || null,
  });
  save(); rerender();
  /* Vuelve a enfocar el mismo campo para seguir añadiendo */
  const sel = Object.keys(f.dataset).filter(k => k !== 'act').map(k => `[data-${k}="${f.dataset[k]}"]`).join('');
  const again = $(`form[data-act="quick-add"]${sel} input[name=title]`);
  if (again) again.focus();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'focus-minutes') { state.settings.focusMinutes = Number(el.value); save(); toast('Guardado'); }
  if (el.dataset.act === 'import' && el.files[0]) { importData(el.files[0]); el.value = ''; }
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `organizador-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.tasks) || !Array.isArray(s.projects) || !Array.isArray(s.goals)) throw new Error('formato no válido');
      if (!confirm('Esto reemplazará los datos de este dispositivo por los del archivo. ¿Continuar?')) return;
      state = normalize(s);
      save(); toast('Datos importados'); route();
    } catch (err) { toast('No se pudo importar: ' + err.message); }
  };
  r.readAsText(file);
}

/* Al volver a la app: recarga datos y, si cambió el día, salta a hoy */
let lastDay = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || modal.open) return;
  const fresh = loadState();
  if (fresh) state = fresh;
  if (lastDay !== todayStr()) { if (viewDate === lastDay) viewDate = todayStr(); lastDay = todayStr(); }
  const typing = document.activeElement && document.activeElement.matches('input, textarea');
  if (!typing) rerender();
});
/* Sincroniza entre pestañas abiertas del mismo navegador */
window.addEventListener('storage', e => { if (e.key === STORE_KEY && !modal.open) { state = loadState() || emptyState(); rerender(); } });
setInterval(refreshNow, 30000);

/* ---------- PWA ---------- */

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}

state = loadState() || seedState();
route();
