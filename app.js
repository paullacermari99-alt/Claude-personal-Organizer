/* P Organizer — vistas, formularios y acciones.
   Usa core.js (datos y cálculos) y calendar.js (Semana). Los datos viven en localStorage. */
'use strict';

let viewDate = todayStr();
let taskQuery = '';
const expanded = new Set();     /* diarias desplegadas */
let focusTaskId = null;
let focusMins = null;

/* ---------- Aviso con acción (Deshacer) ---------- */

let toastTimer, toastAction = null;
function toast(msg, opts = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button" class="toast-btn">${esc(opts.action)}</button>` : ''}`;
  toastAction = opts.onAction || null;
  el.classList.toggle('actionable', !!opts.action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); toastAction = null; }, opts.action ? 5000 : 2400);
}
$('#toast').addEventListener('click', e => {
  if (!e.target.closest('.toast-btn') || !toastAction) return;
  const f = toastAction;
  toastAction = null;
  $('#toast').classList.remove('show');
  f();
});

/* ---------- Router ---------- */

function parseHash() {
  const [name, id, sub] = (location.hash.replace(/^#/, '') || 'hoy').split('/');
  return { name: name || 'hoy', id, sub };
}
const NAV_OF = { proyecto: 'proyectos', objetivo: 'objetivos' };
function renderView() {
  const { name, id, sub } = parseHash();
  const sec = NAV_OF[name] || name;
  document.body.dataset.view = sec;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === sec || (a.dataset.also || '').split(' ').includes(sec)));
  switch (name) {
    case 'semana': return viewWeek();
    case 'tareas': return viewTasks();
    case 'diarias': return viewRoutines();
    case 'revision': return viewReview();
    case 'proyectos': return viewProjects();
    case 'proyecto': return viewProject(id, sub);
    case 'objetivos': return viewGoals();
    case 'objetivo': return viewGoal(id);
    case 'ajustes': return viewSettings();
    case 'progreso': return viewStats();
    default: return viewToday();
  }
}
function route() {
  const calScroll = $('.cal-scroll');
  const keep = calScroll ? { top: calScroll.scrollTop, left: calScroll.scrollLeft, key: calScroll.dataset.key } : null;
  $('#app').innerHTML = renderView();
  updateTimerUI();
  afterRenderCalendar(keep);
}
function rerender() { const y = window.scrollY; route(); window.scrollTo(0, y); }
function navigate(fn) {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const vt = document.startViewTransition(fn);
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach(pr => pr && pr.catch(() => {}));
  } else fn();
}
/* Actualiza solo las zonas data-live (contadores, progreso…) sin repintar listas:
   así nada se mueve ni cambia de tamaño al marcar una tarea. */
function refreshLive() {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderView();
  $$('[data-live]').forEach(el => {
    const fresh = tpl.content.querySelector(`[data-live="${el.dataset.live}"]`);
    if (!fresh || fresh.innerHTML === el.innerHTML) return;
    const a = document.activeElement;
    if (a && el.contains(a) && a.matches('input:not([type=checkbox]), textarea, select')) return;
    el.innerHTML = fresh.innerHTML;
  });
}
window.addEventListener('hashchange', () => navigate(() => { route(); window.scrollTo(0, 0); }));

/* ---------- Piezas comunes ---------- */

function pageHead({ eyebrow = '', title, actions = '', dot = '' }) {
  return `<header class="page-head">
    <div class="ph-text">
      <div class="eyebrow">${eyebrow || '&nbsp;'}</div>
      <h1>${dot ? `<span class="title-dot" style="--c:${dot}"></span>` : ''}${title}</h1>
    </div>
    ${actions ? `<div class="ph-actions">${actions}</div>` : ''}
  </header>`;
}
function backLink(href, label) { return `<a class="back" href="${href}">${I.left}<span>${label}</span></a>`; }
function progressBar(pct) { return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`; }
function statRow(key, pct, label) { return `<div class="stat-row" data-live="${key}">${progressBar(pct)}<span class="count">${label}</span></div>`; }
function durLabel(m) { return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`; }
function durationLabel(a, b) { const m = toMin(b) - toMin(a); return m > 0 ? durLabel(m) : ''; }
function tagPill(tg) { return `<span class="tag dot" style="--c:${tg.color}">${esc(tg.name)}</span>`; }
function projTag(p) { return `<span class="tag dot" style="--c:${p.color}">${esc(p.icon || '')} ${esc(p.name)}</span>`; }
function dueTag(t) {
  if (!t.due) return '';
  const late = !t.done && t.due < todayStr();
  return `<span class="tag ${late ? 'warn' : ''}" title="Plazo">${I.flag}${esc(relDay(t.due))}</span>`;
}
function emptyBox(txt) { return `<div class="empty">${txt}</div>`; }
function dayPriorities(d) { const dp = state.dayPlans[d]; return ((dp && dp.priorities) || []).filter(id => task(id)); }
const stable = (a, b) => (PRI_ORDER[b.priority] - PRI_ORDER[a.priority]) || (a.createdAt - b.createdAt);

