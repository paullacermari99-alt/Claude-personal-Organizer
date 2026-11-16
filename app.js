/* Mi Organizador — app de una sola página, sin dependencias.
   Los datos se guardan en localStorage del navegador (clave STORE_KEY). */
'use strict';

const STORE_KEY = 'organizador.v1';
const TIMER_KEY = 'organizador.timer';
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#475569'];

/* ---------- Estado y persistencia ---------- */

function emptyState() {
  return { version: 1, tasks: [], blocks: [], projects: [], goals: [], settings: { focusMinutes: 25 } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { ...emptyState(), ...s, settings: { ...emptyState().settings, ...(s.settings || {}) } };
  } catch (e) {
    console.warn('No se pudo leer el estado', e);
    return null;
  }
}

let state = loadState() || seedState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- Fechas ---------- */

function ymd(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayStr() { return ymd(new Date()); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function fmtLongDate(s) {
  const t = parseYmd(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fmtShortDate(s) { return parseYmd(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
function daysUntil(s) { return Math.round((parseYmd(s) - parseYmd(todayStr())) / 86400000); }
function nowHHMM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function relDay(s) {
  const n = daysUntil(s);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  if (n === -1) return 'Ayer';
  return fmtShortDate(s);
}

/* ---------- Utilidades ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

const byId = (list, id) => list.find(x => x.id === id);
const project = id => byId(state.projects, id);
const goal = id => byId(state.goals, id);
const task = id => byId(state.tasks, id);

/* Tareas que cuentan para un proyecto o un objetivo (directas + vía proyectos) */
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

/* ---------- Datos de ejemplo (solo la primera vez) ---------- */

function seedState() {
  const s = emptyState();
  const t = todayStr();
  const g1 = { id: uid(), title: 'Ponerme en forma', why: 'Tener energía para todo lo demás y sentirme bien conmigo.', deadline: addDays(t, 90), area: 'Salud', status: 'activo', color: COLORS[7], createdAt: Date.now() };
  const g2 = { id: uid(), title: 'Lanzar mi organizador personal', why: 'Dejar de procrastinar y tener claro qué hacer cada día.', deadline: addDays(t, 30), area: 'Personal', status: 'activo', color: COLORS[0], createdAt: Date.now() };
  const p1 = { id: uid(), name: 'Organizador web', color: COLORS[0], goalId: g2.id, status: 'activo', notes: 'PWA para móvil y ordenador.', createdAt: Date.now() };
  s.goals.push(g1, g2);
  s.projects.push(p1);
  const mk = (title, extra = {}) => ({ id: uid(), title, done: false, date: null, projectId: null, goalId: null, important: false, createdAt: Date.now(), doneAt: null, ...extra });
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
  s.seeded = true;
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
  return s;
}

/* ---------- Router ---------- */

let viewDate = todayStr();

function route() {
  const hash = location.hash.replace(/^#/, '') || 'hoy';
  const [name, id] = hash.split('/');
  document.querySelectorAll('[data-nav]').forEach(a => {
    const sec = name === 'proyecto' ? 'proyectos' : name === 'objetivo' ? 'objetivos' : name;
    a.classList.toggle('active', a.dataset.nav === sec);
  });
  const app = $('#app');
  switch (name) {
    case 'proyectos': app.innerHTML = viewProjects(); break;
    case 'proyecto': app.innerHTML = viewProject(id); break;
    case 'objetivos': app.innerHTML = viewGoals(); break;
    case 'objetivo': app.innerHTML = viewGoal(id); break;
    case 'ajustes': app.innerHTML = viewSettings(); break;
    default: app.innerHTML = viewToday(); updateTimerUI();
  }
}
function rerender() { const y = window.scrollY; route(); window.scrollTo(0, y); }
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

/* ---------- Componentes ---------- */

function progressBar(pct) { return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`; }

function taskItem(t, opts = {}) {
  const p = t.projectId && project(t.projectId);
  const g = goalOfTask(t);
  const tags = [];
  if (opts.showDate && t.date) {
    const late = !t.done && t.date < todayStr();
    tags.push(`<span class="tag ${late ? 'warn' : ''}">${esc(relDay(t.date))}</span>`);
  }
  if (p && !opts.hideProject) tags.push(`<span class="tag dot" style="--c:${p.color}">${esc(p.name)}</span>`);
  if (g && !opts.hideGoal) tags.push(`<span class="tag">◎ ${esc(g.title)}</span>`);
  return `<li class="task ${t.done ? 'done' : ''}">
    <input type="checkbox" class="check" data-act="toggle-task" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Completar ${esc(t.title)}">
    <div class="body" data-act="edit-task" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      ${tags.length ? `<div class="meta">${tags.join('')}</div>` : ''}
    </div>
    ${opts.moveToday ? `<button class="btn small" data-act="move-today" data-id="${t.id}">A hoy</button>` : ''}
    <button class="icon-btn ${t.important ? 'on' : ''}" data-act="star-task" data-id="${t.id}" title="Importante" aria-label="Marcar como importante">${t.important ? '★' : '☆'}</button>
  </li>`;
}

function taskList(tasks, opts) {
  if (!tasks.length) return '';
  return `<ul class="tasks">${tasks.map(t => taskItem(t, opts)).join('')}</ul>`;
}

function quickAdd(ctx) {
  const attrs = Object.entries(ctx).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<form class="quick-add" data-act="quick-add" ${attrs}>
    <input type="text" name="title" placeholder="Añadir tarea…" autocomplete="off" aria-label="Nueva tarea">
    <button class="btn primary" type="submit">Añadir</button>
  </form>`;
}

function sortTasks(list) {
  return list.slice().sort((a, b) => (a.done - b.done) || (b.important - a.important) || (a.createdAt - b.createdAt));
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

  const greeting = (() => { const h = new Date().getHours(); return h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'; })();

  return `
  <div class="page-head">
    <div>
      <div class="muted small">${isToday ? greeting + ', Pau' : relDay(d)}</div>
      <h1>${esc(fmtLongDate(d))}</h1>
    </div>
    <div class="date-nav">
      <button class="icon-btn" data-act="day" data-n="-1" aria-label="Día anterior">‹</button>
      ${isToday ? '' : `<button class="btn small" data-act="day" data-n="0">Hoy</button>`}
      <button class="icon-btn" data-act="day" data-n="1" aria-label="Día siguiente">›</button>
    </div>
  </div>

  ${isToday ? focusCard(dayTasks) : ''}

  ${dayTasks.length ? `<div class="section"><div class="stat-row">${progressBar(prog.pct)}<span class="small muted">${prog.done}/${prog.total} hechas</span></div></div>` : ''}

  ${overdue.length ? `<div class="section">
    <div class="section-head"><h2>Atrasadas (${overdue.length})</h2><button class="btn small ghost" data-act="move-all-today">Pasar todas a hoy</button></div>
    ${taskList(sortTasks(overdue), { showDate: true, moveToday: true })}
  </div>` : ''}

  <div class="section">
    <div class="section-head"><h2>★ Las 3 importantes</h2></div>
    ${important.length ? taskList(important) : `<div class="empty">¿Qué 3 cosas harían que hoy fuera un buen día? Marca tareas con ☆ para ponerlas aquí.</div>`}
    ${important.filter(t => !t.done).length > 3 ? `<p class="small muted">Tienes más de 3 importantes. Elegir menos ayuda a empezar.</p>` : ''}
  </div>

  <div class="section">
    <div class="section-head"><h2>Tareas</h2></div>
    ${taskList(rest)}
    ${quickAdd({ date: d })}
  </div>

  <div class="section">
    <div class="section-head"><h2>Bloques de tiempo</h2><button class="btn small" data-act="new-block">+ Bloque</button></div>
    ${blocks.length ? `<div class="timeline">${blocks.map(b => blockItem(b, isToday, now)).join('')}</div>`
      : `<div class="empty">Reserva tiempo en tu calendario para lo que importa. Un bloque es una cita contigo.</div>`}
  </div>

  ${undated.length ? `<div class="section">
    <div class="section-head"><h2>Pendientes sin fecha (${undated.length})</h2></div>
    <p class="small muted" style="margin:-4px 0 10px">Pulsa «${isToday ? 'A hoy' : 'A este día'}» para planificarlas.</p>
    ${taskList(sortTasks(undated).slice(0, 8), { moveToday: true })}
  </div>` : ''}
  `;
}

function blockItem(b, isToday, now) {
  const p = b.projectId && project(b.projectId);
  const g = b.goalId && goal(b.goalId);
  const color = p ? p.color : g ? g.color : 'var(--accent)';
  const isNow = isToday && b.start <= now && now < b.end;
  const isPast = isToday && b.end <= now;
  return `<div class="block ${isNow ? 'now' : ''} ${isPast ? 'past' : ''}" style="--c:${color}" data-act="edit-block" data-id="${b.id}">
    <div class="hours">${esc(b.start)}<span>${esc(b.end)}</span></div>
    <div>
      <div>${esc(b.title)}${isNow ? '<span class="now-badge">AHORA</span>' : ''}</div>
      <div class="meta">${p ? `<span class="tag dot" style="--c:${p.color}">${esc(p.name)}</span>` : ''}${g ? `<span class="tag">◎ ${esc(g.title)}</span>` : ''}</div>
    </div>
    <span class="muted small">${durationLabel(b.start, b.end)}</span>
  </div>`;
}
function durationLabel(a, b) {
  const m = toMin(b) - toMin(a);
  if (m <= 0) return '';
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/* ---------- Temporizador de enfoque (pomodoro) ---------- */

function getTimer() { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch { return null; } }
function setTimer(t) { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); }

function focusCard(dayTasks) {
  const open = dayTasks.filter(t => !t.done);
  const timer = getTimer();
  const mins = state.settings.focusMinutes;
  return `<div class="focus" id="focus">
    <div class="time" id="focus-time">${String(mins).padStart(2, '0')}:00</div>
    <div class="what">
      <div class="small muted" id="focus-label">${timer ? 'Enfocado en' : 'Empieza ya: solo ' + mins + ' minutos'}</div>
      <select id="focus-task" aria-label="Tarea en la que enfocarte" ${timer ? 'disabled' : ''}>
        <option value="">Elige una tarea…</option>
        ${open.map(t => `<option value="${t.id}" ${timer && timer.taskId === t.id ? 'selected' : ''}>${t.important ? '★ ' : ''}${esc(t.title)}</option>`).join('')}
      </select>
    </div>
    <div class="actions">
      <button class="btn primary ${timer ? 'hidden' : ''}" data-act="focus-start" id="focus-start">▶ Empezar</button>
      <button class="btn ${timer ? '' : 'hidden'}" data-act="focus-stop" id="focus-stop">■ Parar</button>
    </div>
  </div>`;
}

function updateTimerUI() {
  const el = $('#focus-time');
  if (!el) return;
  const timer = getTimer();
  if (!timer) { el.textContent = String(state.settings.focusMinutes).padStart(2, '0') + ':00'; return; }
  const left = Math.max(0, timer.endAt - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  document.title = `${el.textContent} · Mi Organizador`;
  if (left <= 0) finishTimer(timer);
}
function finishTimer(timer) {
  setTimer(null);
  document.title = 'Mi Organizador';
  state.focusLog = state.focusLog || [];
  state.focusLog.push({ date: todayStr(), minutes: timer.minutes, taskId: timer.taskId || null });
  save();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
  beep();
  const t = timer.taskId && task(timer.taskId);
  toast(`¡Bloque de enfoque completado${t ? ': ' + t.title : ''}! Descansa 5 minutos.`);
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
  const chips = [['activo', 'Activos'], ['pausado', 'En pausa'], ['hecho', 'Terminados'], ['todos', 'Todos']];
  return `
  <div class="page-head">
    <div><h1>Proyectos</h1><div class="sub">Lo que estás construyendo, paso a paso.</div></div>
    <button class="btn primary" data-act="new-project">+ Proyecto</button>
  </div>
  <div class="filters">${chips.map(([v, l]) => `<button class="chip ${projectFilter === v ? 'on' : ''}" data-act="project-filter" data-v="${v}">${l}</button>`).join('')}</div>
  ${list.length ? `<div class="grid">${list.map(projectCard).join('')}</div>` : `<div class="empty">No hay proyectos aquí. Crea uno y divídelo en tareas pequeñas.</div>`}
  `;
}
function projectCard(p) {
  const pr = progressOf(tasksOfProject(p.id));
  const g = p.goalId && goal(p.goalId);
  const next = sortTasks(tasksOfProject(p.id)).find(t => !t.done);
  return `<a class="card item-card" href="#proyecto/${p.id}" style="--c:${p.color}">
    <div class="name">${esc(p.name)}</div>
    ${g ? `<div><span class="tag">◎ ${esc(g.title)}</span></div>` : ''}
    <div class="stat-row">${progressBar(pr.pct)}<span class="small muted">${pr.done}/${pr.total}</span></div>
    <div class="small muted">${next ? 'Siguiente: ' + esc(next.title) : pr.total ? '¡Todo hecho!' : 'Sin tareas todavía'}</div>
  </a>`;
}

function viewProject(id) {
  const p = project(id);
  if (!p) return `<a class="back" href="#proyectos">‹ Proyectos</a><div class="empty">Este proyecto ya no existe.</div>`;
  const tasks = sortTasks(tasksOfProject(id));
  const pr = progressOf(tasks);
  const g = p.goalId && goal(p.goalId);
  const statusLabel = { activo: 'Activo', pausado: 'En pausa', hecho: 'Terminado' }[p.status];
  return `
  <a class="back" href="#proyectos">‹ Proyectos</a>
  <div class="page-head">
    <div>
      <h1 style="border-left:6px solid ${p.color};padding-left:12px">${esc(p.name)}</h1>
      <div class="sub">${statusLabel}${g ? ` · Objetivo: <a href="#objetivo/${g.id}">${esc(g.title)}</a>` : ''}</div>
    </div>
    <button class="btn" data-act="edit-project" data-id="${p.id}">Editar</button>
  </div>
  ${p.notes ? `<div class="card section" style="white-space:pre-wrap">${esc(p.notes)}</div>` : ''}
  <div class="section"><div class="stat-row">${progressBar(pr.pct)}<span class="small muted">${pr.pct}% · ${pr.done}/${pr.total}</span></div></div>
  <div class="section">
    <div class="section-head"><h2>Tareas</h2></div>
    ${taskList(tasks, { showDate: true, hideProject: true, hideGoal: true })}
    ${tasks.length ? '' : `<div class="empty">Divide el proyecto en pasos que puedas hacer en menos de una hora.</div>`}
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
    <button class="btn primary" data-act="new-goal">+ Objetivo</button>
  </div>
  ${active.length ? `<div class="grid">${active.map(goalCard).join('')}</div>` : `<div class="empty">Define un objetivo concreto, con fecha y con un «para qué».</div>`}
  ${done.length ? `<div class="section" style="margin-top:28px"><h2>Logrados 🎉</h2><div class="grid">${done.map(goalCard).join('')}</div></div>` : ''}
  `;
}
function deadlineTag(g) {
  if (!g.deadline) return '';
  const n = daysUntil(g.deadline);
  const txt = n < 0 ? `Venció hace ${-n} d` : n === 0 ? 'Vence hoy' : `Quedan ${n} días`;
  return `<span class="tag ${n <= 7 && g.status === 'activo' ? 'warn' : ''}">${txt}</span>`;
}
function goalCard(g) {
  const pr = progressOf(tasksOfGoal(g.id));
  const nProjects = state.projects.filter(p => p.goalId === g.id).length;
  return `<a class="card item-card" href="#objetivo/${g.id}" style="--c:${g.color}">
    <div class="name">${esc(g.title)}</div>
    ${g.why ? `<div class="why">${esc(g.why)}</div>` : ''}
    <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap">${g.area ? `<span class="tag">${esc(g.area)}</span>` : ''}${deadlineTag(g)}${nProjects ? `<span class="tag">${nProjects} proyecto${nProjects > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="stat-row">${progressBar(pr.pct)}<span class="small muted">${pr.pct}%</span></div>
  </a>`;
}

function viewGoal(id) {
  const g = goal(id);
  if (!g) return `<a class="back" href="#objetivos">‹ Objetivos</a><div class="empty">Este objetivo ya no existe.</div>`;
  const projects = state.projects.filter(p => p.goalId === id);
  const direct = sortTasks(state.tasks.filter(t => t.goalId === id));
  const pr = progressOf(tasksOfGoal(id));
  return `
  <a class="back" href="#objetivos">‹ Objetivos</a>
  <div class="page-head">
    <div>
      <h1 style="border-left:6px solid ${g.color};padding-left:12px">${esc(g.title)}</h1>
      <div class="sub" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${g.area ? `<span class="tag">${esc(g.area)}</span>` : ''}${g.deadline ? `<span class="tag">📅 ${esc(fmtShortDate(g.deadline))}</span>` : ''}${deadlineTag(g)}</div>
    </div>
    <div style="display:flex;gap:8px">
      ${g.status === 'activo' ? `<button class="btn" data-act="goal-done" data-id="${g.id}">✓ Logrado</button>` : `<button class="btn" data-act="goal-reopen" data-id="${g.id}">Reabrir</button>`}
      <button class="btn" data-act="edit-goal" data-id="${g.id}">Editar</button>
    </div>
  </div>
  ${g.why ? `<div class="why-box"><strong>Para qué</strong>${esc(g.why)}</div>` : ''}
  <div class="section"><div class="stat-row">${progressBar(pr.pct)}<span class="small muted">${pr.pct}% · ${pr.done}/${pr.total} tareas</span></div></div>

  <div class="section">
    <div class="section-head"><h2>Proyectos</h2><button class="btn small" data-act="new-project" data-goal="${g.id}">+ Proyecto</button></div>
    ${projects.length ? `<div class="grid">${projects.map(projectCard).join('')}</div>` : `<div class="empty">Sin proyectos vinculados.</div>`}
  </div>

  <div class="section">
    <div class="section-head"><h2>Tareas / hitos del objetivo</h2></div>
    ${taskList(direct, { showDate: true, hideGoal: true })}
    ${quickAdd({ goal: g.id })}
  </div>`;
}

/* ---------- Vista: Ajustes ---------- */

function viewSettings() {
  const stats = `${state.tasks.length} tareas · ${state.projects.length} proyectos · ${state.goals.length} objetivos`;
  const focusToday = (state.focusLog || []).filter(f => f.date === todayStr()).reduce((a, f) => a + f.minutes, 0);
  return `
  <div class="page-head"><div><h1>Ajustes</h1><div class="sub">${stats}</div></div></div>
  <div class="section settings-list">
    <h2>Enfoque</h2>
    <div class="card">
      <div><div>Duración del bloque de enfoque</div><div class="small muted">Hoy llevas ${focusToday} min de enfoque.</div></div>
      <select data-act="focus-minutes" style="width:auto">
        ${[15, 20, 25, 30, 45, 50, 60, 90].map(m => `<option value="${m}" ${state.settings.focusMinutes === m ? 'selected' : ''}>${m} min</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="section settings-list">
    <h2>Tus datos</h2>
    <div class="card">
      <div><div>Copia de seguridad</div><div class="small muted">Tus datos se guardan en este dispositivo. Exporta para pasarlos a otro.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="export">Exportar</button>
        <label class="btn">Importar<input type="file" accept="application/json,.json" data-act="import" hidden></label>
      </div>
    </div>
    <div class="card">
      <div><div>Empezar de cero</div><div class="small muted">Borra todo (incluidos los ejemplos).</div></div>
      <button class="btn danger" data-act="reset">Borrar todo</button>
    </div>
  </div>
  <div class="section settings-list">
    <h2>Instalar</h2>
    <div class="card"><div class="small muted">
      <strong>iPhone:</strong> abre la web en Safari → Compartir → «Añadir a pantalla de inicio».<br>
      <strong>Android:</strong> en Chrome → menú ⋮ → «Instalar aplicación».<br>
      <strong>Ordenador:</strong> en Chrome/Edge, icono de instalar en la barra de direcciones.
    </div>
    <button class="btn primary ${deferredInstall ? '' : 'hidden'}" data-act="install">Instalar app</button></div>
  </div>`;
}

/* ---------- Modales (formularios) ---------- */

const modal = $('#modal');
const modalForm = $('#modal-form');
let modalSubmit = null;

function openModal(html, onSubmit) {
  modalForm.innerHTML = html;
  modalSubmit = onSubmit;
  modal.showModal();
  const first = modalForm.querySelector('input[type=text], textarea');
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}
modalForm.addEventListener('submit', e => {
  const action = e.submitter && e.submitter.value;
  if (action === 'cancel') return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(modalForm));
  if (modalSubmit && modalSubmit(data, action) !== false) { modal.close(); save(); rerender(); }
});
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

function optionList(items, selected, labelKey, emptyLabel) {
  return `<option value="">${emptyLabel}</option>` + items.map(i => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i[labelKey])}</option>`).join('');
}
function colorPicker(sel) {
  return `<div class="colors">${COLORS.map(c => `<input type="radio" name="color" value="${c}" style="--c:${c}" ${c === sel ? 'checked' : ''} aria-label="Color ${c}">`).join('')}</div>`;
}
function modalActions(canDelete, saveLabel = 'Guardar') {
  return `<div class="modal-actions">
    ${canDelete ? `<button class="btn danger" value="delete" formnovalidate>Eliminar</button>` : ''}
    <div class="right"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">${saveLabel}</button></div>
  </div>`;
}

function taskModal(t) {
  const isNew = !t.id;
  const activeProjects = state.projects.filter(p => p.status !== 'hecho' || p.id === t.projectId);
  const activeGoals = state.goals.filter(g => g.status === 'activo' || g.id === t.goalId);
  openModal(`
    <h3>${isNew ? 'Nueva tarea' : 'Editar tarea'}</h3>
    <label class="field">Tarea<input type="text" name="title" required value="${esc(t.title || '')}"></label>
    <div class="row">
      <label class="field">Día<input type="date" name="date" value="${esc(t.date || '')}"></label>
      <label class="field">Importante<select name="important"><option value="">No</option><option value="1" ${t.important ? 'selected' : ''}>★ Sí</option></select></label>
    </div>
    <label class="field">Proyecto<select name="projectId">${optionList(activeProjects, t.projectId, 'name', 'Ninguno')}</select></label>
    <label class="field">Objetivo<select name="goalId">${optionList(activeGoals, t.goalId, 'title', 'Ninguno (o el del proyecto)')}</select></label>
    ${modalActions(!isNew)}
  `, (d, action) => {
    if (action === 'delete') { state.tasks = state.tasks.filter(x => x.id !== t.id); toast('Tarea eliminada'); return; }
    const obj = isNew ? { id: uid(), done: false, createdAt: Date.now(), doneAt: null } : task(t.id);
    Object.assign(obj, { title: d.title.trim(), date: d.date || null, important: !!d.important, projectId: d.projectId || null, goalId: d.goalId || null });
    if (isNew) state.tasks.push(obj);
  });
}

function blockModal(b) {
  const isNew = !b.id;
  const dayTasks = state.tasks.filter(t => t.date === (b.date || viewDate) && !t.done);
  openModal(`
    <h3>${isNew ? 'Nuevo bloque de tiempo' : 'Editar bloque'}</h3>
    <label class="field">Qué vas a hacer<input type="text" name="title" required value="${esc(b.title || '')}" list="block-suggest" placeholder="Ej. Trabajo profundo, Gimnasio, Estudiar…"></label>
    <datalist id="block-suggest">${dayTasks.map(t => `<option value="${esc(t.title)}">`).join('')}</datalist>
    <div class="row">
      <label class="field">Empieza<input type="time" name="start" required value="${esc(b.start || '')}"></label>
      <label class="field">Termina<input type="time" name="end" required value="${esc(b.end || '')}"></label>
    </div>
    <label class="field">Día<input type="date" name="date" required value="${esc(b.date || viewDate)}"></label>
    <label class="field">Proyecto<select name="projectId">${optionList(state.projects.filter(p => p.status !== 'hecho' || p.id === b.projectId), b.projectId, 'name', 'Ninguno')}</select></label>
    <label class="field">Objetivo<select name="goalId">${optionList(state.goals.filter(g => g.status === 'activo' || g.id === b.goalId), b.goalId, 'title', 'Ninguno')}</select></label>
    ${modalActions(!isNew)}
  `, (d, action) => {
    if (action === 'delete') { state.blocks = state.blocks.filter(x => x.id !== b.id); toast('Bloque eliminado'); return; }
    if (d.end <= d.start) { toast('La hora de fin debe ser posterior al inicio'); return false; }
    const obj = isNew ? { id: uid() } : byId(state.blocks, b.id);
    Object.assign(obj, { title: d.title.trim(), start: d.start, end: d.end, date: d.date, projectId: d.projectId || null, goalId: d.goalId || null });
    if (isNew) state.blocks.push(obj);
  });
}

function suggestBlockTime() {
  const blocks = state.blocks.filter(b => b.date === viewDate).sort((a, b) => a.end.localeCompare(b.end));
  let start = viewDate === todayStr() ? nowHHMM() : '09:00';
  const last = blocks[blocks.length - 1];
  if (last && last.end > start) start = last.end;
  let m = Math.ceil(toMin(start) / 15) * 15;
  if (m > 22 * 60 + 59) m = 9 * 60;
  const f = x => String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  return { start: f(m), end: f(Math.min(m + 60, 23 * 60 + 59)) };
}

function projectModal(p) {
  const isNew = !p.id;
  openModal(`
    <h3>${isNew ? 'Nuevo proyecto' : 'Editar proyecto'}</h3>
    <label class="field">Nombre<input type="text" name="name" required value="${esc(p.name || '')}"></label>
    <label class="field">Objetivo al que contribuye<select name="goalId">${optionList(state.goals.filter(g => g.status === 'activo' || g.id === p.goalId), p.goalId, 'title', 'Ninguno')}</select></label>
    <label class="field">Estado<select name="status">
      ${[['activo', 'Activo'], ['pausado', 'En pausa'], ['hecho', 'Terminado']].map(([v, l]) => `<option value="${v}" ${(p.status || 'activo') === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label class="field">Notas<textarea name="notes" placeholder="Qué es, cómo sabrás que está terminado…">${esc(p.notes || '')}</textarea></label>
    <div class="field"><span>Color</span>${colorPicker(p.color || COLORS[state.projects.length % COLORS.length])}</div>
    ${modalActions(!isNew)}
  `, (d, action) => {
    if (action === 'delete') {
      if (!confirm('¿Eliminar el proyecto? Sus tareas se conservarán sin proyecto.')) return false;
      state.projects = state.projects.filter(x => x.id !== p.id);
      state.tasks.forEach(t => { if (t.projectId === p.id) t.projectId = null; });
      state.blocks.forEach(b => { if (b.projectId === p.id) b.projectId = null; });
      location.hash = '#proyectos';
      toast('Proyecto eliminado');
      return;
    }
    const obj = isNew ? { id: uid(), createdAt: Date.now() } : project(p.id);
    Object.assign(obj, { name: d.name.trim(), goalId: d.goalId || null, status: d.status, notes: d.notes.trim(), color: d.color || COLORS[0] });
    if (isNew) { state.projects.push(obj); setTimeout(() => { location.hash = '#proyecto/' + obj.id; }); }
  });
}

function goalModal(g) {
  const isNew = !g.id;
  openModal(`
    <h3>${isNew ? 'Nuevo objetivo' : 'Editar objetivo'}</h3>
    <label class="field">Objetivo (concreto y medible)<input type="text" name="title" required value="${esc(g.title || '')}" placeholder="Ej. Correr 10 km en menos de 60 min"></label>
    <label class="field">¿Para qué? (tu motivación)<textarea name="why" placeholder="Lo leerás cuando te cueste empezar.">${esc(g.why || '')}</textarea></label>
    <div class="row">
      <label class="field">Fecha límite<input type="date" name="deadline" value="${esc(g.deadline || '')}"></label>
      <label class="field">Área<input type="text" name="area" value="${esc(g.area || '')}" list="areas" placeholder="Salud, Trabajo…"></label>
    </div>
    <datalist id="areas">${['Salud', 'Trabajo', 'Finanzas', 'Relaciones', 'Aprendizaje', 'Personal', 'Ocio'].map(a => `<option value="${a}">`).join('')}</datalist>
    <div class="field"><span>Color</span>${colorPicker(g.color || COLORS[(state.goals.length + 3) % COLORS.length])}</div>
    ${modalActions(!isNew)}
  `, (d, action) => {
    if (action === 'delete') {
      if (!confirm('¿Eliminar el objetivo? Proyectos y tareas se conservarán sin objetivo.')) return false;
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.projects.forEach(p => { if (p.goalId === g.id) p.goalId = null; });
      state.tasks.forEach(t => { if (t.goalId === g.id) t.goalId = null; });
      state.blocks.forEach(b => { if (b.goalId === g.id) b.goalId = null; });
      location.hash = '#objetivos';
      toast('Objetivo eliminado');
      return;
    }
    const obj = isNew ? { id: uid(), status: 'activo', createdAt: Date.now() } : goal(g.id);
    Object.assign(obj, { title: d.title.trim(), why: d.why.trim(), deadline: d.deadline || null, area: d.area.trim(), color: d.color || COLORS[0] });
    if (isNew) { state.goals.push(obj); setTimeout(() => { location.hash = '#objetivo/' + obj.id; }); }
  });
}

/* ---------- Acciones ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'FORM' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'toggle-task': {
      const t = task(id); t.done = !t.done; t.doneAt = t.done ? Date.now() : null;
      if (t.done) toast(pick(['¡Hecho! 💪', '¡Una menos!', '¡Bien! Sigue así.', '¡Genial!']));
      break;
    }
    case 'star-task': { const t = task(id); t.important = !t.important; break; }
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
      toast('A por ello. Solo esto durante ' + minutes + ' minutos.');
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      route(); return;
    }
    case 'focus-stop': setTimer(null); document.title = 'Mi Organizador'; route(); return;
    case 'export': exportData(); return;
    case 'reset':
      if (confirm('¿Seguro? Se borrarán todas tus tareas, proyectos y objetivos de este dispositivo.')) { state = emptyState(); toast('Todo borrado'); break; }
      return;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
    default: return;
  }
  save(); rerender();
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.act !== 'quick-add') return;
  e.preventDefault();
  const title = f.elements.namedItem('title').value.trim();
  if (!title) return;
  state.tasks.push({
    id: uid(), title, done: false, important: false, createdAt: Date.now(), doneAt: null,
    date: f.dataset.date || null, projectId: f.dataset.project || null, goalId: f.dataset.goal || null,
  });
  save(); rerender();
  const input = document.querySelector(`form[data-act="quick-add"] input[name=title]`);
  if (input) input.focus();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'focus-minutes') { state.settings.focusMinutes = Number(el.value); save(); toast('Guardado'); }
  if (el.dataset.act === 'import' && el.files[0]) importData(el.files[0]);
});

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `organizador-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.tasks) || !Array.isArray(s.projects) || !Array.isArray(s.goals)) throw new Error('formato no válido');
      if (!confirm('Esto reemplazará los datos de este dispositivo por los del archivo. ¿Continuar?')) return;
      state = { ...emptyState(), ...s, settings: { ...emptyState().settings, ...(s.settings || {}) } };
      save(); toast('Datos importados'); route();
    } catch (err) { toast('No se pudo importar: ' + err.message); }
  };
  r.readAsText(file);
}

/* Si se cambia de pestaña/día, refrescar al volver */
let lastDay = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const fresh = loadState();
  if (fresh) state = fresh;
  if (lastDay !== todayStr()) { if (viewDate === lastDay) viewDate = todayStr(); lastDay = todayStr(); }
  rerender();
});
/* Sincroniza entre pestañas abiertas del mismo navegador */
window.addEventListener('storage', e => { if (e.key === STORE_KEY) { state = loadState() || emptyState(); rerender(); } });
/* Refresca la marca "AHORA" de los bloques cada minuto */
setInterval(() => { if ((location.hash || '#hoy').startsWith('#hoy') && !modal.open) rerender(); }, 60000);

/* ---------- PWA ---------- */

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}

route();