function taskMeta(t, opts = {}) {
  const out = [];
  if (t.due && opts.hideDue !== t.due) out.push(dueTag(t));
  const p = projectOfTask(t), g = t.goalId && goal(t.goalId);
  if (p && !opts.hideProject) out.push(projTag(p));
  if (g && !opts.hideGoal) out.push(`<span class="tag dot" style="--c:${g.color}">${I.target}${esc(g.title)}</span>`);
  (t.tags || []).map(tag).filter(Boolean).forEach(tg => out.push(tagPill(tg)));
  if (t.priority === 'high') out.push(`<span class="tag pri-high">Alta</span>`);
  else if (t.priority === 'med') out.push(`<span class="tag pri-med">Media</span>`);
  if (t.estimate) out.push(`<span class="tag">${I.clock}${durLabel(t.estimate)}</span>`);
  if (t.subtasks && t.subtasks.length) out.push(`<span class="tag">${I.list}${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>`);
  const ev = blocksOfTask(t.id).filter(e => !e.recurrence && e.date >= todayStr()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  if (ev) out.push(`<span class="tag tag-block" title="Tiempo reservado">${I.cal}${esc(relDay(ev.date))} ${esc(ev.start)}</span>`);
  return out.join('');
}

function taskItem(t, opts = {}) {
  const meta = taskMeta(t, opts);
  const isPrio = opts.star && dayPriorities(viewDate).includes(t.id);
  return `<li class="task ${t.done ? 'done' : ''} ${opts.firstStep ? 'prio' : ''}" data-task="${t.id}" data-drag="task" data-id="${t.id}">
    <div class="swipe-act done-act" aria-hidden="true">✓ Hecha</div>
    <div class="swipe-act later-act" aria-hidden="true">Mañana →</div>
    <div class="task-row">
      <input type="checkbox" class="check" data-act="toggle-task" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Completar ${esc(t.title)}">
      <div class="body" data-act="edit-task" data-id="${t.id}">
        <div class="title">${esc(t.title)}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${opts.firstStep ? `<label class="step-line"><span>Primer paso</span><input type="text" class="step-input" data-input="first-step" data-id="${t.id}" value="${esc(t.firstStep)}" placeholder="Lo más pequeño que puedas hacer ya…" enterkeyhint="done"></label>` : ''}
      </div>
      ${opts.moveToday ? `<button class="btn small" data-act="move-today" data-id="${t.id}">A hoy</button>` : ''}
      <button class="icon-btn" data-act="focus-open" data-id="${t.id}" aria-label="Empezar ${esc(t.title)}" title="Empezar">${I.play}</button>
      ${opts.noResched ? '' : `<button class="icon-btn" data-act="resched" data-id="${t.id}" aria-label="Reprogramar" title="Reprogramar">${I.resched}</button>`}
      ${opts.star ? `<button class="icon-btn ${isPrio ? 'on' : ''}" data-act="prio-toggle" data-id="${t.id}" aria-label="${isPrio ? 'Quitar de prioridades' : 'Hacer prioridad de hoy'}" title="Prioridad de hoy">${isPrio ? I.starFill : I.star}</button>` : ''}
    </div>
  </li>`;
}
function taskList(tasks, opts) {
  if (!tasks.length) return '';
  return `<ul class="tasks glass">${tasks.map(t => taskItem(t, opts)).join('')}</ul>`;
}
function quickAdd(ctx, placeholder = 'Nueva tarea') {
  const attrs = Object.entries(ctx).filter(([, v]) => v).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<form class="quick-add glass" data-act="quick-add" ${attrs}>
    <input type="text" name="title" placeholder="${placeholder}" autocomplete="off" enterkeyhint="done" aria-label="${placeholder}">
    <button class="icon-btn round" type="submit" aria-label="Añadir tarea">${I.plus}</button>
  </form>`;
}
function collapsible(key, title, count, body, extra = '') {
  const closed = !!state.settings.ui.collapsed[key];
  return `<section class="section collapsible ${closed ? 'closed' : ''}" data-key="${key}">
    <div class="section-head">
      <button class="sec-toggle" data-act="collapse" data-key="${key}" aria-expanded="${!closed}">${I.down}<h2>${title} · <span data-live="cnt-${key}">${count}</span></h2></button>
      ${extra}
    </div>
    <div class="collapse-body">${body}</div>
  </section>`;
}

/* ---------- Diarias (grupo con contador) ---------- */

function routineColor(r) {
  const tg = r.tagId && tag(r.tagId), p = r.projectId && project(r.projectId);
  return tg ? tg.color : p ? p.color : 'var(--accent)';
}
function scheduleLabel(r) {
  if (!r.days || !r.days.length || r.days.length === 7) return 'Cada día';
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter(d => r.days.includes(d)).map(d => DOW_SHORT[d]).join(', ');
}
function routineGroup(r, opts = {}) {
  const pend = pendingOfRoutine(r.id);
  const open = expanded.has(r.id) && pend.length > 0;
  return `<div class="routine glass" style="--c:${routineColor(r)}">
    <div data-live="rt-${r.id}">
      <div class="rt-head">
        <button class="rt-count ${pend.length ? '' : 'zero'}" data-act="rt-expand" data-id="${r.id}" aria-expanded="${open}" aria-label="${pend.length} pendientes; ver lista">${pend.length || '✓'}</button>
        <div class="rt-body" data-act="${opts.manage ? 'edit-routine' : 'rt-expand'}" data-id="${r.id}">
          <div class="title">${esc(r.title)}</div>
          <div class="meta small muted">${(st => st.streak ? `<b class="streak">🔥 ${st.streak}</b> · ` : '')(routineStats(r))}${scheduleLabel(r)}${isPaused(r) ? ' · <b class="paused">En pausa</b>' : ''} · ${pend.length ? `${pend.length === 1 ? '1 pendiente' : pend.length + ' pendientes'} desde ${esc(relDay(pend[0].routineDate).toLowerCase())}` : 'al día'}</div>
        </div>
        ${pend.length ? `<button class="btn small" data-act="rt-one" data-id="${r.id}">Completar una</button>` : ''}
        ${pend.length ? `<button class="icon-btn rt-chev ${open ? 'open' : ''}" data-act="rt-expand" data-id="${r.id}" aria-label="Desplegar">${I.down}</button>` : ''}
      </div>
      ${open ? `<ul class="rt-list">${pend.map(t => `<li class="rt-item" data-task="${t.id}">
          <input type="checkbox" class="check sm" data-act="toggle-task" data-id="${t.id}" aria-label="Completar la del ${esc(fmtShortDate(t.routineDate))}">
          <span>${esc(fmtLongDate(t.routineDate))}</span><span class="muted small">${esc(relDay(t.routineDate))}</span>
        </li>`).join('')}</ul>` : ''}
    </div>
    ${opts.manage ? `<div class="rt-actions">
      <button class="btn small" data-act="rt-pause" data-id="${r.id}">${isPaused(r) ? 'Reanudar' : 'Pausar'}</button>
      <button class="btn small" data-act="edit-routine" data-id="${r.id}">Editar</button>
      <span class="muted small">${(st => `Mejor racha ${st.best}${st.rate !== null ? ` · ${st.rate}% en 30 días` : ''}`)(routineStats(r))}</span>
    </div>` : ''}
  </div>`;
}

/* ---------- Vista: Hoy ---------- */

function blockItem(e, isToday, now) {
  const t = e.taskId && task(e.taskId);
  const isNow = isToday && e.start <= now && now < e.end;
  const isPast = isToday && e.end <= now;
  const tg = e.tagId && tag(e.tagId), p = e.projectId && project(e.projectId);
  const clash = overlapIds(e.date).has(e.id);
  return `<div class="block glass ${isNow ? 'now' : ''} ${isPast ? 'past' : ''}" style="--c:${colorOfEvent(e)}" data-act="edit-event" data-id="${e.id}" data-start="${e.start}" data-end="${e.end}" role="button" tabindex="0">
    <div class="hours">${esc(e.start)}<span>${esc(e.end)}</span></div>
    <div>
      <div>${clash ? '<span class="ev-warn" title="Se solapa">⚠</span> ' : ''}${e.recurrence ? '↻ ' : ''}${esc(e.title)}<span class="now-badge ${isNow ? '' : 'hidden'}">AHORA</span></div>
      ${t || tg || p ? `<div class="meta">${t ? `<span class="tag">☑ Tarea${t.due ? ' · plazo ' + esc(relDay(t.due).toLowerCase()) : ''}</span>` : ''}${tg ? tagPill(tg) : ''}${p ? projTag(p) : ''}</div>` : ''}
    </div>
    <span class="muted small">${durationLabel(e.start, e.end)}</span>
  </div>`;
}
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

function viewToday() {
  const d = viewDate, today = todayStr(), isToday = d === today;
  const prios = dayPriorities(d).map(task);
  const prioSet = new Set(prios.map(t => t.id));
  const evs = eventsOn(d);
  const blockIds = new Set(evs.filter(e => e.taskId).map(e => e.taskId));
  const dayTasks = state.tasks.filter(t => !isRoutineTask(t) && !prioSet.has(t.id) && (t.due === d || blockIds.has(t.id))).sort(stable);
  const overdue = isToday ? state.tasks.filter(t => !isRoutineTask(t) && !prioSet.has(t.id) && !blockIds.has(t.id) && !t.done && t.due && t.due < d).sort(sortByDue) : [];
  const routines = isToday ? state.routines.filter(r => pendingOfRoutine(r.id).length) : [];
  const totalPend = routines.reduce((a, r) => a + pendingOfRoutine(r.id).length, 0);
  const prog = progressOf([...prios, ...dayTasks]);
  const now = nowHHMM();
  const h = Number(now.slice(0, 2));
  const greeting = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const weekday = cap(parseYmd(d).toLocaleDateString('es-ES', { weekday: 'long' }));
  const dayMonth = parseYmd(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  return `
  <div class="page page-today">
  ${pageHead({
    eyebrow: isToday ? `${weekday} · ${greeting}, Pau` : `${weekday} · ${relDay(d)}`,
    title: esc(dayMonth),
    actions: `<button class="icon-btn round" data-act="day" data-n="-1" aria-label="Día anterior">${I.left}</button>
      ${isToday ? '' : `<button class="btn small" data-act="day" data-n="0">Hoy</button>`}
      <button class="icon-btn round" data-act="day" data-n="1" aria-label="Día siguiente">${I.right}</button>
      <a class="icon-btn round mobile-only" href="#ajustes" aria-label="Ajustes">${I.gear}</a>`,
  })}

  <div class="today-grid">
    <div class="col-main">
      ${isToday && !(state.dayPlans[d] && state.dayPlans[d].planned) ? `<div class="plan-card glass">
        <div class="grow"><div class="title">Planifica tu día en 1 minuto</div><div class="small muted">Elige 3 prioridades y reserva hueco para ellas.</div></div>
        <button class="btn primary small" data-act="plan-day">Empezar</button>
        <button class="icon-btn" data-act="plan-skip" aria-label="Ahora no">${I.close}</button>
      </div>` : ''}
      <div class="section day-prog">${statRow('day-progress', prog.pct, prog.total ? `${prog.done} de ${prog.total}` : 'Sin tareas')}<a class="btn small ghost" href="#progreso">${I.chart}<span>Progreso</span></a></div>

      <div class="section">
        <div class="section-head"><h2>Prioridades · ${prios.length}/3</h2><button class="btn small" data-act="pick-priorities">${prios.length ? 'Cambiar' : 'Elegir'}</button></div>
        ${prios.length ? `<ul class="tasks glass">${prios.map(t => taskItem(t, { firstStep: true, star: true, hideDue: d })).join('')}</ul>`
          : emptyBox('¿Qué 3 cosas harían que hoy fuera un buen día? Elígelas y escribe el primer paso de cada una.')}
      </div>

      ${overdue.length ? collapsible('vencidas', 'Vencidas', overdue.length, taskList(overdue, { star: true, moveToday: true }),
        `<button class="btn small ghost" data-act="move-all-today">Todas a hoy</button>`) : ''}

      ${routines.length ? collapsible('diarias', 'Diarias pendientes', totalPend, routines.map(r => routineGroup(r)).join(''),
        `<a class="btn small ghost" href="#diarias">Ver diarias</a>`) : ''}

      <div class="section">
        <div class="section-head"><h2>Tareas</h2>${isToday && !routines.length ? `<a class="btn small ghost" href="#diarias">${I.daily}<span>Diarias</span></a>` : ''}</div>
        ${taskList(dayTasks, { star: true, hideDue: d })}
        ${quickAdd({ due: d }, 'Nueva tarea para ' + relDay(d).toLowerCase())}
        <p class="hint touch-only">Desliza a la derecha para completar o a la izquierda para pasar a mañana.</p>
      </div>
    </div>

    <aside class="col-side">
      <div class="section">
        <div class="section-head"><h2>Horario</h2><button class="btn small" data-act="new-event" data-date="${d}">${I.plus}<span>Añadir bloque</span></button></div>
        <div class="agenda-list">
          ${evs.length ? `<div class="timeline">${evs.map(e => blockItem(e, isToday, now)).join('')}</div>`
            : emptyBox('Reserva tiempo para lo que importa. Un bloque es una cita contigo.')}
        </div>
        <div class="agenda-cal">${calendarGrid([d], { compact: true })}</div>
        <p class="hint desktop-only">Arrastra una tarea a una hora para reservarle tiempo; su plazo no cambia.</p>
      </div>
    </aside>
  </div>
  </div>`;
}

/* ---------- Vista: Tareas ---------- */

const TASK_TABS = [['bandeja', 'Bandeja'], ['proximas', 'Próximas'], ['vencidas', 'Vencidas'], ['completadas', 'Hechas']];
function tasksForTab(tab) {
  const today = todayStr();
  const base = state.tasks.filter(t => !isRoutineTask(t));
  switch (tab) {
    case 'proximas': return base.filter(t => !t.done && t.due && t.due >= today).sort(sortByDue);
    case 'vencidas': return base.filter(t => !t.done && t.due && t.due < today).sort(sortByDue);
    case 'completadas': return base.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    default: return base.filter(t => !t.done && !t.due).sort(stable);
  }
}
function filterTasks(list) {
  const f = state.settings.ui.taskFilter || {};
  const q = taskQuery.trim().toLowerCase();
  return list.filter(t => {
    if (f.project) { const p = projectOfTask(t); if (!p || p.id !== f.project) return false; }
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (q && !(t.title + ' ' + t.notes + ' ' + (t.subtasks || []).map(s => s.title).join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
}
function taskResults() {
  const tab = state.settings.ui.tasksTab || 'bandeja';
  const list = filterTasks(tasksForTab(tab));
  if (!list.length) {
    const msg = taskQuery || Object.values(state.settings.ui.taskFilter || {}).some(Boolean) ? 'Nada coincide con la búsqueda o los filtros.'
      : { bandeja: 'Bandeja vacía. Lo que apuntes sin fecha aparecerá aquí.', proximas: 'No tienes tareas con plazo por delante.', vencidas: 'Nada vencido. ¡Bien!', completadas: 'Aún no has completado tareas.' }[tab];
    return emptyBox(msg);
  }
  if (tab === 'proximas' || tab === 'vencidas') {
    const groups = new Map();
    list.forEach(t => { if (!groups.has(t.due)) groups.set(t.due, []); groups.get(t.due).push(t); });
    return [...groups].map(([d, ts]) => `<div class="day-group"><h3 class="group-title">${esc(relDay(d))} <span class="muted">· ${esc(fmtShortDate(d))}</span></h3>${taskList(ts, { hideDue: d })}</div>`).join('');
  }
  return taskList(list, {});
}
function viewTasks() {
  const ui = state.settings.ui, tab = ui.tasksTab || 'bandeja', f = ui.taskFilter || {};
  const counts = Object.fromEntries(TASK_TABS.map(([k]) => [k, tasksForTab(k).length]));
  const activeProjects = state.projects.filter(p => !p.archived);
  return `
  <div class="page page-mid">
  ${pageHead({ eyebrow: 'Todo lo que tienes entre manos', title: 'Tareas', actions: `<a class="btn small" href="#diarias">${I.daily}<span>Diarias</span></a>
    <button class="btn primary" data-act="new-task">${I.plus}<span>Nueva</span></button>` })}
  <div class="segmented" role="tablist" data-live="task-tabs">${TASK_TABS.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-act="tasks-tab" data-v="${k}">${l}${k !== 'completadas' && counts[k] ? ` <span class="seg-count ${k === 'vencidas' ? 'warn' : ''}">${counts[k]}</span>` : ''}</button>`).join('')}</div>
  <div class="filters">
    <label class="search glass">${I.search}<input type="search" data-input="task-search" value="${esc(taskQuery)}" placeholder="Buscar tareas" aria-label="Buscar tareas"></label>
    <select data-set-ui="taskFilter.project" aria-label="Filtrar por proyecto"><option value="">Proyecto: todos</option>${activeProjects.map(p => `<option value="${p.id}" ${f.project === p.id ? 'selected' : ''}>${esc(p.icon)} ${esc(p.name)}</option>`).join('')}</select>
    <select data-set-ui="taskFilter.tag" aria-label="Filtrar por etiqueta"><option value="">Etiqueta: todas</option>${state.tags.map(t => `<option value="${t.id}" ${f.tag === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <select data-set-ui="taskFilter.priority" aria-label="Filtrar por prioridad"><option value="">Prioridad: todas</option>${Object.entries(PRIORITIES).map(([k, l]) => `<option value="${k}" ${f.priority === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  ${tab === 'completadas' ? '' : quickAdd({ due: tab === 'proximas' ? todayStr() : tab === 'bandeja' ? '' : '' }, tab === 'proximas' ? 'Nueva tarea para hoy' : 'Apunta algo (solo el título)')}
  <div id="task-results" class="section-gap">${taskResults()}</div>
  </div>`;
}

/* ---------- Vista: Diarias ---------- */

function viewRoutines() {
  const list = state.routines.slice().sort((a, b) => isPaused(a) - isPaused(b) || a.createdAt - b.createdAt);
  return `
  <div class="page page-mid">
  ${pageHead({ eyebrow: backLink('#tareas', 'Tareas'), title: 'Diarias', actions: `<button class="btn primary" data-act="new-routine">${I.plus}<span>Nueva</span></button>` })}
  <p class="hint intro">Cada día programado crea una tarea, aunque no abras la app. Las que no hagas se acumulan bajo un contador: «Completar una» marca la más antigua.</p>
  ${list.length ? `<div class="routine-list">${list.map(r => routineGroup(r, { manage: true })).join('')}</div>`
    : emptyBox('Crea una diaria para lo que quieres hacer cada día o ciertos días: leer, beber agua, repasar…')}
  </div>`;
}

/* ---------- Vista: Revisión semanal ---------- */

function reviewWeekStart() {
  const today = todayStr(), ws = startOfWeek(today);
  return addDays(ws, 6) === today ? addDays(ws, 7) : ws; /* el último día de la semana se planifica la siguiente */
}
function viewReview() {
  const ws = reviewWeekStart(), days = weekDays(ws), we = days[6], today = todayStr();
  const open = state.tasks.filter(t => !t.done && !isRoutineTask(t));
  const pending = open.filter(t => !t.due || t.due < today).sort(sortByDue);
  const wp = state.weekPlans[ws] || { priorities: [] };
  const prios = wp.priorities.map(task).filter(Boolean);
  const cands = open.filter(t => !wp.priorities.includes(t.id)).sort(sortByDue).slice(0, 30);
  const from = today > ws ? today : ws;
  return `
  <div class="page page-mid page-review">
  ${pageHead({ eyebrow: backLink('#semana', 'Semana'), title: 'Revisión semanal' })}
  <p class="hint intro">Semana del ${esc(fmtShortDate(ws))} al ${esc(fmtShortDate(we))}. Tres pasos, unos 10 minutos.</p>

  <div class="section step">
    <div class="step-head"><span class="step-num">1</span><div><h3>Revisa lo pendiente</h3><p class="muted small">Vencidas y sin fecha: complétalas, reprográmalas o bórralas.</p></div></div>
    ${pending.length ? taskList(pending, {}) : emptyBox('Nada pendiente. 🎉')}
  </div>

  <div class="section step">
    <div class="step-head"><span class="step-num">2</span><div><h3>Elige tus prioridades</h3><p class="muted small">Lo que de verdad quieres sacar esta semana (hasta 5).</p></div></div>
    <div class="pick-chips">
      ${prios.map(t => `<button class="pick-chip on" data-act="week-prio" data-id="${t.id}" style="--c:${colorOfTask(t)}">★ ${esc(t.title)}</button>`).join('')}
      ${cands.map(t => `<button class="pick-chip" data-act="week-prio" data-id="${t.id}" style="--c:${colorOfTask(t)}">${esc(t.title)}${t.due ? ` <span class="muted">· ${esc(relDay(t.due))}</span>` : ''}</button>`).join('')}
      ${prios.length + cands.length ? '' : emptyBox('No hay tareas abiertas. Crea alguna con el botón +.')}
    </div>
  </div>

  <div class="section step">
    <div class="step-head"><span class="step-num">3</span><div><h3>Dales tiempo en el calendario</h3><p class="muted small">Reservar un hueco no cambia el plazo de la tarea.</p></div></div>
    ${prios.length ? `<div class="settings-group glass">${prios.map(t => {
      const evs = state.events.filter(e => e.taskId === t.id && !e.recurrence && e.date >= ws && e.date <= we).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return `<div class="item">
        <div class="grow"><div>${esc(t.title)}</div><div class="small ${evs.length ? 'muted' : 'warn-text'}">${evs.length ? evs.map(e => `${esc(relDay(e.date))} ${esc(e.start)}–${esc(e.end)}`).join(' · ') : 'Sin tiempo reservado'}${t.due ? ` · plazo ${esc(relDay(t.due).toLowerCase())}` : ''}</div></div>
        <button class="btn small" data-act="auto-reserve" data-id="${t.id}" data-from="${from}" data-to="${we}">Reservar</button>
        <button class="btn small ghost" data-act="reserve-task" data-id="${t.id}">Elegir hora</button>
      </div>`;
    }).join('')}</div>` : emptyBox('Elige primero alguna prioridad en el paso 2.')}
  </div>
  <div class="review-foot">
    <a class="btn" href="#semana">${I.cal}<span>Ver la semana</span></a>
    <button class="btn primary" data-act="review-done" data-ws="${ws}">${state.settings.ui.lastReview === ws ? 'Revisión hecha ✓' : 'Terminar revisión'}</button>
  </div>
  </div>`;
}

/* ---------- Vista: Objetivos ---------- */

function deadlineTag(g) {
  if (!g.due) return '';
  if (g.status === 'cumplido') return `<span class="tag">${I.flag}${esc(fmtShortDate(g.due))}</span>`;
  const n = daysUntil(g.due);
  const txt = n < 0 ? `Venció hace ${-n} d` : n === 0 ? 'Vence hoy' : n === 1 ? 'Queda 1 día' : `Quedan ${n} días`;
  return `<span class="tag ${n <= 7 ? 'warn' : ''}">${I.flag}${txt}</span>`;
}
function statusBadge(st) { return `<span class="tag st-${st}">${STATUS_LABEL[st]}</span>`; }
function goalCard(g) {
  const st = goalStatus(g), pct = goalProgress(g), next = st !== 'cumplido' && nextTaskOfGoal(g);
  const p = g.projectId && project(g.projectId);
  return `<a class="card glass item-card" href="#objetivo/${g.id}" style="--c:${g.color}">
    <div class="top"><div class="swatch">${I.target}</div><div class="name">${esc(g.title)}</div></div>
    <div class="meta">${statusBadge(st)}${deadlineTag(g)}${p ? projTag(p) : ''}</div>
    <div class="stat-row">${progressBar(pct)}<span class="count">${pct}%${g.progressMode === 'manual' ? ' · manual' : ''}</span></div>
    <div class="small muted one-line">${st === 'cumplido' ? `Conseguido el ${esc(fmtShortDate(g.achievedAt || todayStr()))}` : next ? 'Siguiente: ' + esc(next.title) : 'Sin próxima tarea'}</div>
  </a>`;
}
function goalMatches(g, ui) {
  const st = goalStatus(g);
  const okStatus = { activos: st !== 'cumplido', vencidos: st === 'vencido', cumplidos: st === 'cumplido', todos: true }[ui.goalsStatus || 'activos'];
  return okStatus && (ui.goalsHorizon === 'todos' || g.horizon === ui.goalsHorizon) && (!ui.goalsProject || g.projectId === ui.goalsProject);
}
function viewGoals() {
  const ui = state.settings.ui;
  const list = state.goals.filter(g => goalMatches(g, ui)).sort(sortByDue);
  const hs = ui.goalsHorizon === 'todos' ? Object.keys(HORIZONS) : [ui.goalsHorizon];
  const groups = hs.map(h => [h, list.filter(g => g.horizon === h)]).filter(([, gs]) => gs.length);
  return `
  <div class="page">
  ${pageHead({ eyebrow: 'Hacia dónde vas y para qué', title: 'Objetivos', actions: `<button class="btn primary" data-act="new-goal">${I.plus}<span>Nuevo</span></button>` })}
  <div class="toolbar">
    <div class="segmented compact" role="tablist">${[['todos', 'Todos'], ['corto', 'Corto'], ['medio', 'Medio'], ['largo', 'Largo']].map(([v, l]) => `<button role="tab" class="${ui.goalsHorizon === v ? 'on' : ''}" data-act="set-ui" data-k="goalsHorizon" data-v="${v}">${l}</button>`).join('')}</div>
    <select data-set-ui="goalsProject" aria-label="Proyecto"><option value="">Proyecto: todos</option>${state.projects.map(p => `<option value="${p.id}" ${ui.goalsProject === p.id ? 'selected' : ''}>${esc(p.icon)} ${esc(p.name)}</option>`).join('')}</select>
    <select data-set-ui="goalsStatus" aria-label="Estado">${[['activos', 'Activos'], ['vencidos', 'Vencidos'], ['cumplidos', 'Cumplidos'], ['todos', 'Todos']].map(([v, l]) => `<option value="${v}" ${ui.goalsStatus === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  ${groups.length ? groups.map(([h, gs]) => `<div class="section"><div class="section-head"><h2>${HORIZONS[h]} · ${gs.length}</h2></div><div class="grid">${gs.map(goalCard).join('')}</div></div>`).join('')
    : emptyBox(state.goals.length ? 'Ningún objetivo con estos filtros.' : 'Define un objetivo concreto, con plazo y con un «cómo sabré que lo he conseguido».')}
  </div>`;
}
function viewGoal(id) {
  const g = goal(id);
  if (!g) return `<div class="page">${pageHead({ eyebrow: backLink('#objetivos', 'Objetivos'), title: 'No encontrado' })}${emptyBox('Este objetivo ya no existe.')}</div>`;
  const st = goalStatus(g), pct = goalProgress(g), tasks = tasksOfGoal(id).sort(sortByDue);
  const pr = progressOf(tasks), next = nextTaskOfGoal(g), p = g.projectId && project(g.projectId);
  const nextEv = next && blocksOfTask(next.id).filter(e => e.date >= todayStr()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  return `
  <div class="page">
  ${pageHead({ eyebrow: backLink(p ? '#proyecto/' + p.id + '/objetivos' : '#objetivos', p ? esc(p.name) : 'Objetivos'), title: esc(g.title), dot: g.color, actions: `
      ${st === 'cumplido' ? `<button class="btn" data-act="goal-reopen" data-id="${g.id}">Reabrir</button>` : `<button class="btn" data-act="goal-done" data-id="${g.id}">Conseguido</button>`}
      <button class="btn" data-act="edit-goal" data-id="${g.id}">Editar</button>` })}
  <div class="detail-grid">
    <div class="col-side">
      <div class="card glass info-card">
        <div class="meta"><span class="tag">${HORIZONS[g.horizon]}</span>${statusBadge(st)}${deadlineTag(g)}${p ? `<a href="#proyecto/${p.id}">${projTag(p)}</a>` : ''}</div>
        ${statRow('goal-progress', pct, g.progressMode === 'manual' ? `${pct}%` : `${pct}% · ${pr.done}/${pr.total}`)}
        ${g.progressMode === 'manual' && st !== 'cumplido' ? `<label class="field">Progreso manual<input type="range" min="0" max="100" step="5" value="${pct}" data-input="goal-progress" data-id="${g.id}"></label>` : `<p class="muted small">${st === 'cumplido' ? `Conseguido el ${esc(fmtShortDate(g.achievedAt || todayStr()))}.` : 'Progreso automático: tareas hechas de este objetivo.'}</p>`}
        ${g.description ? `<div class="notes">${esc(g.description)}</div>` : ''}
        ${g.success ? `<div class="why-box"><strong>Cómo sabré que lo he conseguido</strong>${esc(g.success)}</div>` : ''}
      </div>
    </div>
    <div class="col-main">
      ${st !== 'cumplido' ? `<div class="section">
        <div class="section-head"><h2>Siguiente paso</h2></div>
        ${next ? `<div class="card glass next-card">
            <div class="grow"><div class="title">${esc(next.title)}</div><div class="small muted">${next.due ? 'Plazo ' + esc(relDay(next.due).toLowerCase()) : 'Sin plazo'}${nextEv ? ` · reservado ${esc(relDay(nextEv.date).toLowerCase())} ${esc(nextEv.start)}` : ''}</div></div>
            <button class="btn small" data-act="reserve-task" data-id="${next.id}">${I.cal}<span>Reservar tiempo</span></button>
            <button class="btn small primary" data-act="focus-open" data-id="${next.id}">${I.play}<span>Empezar</span></button>
          </div>`
          : `<div class="card glass next-card"><div class="grow muted">No hay ninguna tarea pendiente.</div><button class="btn small primary" data-act="new-task" data-goal="${g.id}">${I.plus}<span>Crear siguiente tarea</span></button></div>`}
      </div>` : ''}
      <div class="section">
        <div class="section-head"><h2>Tareas</h2><button class="btn small" data-act="new-task" data-goal="${g.id}">${I.plus}<span>Tarea</span></button></div>
        ${taskList(tasks, { hideGoal: true })}
        ${quickAdd({ goal: g.id })}
      </div>
    </div>
  </div>
  </div>`;
}

/* ---------- Vista: Proyectos ---------- */

function sortedProjects() {
  const ui = state.settings.ui;
  const by = {
    nombre: (a, b) => a.name.localeCompare(b.name, 'es'),
    recientes: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    progreso: (a, b) => progressOf(tasksOfProject(b.id)).pct - progressOf(tasksOfProject(a.id)).pct,
  }[ui.projectsSort] || ((a, b) => (a.order || 0) - (b.order || 0));
  return state.projects.filter(p => !!p.archived === !!ui.projectsArchived).sort((a, b) => (b.favorite - a.favorite) || by(a, b));
}
function projectStats(p) {
  const tasks = tasksOfProject(p.id), pr = progressOf(tasks);
  const goals = state.goals.filter(g => g.projectId === p.id);
  const next = tasks.filter(t => !t.done).sort(sortByDue)[0];
  return { pr, goals, next };
}
function favBtn(p) { return `<button class="icon-btn fav ${p.favorite ? 'on' : ''}" data-act="project-fav" data-id="${p.id}" aria-label="${p.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}">${p.favorite ? I.starFill : I.star}</button>`; }
function projectCard(p) {
  const { pr, goals, next } = projectStats(p);
  return `<a class="card glass item-card" href="#proyecto/${p.id}" style="--c:${p.color}">
    <div class="top"><div class="swatch emoji">${esc(p.icon || '📁')}</div><div class="name">${esc(p.name)}</div>${favBtn(p)}</div>
    <div class="meta"><span class="tag">${goals.length} objetivo${goals.length === 1 ? '' : 's'}</span><span class="tag">${pr.total - pr.done} pendiente${pr.total - pr.done === 1 ? '' : 's'}</span>${p.archived ? '<span class="tag">Archivado</span>' : ''}</div>
    <div class="stat-row">${progressBar(pr.pct)}<span class="count">${pr.done}/${pr.total}</span></div>
    <div class="small muted one-line">${next ? 'Siguiente: ' + esc(next.title) : pr.total ? '¡Todo hecho!' : 'Sin tareas todavía'}</div>
  </a>`;
}
function projectRow(p) {
  const { pr, goals } = projectStats(p);
  return `<li><a class="proj-row" href="#proyecto/${p.id}" style="--c:${p.color}">
    <span class="swatch emoji sm">${esc(p.icon || '📁')}</span>
    <span class="grow"><span class="name">${esc(p.name)}</span><span class="small muted">${goals.length} obj. · ${pr.done}/${pr.total} tareas</span></span>
    <span class="mini-progress">${progressBar(pr.pct)}</span>
    ${favBtn(p)}
  </a></li>`;
}
function viewProjects() {
  const ui = state.settings.ui, list = sortedProjects();
  const nArch = state.projects.filter(p => p.archived).length;
  return `
  <div class="page">
  ${pageHead({ eyebrow: 'Lo que estás construyendo, paso a paso', title: 'Proyectos', actions: `
    <div class="segmented compact icons" role="tablist" aria-label="Vista">
      <button role="tab" class="${ui.projectsView !== 'list' ? 'on' : ''}" data-act="set-ui" data-k="projectsView" data-v="cards" aria-label="Tarjetas">${I.grid}</button>
      <button role="tab" class="${ui.projectsView === 'list' ? 'on' : ''}" data-act="set-ui" data-k="projectsView" data-v="list" aria-label="Lista">${I.list}</button>
    </div>
    <button class="btn primary" data-act="new-project">${I.plus}<span>Nuevo</span></button>` })}
  <div class="toolbar">
    <div class="segmented compact" role="tablist">
      <button role="tab" class="${!ui.projectsArchived ? 'on' : ''}" data-act="set-ui" data-k="projectsArchived" data-v="">Activos</button>
      <button role="tab" class="${ui.projectsArchived ? 'on' : ''}" data-act="set-ui" data-k="projectsArchived" data-v="1">Archivados${nArch ? ' · ' + nArch : ''}</button>
    </div>
    <select data-set-ui="projectsSort" aria-label="Ordenar">${[['manual', 'Orden: creación'], ['nombre', 'Orden: nombre'], ['recientes', 'Orden: recientes'], ['progreso', 'Orden: progreso']].map(([v, l]) => `<option value="${v}" ${ui.projectsSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  ${!list.length ? emptyBox(ui.projectsArchived ? 'No hay proyectos archivados.' : 'Crea un proyecto y divídelo en objetivos y tareas pequeñas.')
    : ui.projectsView === 'list' ? `<ul class="proj-list glass">${list.map(projectRow).join('')}</ul>` : `<div class="grid">${list.map(projectCard).join('')}</div>`}
  </div>`;
}
function viewProject(id, sub) {
  const p = project(id);
  if (!p) return `<div class="page">${pageHead({ eyebrow: backLink('#proyectos', 'Proyectos'), title: 'No encontrado' })}${emptyBox('Este proyecto ya no existe.')}</div>`;
  const tab = ['resumen', 'objetivos', 'tareas'].includes(sub) ? sub : (p.defaultView || 'resumen');
  const tasks = tasksOfProject(id), pr = progressOf(tasks);
  const goals = state.goals.filter(g => g.projectId === id).sort(sortByDue);
  let body = '';
  if (tab === 'resumen') {
    const nextTasks = tasks.filter(t => !t.done).sort(sortByDue).slice(0, 5);
    const today = todayStr();
    const deadlines = [...tasks.filter(t => !t.done && t.due), ...goals.filter(g => g.status !== 'cumplido' && g.due)]
      .filter(x => daysBetween(today, x.due) <= 30).sort(sortByDue).slice(0, 6);
    body = `<div class="detail-grid">
      <div class="col-side"><div class="card glass info-card">
        <div class="meta"><span class="tag">${goals.length} objetivo${goals.length === 1 ? '' : 's'}</span>${p.archived ? '<span class="tag">Archivado</span>' : ''}</div>
        ${statRow('project-progress', pr.pct, `${pr.pct}% · ${pr.done}/${pr.total}`)}
        ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
      </div></div>
      <div class="col-main">
        <div class="section"><div class="section-head"><h2>Siguientes tareas</h2></div>${nextTasks.length ? taskList(nextTasks, { hideProject: true }) : emptyBox('No hay tareas pendientes.')}${quickAdd({ project: p.id })}</div>
        <div class="section"><div class="section-head"><h2>Próximos plazos</h2></div>${deadlines.length ? `<div class="settings-group glass">${deadlines.map(x => `<a class="item" href="${x.horizon ? '#objetivo/' + x.id : '#proyecto/' + p.id + '/tareas'}"><span>${x.horizon ? I.target : '☑'} ${esc(x.title)}</span><span class="tag ${x.due < today ? 'warn' : ''}">${esc(relDay(x.due))}</span></a>`).join('')}</div>` : emptyBox('Nada vence en los próximos 30 días.')}</div>
      </div></div>`;
  } else if (tab === 'objetivos') {
    body = `<div class="section"><div class="section-head"><h2>Objetivos · ${goals.length}</h2><button class="btn small" data-act="new-goal" data-project="${p.id}">${I.plus}<span>Objetivo</span></button></div>
      ${goals.length ? `<div class="grid">${goals.map(goalCard).join('')}</div>` : emptyBox('Añade un objetivo con plazo a este proyecto.')}</div>`;
  } else {
    const sorted = tasks.slice().sort(sortByDue);
    body = `<div class="section"><div class="section-head"><h2>Tareas · ${pr.total - pr.done} pendientes</h2></div>
      ${taskList(sorted, { hideProject: true })}${quickAdd({ project: p.id })}
      <p class="hint">Aquí también aparecen las tareas de los objetivos de este proyecto.</p></div>`;
  }
  return `
  <div class="page">
  ${pageHead({ eyebrow: backLink('#proyectos', 'Proyectos'), title: `${esc(p.icon || '')} ${esc(p.name)}`, dot: p.color, actions: `${favBtn(p)}<button class="btn" data-act="edit-project" data-id="${p.id}">Editar</button>` })}
  <div class="segmented" role="tablist">${[['resumen', 'Resumen'], ['objetivos', 'Objetivos'], ['tareas', 'Tareas']].map(([v, l]) => `<button role="tab" class="${tab === v ? 'on' : ''}" data-act="proj-tab" data-id="${p.id}" data-v="${v}">${l}</button>`).join('')}</div>
  ${body}
  </div>`;
}

/* ---------- Vista: Ajustes ---------- */

let deferredInstall = null;
function viewSettings() {
  const s = state.settings, r = s.reminders;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let tzs = [s.timezone];
  try { tzs = Intl.supportedValuesOf('timeZone'); if (!tzs.includes(s.timezone)) tzs.unshift(s.timezone); } catch {}
  const sel = (path, opts, cur, num) => `<select data-set="${path}" ${num ? 'data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `
  <div class="page page-narrow">
  ${pageHead({ eyebrow: `${state.tasks.filter(t => !isRoutineTask(t)).length} tareas · ${state.projects.length} proyectos · ${state.goals.length} objetivos`, title: 'Ajustes' })}

  <div class="section">
    <div class="section-head"><h2>Recordatorios</h2></div>
    <div class="settings-group glass">
      <label class="item"><span>Activar recordatorios</span><input type="checkbox" class="switch" data-set="reminders.enabled" ${r.enabled && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}></label>
      <div class="item"><span>Antes de un bloque</span>${sel('reminders.blocks', [[0, 'No avisar'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes']], r.blocks, true)}</div>
      <div class="item"><span>Plazos</span><div class="inline">${sel('reminders.deadlines', [['off', 'No avisar'], ['day-before', 'El día antes'], ['same-day', 'El mismo día']], r.deadlines)}<input type="time" data-set="reminders.deadlineTime" value="${esc(r.deadlineTime)}" aria-label="Hora del aviso de plazos"></div></div>
      <div class="item"><span>Resumen de diarias</span>${sel('reminders.dailySummary', [['', 'No'], ['08:00', 'A las 8:00'], ['09:00', 'A las 9:00'], ['13:00', 'A las 13:00'], ['18:00', 'A las 18:00'], ['20:00', 'A las 20:00'], ['21:00', 'A las 21:00']], r.dailySummary)}</div>
      <div class="item"><span>Horas de silencio</span><div class="inline"><input type="time" data-set="reminders.quietFrom" value="${esc(r.quietFrom)}" aria-label="Desde"><span class="muted">a</span><input type="time" data-set="reminders.quietTo" value="${esc(r.quietTo)}" aria-label="Hasta"></div></div>
    </div>
    <p class="hint">${perm === 'unsupported' ? 'Este navegador no admite notificaciones. En iPhone, instala la app en la pantalla de inicio.' : perm === 'denied' ? 'Las notificaciones están bloqueadas en el navegador; actívalas en sus ajustes.' : 'Los avisos llegan mientras la app está abierta o en segundo plano. En silencio no se avisa.'}</p>
  </div>

  <div class="section">
    <div class="section-head"><h2>Calendario</h2></div>
    <div class="settings-group glass">
      <div class="item"><span>Zona horaria</span><select data-set="timezone" class="tz">${tzs.map(z => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      <div class="item"><span>Primer día de la semana</span>${sel('weekStart', [[1, 'Lunes'], [0, 'Domingo']], s.weekStart, true)}</div>
      <div class="item"><span>Temporizador de enfoque</span>${sel('focusMinutes', [[5, '5 min'], [15, '15 min'], [25, '25 min']], s.focusMinutes, true)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Etiquetas</h2></div>
    <div class="settings-group glass">
      ${state.tags.map(t => `<div class="item tag-item">
        <input type="color" value="${esc(t.color)}" data-tag-color="${t.id}" aria-label="Color de ${esc(t.name)}">
        <input type="text" class="inline-input" value="${esc(t.name)}" data-tag-name="${t.id}" aria-label="Nombre">
        <button class="icon-btn" data-act="tag-del" data-id="${t.id}" aria-label="Eliminar etiqueta">${I.close}</button>
      </div>`).join('')}
      <form class="item tag-item" data-act="tag-add">
        <input type="color" name="color" value="${COLORS[state.tags.length % COLORS.length]}" aria-label="Color">
        <input type="text" class="inline-input" name="name" placeholder="Nueva etiqueta" aria-label="Nueva etiqueta">
        <button class="btn small" type="submit">Añadir</button>
      </form>
    </div>
    <p class="hint">Un bloque usa su propio color; si no tiene, el de su etiqueta; si no, el de su proyecto. Cambiar un color actualiza todo lo que lo hereda.</p>
  </div>

  <div class="section">
    <div class="section-head"><h2>Tus datos</h2></div>
    <div class="settings-group glass">
      <div class="item"><span>Exportar copia de seguridad</span><button class="btn small" data-act="export">Exportar</button></div>
      <div class="item"><span>Importar copia</span><label class="btn small">Importar<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
      <div class="item"><span style="color:var(--red)">Borrar todo</span><button class="btn small danger" data-act="reset">Borrar</button></div>
    </div>
    <p class="hint">Se guarda solo en este dispositivo, al instante. Exporta aquí e importa en el otro para pasar tus datos.</p>
  </div>

  <div class="section">
    <div class="section-head"><h2>Instalar</h2></div>
    <div class="settings-group glass">
      <div class="item small muted" style="display:block;line-height:1.6">
        <strong style="color:var(--text)">iPhone:</strong> Safari → Compartir → «Añadir a pantalla de inicio».<br>
        <strong style="color:var(--text)">Android:</strong> Chrome → menú ⋮ → «Instalar aplicación».<br>
        <strong style="color:var(--text)">Ordenador:</strong> Chrome o Edge → icono de instalar en la barra de direcciones.
      </div>
      ${deferredInstall ? `<div class="item"><span>Instalar en este dispositivo</span><button class="btn small primary" data-act="install">Instalar</button></div>` : ''}
    </div>
  </div>
  </div>`;
}

/* ---------- Hojas modales ---------- */

const modal = $('#modal');
const modalForm = $('#modal-form');
let modalOpts = {};

function openModal(title, body, opts = {}) {
  /* Guardar es el único botón submit: Intro siempre guarda */
  modalForm.innerHTML = `
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <button type="button" class="btn" data-modal="cancel">${opts.onSave ? 'Cancelar' : 'Cerrar'}</button>
      <h3>${title}</h3>
      ${opts.onSave ? `<button type="submit" class="btn primary">${opts.saveLabel || 'Guardar'}</button>` : '<span></span>'}
    </div>
    ${body}
    ${opts.onDelete ? `<button type="button" class="btn wide danger" data-modal="delete">${opts.deleteLabel || 'Eliminar'}</button>` : ''}`;
  modalOpts = opts;
  if (modal.open) modal.close();
  modal.showModal();
  modalForm.scrollTop = 0;
  /* Sin esto el navegador enfoca «Cancelar» y lo dibuja como seleccionado */
  modalForm.focus({ preventScroll: true });
  const first = modalForm.querySelector('input[type=text]');
  if (first && !first.value && matchMedia('(pointer: fine)').matches) first.focus();
}
/* Ejecuta onSave; devuelve true si se guardó */
function submitModal() {
  if (!modalOpts.onSave) return false;
  if (!modalForm.reportValidity()) return false;
  const fd = new FormData(modalForm);
  if (modalOpts.onSave(Object.fromEntries(fd), fd) === false) return false;
  modal.close(); save(); rerender();
  return true;
}
modalForm.addEventListener('submit', e => { e.preventDefault(); submitModal(); });
modalForm.addEventListener('click', e => {
  const b = e.target.closest('[data-modal]');
  if (!b) return;
  const k = b.dataset.modal;
  if (k === 'cancel') { modal.close(); return; }
  if (k === 'delete') { if (modalOpts.onDelete && modalOpts.onDelete() !== false) { modal.close(); save(); rerender(); } return; }
  const fn = modalOpts.actions && modalOpts.actions[k];
  if (fn) fn(b);
});
modalForm.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.enter) { e.preventDefault(); const fn = modalOpts.actions && modalOpts.actions[e.target.dataset.enter]; if (fn) fn(e.target); }
});
modalForm.addEventListener('input', e => {
  const c = e.target.dataset.customFor;
  if (c) { const r = modalForm.querySelector(`input[name="${c}"][value="custom"]`); if (r) r.checked = true; }
});
modalForm.addEventListener('change', e => {
  if (e.target.name === 'repeat') modalForm.dataset.rep = e.target.value;
  if (e.target.name === 'progressMode') modalForm.dataset.pm = e.target.value;
  if (e.target.name === 'p' && e.target.checked && $$('input[name=p]:checked', modalForm).length > 3) { e.target.checked = false; toast('Como máximo 3 prioridades'); }
});
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

function optionList(items, selected, label, emptyLabel) {
  return `<option value="">${emptyLabel}</option>` + items.map(i => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(label(i))}</option>`).join('');
}
const projLabel = p => `${p.icon || ''} ${p.name}`;
const goalLabel = g => g.title + (g.projectId && project(g.projectId) ? ` · ${project(g.projectId).name}` : '');
function colorField(name, sel, { auto = false } = {}) {
  const isCustom = !!sel && !COLORS.includes(sel);
  return `<div class="colors">
    ${auto ? `<label class="color-auto" title="Automático (etiqueta o proyecto)"><input type="radio" name="${name}" value="" ${!sel ? 'checked' : ''}><span>Auto</span></label>` : ''}
    ${COLORS.map((c, i) => `<input type="radio" name="${name}" value="${c}" style="--c:${c}" ${c === sel ? 'checked' : ''} aria-label="Color ${i + 1}">`).join('')}
    <label class="color-custom" title="Otro color"><input type="radio" name="${name}" value="custom" ${isCustom ? 'checked' : ''} aria-label="Color personalizado"><input type="color" name="${name}Custom" value="${isCustom ? esc(sel) : '#8e8e93'}" data-custom-for="${name}" aria-label="Elegir color"></label>
  </div>`;
}
function readColor(d, name) { return d[name] === 'custom' ? d[name + 'Custom'] : (d[name] || null); }
function daysPicker(name, sel = []) {
  return `<div class="days-pick">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="${name}" value="${d}" ${sel.includes(d) ? 'checked' : ''}><span>${DOW_LETTER[d]}</span></label>`).join('')}</div>`;
}
function actionSheet(title, items, sub = '') {
  openModal(title, `${sub ? `<div class="sheet-sub">${sub}</div>` : ''}<div class="sheet-list">${items.map(([l, ic], i) => `<button type="button" class="sheet-item" data-modal="item-${i}">${ic || ''}<span>${l}</span></button>`).join('')}</div>`,
    { actions: Object.fromEntries(items.map(([, , fn], i) => [`item-${i}`, () => { modal.close(); fn(); }])) });
}

function newAnySheet() {
  const { name, id } = parseHash();
  const ctx = name === 'hoy' ? { due: viewDate } : name === 'proyecto' ? { projectId: id } : name === 'objetivo' ? { goalId: id } : {};
  actionSheet('Crear', [
    ['Tarea', I.review, () => taskModal(ctx)],
    ['Evento o bloque', I.cal, () => eventModal(defaultEventCtx())],
    ['Diaria', I.daily, () => routineModal({ projectId: ctx.projectId || null })],
    ['Objetivo', I.target, () => goalModal({ projectId: name === 'proyecto' ? id : null })],
    ['Proyecto', I.grid, () => projectModal({})],
  ]);
}
function defaultEventCtx(date) {
  const today = todayStr();
  let d = date;
  if (!d) {
    if (location.hash.startsWith('#semana') && isPhone()) { const ds = phoneDays(); d = ds.includes(today) ? today : ds[0]; }
    else if (location.hash.startsWith('#semana') && (state.settings.ui.weekMode || '7') !== '1' && weekStart) d = weekDays(weekStart).includes(today) ? today : weekStart;
    else d = viewDate;
  }
  const slot = nextFreeSlot(d, 60) || { start: '09:00', end: '10:00' };
  return { date: d, ...slot };
}

/* Tarea: solo el título es obligatorio */
function subRow(s) {
  return `<div class="sub-row" data-id="${s.id}"><input type="checkbox" class="check sm" ${s.done ? 'checked' : ''} aria-label="Hecha"><input type="text" value="${esc(s.title)}" aria-label="Subtarea"><button type="button" class="icon-btn" data-modal="del-sub" aria-label="Quitar">${I.close}</button></div>`;
}
function taskModal(t0 = {}) {
  const isNew = !t0.id;
  const t = isNew ? newTask(t0) : t0;
  let saved = null;
  const evs = isNew ? [] : blocksOfTask(t.id).filter(e => !e.recurrence && e.date >= todayStr());
  openModal(isNew ? 'Nueva tarea' : 'Tarea', `
    <label class="field">Tarea<input type="text" name="title" required value="${esc(t.title)}" enterkeyhint="done" placeholder="¿Qué hay que hacer?"></label>
    <div class="row">
      <label class="field">Plazo<input type="date" name="due" value="${esc(t.due || '')}"></label>
      <label class="field">Duración estimada<select name="estimate"><option value="">—</option>${ESTIMATES.map(m => `<option value="${m}" ${t.estimate === m ? 'selected' : ''}>${durLabel(m)}</option>`).join('')}</select></label>
    </div>
    <div class="field">Prioridad<div class="seg-radio">${Object.entries(PRIORITIES).map(([k, l]) => `<label><input type="radio" name="priority" value="${k}" ${t.priority === k ? 'checked' : ''}><span>${k === 'none' ? 'Ninguna' : l}</span></label>`).join('')}</div></div>
    ${state.tags.length ? `<div class="field">Etiquetas<div class="tag-pick">${state.tags.map(tg => `<label style="--c:${tg.color}"><input type="checkbox" name="tag" value="${tg.id}" ${t.tags.includes(tg.id) ? 'checked' : ''}><span>${esc(tg.name)}</span></label>`).join('')}</div></div>` : ''}
    <div class="row">
      <label class="field">Proyecto<select name="projectId">${optionList(state.projects.filter(p => !p.archived || p.id === t.projectId), t.projectId, projLabel, 'Ninguno')}</select></label>
      <label class="field">Objetivo<select name="goalId">${optionList(state.goals.filter(g => g.status !== 'cumplido' || g.id === t.goalId), t.goalId, goalLabel, 'Ninguno')}</select></label>
    </div>
    <label class="field">Primer paso<input type="text" name="firstStep" value="${esc(t.firstStep)}" placeholder="Lo más pequeño para arrancar"></label>
    <div class="field">Subtareas
      <div class="subtasks">${t.subtasks.map(subRow).join('')}</div>
      <div class="sub-add"><input type="text" id="sub-new" placeholder="Añadir subtarea" data-enter="add-sub" aria-label="Nueva subtarea"><button type="button" class="icon-btn round" data-modal="add-sub" aria-label="Añadir subtarea">${I.plus}</button></div>
    </div>
    <label class="field">Notas<textarea name="notes" placeholder="Detalles, enlaces…">${esc(t.notes)}</textarea></label>
    ${evs.length ? `<div class="field">Tiempo reservado<div class="small">${evs.map(e => `${esc(relDay(e.date))} ${esc(e.start)}–${esc(e.end)}`).join(' · ')}</div></div>` : ''}
    <div class="sheet-actions">
      <button type="button" class="btn" data-modal="focus">${I.play}<span>Enfoque</span></button>
      <button type="button" class="btn" data-modal="reserve">${I.cal}<span>Reservar tiempo</span></button>
    </div>`, {
    onSave: (d, fd) => {
      const title = d.title.trim();
      if (!title) { toast('Escribe un título'); return false; }
      const obj = isNew ? t : task(t.id);
      const oldTitle = obj.title;
      const subs = $$('.sub-row', modalForm).map(r => ({ id: r.dataset.id || uid(), title: $('input[type=text]', r).value.trim(), done: $('input[type=checkbox]', r).checked })).filter(s => s.title);
      const pendingSub = $('#sub-new', modalForm).value.trim();
      if (pendingSub) subs.push({ id: uid(), title: pendingSub, done: false });
      Object.assign(obj, {
        title, notes: d.notes.trim(), due: d.due || null, priority: d.priority || 'none', tags: fd.getAll('tag'),
        estimate: d.estimate ? Number(d.estimate) : null, projectId: d.projectId || null, goalId: d.goalId || null,
        firstStep: d.firstStep.trim(), subtasks: subs,
      });
      if (isNew) state.tasks.push(obj);
      else blocksOfTask(obj.id).forEach(e => { if (e.title === oldTitle) e.title = title; });
      saved = obj;
    },
    onDelete: isNew ? null : () => {
      const removed = task(t.id), idx = state.tasks.indexOf(removed);
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      const evs2 = state.events.filter(e => e.taskId === t.id);
      state.events = state.events.filter(e => e.taskId !== t.id);
      Object.values(state.dayPlans).concat(Object.values(state.weekPlans)).forEach(p => { p.priorities = (p.priorities || []).filter(x => x !== t.id); });
      toast('Tarea eliminada', { action: 'Deshacer', onAction: () => { state.tasks.splice(idx, 0, removed); state.events.push(...evs2); save(); rerender(); } });
    },
    actions: {
      'add-sub': () => {
        const inp = $('#sub-new', modalForm), v = inp.value.trim();
        if (!v) return;
        $('.subtasks', modalForm).insertAdjacentHTML('beforeend', subRow({ id: uid(), title: v, done: false }));
        inp.value = ''; inp.focus();
      },
      'del-sub': b => b.closest('.sub-row').remove(),
      focus: () => { if (submitModal()) openFocus(saved.id); },
      reserve: () => { if (submitModal()) reserveTask(saved); },
    },
  });
}

/* Evento / bloque de tiempo (puede repetirse y estar vinculado a una tarea) */
function eventModal(ev0 = {}) {
  const sid = ev0.id ? String(ev0.id).split('@')[0] : null;
  const occ = ev0.id && String(ev0.id).includes('@') ? String(ev0.id).split('@')[1] : null;
  const series = sid ? byId(state.events, sid) : null;
  if (ev0.id && !series) return;
  const isNew = !series;
  const src = series ? { ...series, date: occ || series.date } : { title: '', date: viewDate, start: '09:00', end: '10:00', taskId: null, color: null, tagId: null, projectId: null, goalId: null, recurrence: null, ...ev0 };
  const t = src.taskId && task(src.taskId);
  const rec = src.recurrence;
  const rep = !rec ? 'no' : rec.days && rec.days.length ? 'dias' : 'diaria';
  const recFields = occ ? `<div class="linked">↻ Se repite (${rep === 'diaria' ? 'cada día' : esc(scheduleLabel(rec))}). Si cambias el día o la hora, solo cambia este día. <button type="button" class="btn small" data-modal="edit-series">Editar la serie</button></div>`
    : `<div class="rep-wrap">
        <label class="field">Repetir<select name="repeat"><option value="no" ${rep === 'no' ? 'selected' : ''}>No se repite</option><option value="diaria" ${rep === 'diaria' ? 'selected' : ''}>Cada día</option><option value="dias" ${rep === 'dias' ? 'selected' : ''}>Días concretos</option></select></label>
        <div class="rep-days">${daysPicker('rday', rec && rec.days ? rec.days : [dow(src.date)])}</div>
        <label class="field rep-until">Hasta (opcional)<input type="date" name="until" value="${esc((rec && rec.until) || '')}"></label>
      </div>`;
  openModal(isNew ? (t ? 'Reservar tiempo' : 'Nuevo bloque') : occ ? 'Bloque (se repite)' : 'Bloque', `
    <label class="field">Qué vas a hacer<input type="text" name="title" ${t ? '' : 'required'} value="${esc(src.title || (t ? t.title : ''))}" placeholder="Trabajo profundo, clase, gimnasio…"></label>
    ${t ? `<div class="linked">☑ Tiempo para la tarea «${esc(t.title)}»${t.due ? ` · su plazo sigue siendo ${esc(fmtLongDate(t.due).toLowerCase())}` : ''}</div>` : ''}
    <label class="field">Día<input type="date" name="date" required value="${esc(src.date)}"></label>
    <div class="row">
      <label class="field">Empieza<input type="time" name="start" required value="${esc(src.start)}"></label>
      <label class="field">Termina<input type="time" name="end" required value="${esc(src.end)}"></label>
    </div>
    ${recFields}
    <div class="field">Color${colorField('color', src.color, { auto: true })}</div>
    <div class="row">
      <label class="field">Etiqueta<select name="tagId">${optionList(state.tags, src.tagId, x => x.name, 'Ninguna')}</select></label>
      <label class="field">Proyecto<select name="projectId">${optionList(state.projects.filter(p => !p.archived || p.id === src.projectId), src.projectId, projLabel, 'Ninguno')}</select></label>
    </div>
    ${occ ? `<button type="button" class="btn wide danger-soft" data-modal="del-one">Eliminar solo este día</button>` : ''}`, {
    onSave: (d, fd) => {
      if (d.end <= d.start) { toast('La hora de fin debe ser posterior al inicio'); return false; }
      const fields = { title: d.title.trim() || (t ? t.title : 'Bloque'), color: readColor(d, 'color'), tagId: d.tagId || null, projectId: d.projectId || null };
      let saved;
      if (occ) {
        Object.assign(series, fields);
        saved = (d.date !== occ || d.start !== series.start || d.end !== series.end) ? moveEvent(ev0.id, d.date, d.start, d.end) : { ...series, date: occ, id: ev0.id, seriesId: series.id };
      } else {
        const recurrence = d.repeat === 'no' || !d.repeat ? null : { days: d.repeat === 'dias' ? fd.getAll('rday').map(Number) : [], until: d.until || null };
        if (recurrence && d.repeat === 'dias' && !recurrence.days.length) { toast('Elige al menos un día'); return false; }
        if (isNew) { saved = { id: uid(), taskId: src.taskId || null, goalId: src.goalId || null, exceptions: [], date: d.date, start: d.start, end: d.end, recurrence, ...fields }; state.events.push(saved); }
        else { Object.assign(series, fields, { date: d.date, start: d.start, end: d.end, recurrence }); saved = series; }
      }
      if (!warnOverlap(saved)) toast(isNew ? (t ? `Tiempo reservado: ${relDay(saved.date).toLowerCase()} a las ${saved.start}` : 'Bloque creado') : 'Guardado');
    },
    onDelete: isNew ? null : () => {
      const copy = JSON.parse(JSON.stringify(state.events));
      state.events = state.events.filter(e => e.id !== sid);
      toast(series.recurrence ? 'Serie eliminada' : 'Bloque eliminado', { action: 'Deshacer', onAction: () => { state.events = copy; save(); rerender(); } });
    },
    deleteLabel: series && series.recurrence ? 'Eliminar toda la serie' : 'Eliminar',
    actions: {
      'del-one': () => { series.exceptions = [...(series.exceptions || []), occ]; modal.close(); save(); rerender(); toast('Eliminado solo este día', { action: 'Deshacer', onAction: () => { series.exceptions = series.exceptions.filter(x => x !== occ); save(); rerender(); } }); },
      'edit-series': () => eventModal({ id: series.id }),
    },
  });
  modalForm.dataset.rep = rep;
}

function reserveTask(t) {
  const dur = t.estimate || 60, today = todayStr();
  const slot = findSlot(dur, today, addDays(today, 13));
  eventModal({ title: t.title, taskId: t.id, ...slot });
}
function findSlot(dur, from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) { const s = nextFreeSlot(d, dur); if (s) return { date: d, ...s }; }
  return { date: from, start: '09:00', end: fmtHM(9 * 60 + dur) };
}

function reschedSheet(id) {
  const t = task(id);
  if (!t) return;
  const today = todayStr(), nextWeek = addDays(startOfWeek(today), 7), prev = t.due;
  const setDue = due => {
    t.due = due; save(); rerender();
    toast(due ? `Plazo: ${relDay(due).toLowerCase()}` : 'Sin fecha', { action: 'Deshacer', onAction: () => { t.due = prev; save(); rerender(); } });
  };
  openModal('Reprogramar', `
    <div class="sheet-sub">${esc(t.title)}${t.due ? ` · plazo ${esc(relDay(t.due).toLowerCase())}` : ''}</div>
    <div class="sheet-list">
      <button type="button" class="sheet-item" data-modal="r-today">${I.clock}<span>Hoy</span></button>
      <button type="button" class="sheet-item" data-modal="r-tomorrow">${I.right}<span>Mañana</span><span class="muted small">${esc(fmtShortDate(addDays(today, 1)))}</span></button>
      <button type="button" class="sheet-item" data-modal="r-week">${I.cal}<span>Próxima semana</span><span class="muted small">${esc(fmtShortDate(nextWeek))}</span></button>
      <button type="button" class="sheet-item" data-modal="r-none">${I.archive}<span>Sin fecha (bandeja)</span></button>
      <button type="button" class="sheet-item" data-modal="r-reserve">${I.clock}<span>Reservar tiempo en el calendario</span></button>
    </div>
    <label class="field">Otra fecha<input type="date" name="due" value="${esc(t.due || '')}"></label>`, {
    saveLabel: 'Aplicar',
    onSave: d => { if (!d.due) { toast('Elige una fecha'); return false; } modal.close(); setDue(d.due); return false; },
    actions: {
      'r-today': () => { modal.close(); setDue(today); },
      'r-tomorrow': () => { modal.close(); setDue(addDays(today, 1)); },
      'r-week': () => { modal.close(); setDue(nextWeek); },
      'r-none': () => { modal.close(); setDue(null); },
      'r-reserve': () => { modal.close(); reserveTask(t); },
    },
  });
}

function pickPriorities(d) {
  const cur = dayPriorities(d);
  const rank = t => cur.includes(t.id) ? 0 : t.due && t.due <= d ? 1 : t.due && daysBetween(d, t.due) <= 7 ? 2 : 3;
  const cands = state.tasks.filter(t => !isRoutineTask(t) && (!t.done || cur.includes(t.id))).sort((a, b) => rank(a) - rank(b) || sortByDue(a, b)).slice(0, 40);
  openModal('Prioridades', `
    <p class="sheet-sub">Elige hasta 3 para ${esc(relDay(d).toLowerCase())}. Lo demás puede esperar.</p>
    ${cands.length ? `<div class="pick-list glass">${cands.map(t => `<label class="pick"><input type="checkbox" class="check" name="p" value="${t.id}" ${cur.includes(t.id) ? 'checked' : ''}><span class="grow">${esc(t.title)}</span>${t.due ? `<span class="tag ${t.due < todayStr() ? 'warn' : ''}">${esc(relDay(t.due))}</span>` : ''}</label>`).join('')}</div>` : emptyBox('No tienes tareas abiertas.')}`, {
    onSave: (data, fd) => {
      const ids = fd.getAll('p');
      if (ids.length > 3) { toast('Como máximo 3'); return false; }
      state.dayPlans[d] = { ...(state.dayPlans[d] || {}), priorities: ids };
    },
  });
}

/* Planificar el día en 1 minuto: prioridades + huecos */
function planDaySheet() {
  const d = todayStr(), cur = dayPriorities(d);
  const rank = t => cur.includes(t.id) ? 0 : t.due && t.due < d ? 1 : t.due === d ? 1 : PRI_ORDER[t.priority] >= 2 ? 2 : t.due && daysBetween(d, t.due) <= 3 ? 2 : t.due && daysBetween(d, t.due) <= 7 ? 3 : 4;
  const cands = state.tasks.filter(t => !isRoutineTask(t) && !t.done).sort((a, b) => rank(a) - rank(b) || sortByDue(a, b)).slice(0, 30);
  const pre = cur.length ? cur : cands.slice(0, 3).map(t => t.id);
  const free = freeIntervals(d);
  const evs = eventsOn(d);
  const pend = state.routines.reduce((a, r) => a + pendingOfRoutine(r.id).length, 0);
  openModal('Planificar hoy', `
    <div class="plan-summary">
      <div><b>${evs.length}</b><span>bloques</span></div>
      <div><b>${free.reduce((a, [s, e]) => a + e - s, 0) >= 60 ? Math.floor(free.reduce((a, [s, e]) => a + e - s, 0) / 60) + ' h' : free.reduce((a, [s, e]) => a + e - s, 0) + ' min'}</b><span>libres</span></div>
      <div><b>${pend}</b><span>diarias</span></div>
    </div>
    <div class="field">Huecos libres<div class="free-slots">${free.length ? free.map(([s, e]) => `<span class="tag">${fmtHM(s)}–${fmtHM(e)}</span>`).join('') : '<span class="muted">No queda tiempo libre hoy</span>'}</div></div>
    <div class="field">Elige hasta 3 prioridades
      ${cands.length ? `<div class="pick-list glass">${cands.map(t => `<label class="pick"><input type="checkbox" class="check" name="p" value="${t.id}" ${pre.includes(t.id) ? 'checked' : ''}><span class="grow">${esc(t.title)}${t.estimate ? ` <span class="muted small">· ${durLabel(t.estimate)}</span>` : ''}</span>${t.due ? `<span class="tag ${t.due < d ? 'warn' : ''}">${esc(relDay(t.due))}</span>` : ''}</label>`).join('')}</div>` : emptyBox('No tienes tareas abiertas. Apunta alguna primero.')}
    </div>
    <label class="field toggle-row">Reservarles hueco hoy<input type="checkbox" class="switch" name="reserve" value="1" checked></label>`, {
    saveLabel: 'Listo',
    onSave: (data, fd) => {
      const ids = fd.getAll('p');
      if (ids.length > 3) { toast('Como máximo 3'); return false; }
      let booked = 0;
      if (data.reserve) ids.forEach(id => {
        const t = task(id);
        if (eventsOn(d).some(e => e.taskId === id)) return;
        const slot = nextFreeSlot(d, t.estimate || 60);
        if (slot) { scheduleTask(t, d, slot.start, slot.end); booked++; }
      });
      state.dayPlans[d] = { ...(state.dayPlans[d] || {}), priorities: ids, planned: true };
      toast(`Día planificado: ${ids.length} prioridad${ids.length === 1 ? '' : 'es'}${booked ? `, ${booked} con hueco reservado` : ''}`);
    },
  });
}

/* ---------- Vista: Progreso ---------- */

function bars(rows, unit) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="bars">${rows.map(r => `<div class="bar-col ${r.today ? 'today' : ''}" title="${esc(r.label)}: ${r.v} ${unit}">
    <span class="bar-val">${r.v || ''}</span>
    <div class="bar-track"><div class="bar" style="height:${Math.round(r.v / max * 100)}%"></div></div>
    <span class="bar-label">${esc(r.short)}</span>
  </div>`).join('')}</div>`;
}
function viewStats() {
  const today = todayStr(), days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const doneBy = new Map();
  state.tasks.filter(t => t.done && t.doneAt).forEach(t => { const k = dateOfTs(t.doneAt); doneBy.set(k, (doneBy.get(k) || 0) + 1); });
  const focusBy = new Map();
  state.focusLog.forEach(f => focusBy.set(f.date, (focusBy.get(f.date) || 0) + f.minutes));
  const row = (map, d) => ({ v: map.get(d) || 0, label: fmtLongDate(d), short: DOW_LETTER[dow(d)], today: d === today });
  const ws = startOfWeek(today), wDays = weekDays(ws).filter(d => d <= today);
  const sum = (map, list) => list.reduce((a, d) => a + (map.get(d) || 0), 0);
  const prevW = weekDays(addDays(ws, -7));
  const tasksW = sum(doneBy, wDays), tasksPrev = sum(doneBy, prevW.slice(0, wDays.length));
  const focusW = sum(focusBy, wDays);
  const goalsDone = state.goals.filter(g => g.status === 'cumplido').length;
  const rstats = state.routines.map(r => ({ r, ...routineStats(r) })).sort((a, b) => b.streak - a.streak);
  const bestStreak = Math.max(0, ...rstats.map(x => x.streak));
  const diff = tasksW - tasksPrev;
  return `
  <div class="page page-mid">
  ${pageHead({ eyebrow: backLink('#hoy', 'Hoy'), title: 'Progreso' })}
  <div class="stat-tiles">
    <div class="tile glass"><b>${tasksW}</b><span>tareas hechas esta semana</span><small class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff} vs. la anterior</small></div>
    <div class="tile glass"><b>${focusW >= 60 ? (focusW / 60).toFixed(1).replace('.0', '') + ' h' : focusW + ' min'}</b><span>de enfoque esta semana</span></div>
    <div class="tile glass"><b>🔥 ${bestStreak}</b><span>mejor racha activa</span></div>
    <div class="tile glass"><b>${goalsDone}</b><span>objetivo${goalsDone === 1 ? '' : 's'} conseguido${goalsDone === 1 ? '' : 's'}</span></div>
  </div>
  <div class="section"><div class="section-head"><h2>Tareas hechas · últimos 7 días</h2></div><div class="card glass">${bars(days.map(d => row(doneBy, d)), 'tareas')}</div></div>
  <div class="section"><div class="section-head"><h2>Minutos de enfoque · últimos 7 días</h2></div><div class="card glass">${bars(days.map(d => row(focusBy, d)), 'min')}</div></div>
  <div class="section"><div class="section-head"><h2>Rachas de diarias</h2><a class="btn small ghost" href="#diarias">Diarias</a></div>
    ${rstats.length ? `<div class="settings-group glass">${rstats.map(x => `<div class="item"><div class="grow"><div>${esc(x.r.title)}</div><div class="small muted">Mejor racha ${x.best}${x.rate !== null ? ` · ${x.rate}% cumplido en 30 días` : ''}${isPaused(x.r) ? ' · en pausa' : ''}</div></div><b class="streak big">🔥 ${x.streak}</b></div>`).join('')}</div>`
      : emptyBox('Crea una diaria para empezar una racha.')}
  </div>
  </div>`;
}

/* Diaria */
function routineModal(r0 = {}) {
  const isNew = !r0.id;
  const r = isNew ? { title: '', days: [], startDate: todayStr(), tagId: null, projectId: null, goalId: null, ...r0 } : r0;
  openModal(isNew ? 'Nueva diaria' : 'Diaria', `
    <label class="field">Qué quieres hacer<input type="text" name="title" required value="${esc(r.title)}" placeholder="Leer 10 páginas, beber agua…"></label>
    <div class="field">Días <span class="muted small">(sin marcar = cada día)</span>${daysPicker('rday', r.days || [])}</div>
    <label class="field">Empieza el<input type="date" name="startDate" required value="${esc(r.startDate)}"></label>
    <div class="row">
      <label class="field">Etiqueta<select name="tagId">${optionList(state.tags, r.tagId, x => x.name, 'Ninguna')}</select></label>
      <label class="field">Proyecto<select name="projectId">${optionList(state.projects.filter(p => !p.archived), r.projectId, projLabel, 'Ninguno')}</select></label>
    </div>
    <label class="field">Objetivo<select name="goalId">${optionList(state.goals.filter(g => g.status !== 'cumplido'), r.goalId, goalLabel, 'Ninguno')}</select></label>
    <p class="hint">Cada día programado crea una tarea, aunque no abras la app. Si cambias los días, las ya creadas se conservan.</p>`, {
    onSave: (d, fd) => {
      const days = fd.getAll('rday').map(Number);
      const obj = isNew ? { id: uid(), pauses: [], skipped: [], createdAt: Date.now() } : routine(r.id);
      const oldTitle = obj.title;
      Object.assign(obj, { title: d.title.trim(), days: days.length === 7 ? [] : days, startDate: d.startDate, tagId: d.tagId || null, projectId: d.projectId || null, goalId: d.goalId || null });
      if (isNew) state.routines.push(obj);
      else state.tasks.forEach(t => { if (t.routineId === obj.id && !t.done && t.title === oldTitle) Object.assign(t, { title: obj.title, tags: obj.tagId ? [obj.tagId] : [], projectId: obj.projectId, goalId: obj.goalId }); });
      const n = generateRoutines();
      toast(isNew ? (n > 1 ? `Diaria creada · ${n} pendientes desde ${fmtShortDate(obj.startDate)}` : 'Diaria creada') : 'Guardado');
    },
    onDelete: isNew ? null : () => {
      if (!confirm('¿Eliminar la diaria? Se borran sus pendientes; las ya completadas se conservan.')) return false;
      state.routines = state.routines.filter(x => x.id !== r.id);
      state.tasks = state.tasks.filter(t => t.routineId !== r.id || t.done);
      toast('Diaria eliminada');
    },
  });
}

/* Objetivo: título, horizonte y plazo obligatorios */
function goalModal(g0 = {}) {
  const isNew = !g0.id;
  const g = isNew ? { title: '', horizon: 'corto', due: '', description: '', success: '', projectId: null, progressMode: 'auto', progress: 0, color: COLORS[(state.goals.length + 1) % COLORS.length], ...g0 } : g0;
  openModal(isNew ? 'Nuevo objetivo' : 'Objetivo', `
    <label class="field">Objetivo<input type="text" name="title" required value="${esc(g.title)}" placeholder="Correr 10 km en menos de 60 min"></label>
    <div class="row">
      <label class="field">Horizonte<select name="horizon" required>${Object.entries(HORIZONS).map(([k, l]) => `<option value="${k}" ${g.horizon === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Plazo<input type="date" name="due" required value="${esc(g.due || '')}"></label>
    </div>
    <label class="field">Descripción <span class="muted small">(opcional)</span><textarea name="description" placeholder="Para qué lo quieres">${esc(g.description)}</textarea></label>
    <label class="field">Cómo sabré que lo he conseguido <span class="muted small">(opcional)</span><input type="text" name="success" value="${esc(g.success)}" placeholder="Un resultado que se pueda comprobar"></label>
    <label class="field">Proyecto <span class="muted small">(opcional)</span><select name="projectId">${optionList(state.projects.filter(p => !p.archived || p.id === g.projectId), g.projectId, projLabel, 'Ninguno')}</select></label>
    <div class="field">Progreso<div class="seg-radio"><label><input type="radio" name="progressMode" value="auto" ${g.progressMode !== 'manual' ? 'checked' : ''}><span>Automático (tareas)</span></label><label><input type="radio" name="progressMode" value="manual" ${g.progressMode === 'manual' ? 'checked' : ''}><span>Manual</span></label></div></div>
    <label class="field pm-manual">Progreso manual (%)<input type="range" name="progress" min="0" max="100" step="5" value="${Number(g.progress) || 0}"></label>
    <div class="field">Color${colorField('color', g.color)}</div>`, {
    onSave: d => {
      const obj = isNew ? { id: uid(), status: 'activo', achievedAt: null, createdAt: Date.now() } : goal(g.id);
      Object.assign(obj, { title: d.title.trim(), horizon: d.horizon, due: d.due, description: d.description.trim(), success: d.success.trim(), projectId: d.projectId || null, progressMode: d.progressMode, progress: Number(d.progress) || 0, color: readColor(d, 'color') || COLORS[0] });
      if (isNew) { state.goals.push(obj); setTimeout(() => { location.hash = '#objetivo/' + obj.id; }); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('¿Eliminar el objetivo? Sus tareas se conservan sin objetivo.')) return false;
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.tasks.forEach(t => { if (t.goalId === g.id) t.goalId = null; });
      state.events.forEach(e => { if (e.goalId === g.id) e.goalId = null; });
      state.routines.forEach(r => { if (r.goalId === g.id) r.goalId = null; });
      location.hash = '#objetivos';
      toast('Objetivo eliminado');
    },
  });
  modalForm.dataset.pm = g.progressMode === 'manual' ? 'manual' : 'auto';
}

/* Proyecto: icono, color y vista por defecto */
function projectModal(p0 = {}) {
  const isNew = !p0.id;
  const p = isNew ? { name: '', icon: '📁', color: COLORS[state.projects.length % COLORS.length], defaultView: 'resumen', notes: '', favorite: false, archived: false } : p0;
  openModal(isNew ? 'Nuevo proyecto' : 'Proyecto', `
    <label class="field">Nombre<input type="text" name="name" required value="${esc(p.name)}"></label>
    <div class="field">Icono<div class="icon-pick">${PROJECT_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${ic === p.icon ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div></div>
    <div class="field">Color${colorField('color', p.color)}</div>
    <label class="field">Al abrirlo, mostrar<select name="defaultView">${[['resumen', 'Resumen'], ['objetivos', 'Objetivos'], ['tareas', 'Tareas']].map(([v, l]) => `<option value="${v}" ${p.defaultView === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Notas<textarea name="notes" placeholder="Qué es y cómo sabrás que está terminado">${esc(p.notes)}</textarea></label>
    <label class="field toggle-row">Favorito<input type="checkbox" class="switch" name="favorite" value="1" ${p.favorite ? 'checked' : ''}></label>
    ${isNew ? '' : `<label class="field toggle-row">Archivado<input type="checkbox" class="switch" name="archived" value="1" ${p.archived ? 'checked' : ''}></label>
    <p class="hint">Archivar lo oculta de las listas pero conserva sus objetivos, tareas e historial.</p>`}`, {
    onSave: d => {
      const obj = isNew ? { id: uid(), createdAt: Date.now(), order: state.projects.length } : project(p.id);
      Object.assign(obj, { name: d.name.trim(), icon: d.icon || '📁', color: readColor(d, 'color') || COLORS[0], defaultView: d.defaultView, notes: d.notes.trim(), favorite: !!d.favorite, archived: !!d.archived });
      if (isNew) { state.projects.push(obj); setTimeout(() => { location.hash = '#proyecto/' + obj.id; }); }
    },
    onDelete: isNew ? null : () => {
      if (!confirm('¿Eliminar el proyecto? Sus objetivos y tareas se conservan sin proyecto. (Si solo quieres ocultarlo, mejor archívalo.)')) return false;
      state.projects = state.projects.filter(x => x.id !== p.id);
      [state.tasks, state.events, state.goals, state.routines].forEach(list => list.forEach(x => { if (x.projectId === p.id) x.projectId = null; }));
      location.hash = '#proyectos';
      toast('Proyecto eliminado');
    },
  });
}

/* ---------- Enfoque ---------- */

function getTimer() { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch { return null; } }
function setTimer(t) { try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); } catch {} }
const RING = 2 * Math.PI * 38;

function openFocus(id) {
  const t = task(id);
  if (!t) return;
  focusTaskId = id;
  if (!t.startedAt) { t.startedAt = Date.now(); save(); }
  if (![5, 15, 25].includes(focusMins)) focusMins = [5, 15, 25].includes(state.settings.focusMinutes) ? state.settings.focusMinutes : 25;
  renderFocus();
  $('#focus').hidden = false;
  document.body.classList.add('focus-open');
}
function closeFocus() {
  $('#focus').hidden = true;
  document.body.classList.remove('focus-open');
  updateTimerUI();
}
function renderFocus() {
  const t = task(focusTaskId);
  if (!t) { closeFocus(); return; }
  const timer = getTimer(), mine = timer && timer.taskId === t.id;
  $('#focus').innerHTML = `<div class="focus-card glass" role="dialog" aria-label="Enfoque">
    <button class="icon-btn round focus-close" data-act="focus-close" aria-label="Cerrar">${I.close}</button>
    <div class="eyebrow">Enfoque</div>
    <h2 class="focus-title ${t.done ? 'done' : ''}">${esc(t.title)}</h2>
    <label class="field">Primer paso<input type="text" data-input="first-step" data-id="${t.id}" value="${esc(t.firstStep)}" placeholder="¿Qué es lo primero que harás? (menos de 2 min)"></label>
    ${t.subtasks.length ? `<div class="focus-subs">${t.subtasks.map(s => `<label><input type="checkbox" class="check sm" data-act="sub-toggle" data-id="${t.id}" data-sub="${s.id}" ${s.done ? 'checked' : ''}><span>${esc(s.title)}</span></label>`).join('')}</div>` : ''}
    <div class="focus-timer">
      <div class="ring big" aria-hidden="true">
        <svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="38"/><circle class="bar" id="focus-ring" cx="42" cy="42" r="38" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
        <div class="time" id="focus-time">${pad(focusMins)}:00</div>
      </div>
      <div class="chips-row">${[5, 15, 25].map(m => `<button class="chip-btn ${m === (mine ? timer.minutes : focusMins) ? 'on' : ''}" data-act="focus-min" data-v="${m}" ${mine ? 'disabled' : ''}>${m} min</button>`).join('')}</div>
      <p class="muted small">El temporizador es opcional: también puedes empezar sin él.</p>
    </div>
    <div class="focus-actions">
      ${mine ? `<button class="btn" data-act="focus-stop">Parar</button>` : `<button class="btn" data-act="focus-start">${I.play}<span>Empezar ${focusMins} min</span></button>`}
      <button class="btn primary" data-act="focus-done" data-id="${t.id}">${t.done ? 'Hecha ✓' : 'Completar tarea'}</button>
    </div>
  </div>`;
  updateTimerUI();
}
function updateTimerUI() {
  const timer = getTimer();
  const pill = $('#focus-pill');
  const layerOpen = !$('#focus').hidden;
  if (!timer) {
    document.title = 'P Organizer';
    pill.hidden = true;
    const el = $('#focus-time');
    if (el) { el.textContent = pad(focusMins || 25) + ':00'; $('#focus-ring').style.strokeDashoffset = 0; }
    return;
  }
  const left = Math.max(0, timer.endAt - Date.now());
  const txt = `${pad(Math.floor(left / 60000))}:${pad(Math.floor(left / 1000) % 60)}`;
  document.title = `${txt} · P Organizer`;
  const t = timer.taskId && task(timer.taskId);
  pill.hidden = layerOpen;
  pill.innerHTML = `${I.play}<span class="one-line">${esc(t ? t.title : 'Enfoque')}</span><b>${txt}</b>`;
  const el = $('#focus-time');
  if (el && timer.taskId === focusTaskId) {
    el.textContent = txt;
    $('#focus-ring').style.strokeDashoffset = RING * (1 - left / (timer.minutes * 60000));
  }
  if (left <= 0) finishTimer(timer);
}
function finishTimer(timer) {
  setTimer(null);
  document.title = 'P Organizer';
  state.focusLog.push({ date: todayStr(), minutes: timer.minutes, taskId: timer.taskId || null });
  save();
  haptic([200, 100, 200]);
  beep();
  const t = timer.taskId && task(timer.taskId);
  const msg = `Enfoque completado${t ? ': ' + t.title : ''}. Descansa 5 min.`;
  toast(msg);
  if (document.hidden) notify('focus:' + timer.endAt, 'Enfoque completado', t ? t.title : '');
  if (!$('#focus').hidden) renderFocus();
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

/* ---------- Recordatorios ---------- */

function inQuiet(hm) {
  const { quietFrom: a, quietTo: b } = state.settings.reminders;
  if (!a || !b || a === b) return false;
  return a < b ? hm >= a && hm < b : hm >= a || hm < b;
}
function notify(key, title, body) {
  if (state.notified[key]) return;
  state.notified[key] = Date.now();
  save();
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: key };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts));
    else new Notification(title, opts);
  } catch (e) { console.warn('Notificación', e); }
}
function checkReminders() {
  const r = state.settings.reminders;
  if (!r.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = nowHHMM(), today = todayStr();
  /* Limpia avisos antiguos */
  const old = Date.now() - 4 * 86400000;
  Object.keys(state.notified).forEach(k => { if (state.notified[k] < old) delete state.notified[k]; });
  if (inQuiet(now)) return;
  if (r.blocks) eventsOn(today).forEach(e => {
    const diff = toMin(e.start) - toMin(now);
    if (diff >= 0 && diff <= r.blocks) notify(`ev:${e.id}:${today}`, e.title, `Empieza a las ${e.start}`);
  });
  if (r.deadlines !== 'off' && now >= r.deadlineTime) {
    const target = r.deadlines === 'day-before' ? addDays(today, 1) : today;
    state.tasks.filter(t => !t.done && !isRoutineTask(t) && t.due === target).forEach(t => notify(`due:${t.id}:${target}`, `Plazo ${relDay(target).toLowerCase()}`, t.title));
    state.goals.filter(g => g.status !== 'cumplido' && g.due === target).forEach(g => notify(`goal:${g.id}:${target}`, `Objetivo: plazo ${relDay(target).toLowerCase()}`, g.title));
  }
  if (r.dailySummary && now >= r.dailySummary) {
    const n = state.tasks.filter(t => isRoutineTask(t) && !t.done && t.routineDate <= today).length;
    if (n) notify(`sum:${today}`, 'Diarias pendientes', `Tienes ${n} pendiente${n === 1 ? '' : 's'}.`);
  }
}

/* ---------- Acciones ---------- */

function toggleTask(id, checkbox, { silent = false } = {}) {
  const t = task(id);
  if (!t) return;
  t.done = checkbox ? checkbox.checked : !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  /* En el sitio: la fila no se mueve ni cambia de tamaño */
  $$(`[data-task="${id}"]`).forEach(li => {
    li.classList.toggle('done', t.done);
    const c = $('.check', li); if (c) c.checked = t.done;
  });
  refreshLive();
  haptic();
  if (silent) return;
  if (t.done) {
    const msg = t.routineId ? `Hecha la del ${fmtShortDate(t.routineDate)}` : pick(['¡Hecho!', '¡Una menos!', '¡Bien! Sigue así.', '¡Genial!']);
    toast(msg, { action: 'Deshacer', onAction: () => toggleTask(id, null, { silent: true }) });
  }
}
function setPath(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  ks.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = v;
}

document.addEventListener('click', e => {
  if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.target.matches('input:not([type=checkbox]):not([type=radio]), textarea, select, label.step-line, label.step-line span')) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'FORM' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  if (el.closest('#modal')) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'toggle-task': toggleTask(id, el); return;
    case 'edit-task': if (task(id)) taskModal(task(id)); return;
    case 'new-task': taskModal({ goalId: el.dataset.goal || null, projectId: el.dataset.project || null, due: el.dataset.due || null }); return;
    case 'focus-open': openFocus(id); return;
    case 'focus-close': closeFocus(); return;
    case 'focus-min': focusMins = Number(el.dataset.v); renderFocus(); return;
    case 'focus-start': setTimer({ endAt: Date.now() + focusMins * 60000, minutes: focusMins, taskId: focusTaskId }); toast(`A por ello: ${focusMins} minutos solo para esto.`); renderFocus(); return;
    case 'focus-stop': setTimer(null); renderFocus(); updateTimerUI(); return;
    case 'focus-pill': { const tm = getTimer(); if (tm && tm.taskId) openFocus(tm.taskId); return; }
    case 'focus-done': {
      const t = task(id);
      if (!t.done) toggleTask(id, null);
      const tm = getTimer(); if (tm && tm.taskId === id) setTimer(null);
      closeFocus(); rerender(); return;
    }
    case 'sub-toggle': { const t = task(id), s = t && t.subtasks.find(x => x.id === el.dataset.sub); if (s) { s.done = el.checked; save(); } return; }
    case 'resched': reschedSheet(id); return;
    case 'prio-toggle': {
      const d = viewDate, cur = dayPriorities(d);
      if (cur.includes(id)) state.dayPlans[d].priorities = cur.filter(x => x !== id);
      else if (cur.length >= 3) { toast('Ya tienes 3 prioridades. Quita una primero.'); return; }
      else state.dayPlans[d] = { ...(state.dayPlans[d] || {}), priorities: [...cur, id] };
      haptic(); break;
    }
    case 'pick-priorities': pickPriorities(viewDate); return;
    case 'plan-day': planDaySheet(); return;
    case 'plan-skip': state.dayPlans[todayStr()] = { ...(state.dayPlans[todayStr()] || {}), planned: 'skip' }; break;
    case 'move-today': { const t = task(id); const prev = t.due; t.due = todayStr(); save(); rerender(); toast('Plazo: hoy', { action: 'Deshacer', onAction: () => { t.due = prev; save(); rerender(); } }); return; }
    case 'move-all-today': {
      const moved = state.tasks.filter(t => !t.done && !isRoutineTask(t) && t.due && t.due < todayStr()).map(t => [t, t.due]);
      moved.forEach(([t]) => { t.due = todayStr(); });
      save(); rerender();
      toast(`${moved.length} pasadas a hoy`, { action: 'Deshacer', onAction: () => { moved.forEach(([t, d]) => { t.due = d; }); save(); rerender(); } });
      return;
    }
    case 'collapse': {
      const k = el.dataset.key, c = state.settings.ui.collapsed;
      c[k] = !c[k];
      el.closest('.collapsible').classList.toggle('closed', !!c[k]);
      el.setAttribute('aria-expanded', String(!c[k]));
      save(); return;
    }
    case 'rt-expand': expanded.has(id) ? expanded.delete(id) : expanded.add(id); rerender(); return;
    case 'rt-one': {
      const t = pendingOfRoutine(id)[0];
      if (!t) return;
      t.done = true; t.doneAt = Date.now(); save(); refreshLive(); haptic();
      const left = pendingOfRoutine(id).length;
      toast(`Hecha la del ${fmtShortDate(t.routineDate)} · quedan ${left}`, { action: 'Deshacer', onAction: () => { t.done = false; t.doneAt = null; save(); refreshLive(); } });
      return;
    }
    case 'rt-pause': {
      const r = routine(id), today = todayStr();
      if (isPaused(r)) { r.pauses.find(p => !p.to).to = today; generateRoutines(); toast('Diaria reanudada'); }
      else { r.pauses.push({ from: addDays(today, 1), to: null }); toast('En pausa: no se crearán más; las pendientes se conservan'); }
      break;
    }
    case 'new-routine': routineModal({}); return;
    case 'edit-routine': routineModal(routine(id)); return;
    case 'new-event': eventModal(defaultEventCtx(el.dataset.date)); return;
    case 'edit-event': eventModal({ id }); return;
    case 'reserve-task': reserveTask(task(id)); return;
    case 'auto-reserve': {
      const t = task(id), slot = findSlot(t.estimate || 60, el.dataset.from, el.dataset.to);
      const ev = scheduleTask(t, slot.date, slot.start, slot.end);
      save(); rerender();
      toast(`Reservado ${relDay(slot.date).toLowerCase()} ${slot.start}–${slot.end}`, { action: 'Deshacer', onAction: () => { state.events = state.events.filter(x => x.id !== ev.id); save(); rerender(); } });
      return;
    }
    case 'week-prio': {
      const ws = reviewWeekStart(), wp = state.weekPlans[ws] = state.weekPlans[ws] || { priorities: [] };
      if (wp.priorities.includes(id)) wp.priorities = wp.priorities.filter(x => x !== id);
      else if (wp.priorities.length >= 5) { toast('Como máximo 5 prioridades'); return; }
      else wp.priorities.push(id);
      break;
    }
    case 'review-done': state.settings.ui.lastReview = el.dataset.ws; save(); toast('¡Semana planificada!'); location.hash = '#semana'; return;
    case 'day': {
      const n = Number(el.dataset.n);
      viewDate = n === 0 ? todayStr() : addDays(viewDate, n);
      navigate(() => route()); return;
    }
    case 'week': {
      const n = Number(el.dataset.n), mode = state.settings.ui.weekMode || '7';
      if (mode === '1') { viewDate = n === 0 ? todayStr() : addDays(viewDate, n); weekStart = startOfWeek(viewDate); }
      else { weekStart = n === 0 ? startOfWeek(todayStr()) : addDays(weekStart, 7 * n); if (n === 0) viewDate = todayStr(); }
      navigate(() => route()); return;
    }
    case 'week-mode': {
      const v = el.dataset.v;
      if (v === '1' && !weekDays(weekStart).includes(viewDate)) viewDate = weekDays(weekStart).includes(todayStr()) ? todayStr() : weekStart;
      state.settings.ui.weekMode = v; save(); route(); return;
    }
    case 'set-ui': {
      const k = el.dataset.k, v = el.dataset.v;
      state.settings.ui[k] = k === 'projectsArchived' ? !!v : v;
      save(); navigate(() => route()); return;
    }
    case 'tasks-tab': state.settings.ui.tasksTab = el.dataset.v; save(); navigate(() => route()); return;
    case 'new-project': projectModal({}); return;
    case 'edit-project': projectModal(project(id)); return;
    case 'project-fav': e.preventDefault(); { const p = project(id); p.favorite = !p.favorite; haptic(); } break;
    case 'proj-tab': location.hash = `#proyecto/${id}/${el.dataset.v}`; return;
    case 'new-goal': goalModal({ projectId: el.dataset.project || null }); return;
    case 'edit-goal': goalModal(goal(id)); return;
    case 'goal-done': { const g = goal(id); g.status = 'cumplido'; g.achievedAt = todayStr(); toast('¡Objetivo conseguido! 🎉'); break; }
    case 'goal-reopen': { const g = goal(id); g.status = 'activo'; g.achievedAt = null; break; }
    case 'new-any': newAnySheet(); return;
    case 'tag-del': {
      const tg = tag(id);
      if (!confirm(`¿Eliminar la etiqueta «${tg.name}»? Se quitará de tareas y bloques.`)) return;
      state.tags = state.tags.filter(x => x.id !== id);
      state.tasks.forEach(t => { t.tags = (t.tags || []).filter(x => x !== id); });
      [state.events, state.routines].forEach(l => l.forEach(x => { if (x.tagId === id) x.tagId = null; }));
      break;
    }
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('¿Seguro? Se borrarán todas tus tareas, proyectos y objetivos de este dispositivo.')) return;
      state = emptyState(); state.tags = defaultTags(); setTimer(null); toast('Todo borrado'); break;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
    default: return;
  }
  save(); rerender();
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.block[data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && !$('#focus').hidden && !modal.open) closeFocus();
  if (e.key === 'Enter' && e.target.dataset.input === 'first-step') e.target.blur();
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.act === 'tag-add') {
    e.preventDefault();
    const name = f.elements.name.value.trim();
    if (!name) return;
    state.tags.push({ id: uid(), name, color: f.elements.color.value });
    save(); rerender(); return;
  }
  if (f.dataset.act !== 'quick-add') return;
  e.preventDefault();
  const input = f.elements.namedItem('title');
  const title = input.value.trim();
  if (!title) return;
  state.tasks.push(newTask({ title, due: f.dataset.due || null, projectId: f.dataset.project || null, goalId: f.dataset.goal || null }));
  save(); rerender();
  const sel = Object.keys(f.dataset).filter(k => k !== 'act').map(k => `[data-${k}="${f.dataset[k]}"]`).join('');
  const again = $(`form[data-act="quick-add"]${sel} input[name=title]`);
  if (again) again.focus();
});

document.addEventListener('input', e => {
  const el = e.target, k = el.dataset.input;
  if (k === 'first-step') { const t = task(el.dataset.id); if (t) { t.firstStep = el.value; save(); } }
  if (k === 'task-search') { taskQuery = el.value; $('#task-results').innerHTML = taskResults(); }
  if (k === 'goal-progress') { const g = goal(el.dataset.id); g.progress = Number(el.value); const c = el.closest('.info-card'); if (c) { $('.progress > span', c).style.width = el.value + '%'; $('.stat-row .count', c).textContent = el.value + '%'; } }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.closest('#modal')) return;
  if (el.dataset.set) {
    const path = el.dataset.set;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if ('num' in el.dataset) v = Number(v);
    setPath(state.settings, path, v);
    if (path === 'weekStart') weekStart = null;
    if (path === 'focusMinutes') focusMins = v;
    save();
    if (path === 'reminders.enabled' && v && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission().then(p => {
        if (p !== 'granted') { state.settings.reminders.enabled = false; save(); toast('Sin permiso para avisar'); }
        else { toast('Recordatorios activados'); checkReminders(); }
        rerender();
      });
      return;
    }
    toast('Guardado');
    if (path === 'timezone' || path === 'weekStart') { viewDate = todayStr(); generateRoutines(); save(); rerender(); }
    return;
  }
  if (el.dataset.setUi) { setPath(state.settings.ui, el.dataset.setUi, el.value); save(); rerender(); return; }
  if (el.dataset.tagColor) { tag(el.dataset.tagColor).color = el.value; save(); toast('Color actualizado'); return; }
  if (el.dataset.tagName) { const v = el.value.trim(); if (v) { tag(el.dataset.tagName).name = v; save(); toast('Guardado'); } return; }
  if (el.dataset.input === 'goal-progress') { save(); refreshLive(); return; }
  if (el.dataset.act === 'import' && el.files[0]) { importData(el.files[0]); el.value = ''; }
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `p-organizer-${todayStr()}.json`;
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
      state = migrate(s);
      generateRoutines();
      save(); toast('Datos importados'); route();
    } catch (err) { toast('No se pudo importar: ' + err.message); }
  };
  r.readAsText(file);
}

/* Guardado al cerrar y al volver: recarga, genera las diarias de los días sin abrir y salta a hoy si cambió el día */
let lastDay = todayStr();
function onNewDayOrReturn() {
  const created = generateRoutines();
  const changed = lastDay !== todayStr();
  if (changed) { if (viewDate === lastDay) viewDate = todayStr(); lastDay = todayStr(); }
  if (created) save();
  return created || changed;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { save(); return; }
  if (modal.open) return;
  const fresh = loadState();
  if (fresh) state = fresh;
  onNewDayOrReturn();
  const typing = document.activeElement && document.activeElement.matches('input, textarea');
  if (!typing) rerender();
  checkReminders();
});
window.addEventListener('pagehide', save);
window.addEventListener('storage', e => { if (e.key === STORE_KEY && !modal.open) { state = loadState() || emptyState(); rerender(); } });
setInterval(() => {
  refreshNow(); refreshNowLine();
  if (onNewDayOrReturn() && !modal.open) rerender();
  checkReminders();
}, 30000);
$('#focus-pill').addEventListener('click', () => { const tm = getTimer(); if (tm && tm.taskId) openFocus(tm.taskId); });
$('#focus').addEventListener('click', e => { if (e.target.id === 'focus') closeFocus(); });

/* ---------- PWA ---------- */

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}

/* ---------- Arranque ---------- */
state = loadState();
if (!state) seedState();
generateRoutines();
save();
route();
setTimeout(checkReminders, 2000);
