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
  el.innerHTML = `<span>${esc(String(msg).replace(/● /g, ""))}</span>${opts.action ? `<button type="button" class="toast-btn">${esc(opts.action)}</button>` : ''}`;
  toastAction = opts.onAction || null;
  el.classList.toggle('actionable', !!opts.action);
  /* Capa superior: así el aviso se ve encima de una hoja abierta */
  if (el.showPopover) try { if (!el.popover) el.popover = 'manual'; if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch (_) { /* sin capa superior */ }
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
const NAV_OF = { proyecto: 'proyectos', objetivo: 'objetivos', habitos: 'progreso', planificar: 'hoy' };
function renderView() {
  const { name, id, sub } = parseHash();
  const sec = NAV_OF[name] || name;
  document.body.dataset.view = sec;
  document.body.dataset.page = name;
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
    case 'habitos': return viewHabits();
    case 'planificar': return viewPlanDay();
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
/* En el móvil el cambio de pantalla es instantáneo, como las pestañas de una app: el fundido
   entre pantallas oscurecía un instante el fondo (parpadeo). En el ordenador, fundido suave. */
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function navigate(fn) {
  if (document.startViewTransition && !isPhone() && !reduceMotion()) {
    const vt = document.startViewTransition(fn);
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach(pr => pr && pr.catch(() => {}));
  } else { fn(); if (!reduceMotion()) pageEnter(); }
}
/* v28: cambios dentro de la misma pantalla (pestañas, Activos/Archivados, día anterior/siguiente…):
   la cabecera y las pestañas se quedan quietas, la pastilla se desliza a la opción nueva y solo
   lo que cambia aparece con un fundido corto. Antes toda la pantalla bajaba y subía (temblor). */
function softSwap(fn = route) {
  const app = $('#app'), y = window.scrollY;
  const pageOf = () => app.querySelector(':scope > .page') || app;
  const before = [...pageOf().children].map(n => n.outerHTML);
  const segs = $$('.segmented:not(.seg-slide)', app).map(sg => { const on = sg.querySelector('button.on'); return on ? { x: on.offsetLeft, w: on.offsetWidth } : null; });
  clearTimeout(pageEnter.t); app.classList.remove('page-enter');
  fn();
  window.scrollTo(0, y);
  if (reduceMotion()) return;
  [...pageOf().children].forEach((n, i) => {
    if (n.outerHTML === before[i] || n.matches('.page-head, .toolbar, .segmented') || n.querySelector('.segmented')) return;
    if (n.animate) n.animate([{ opacity: .15 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  });
  $$('.segmented:not(.seg-slide)', app).forEach((sg, i) => {
    const from = segs[i], on = sg.querySelector('button.on');
    if (!from || !on || !sg.animate || (from.x === on.offsetLeft && from.w === on.offsetWidth)) return;
    const g = document.createElement('span');
    g.className = 'seg-ghost';
    g.style.cssText = `left:${on.offsetLeft}px;top:${on.offsetTop}px;width:${on.offsetWidth}px;height:${on.offsetHeight}px`;
    sg.prepend(g); sg.classList.add('seg-moving');
    const a = g.animate([{ transform: `translateX(${from.x - on.offsetLeft}px)`, width: from.w + 'px' }, { transform: 'none', width: on.offsetWidth + 'px' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const end = () => { g.remove(); sg.classList.remove('seg-moving'); };
    a.finished.then(end, end);
  });
}
/* v23: en el móvil la pantalla nueva entra con un fundido corto (solo el contenido, el fondo no cambia: sin parpadeo) */
function pageEnter() {
  const app = $('#app');
  app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
  clearTimeout(pageEnter.t); pageEnter.t = setTimeout(() => app.classList.remove('page-enter'), 420);
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
    const old = [...el.querySelectorAll('.progress > span')].map(s => s.style.width);
    el.innerHTML = fresh.innerHTML;
    /* La barra crece desde donde estaba en vez de saltar */
    const bars = el.querySelectorAll('.progress > span');
    if (old.length && bars.length === old.length) {
      bars.forEach((b, i) => { const to = b.style.width; b.style.transition = 'none'; b.style.width = old[i]; b.offsetWidth; b.style.transition = ''; b.style.width = to; });
    }
  });
}
/* «Hoy» en el menú siempre vuelve al día de hoy, aunque estuvieras mirando otro día */
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav="hoy"]');
  if (!a || viewDate === todayStr()) return;
  viewDate = todayStr();
  if (location.hash.startsWith('#hoy')) { e.preventDefault(); navigate(() => route()); }
});
let lastRoute = parseHash();
window.addEventListener('hashchange', () => {
  if (shortcutHash()) return;
  const r = parseHash(), same = r.name === lastRoute.name && r.id === lastRoute.id && r.id;
  lastRoute = r;
  if (same) { softSwap(); return; }
  navigate(() => { route(); window.scrollTo(0, 0); }); maybeScreenTour();
});

/* ---------- Piezas comunes ---------- */

function pageHead({ eyebrow = '', title, actions = '', dot = '' }) {
  return `<header class="page-head">
    <button class="ph-search mobile-only" data-act="search" aria-label="Buscar">${I.search}</button>
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
  if (t.repeat) out.push(`<span class="tag" title="Se repite">↻ ${esc(repeatLabel(t.repeat))}</span>`);
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
        ${opts.firstStep ? `<label class="step-line"><span>Para empezar</span><input type="text" class="step-input" data-input="first-step" data-id="${t.id}" value="${esc(t.firstStep)}" placeholder="Ej.: abrir el documento…" enterkeyhint="done"></label>` : ''}
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
    <input type="text" name="title" placeholder="${placeholder}" autocomplete="off" enterkeyhint="done" aria-label="${placeholder}" data-input="quick">
    ${micBtn()}<button class="icon-btn round" type="submit" aria-label="Añadir tarea">${I.plus}</button>
  </form><div class="qa-preview" aria-live="polite"></div>`;
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
  if (e.ext) return `<div class="block glass ext ${isNow ? 'now' : ''} ${isPast ? 'past' : ''}" style="--c:${e.color}" data-act="ext-event" data-id="${e.id}" data-start="${e.start}" data-end="${e.end}" role="button" tabindex="0">
    <div class="hours">${esc(e.start)}<span>${esc(e.end)}</span></div>
    <div><div>${esc(e.title)}<span class="now-badge ${isNow ? '' : 'hidden'}">AHORA</span></div><div class="meta"><span class="tag">${I.cal}${esc(calName(e.calId))}</span>${e.loc ? `<span class="tag">${esc(e.loc)}</span>` : ''}</div></div>
    <span class="muted small">${durationLabel(e.start, e.end)}</span>
  </div>`;
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


/* ---------- ¿Me cabe hoy? ---------- */
function dayFit(d, tasks) {
  if (d < todayStr()) return null;
  const blocked = new Set(eventsOn(d).filter(e => e.taskId).map(e => e.taskId));
  const pend = tasks.filter(t => !t.done && !blocked.has(t.id));
  if (!pend.length) return null;
  const unknown = pend.filter(t => !t.estimate).length;
  const need = pend.reduce((a, t) => a + (t.estimate || 30), 0);
  const free = freeIntervals(d, 5).reduce((a, [x, y]) => a + y - x, 0);
  const level = need <= free * 0.85 ? 'ok' : need <= free ? 'tight' : 'over';
  return { pend, unknown, need, free, level };
}
function fitCard(d, tasks) {
  const f = dayFit(d, tasks);
  if (!f) return '<div data-live="fit"></div>';
  const msg = f.level === 'ok' ? `Te cabe. Te sobran ${durLabel(f.free - f.need)}.`
    : f.level === 'tight' ? 'Te cabe, pero vas justo.' : `No te cabe: te faltan ${durLabel(f.need - f.free)}.`;
  const pct = f.free ? Math.min(100, Math.round(f.need / f.free * 100)) : 100;
  return `<div data-live="fit"><div class="fit glass fit-${f.level}">
    <div class="fit-top"><span class="fit-ic">${I.clock}</span><div class="grow"><b>${msg}</b>
      <div class="small muted">${durLabel(f.need)} de tareas · ${f.free ? durLabel(f.free) : 'nada'} libre${d === todayStr() ? ' desde ahora' : ''} hasta las ${esc(state.settings.dayEnd || '21:00')}${f.unknown ? ` · ${f.unknown} sin duración (cuento 30 min)` : ''}</div></div>
      ${f.level === 'over' ? `<button class="btn small primary" data-act="fit-adjust" data-date="${d}">Ajustar</button>` : ''}</div>
    <div class="fit-bar"><span style="width:${pct}%"></span></div>
  </div></div>`;
}
function fitAdjustSheet(d) {
  const prios = new Set(dayPriorities(d));
  const tasks = state.tasks.filter(t => !isRoutineTask(t) && (t.due === d || prios.has(t.id)));
  const f = dayFit(d, tasks);
  if (!f) return;
  const list = [...f.pend].sort((a, b) => (prios.has(a.id) - prios.has(b.id)) || (PRI_ORDER[a.priority] - PRI_ORDER[b.priority]) || ((b.estimate || 30) - (a.estimate || 30)));
  const nextDay = addDays(d, 1);
  openModal('Ajustar el día', `
    <p class="sheet-sub">Te faltan <b>${durLabel(Math.max(0, f.need - f.free))}</b>. Marca lo que pasas a ${esc(relDay(nextDay).toLowerCase())}; las prioridades van al final.</p>
    <div class="pick-list glass">${list.map(t => `<label class="pick"><input type="checkbox" class="check" name="m" value="${t.id}"><span class="grow">${prios.has(t.id) ? '★ ' : ''}${esc(t.title)}</span><span class="tag">${t.estimate ? durLabel(t.estimate) : '~30 min'}</span></label>`).join('')}</div>
    <p class="hint" id="fit-sum"></p>`, {
    saveLabel: 'Mover',
    onSave: (data, fd) => {
      const ids = fd.getAll('m');
      if (!ids.length) return;
      ids.forEach(id => { const t = task(id); if (t) t.due = nextDay; });
      const dp = state.dayPlans[d];
      if (dp && dp.priorities) dp.priorities = dp.priorities.filter(x => !ids.includes(x));
      toast(`${ids.length} movida${ids.length === 1 ? '' : 's'} a ${relDay(nextDay).toLowerCase()}`);
    },
  });
  const upd = () => {
    const moved = $$('input[name=m]:checked', modalForm).reduce((a, c) => a + ((task(c.value) || {}).estimate || 30), 0);
    const left = f.need - moved - f.free;
    const out = $('#fit-sum', modalForm);
    if (out) out.textContent = moved ? (left > 0 ? `Liberas ${durLabel(moved)}. Aún faltan ${durLabel(left)}.` : `Liberas ${durLabel(moved)}. Ya te cabe.`) : '';
  };
  modalForm.addEventListener('change', upd);
  modal.addEventListener('close', () => modalForm.removeEventListener('change', upd), { once: true });
}

/* ---------- Diario del día ---------- */
function journalCard(d) {
  const today = todayStr(), j = journalOf(d);
  const show = j || d < today || (d === today && Number(nowHHMM().slice(0, 2)) >= 18);
  if (!show) return '';
  return `<div class="section" data-live="journal">
    <div class="section-head"><h2>${d === today ? '¿Qué tal ha ido el día?' : 'Cómo fue el día'}</h2>${j && j.mood ? `<span class="muted small">${MOOD_LABEL[j.mood - 1]}</span>` : ''}</div>
    <div class="journal glass">
      <div class="j-row"><span class="j-label">Ánimo</span><div class="j-moods">${MOODS.map((m, i) => `<button type="button" class="j-mood ${j && j.mood === i + 1 ? 'on' : ''}" data-act="journal" data-k="mood" data-v="${i + 1}" data-date="${d}" aria-label="${MOOD_LABEL[i]}" aria-pressed="${!!(j && j.mood === i + 1)}">${m}</button>`).join('')}</div></div>
      <div class="j-row"><span class="j-label">Energía</span><div class="j-energy">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="j-en ${j && j.energy >= n ? 'on' : ''}" data-act="journal" data-k="energy" data-v="${n}" data-date="${d}" aria-label="Energía ${n} de 5"></button>`).join('')}</div></div>
      <textarea class="j-note" data-input="journal-note" data-date="${d}" rows="2" placeholder="Una línea sobre el día (opcional)">${esc((j && j.note) || '')}</textarea>
    </div>
  </div>`;
}

function viewToday() {
  const d = viewDate, today = todayStr(), isToday = d === today;
  const prios = dayPriorities(d).map(task);
  const prioSet = new Set(prios.map(t => t.id));
  const evs = eventsOn(d);
  const extEvs = extEventsOn(d);
  const agenda = [...evs, ...extEvs.filter(e => !e.allDay)].sort((a, b) => a.start.localeCompare(b.start));
  const blockIds = new Set(evs.filter(e => e.taskId).map(e => e.taskId));
  const dayTasks = state.tasks.filter(t => !isRoutineTask(t) && !prioSet.has(t.id) && (t.due === d || blockIds.has(t.id))).sort(stable);
  const overdue = isToday ? state.tasks.filter(t => !isRoutineTask(t) && !prioSet.has(t.id) && !blockIds.has(t.id) && !t.done && t.due && t.due < d).sort(sortByDue) : [];
  const routines = isToday ? state.routines.filter(r => pendingOfRoutine(r.id).length) : [];
  const totalPend = routines.reduce((a, r) => a + pendingOfRoutine(r.id).length, 0);
  const prog = progressOf([...prios, ...dayTasks]);
  const now = nowHHMM();
  const h = Number(now.slice(0, 2));
  const greeting = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const weekday = cap(dtf('es-ES', { weekday: 'long' }).format(parseYmd(d)));
  const dayMonth = dtf('es-ES', { day: 'numeric', month: 'long' }).format(parseYmd(d));

  return `
  <div class="page page-today">
  ${pageHead({
    eyebrow: isToday ? `${weekday} · ${greeting}` : `${weekday} · ${relDay(d)}`,
    title: `<span class="t-long">${esc(dayMonth)}</span><span class="t-short">${esc(dtf('es-ES', { day: 'numeric', month: 'short' }).format(parseYmd(d)).replace('.', ''))}</span>`,
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
      ${fitCard(d, [...prios, ...dayTasks])}

      <div class="section">
        <div class="section-head"><h2>Prioridades · ${prios.length}/3</h2><button class="btn small" data-act="pick-priorities">${prios.length ? 'Cambiar' : 'Elegir'}</button></div>
        ${prios.length ? `<ul class="tasks glass">${prios.map(t => taskItem(t, { firstStep: true, star: true, hideDue: d })).join('')}</ul>`
          : emptyBox('¿Qué 3 cosas harían que hoy fuera un buen día? Elígelas y escribe por dónde empezarás cada una.')}
      </div>

      ${overdue.length ? collapsible('vencidas', 'Vencidas', overdue.length, taskList(overdue, { star: true, moveToday: true }),
        `<button class="btn small ghost" data-act="bulk-resched">${I.resched}<span>Reprogramar</span></button>`) : ''}

      ${routines.length ? collapsible('diarias', 'Diarias pendientes', totalPend, routines.map(r => routineGroup(r)).join(''),
        `<a class="btn small ghost" href="#diarias">Ver diarias</a>`) : ''}

      ${habitsTodaySection(d)}

      <div class="section">
        <div class="section-head"><h2>Tareas</h2>${isToday && !routines.length ? `<a class="btn small ghost" href="#diarias">${I.daily}<span>Diarias</span></a>` : ''}</div>
        ${taskList(dayTasks, { star: true, hideDue: d })}
        ${quickAdd({ due: d }, 'Nueva tarea para ' + relDay(d).toLowerCase())}
        <p class="hint touch-only">Desliza a la derecha para completar o a la izquierda para pasar a mañana.</p>
      </div>
      ${journalCard(d)}
    </div>

    <aside class="col-side">
      <div class="section">
        <div class="section-head"><h2>Horario</h2><div class="head-btns"><a class="btn small" href="#planificar">${I.clock}<span>Planificar por horas</span></a><button class="icon-btn round" data-act="new-event" data-date="${d}" aria-label="Añadir bloque" title="Añadir bloque">${I.plus}</button></div></div>
        <div class="agenda-list">
          ${extEvs.some(e => e.allDay) ? `<div class="allday-row">${extEvs.filter(e => e.allDay).map(e => `<button class="chip ext" data-act="ext-event" data-id="${e.id}" style="--c:${e.color}">${esc(e.title)}</button>`).join('')}</div>` : ''}
          ${agenda.length ? `<div class="timeline">${agenda.map(e => blockItem(e, isToday, now)).join('')}</div>`
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
    const bulk = tab === 'vencidas' ? `<div class="bulk-bar"><span class="muted small">${list.length} con el plazo pasado</span><button class="btn small" data-act="bulk-resched">${I.resched}<span>Reprogramar todas</span></button></div>` : '';
    list.forEach(t => { if (!groups.has(t.due)) groups.set(t.due, []); groups.get(t.due).push(t); });
    return bulk + [...groups].map(([d, ts]) => `<div class="day-group"><h3 class="group-title">${esc(relDay(d))} <span class="muted">· ${esc(fmtShortDate(d))}</span></h3>${taskList(ts, { hideDue: d })}</div>`).join('');
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
  ${tab === 'completadas' ? '' : quickAdd({ due: tab === 'proximas' ? todayStr() : tab === 'bandeja' ? '' : '' }, tab === 'proximas' ? 'Nueva tarea para hoy' : 'Ej.: dentista mañana a las 10')}
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
  <p class="hint intro">Plan para la semana del ${esc(fmtShortDate(ws))} al ${esc(fmtShortDate(we))}. Cuatro pasos, unos 10 minutos.</p>

  ${reviewLookback(ws)}

  <div class="section step">
    <div class="step-head"><span class="step-num">2</span><div class="grow"><h3>Revisa lo pendiente</h3><p class="muted small">Vencidas y sin fecha: complétalas, reprográmalas o bórralas.</p></div>${pending.some(t => t.due) ? `<button class="btn small" data-act="bulk-resched">${I.resched}<span>Reprogramar atrasadas</span></button>` : ''}</div>
    ${pending.length ? taskList(pending, {}) : emptyBox('Nada pendiente. 🎉')}
  </div>

  <div class="section step">
    <div class="step-head"><span class="step-num">3</span><div class="grow"><h3>Elige tus prioridades</h3><p class="muted small">Lo que de verdad quieres sacar esta semana (hasta 5).</p></div><button class="btn small" data-act="propose-plan">${I.star}<span>Proponme un plan</span></button></div>
    <div class="pick-chips">
      ${prios.map(t => `<button class="pick-chip on" data-act="week-prio" data-id="${t.id}" style="--c:${colorOfTask(t)}">★ ${esc(t.title)}</button>`).join('')}
      ${cands.map(t => `<button class="pick-chip" data-act="week-prio" data-id="${t.id}" style="--c:${colorOfTask(t)}">${esc(t.title)}${t.due ? ` <span class="muted">· ${esc(relDay(t.due))}</span>` : ''}</button>`).join('')}
      ${prios.length + cands.length ? '' : emptyBox('No hay tareas abiertas. Crea alguna con el botón +.')}
    </div>
  </div>

  <div class="section step">
    <div class="step-head"><span class="step-num">4</span><div class="grow"><h3>Dales tiempo en el calendario</h3><p class="muted small">Reservar un hueco no cambia el plazo de la tarea.</p></div>${prios.length ? `<button class="btn small" data-act="reserve-all">${I.clock}<span>Reservar todas</span></button>` : ''}</div>
    ${prios.length ? `<div class="settings-group glass">${prios.map(t => {
      const evs = state.events.filter(e => e.taskId === t.id && !e.recurrence && e.date >= ws && e.date <= we).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return `<div class="item">
        <div class="grow"><div>${esc(t.title)}</div><div class="small ${evs.length ? 'muted' : 'warn-text'}">${evs.length ? evs.map(e => `${esc(relDay(e.date))} ${esc(e.start)}–${esc(e.end)}`).join(' · ') : 'Sin tiempo reservado'}${t.due ? ` · plazo ${esc(relDay(t.due).toLowerCase())}` : ''}</div></div>
        <button class="btn small" data-act="auto-reserve" data-id="${t.id}" data-from="${from}" data-to="${we}">Reservar</button>
        <button class="btn small ghost" data-act="reserve-task" data-id="${t.id}">Elegir hora</button>
      </div>`;
    }).join('')}</div>` : emptyBox('Elige primero alguna prioridad en el paso 3.')}
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
    <div class="stat-row">${progressBar(pr.pct)}<span class="count">${pr.total ? pr.pct + ' %' : '–'}</span></div>
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
  <div class="page page-projects">
  ${pageHead({ eyebrow: 'Lo que estás construyendo, paso a paso', title: 'Proyectos', actions: `
    <button class="btn primary" data-act="new-project">${I.plus}<span>Nuevo</span></button>` })}
  <div class="toolbar">
    <div class="segmented compact" role="tablist">
      <button role="tab" class="${!ui.projectsArchived ? 'on' : ''}" data-act="set-ui" data-k="projectsArchived" data-v="">Activos</button>
      <button role="tab" class="${ui.projectsArchived ? 'on' : ''}" data-act="set-ui" data-k="projectsArchived" data-v="1">Archivados${nArch ? ' · ' + nArch : ''}</button>
    </div>
    <select data-set-ui="projectsSort" aria-label="Ordenar">${[['manual', 'Orden: creación'], ['nombre', 'Orden: nombre'], ['recientes', 'Orden: recientes'], ['progreso', 'Orden: progreso']].map(([v, l]) => `<option value="${v}" ${ui.projectsSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="segmented compact icons view-switch" role="tablist" aria-label="Vista">
      <button role="tab" class="${ui.projectsView !== 'list' ? 'on' : ''}" data-act="set-ui" data-k="projectsView" data-v="cards" aria-label="Tarjetas">${I.grid}</button>
      <button role="tab" class="${ui.projectsView === 'list' ? 'on' : ''}" data-act="set-ui" data-k="projectsView" data-v="list" aria-label="Lista">${I.list}</button>
    </div>
  </div>
  ${!list.length ? (ui.projectsArchived ? emptyBox('No hay proyectos archivados.') : `<div class="empty">Crea un proyecto y divídelo en objetivos y tareas pequeñas.<div class="tpl-suggest"><div class="small muted">O empieza con una plantilla:</div><div class="chips-row">${BUILTIN_TEMPLATES.slice(0, 4).map(t => `<button class="chip-btn" data-act="tpl-pick" data-id="${t.id}">${t.data.project.icon} ${esc(t.name)}</button>`).join('')}</div></div></div>`)
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
  <div class="page page-project">
  ${pageHead({ eyebrow: backLink('#proyectos', 'Proyectos'), title: `${esc(p.icon || '')} ${esc(p.name)}`, dot: p.color, actions: `${favBtn(p)}<button class="btn" data-act="templates" data-kind="project" data-id="${p.id}" title="Guardar como plantilla">${I.template}<span>Plantilla</span></button><button class="btn" data-act="edit-project" data-id="${p.id}">Editar</button>` })}
  <div class="segmented" role="tablist">${[['resumen', 'Resumen'], ['objetivos', 'Objetivos'], ['tareas', 'Tareas']].map(([v, l]) => `<button role="tab" class="${tab === v ? 'on' : ''}" data-act="proj-tab" data-id="${p.id}" data-v="${v}">${l}</button>`).join('')}</div>
  ${body}
  </div>`;
}

/* ---------- Vista: Ajustes ---------- */

function agoLabel(ts) {
  if (!ts) return 'nunca';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'ahora mismo' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
}
function syncSection() {
  let body;
  if (!cloudReady()) body = `<div class="item"><span class="muted">Aún no está activada. Cuando esté, podrás entrar con tu email y tener los mismos datos en el móvil y el ordenador.</span></div>`;
  else if (!getSession()) body = `${syncInfo.notice ? `<div class="item"><span class="grow">${syncInfo.notice}</span></div>` : ''}
    <form class="item login" data-act="login">
      <input type="email" name="email" placeholder="Email" autocomplete="email" aria-label="Email" required>
      <input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" aria-label="Contraseña" minlength="6">
      <div class="login-actions"><button class="btn small primary" type="submit" value="in">Entrar</button><button class="btn small" type="submit" value="up">Crear cuenta</button><button class="btn small ghost" type="submit" value="reset" formnovalidate>¿Olvidaste la contraseña?</button></div>
    </form>`;
  else {
    const s = getSession();
    body = `${syncInfo.needPassword ? `<form class="item login" data-act="new-password"><span class="grow">Pon tu contraseña nueva</span><input type="password" name="password" placeholder="Contraseña nueva" autocomplete="new-password" aria-label="Contraseña nueva" minlength="6" required><button class="btn small primary" type="submit">Guardar</button></form>` : ''}
      <div class="item"><span>Cuenta</span><span class="muted">${esc((s.user && s.user.email) || '…')}</span></div>
      <div class="item" data-live="sync"><span>${syncInfo.status === 'error' ? `<span style="color:var(--red)">Error: ${esc(syncInfo.error)}</span>` : syncInfo.status === 'syncing' ? 'Sincronizando…' : `Sincronizado ${agoLabel(syncInfo.lastSync)}`}</span><button class="btn small" data-act="sync-now">Sincronizar ahora</button></div>
      ${CFG.vapidPublicKey ? `<div class="item"><span>Avisos con la app cerrada</span><button class="btn small ${pushActive() ? '' : 'primary'}" data-act="push-toggle">${pushActive() ? 'Desactivar' : 'Activar'}</button></div>` : ''}
      <div class="item"><span>Cerrar sesión en este dispositivo</span><button class="btn small danger" data-act="sign-out">Salir</button></div>`;
  }
  return `<div class="section">
    <div class="section-head"><h2>Cuenta y sincronización</h2></div>
    <div class="settings-group glass">${body}</div>
    <p class="hint">${getSession() ? 'Los cambios se guardan en tu cuenta al momento y se cargan en tus otros dispositivos al abrir la app.' : 'Crea tu cuenta una vez y entra con el mismo email y contraseña en el móvil y en el ordenador. En iPhone, para recibir avisos con la app cerrada, instálala en la pantalla de inicio.'}</p>
  </div>`;
}


/* ---------- Calendarios externos (solo lectura) ---------- */
function calName(id) { const c = (state.settings.calendars || []).find(x => x.id === id); return c ? c.name : 'Calendario'; }
function calendarsSection() {
  const cals = state.settings.calendars || [], cache = loadExt();
  return `<div class="section">
    <div class="section-head"><h2>Calendarios externos</h2>${cals.length ? `<button class="btn small ghost" data-act="cal-refresh">Actualizar</button>` : ''}</div>
    <div class="settings-group glass">
      ${cals.map(c => { const k = cache[c.id] || {}; return `<button class="item" data-act="cal-edit" data-id="${c.id}"><span class="dot-c" style="--c:${c.color}"></span><div class="grow"><div>${esc(c.name)}</div><div class="small ${k.error ? '' : 'muted'}" ${k.error ? 'style="color:var(--red)"' : ''}>${k.error ? esc(k.error) : k.at ? `${(k.events || []).length} eventos · actualizado ${agoLabel(k.at)}` : 'Sin leer todavía'}</div></div>${I.right}</button>`; }).join('')}
      <div class="item"><span>Añadir Google Calendar u otro</span><button class="btn small" data-act="cal-add">Añadir</button></div>
    </div>
    <p class="hint">Se ven en Hoy y en Semana para planificar alrededor de tus citas, y cuentan como tiempo ocupado. Son de solo lectura: se editan en su app.</p>
  </div>`;
}
function calendarModal(c0) {
  const isNew = !c0;
  const c = c0 || { id: uid(), name: 'Google Calendar', url: '', color: COLORS[9] };
  openModal(isNew ? 'Añadir calendario' : 'Calendario', `
    <label class="field">Nombre<input type="text" name="name" required value="${esc(c.name)}"></label>
    <div class="field">Dirección secreta en formato iCal<div class="sub-add"><input type="url" name="url" required value="${esc(c.url)}" placeholder="https://calendar.google.com/…/basic.ics" autocomplete="off" spellcheck="false" aria-label="Dirección secreta en formato iCal"><button type="button" class="btn small" data-modal="paste-url">Pegar</button></div></div>
    <div class="field">Color${colorField('color', c.color)}</div>
    ${getSession() ? '' : `<div class="linked warn-text">Antes, entra en tu cuenta en Ajustes → Cuenta y sincronización. Sin cuenta no se puede leer Google Calendar.</div>`}
    <div class="howto small">
      <b>Cómo conseguir la dirección (una sola vez, 2 minutos)</b><br>
      1. Toca <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">Abrir ajustes de Google Calendar</a>. En el móvil, si te lleva a la app o no ves los ajustes, abre el menú del navegador (⋮ o «aA») y elige «Ver versión para ordenador».<br>
      2. A la izquierda, en «Configuración de mis calendarios», toca tu calendario (suele llevar tu nombre).<br>
      3. Baja casi hasta el final, a «Dirección secreta en formato iCal», y toca el botón de copiar.<br>
      4. Vuelve aquí, toca «Pegar» y luego «Guardar».<br>
      <span class="muted">Es privada: no la compartas con nadie. Tus citas se ven en Hoy, Semana y Planificar, y se actualizan solas cada media hora.</span>
    </div>`, {
    onSave: d => {
      const url = normalizeIcsUrl(d.url);
      if (!/^https:\/\//i.test(url)) { toast('La dirección debe empezar por https:// o webcal://'); return false; }
      const obj = { id: c.id, name: d.name.trim() || 'Calendario', url, color: readColor(d, 'color') || COLORS[9] };
      const list = state.settings.calendars = state.settings.calendars || [];
      const i = list.findIndex(x => x.id === c.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
      extByDay = null;
      toast('Leyendo el calendario…');
      refreshCalendar(obj).then(r => { toast(r.error ? 'No se pudo leer: ' + r.error : `Listo: ${r.events.length} eventos`); rerender(); });
    },
    onDelete: isNew ? null : () => {
      state.settings.calendars = (state.settings.calendars || []).filter(x => x.id !== c.id);
      forgetCalendar(c.id); toast('Calendario quitado');
    },
    deleteLabel: 'Quitar calendario',
    actions: {
      'paste-url': async () => {
        const inp = modalForm.elements.namedItem('url');
        try { const txt = (await navigator.clipboard.readText()).trim(); if (txt) { inp.value = txt; toast(/\/ical\/|\.ics/i.test(txt) ? 'Dirección pegada. Ahora toca Guardar.' : 'Eso no parece la dirección iCal: revisa que copiaste la «secreta en formato iCal»'); return; } } catch {}
        inp.focus(); toast('Mantén pulsado el recuadro y elige «Pegar»');
      },
    },
  });
}
function extEventSheet(id) {
  const e = extEventById(id);
  if (!e) return;
  openModal(esc(e.title), `
    <div class="settings-group glass">
      <div class="item"><span>Cuándo</span><span class="muted">${esc(fmtLongDate(e.date))}${e.allDay ? ' · todo el día' : ` · ${esc(e.start)}–${esc(e.end)}`}</span></div>
      ${e.loc ? `<div class="item"><span>Dónde</span><span class="muted">${esc(e.loc)}</span></div>` : ''}
      <div class="item"><span>Calendario</span><span class="muted"><span class="dot-c" style="--c:${e.color}"></span> ${esc(calName(e.calId))}</span></div>
    </div>
    <p class="hint">Este evento viene de tu calendario y se cambia desde allí.</p>`);
}


/* ---------- Copiar la semana anterior ---------- */
function copyWeekSheet(ws) {
  ws = ws || startOfWeek(todayStr());
  const prev = addDays(ws, -7), prevEnd = addDays(ws, -1);
  const src = state.events.filter(e => !e.recurrence && e.date >= prev && e.date <= prevEnd);
  if (!src.length) { toast('La semana anterior no tiene bloques que copiar (los que se repiten ya aparecen solos)'); return; }
  const plan = src.map(e => {
    const date = addDays(e.date, 7);
    const clash = overlapsWith(date, e.start, e.end).length > 0;
    const dup = state.events.some(x => !x.recurrence && x.date === date && x.start === e.start && x.title === e.title);
    return { e, date, clash, dup };
  });
  const ok = plan.filter(x => !x.dup);
  const nClash = ok.filter(x => x.clash).length;
  openModal('Copiar semana anterior', `
    <p class="sheet-sub">Se copiarán <b>${ok.length}</b> bloque${ok.length === 1 ? '' : 's'} de la semana del ${esc(fmtShortDate(prev))} a la del ${esc(fmtShortDate(ws))}.${plan.length - ok.length ? ` ${plan.length - ok.length} ya estaban copiados.` : ''}</p>
    <div class="pick-list glass">${plan.map((x, i) => `<label class="pick ${x.dup ? 'muted' : ''}"><input type="checkbox" class="check" name="c" value="${i}" ${x.dup || x.clash ? '' : 'checked'} ${x.dup ? 'disabled' : ''}><span class="grow">${esc(x.e.title)}<span class="small muted"> · ${DOW_SHORT[dow(x.date)]} ${esc(x.e.start)}–${esc(x.e.end)}</span></span>${x.dup ? '<span class="tag">Ya está</span>' : x.clash ? '<span class="tag warn">Se solapa</span>' : ''}</label>`).join('')}</div>
    ${nClash ? `<p class="hint">Los que se solapan con algo de esta semana vienen desmarcados.</p>` : ''}`, {
    saveLabel: 'Copiar',
    onSave: (d, fd) => {
      const idx = fd.getAll('c').map(Number);
      if (!idx.length) return;
      const added = idx.map(i => {
        const { e, date } = plan[i];
        const t = e.taskId && task(e.taskId);
        const n = { ...e, id: uid(), date, exceptions: [], taskId: t && !t.done ? e.taskId : null };
        state.events.push(n);
        return n.id;
      });
      toast(`${added.length} bloque${added.length === 1 ? '' : 's'} copiado${added.length === 1 ? '' : 's'}`, { action: 'Deshacer', onAction: () => { state.events = state.events.filter(x => !added.includes(x.id)); save(); rerender(); } });
    },
  });
}

/* ---------- Buscador global ---------- */
function openSearch() {
  if (modal.open) modal.close();
  openModal('Buscar', `
    <div class="gsearch"><span class="gs-ic">${I.search}</span><input type="search" id="gsearch" placeholder="Tareas, proyectos, objetivos, diarias, bloques…" autocomplete="off" enterkeyhint="search" aria-label="Buscar" data-enter="first"></div>
    <div id="gs-results">${searchResults('')}</div>`, {
    actions: {
      open: b => openResult(b.dataset.kind, b.dataset.id),
      first: () => { const b = $('#gs-results [data-modal="open"]', modalForm); if (b) b.click(); },
    },
  });
  setTimeout(() => { const i = $('#gsearch', modalForm); if (i) i.focus(); }, 60);
}
function searchResults(q) {
  const r = searchAll(q);
  if (!r) return `<p class="hint">Escribe para buscar en todo. Atajo en el ordenador: <b>/</b> o <b>Ctrl+K</b>.</p>`;
  if (!r.total) return emptyBox('Nada coincide con «' + esc(q) + '».');
  const row = (kind, id, icon, title, sub, done) => `<button type="button" class="gs-row ${done ? 'done' : ''}" data-modal="open" data-kind="${kind}" data-id="${id}"><span class="gs-kind">${icon}</span><span class="grow"><span class="gs-title">${esc(title)}</span>${sub ? `<span class="small muted">${sub}</span>` : ''}</span></button>`;
  const group = (title, items) => items.length ? `<div class="gs-group"><div class="gs-h">${title}</div><div class="glass gs-list">${items.join('')}</div></div>` : '';
  return group('Tareas', r.tasks.map(t => row('task', t.id, t.done ? '✓' : '○', t.title, [t.due ? esc(relDay(t.due)) : '', projectOfTask(t) ? esc(projectOfTask(t).name) : ''].filter(Boolean).join(' · '), t.done)))
    + group('Proyectos', r.projects.map(p => row('project', p.id, esc(p.icon || '📁'), p.name, p.archived ? 'Archivado' : '')))
    + group('Objetivos', r.goals.map(g => row('goal', g.id, '◎', g.title, STATUS_LABEL[goalStatus(g)])))
    + group('Diarias', r.routines.map(x => row('routine', x.id, '↻', x.title, '')))
    + group('Bloques', r.events.map(e => row('event', e.id, '▦', e.title, e.recurrence ? 'Se repite' : `${esc(relDay(e.date))} · ${esc(e.start)}`)));
}
function openResult(kind, id) {
  modal.close();
  if (kind === 'task' && task(id)) taskModal(task(id));
  else if (kind === 'project') location.hash = '#proyecto/' + id;
  else if (kind === 'goal') location.hash = '#objetivo/' + id;
  else if (kind === 'routine' && routine(id)) routineModal(routine(id));
  else if (kind === 'event') eventModal({ id });
}

/* ---------- Accesos directos (icono de la app y teclado) ---------- */
function startFocusShortcut() {
  const d = todayStr();
  const t = dayPriorities(d).map(task).find(x => x && !x.done)
    || state.tasks.filter(x => !x.done && !isRoutineTask(x) && x.due && x.due <= d).sort(sortByDue)[0]
    || state.tasks.filter(x => !x.done && !isRoutineTask(x)).sort(sortByDue)[0];
  if (t) openFocus(t.id); else { toast('No tienes tareas pendientes. Crea una para enfocarte.'); taskModal({ due: d }); }
}
function runShortcut(name) {
  if (name === 'nueva') taskModal({ due: todayStr() });
  else if (name === 'enfoque') startFocusShortcut();
  else if (name === 'buscar') openSearch();
}
function shortcutHash() {
  const n = parseHash().name;
  if (!['nueva', 'enfoque', 'buscar'].includes(n)) return false;
  history.replaceState(null, '', location.pathname + '#hoy');
  route(); runShortcut(n);
  return true;
}

/* ---------- Diario en Progreso ---------- */
function journalStats() {
  const today = todayStr(), days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const done = doneCountByDay();
  const any = days.some(d => journalOf(d));
  const tips = journalInsights();
  return `<div class="section"><div class="section-head"><h2>Ánimo y energía · 14 días</h2></div>
    <div class="card glass">
      ${any ? `<div class="mood-grid">${days.map(d => { const j = journalOf(d) || {}; return `<div class="mood-day ${d === today ? 'today' : ''}" title="${esc(fmtLongDate(d))}${j.note ? ' · ' + esc(j.note) : ''}">
        <span class="md-emoji">${j.mood ? MOODS[j.mood - 1] : '·'}</span>
        <span class="md-en"><i style="height:${(j.energy || 0) * 20}%"></i></span>
        <span class="md-n">${done.get(d) || ''}</span>
        <span class="md-d">${DOW_LETTER[dow(d)]}</span></div>`; }).join('')}</div>
        <p class="hint">Cara = ánimo · barra = energía · número = tareas hechas.</p>` : emptyBox('A partir de las 18:00 verás en Hoy «¿Qué tal ha ido el día?». Con unos días anotados aquí verás cómo cambian tu ánimo y tu energía.')}
      ${tips.length ? `<ul class="insights">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div></div>`;
}

let deferredInstall = null;
/* Apariencia: automático (según el sistema), claro u oscuro. Se guarda en este dispositivo. */
const THEMES = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']];
function appearanceSection() {
  const cur = window.themePref ? themePref() : 'auto', i = THEMES.findIndex(([v]) => v === cur);
  const sk = window.skinPref ? skinPref() : '';
  return `<div class="section">
    <div class="section-head"><h2>Apariencia</h2></div>
    <div class="settings-group glass">
      <div class="item theme-item"><span>Modo</span>
        <div class="segmented compact seg-slide theme-seg" role="tablist" aria-label="Modo de color" style="--n:3;--i:${i}">${THEMES.map(([v, l]) => `<button role="tab" class="${v === cur ? 'on' : ''}" aria-selected="${v === cur}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div>
      </div>
      <div class="item skin-item"><span>Estilo</span>
      <div class="skin-grid" role="radiogroup" aria-label="Estilo">${SKINS.map(([v, l, bg, card, dot]) => `<button class="skin-opt ${v === sk ? 'on' : ''}" role="radio" aria-checked="${v === sk}" data-act="skin" data-v="${v}">
        <span class="sw" style="background:${bg}"><i style="background:${dot};opacity:.85"></i><i style="background:${card}"></i><i style="background:${card}"></i><b style="background:${dot}"></b></span><span>${l}</span></button>`).join('')}</div>
      </div>
    </div>
    <p class="hint">«Automático» cambia solo entre claro y oscuro según tu móvil u ordenador. El estilo cambia colores, formas y tamaños; tus datos no se tocan.</p>
  </div>`;
}
/* Estilos de la interfaz: [valor, nombre, fondo, tarjeta, color] (las muestras se pintan siempre en claro) */
const SKINS = [
  ['', 'Cristal', 'linear-gradient(150deg,#cfe0ff,#f3d6ea 60%,#d4f3e6)', 'rgba(255,255,255,.75)', '#4a72cf'],
  ['sereno', 'Sereno', '#f5f3ef', '#fff', '#1d1b18'],
  ['vivo', 'Vivo', 'linear-gradient(150deg,#c9b6ff,#ffc0de 55%,#ffe0a8)', 'rgba(255,255,255,.8)', 'linear-gradient(135deg,#7c3aed,#ec4899)'],
  ['compacto', 'Compacto', 'linear-gradient(150deg,#d6e6ff,#e9e2f7)', 'rgba(255,255,255,.75)', '#0e8f84'],
];
function setSkin(v, grid) {
  try { if (!v) localStorage.removeItem('organizador.skin'); else localStorage.setItem('organizador.skin', v); } catch {}
  if (window.applyTheme) applyTheme();
  if (grid) grid.querySelectorAll('.skin-opt').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
function setTheme(v, seg) {
  try { if (v === 'auto') localStorage.removeItem('organizador.theme'); else localStorage.setItem('organizador.theme', v); } catch {}
  if (window.applyTheme) applyTheme();
  if (seg) {
    seg.style.setProperty('--i', THEMES.findIndex(([k]) => k === v));
    seg.querySelectorAll('button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  }
}

function viewSettings() {
  const s = state.settings, r = s.reminders;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let tzs = [s.timezone];
  try { tzs = Intl.supportedValuesOf('timeZone'); if (!tzs.includes(s.timezone)) tzs.unshift(s.timezone); } catch {}
  const sel = (path, opts, cur, num) => `<select data-set="${path}" ${num ? 'data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `
  <div class="page page-narrow">
  ${pageHead({ eyebrow: `${state.tasks.filter(t => !isRoutineTask(t)).length} tareas · ${state.projects.length} proyectos · ${state.goals.length} objetivos`, title: 'Ajustes' })}
  ${syncSection()}

  ${appearanceSection()}

  <div class="section">
    <div class="section-head"><h2>Recordatorios</h2></div>
    <div class="settings-group glass">
      <label class="item"><span>Activar recordatorios</span><input type="checkbox" class="switch" data-set="reminders.enabled" ${r.enabled && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}></label>
      <div class="item"><span>Antes de un bloque</span>${sel('reminders.blocks', [[0, 'No avisar'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes']], r.blocks, true)}</div>
      <div class="item"><span>Plazos</span><div class="inline">${sel('reminders.deadlines', [['off', 'No avisar'], ['day-before', 'El día antes'], ['same-day', 'El mismo día']], r.deadlines)}<input type="time" data-set="reminders.deadlineTime" value="${esc(r.deadlineTime)}" aria-label="Hora del aviso de plazos"></div></div>
      <div class="item"><span>Resumen de la mañana<span class="muted small item-sub">Tus prioridades, bloques y diarias del día</span></span>${sel('reminders.morning', [['', 'No'], ['06:30', 'A las 6:30'], ['07:00', 'A las 7:00'], ['07:30', 'A las 7:30'], ['08:00', 'A las 8:00'], ['08:30', 'A las 8:30'], ['09:00', 'A las 9:00'], ['10:00', 'A las 10:00']], r.morning || '')}</div>
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
      <div class="item"><span>Tu jornada</span><div class="inline"><input type="time" data-set="dayStart" value="${esc(s.dayStart || '08:00')}" aria-label="Empieza"><span class="muted">a</span><input type="time" data-set="dayEnd" value="${esc(s.dayEnd || '21:00')}" aria-label="Termina"></div></div>
      <div class="item"><span>Temporizador de enfoque</span>${sel('focusMinutes', SINGLE_MINS.map(m => [m, m + ' min']), s.focusMinutes, true)}</div>
    </div>
  </div>

  ${calendarsSection()}

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
      <div class="item"><span>Papelera <span class="muted small">· ${(state.trash || []).length} elemento${(state.trash || []).length === 1 ? '' : 's'}, se guardan 10 días</span></span><button class="btn small" data-act="trash-open">Abrir</button></div>
      <div class="item"><span>Plantillas de proyecto <span class="muted small">· ${(state.templates || []).filter(t => t.kind === 'project').length}</span></span><button class="btn small" data-act="templates" data-kind="project">Ver</button></div>
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
      <div class="item small muted" style="display:block;line-height:1.6">
        <strong style="color:var(--text)">Accesos directos:</strong> en Android y en el ordenador, mantén pulsado (o clic derecho) el icono de la app para ir directo a «Nueva tarea», «Hoy», «Enfoque» o «Buscar». En iPhone Apple no lo permite a las apps web: usa la lupa de arriba a la derecha.<br>
        <strong style="color:var(--text)">Teclado:</strong> <b>N</b> nueva tarea · <b>/</b> o <b>Ctrl+K</b> buscar · <b>F</b> enfoque · <b>H</b> hoy · <b>S</b> semana.
      </div>
      <div class="item"><span>Ver la introducción otra vez</span><button class="btn small" data-act="onboarding">Ver</button></div>
      <div class="item"><span>Repetir el tutorial de primeros pasos</span><button class="btn small" data-act="tour">Empezar</button></div>
      <div class="item"><span>Volver a ver la explicación de cada pantalla</span><button class="btn small" data-act="tour-screens">Activar</button></div>
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
  delete modalForm.dataset.tagsTouched; delete modalForm.dataset.colorTouched; modalForm._autoTag = null;
  closeModalNow();
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
  if (e.target.id === 'gsearch') { $('#gs-results', modalForm).innerHTML = searchResults(e.target.value); return; }
  const c = e.target.dataset.customFor;
  if (c) { const r = modalForm.querySelector(`input[name="${c}"][value="custom"]`); if (r) r.checked = true; }
  if (e.target.dataset.ctxColor && !modalForm.dataset.colorTouched) {
    const cx = contextOf(e.target.value), r = cx && modalForm.querySelector(`input[name=color][value="${contextColor(cx)}"]`);
    if (r) r.checked = true;
  }
  if (e.target.dataset.nl) {
    const pv = $('.nl-preview', modalForm);
    const pq = e.target.value.trim().length > 2 ? parseQuick(e.target.value) : null, found = pq ? pq.found : [];
    /* v32: marca sola la etiqueta del tema (si existe y no has tocado las etiquetas) */
    if (!modalForm.dataset.tagsTouched) {
      const prev = modalForm._autoTag && modalForm.querySelector(`input[name=tag][value="${modalForm._autoTag}"]`);
      if (prev) prev.checked = false;
      modalForm._autoTag = null;
      const tg = pq && pq.context && contextTag(pq.context, false), box = tg && modalForm.querySelector(`input[name=tag][value="${tg.id}"]`);
      if (box && !modalForm.querySelector('input[name=tag]:checked')) { box.checked = true; modalForm._autoTag = tg.id; }
    }
    if (pv) { pv.innerHTML = foundChips(found); pv.classList.toggle('on', found.length > 0); }
  }
});
modalForm.addEventListener('change', e => {
  if (e.isTrusted && e.target.name === 'tag') modalForm.dataset.tagsTouched = '1';
  if (e.isTrusted && (e.target.name === 'color' || e.target.name === 'colorCustom')) modalForm.dataset.colorTouched = '1';
  if (e.target.name === 'repeat') modalForm.dataset.rep = e.target.value;
  if (e.target.name === 'repUnit') modalForm.dataset.rpt = e.target.value;
  if (e.target.name === 'progressMode') modalForm.dataset.pm = e.target.value;
  if (e.target.name === 'p' && e.target.checked && $$('input[name=p]:checked', modalForm).length > 3) { e.target.checked = false; toast('Como máximo 3 prioridades'); }
});
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
/* v23: la hoja se va deslizando hacia abajo (o se desvanece en el ordenador) en vez de desaparecer de golpe */
const nativeClose = HTMLDialogElement.prototype.close;
function closeModalNow() {
  clearTimeout(modal._t); modal.classList.remove('is-closing');
  if (modal.open) nativeClose.call(modal);
}
modal.close = function (v) {
  if (!modal.open || modal.classList.contains('is-closing')) return;
  if (reduceMotion()) return nativeClose.call(modal, v);
  modal.classList.add('is-closing');
  modal._t = setTimeout(() => { modal.classList.remove('is-closing'); if (modal.open) nativeClose.call(modal, v); }, 200);
};
modal.addEventListener('cancel', e => { e.preventDefault(); modal.close(); });

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
    ['Hábito', I.repeat, () => habitModal()],
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
    <label class="field">Tarea${isNew && voiceOK ? '<div class="mic-in">' : ''}<input type="text" name="title" required value="${esc(t.title)}" enterkeyhint="done" placeholder="${isNew ? 'Ej.: dentista mañana a las 10' : '¿Qué hay que hacer?'}" ${isNew ? 'data-nl="1"' : ''}>${isNew && voiceOK ? micBtn() + '</div>' : ''}</label>
    ${isNew ? '<div class="qa-preview nl-preview" aria-live="polite"></div>' : ''}
    <div class="row">
      <label class="field">Plazo<input type="date" name="due" value="${esc(t.due || '')}"></label>
      <label class="field">Duración estimada<select name="estimate"><option value="">—</option>${ESTIMATES.map(m => `<option value="${m}" ${t.estimate === m ? 'selected' : ''}>${durLabel(m)}</option>`).join('')}</select></label>
    </div>
    <div class="row">
      <label class="field">Repetir<select name="repUnit"><option value="">No se repite</option>${Object.entries(REPEAT_UNITS).map(([u, [one]]) => `<option value="${u}" ${t.repeat && t.repeat.unit === u ? 'selected' : ''}>Cada ${one}</option>`).join('')}</select></label>
      <label class="field rep-n">Cada cuántos<input type="number" name="repN" min="1" max="99" inputmode="numeric" value="${t.repeat ? t.repeat.n : 1}"></label>
    </div>
    <div class="field">Prioridad<div class="seg-radio">${Object.entries(PRIORITIES).map(([k, l]) => `<label><input type="radio" name="priority" value="${k}" ${t.priority === k ? 'checked' : ''}><span>${k === 'none' ? 'Ninguna' : l}</span></label>`).join('')}</div></div>
    ${state.tags.length ? `<div class="field">Etiquetas<div class="tag-pick">${state.tags.map(tg => `<label style="--c:${tg.color}"><input type="checkbox" name="tag" value="${tg.id}" ${t.tags.includes(tg.id) ? 'checked' : ''}><span>${esc(tg.name)}</span></label>`).join('')}</div></div>` : ''}
    <div class="row">
      <label class="field">Proyecto<select name="projectId">${optionList(state.projects.filter(p => !p.archived || p.id === t.projectId), t.projectId, projLabel, 'Ninguno')}</select></label>
      <label class="field">Objetivo<select name="goalId">${optionList(state.goals.filter(g => g.status !== 'cumplido' || g.id === t.goalId), t.goalId, goalLabel, 'Ninguno')}</select></label>
    </div>
    <label class="field">¿Por dónde empiezas?<input type="text" name="firstStep" value="${esc(t.firstStep)}" placeholder="Ej.: abrir el documento y escribir el título"><span class="hint">Opcional. Una acción pequeña y concreta para arrancar sin pensarlo.</span></label>
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
        repeat: d.repUnit ? { unit: d.repUnit, n: clamp(Number(d.repN) || 1, 1, 99) } : null,
      });
      /* v27: en una tarea nueva, «dentista mañana a las 10» rellena plazo, hora y demás (si no los has cambiado a mano) */
      let nlTime = null;
      const voiced = isNew && !!modalForm.elements.title.dataset.voiced;
      if (isNew) {
        const p = parseQuick(title);
        if (p.found.length && p.title) {
          obj.title = p.title;
          if (p.due && (d.due || null) === (t0.due || null)) obj.due = p.due;
          if (p.estimate && !d.estimate) obj.estimate = p.estimate;
          if (p.priority && obj.priority === 'none') obj.priority = p.priority;
          if (p.repeat && !obj.repeat) obj.repeat = p.repeat;
          if (p.projectId && !obj.projectId) obj.projectId = p.projectId;
          for (const name of p.newTags) { const tg = { id: uid(), name, color: COLORS[state.tags.length % COLORS.length] }; state.tags.push(tg); p.tags.push(tg.id); }
          obj.tags = [...new Set([...obj.tags, ...p.tags])];
          /* v32: tema automático solo si no has elegido etiqueta, proyecto ni objetivo */
          if (p.context && !obj.tags.length && !obj.projectId && !obj.goalId) obj.tags = [contextTag(p.context).id];
          nlTime = p.time;
          if (!voiced) toast('Añadida · ' + p.found.join(' · '));
        }
        if (voiced) voiceSavedToast(obj, p.found);
      }
      if (obj.repeat && !obj.due) obj.due = todayStr();
      if (nlTime) { if (!obj.due) obj.due = todayStr(); scheduleTask(obj, obj.due, nlTime, fmtHM(Math.min(toMin(nlTime) + (obj.estimate || 60), 24 * 60 - 1))); }
      if (isNew) state.tasks.push(obj);
      else blocksOfTask(obj.id).forEach(e => { if (e.title === oldTitle) e.title = title; });
      saved = obj;
    },
    onDelete: isNew ? null : () => { deleteWithUndo('task', t.id); },
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
  modalForm.dataset.rpt = t.repeat ? t.repeat.unit : '';
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

/* floor: escala mínima. Así 15 min de enfoque no llenan la barra entera: la barra llena es 1 h (o más si un día pasas de ahí) */
function bars(rows, unit, floor = 1) {
  const max = Math.max(floor, ...rows.map(r => r.v));
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
  const bestStreak = Math.max(0, bestHabitStreak(), ...rstats.map(x => x.streak));
  const diff = tasksW - tasksPrev;
  return `
  <div class="page page-mid">
  ${pageHead({ eyebrow: `Semana ${weekNumber(ws)}`, title: 'Progreso', actions: `<a class="btn small" href="#habitos">🔥<span>Hábitos</span></a>` })}
  <div class="stat-tiles">
    <div class="tile glass"><b>${tasksW}</b><span>tareas hechas esta semana</span><small class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${diff} vs. la anterior</small></div>
    <div class="tile glass"><b>${focusW >= 60 ? (focusW / 60).toFixed(1).replace('.0', '') + ' h' : focusW + ' min'}</b><span>de enfoque esta semana</span></div>
    <div class="tile glass"><b>🔥 ${bestStreak}</b><span>mejor racha activa</span></div>
    <div class="tile glass"><b>${goalsDone}</b><span>objetivo${goalsDone === 1 ? '' : 's'} conseguido${goalsDone === 1 ? '' : 's'}</span></div>
  </div>
  ${habitsStatsSection()}
  <div class="section"><div class="section-head"><h2>Tareas hechas · últimos 7 días</h2></div><div class="card glass">${bars(days.map(d => row(doneBy, d)), 'tareas', 5)}</div></div>
  <div class="section"><div class="section-head"><h2>Minutos de enfoque · últimos 7 días</h2></div><div class="card glass">${bars(days.map(d => row(focusBy, d)), 'min', 60)}<p class="small muted bars-note">La barra llena es 1 hora de enfoque.</p></div></div>
  ${journalStats()}
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
    <label class="field">Objetivo<input type="text" name="title" required value="${esc(g.title)}" placeholder="Correr 10 km en menos de 60 min" ${isNew ? 'data-ctx-color="1"' : ''}></label>
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
      /* v32: si no has tocado el color, el del proyecto o el del tema («correr» → Deporte) */
      if (isNew && readColor(d, 'color') === g.color) {
        const pj = d.projectId && project(d.projectId), cx = contextOf(d.title);
        if (pj) d.color = pj.color; else if (cx) d.color = contextColor(cx);
      }
      Object.assign(obj, { title: d.title.trim(), horizon: d.horizon, due: d.due, description: d.description.trim(), success: d.success.trim(), projectId: d.projectId || null, progressMode: d.progressMode, progress: Number(d.progress) || 0, color: readColor(d, 'color') || COLORS[0] });
      if (isNew) { state.goals.push(obj); setTimeout(() => { location.hash = '#objetivo/' + obj.id; }); }
    },
    onDelete: isNew ? null : () => {
      /* Va a la papelera: se recupera con sus vínculos durante 10 días */
      deleteWithUndo('goal', g.id);
      location.hash = '#objetivos';
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
      /* Va a la papelera; sus objetivos y tareas se quedan, sin proyecto, hasta que lo recuperes */
      deleteWithUndo('project', p.id);
      location.hash = '#proyectos';
    },
  });
}

/* ---------- Enfoque ---------- */
/* Temporizador: { taskId, mode: 'single'|'long', work, brk, rounds, round, phase: 'work'|'break',
   minutes (de la fase actual), endAt, pausedLeft } — pausedLeft (ms) solo mientras está en pausa.
   Sesión larga: trabajo → descanso → trabajo… sin descanso tras la última ronda. */

const SINGLE_MINS = [5, 15, 25, 45, 60];
const LONG_OPTS = { work: [25, 45, 50], brk: [5, 10, 15], rounds: [2, 3, 4] };
function focusPlan() {
  const p = state.settings.focusPlan || {};
  return {
    mode: p.mode === 'long' ? 'long' : 'single',
    work: LONG_OPTS.work.includes(p.work) ? p.work : 25,
    brk: LONG_OPTS.brk.includes(p.brk) ? p.brk : 5,
    rounds: LONG_OPTS.rounds.includes(p.rounds) ? p.rounds : 4,
  };
}
function setFocusPlan(k, v) { state.settings.focusPlan = { ...focusPlan(), [k]: v }; save(true); }

function getTimer() { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || null; } catch { return null; } }
function setTimer(t) {
  try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); } catch {}
  /* El servidor avisa de cada cambio (descanso, vuelta, fin) aunque la app esté cerrada */
  const end = t && t.pausedLeft == null ? { endAt: timerSchedule(t).slice(-1)[0].at, title: (task(t.taskId) || {}).title || '', events: timerSchedule(t) } : null;
  if (JSON.stringify(state.focusEnd || null) !== JSON.stringify(end)) { state.focusEnd = end; save(); }
  focusNote(true);
}
/* Próximos avisos de la sesión en marcha: cuándo y qué decir */
function timerSchedule(tm) {
  const name = (task(tm.taskId) || {}).title || 'Enfoque';
  const out = [];
  let at = tm.endAt, round = tm.round || 1, phase = tm.phase || 'work';
  const long = tm.mode === 'long';
  for (let i = 0; i < 20; i++) {
    if (!long || (phase === 'work' && round >= tm.rounds)) { out.push({ at, title: 'Enfoque completado', body: `${name}. ${long ? `${tm.rounds} rondas hechas. ` : ''}Buen trabajo.` }); break; }
    if (phase === 'work') { out.push({ at, title: `Descanso de ${tm.brk} min`, body: `Ronda ${round} de ${tm.rounds} hecha. Levántate un momento.` }); phase = 'break'; at += tm.brk * 60000; }
    else { round++; out.push({ at, title: `Ronda ${round} de ${tm.rounds}`, body: `Vuelve a: ${name}` }); phase = 'work'; at += tm.work * 60000; }
  }
  return out;
}
const timerLeft = tm => tm.pausedLeft != null ? tm.pausedLeft : Math.max(0, tm.endAt - Date.now());
const mmss = ms => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}`;
const clockAt = ms => dtf('es-ES', { timeZone: state.settings.timezone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const sessionEnd = tm => timerSchedule(tm).slice(-1)[0].at;
const phaseLabel = tm => tm.mode !== 'long' ? '' : tm.phase === 'break' ? `Descanso · ronda ${tm.round} de ${tm.rounds}` : `Ronda ${tm.round} de ${tm.rounds}`;
const RING = 2 * Math.PI * 38;
/* v28: el reloj de enfoque representa una hora entera (como un temporizador de cocina):
   lo coloreado es el tiempo que queda. 15 min = un cuarto del círculo, 60 min = el círculo entero. */
const ringOffset = ms => RING * (1 - Math.min(1, Math.max(0, ms / 3600000)));
const RING_TICKS = [0, 1, 2, 3].map(k => { const a = k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); return `<line class="tick" x1="${(42 + c * 30).toFixed(1)}" y1="${(42 + s * 30).toFixed(1)}" x2="${(42 + c * 27).toFixed(1)}" y2="${(42 + s * 27).toFixed(1)}"/>`; }).join('');
let celebratedAt = null;

/* Aviso fijo con el tiempo que queda, visible fuera de la app (pantalla de bloqueo y bandeja).
   Se muestra al salir de la app y se quita al volver. */
const canNotify = () => 'Notification' in window && Notification.permission === 'granted';
function swReg() { return navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.ready : null; }
let focusNoteMin = null, focusNoteObj = null;
function focusNote(force) {
  const tm = getTimer();
  if (!tm || document.visibilityState === 'visible' || !canNotify()) { closeFocusNote(); return; }
  const left = timerLeft(tm), paused = tm.pausedLeft != null, mins = Math.max(1, Math.ceil(left / 60000));
  const key = (paused ? 'p' : '') + tm.phase + tm.round + ':' + mins;
  if (!force && key === focusNoteMin) return;
  focusNoteMin = key;
  const t = task(tm.taskId), brk = tm.phase === 'break';
  const title = paused ? `En pausa · quedan ${mmss(left)}` : `${brk ? 'Descanso' : 'Enfoque'} · quedan ${mins} min`;
  const lines = [t ? t.title : 'Enfoque'];
  if (tm.mode === 'long') lines.push(phaseLabel(tm) + '.');
  lines.push(paused ? 'Vuelve a la app para seguir.' : brk ? `Vuelves a las ${clockAt(tm.endAt)}.` : tm.mode === 'long' && tm.round < tm.rounds ? `Descanso a las ${clockAt(tm.endAt)}.` : `Termina a las ${clockAt(tm.endAt)}.`);
  const opts = { body: lines.join('\n'), tag: 'focus-live', silent: true, renotify: false, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#hoy' } };
  try {
    const r = swReg();
    if (r) r.then(reg => reg.showNotification(title, opts)).catch(() => {});
    else { if (focusNoteObj) focusNoteObj.close(); focusNoteObj = new Notification(title, opts); }
  } catch {}
}
function closeFocusNote() {
  if (focusNoteMin === null) return;
  focusNoteMin = null;
  try {
    if (focusNoteObj) { focusNoteObj.close(); focusNoteObj = null; }
    const r = swReg();
    if (r) r.then(reg => reg.getNotifications({ tag: 'focus-live' })).then(l => l.forEach(n => n.close())).catch(() => {});
  } catch {}
}
function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

function openFocus(id) {
  const t = task(id);
  if (!t) return;
  focusTaskId = id;
  if (!t.startedAt) { t.startedAt = Date.now(); save(); }
  if (!SINGLE_MINS.includes(focusMins)) focusMins = SINGLE_MINS.includes(state.settings.focusMinutes) ? state.settings.focusMinutes : 25;
  const layer = $('#focus');
  clearTimeout(closeFocus.t); layer.classList.remove('is-closing');
  const wasOpen = !layer.hidden;
  if (!wasOpen) layer.innerHTML = '';
  renderFocus();
  layer.hidden = false;
  document.body.classList.add('focus-open');
}
function closeFocus() {
  const layer = $('#focus');
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  { const s = getSummary(); if (s && s.taskId === focusTaskId) setSummary(null); }
  document.body.classList.remove('focus-open');
  const done = () => { layer.hidden = true; layer.classList.remove('focus-full', 'is-closing'); updateTimerUI(); };
  clearTimeout(closeFocus.t);
  if (layer.hidden || reduceMotion()) return done();
  layer.classList.add('is-closing');
  closeFocus.t = setTimeout(done, 190);
}
/* v23: pantalla completa con fundido (sin salto) */
function toggleFocusFull() {
  const layer = $('#focus'), on = !layer.classList.contains('focus-full');
  try { if (on) { if (!document.fullscreenElement && document.documentElement.requestFullscreen && !isPhone()) document.documentElement.requestFullscreen().catch(() => {}); } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  const swap = () => { layer.classList.toggle('focus-full', on); renderFocus(true); };
  const card = layer.querySelector('.focus-card');
  if (!card || reduceMotion() || !card.animate) return swap();
  if (toggleFocusFull.busy) return;
  toggleFocusFull.busy = true;
  const out = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `scale(${on ? .98 : 1.02})` }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  const go = () => {
    toggleFocusFull.busy = false;
    swap();
    const c = layer.querySelector('.focus-card');
    if (c) c.animate([{ opacity: 0, transform: `scale(${on ? 1.02 : .98})` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  };
  out.finished.then(go, go);
}
/* v23: al cambiar algo dentro del enfoque la tarjeta no vuelve a «saltar»: crece o encoge suave
   y el selector de modo se desliza */
function morphFocus(card, prev) {
  if (reduceMotion() || !card.animate) return;
  const seg = card.querySelector('.focus-mode');
  if (seg && prev.i != null) {
    const to = seg.style.getPropertyValue('--i');
    if (to !== prev.i) { seg.style.setProperty('--i', prev.i); void seg.offsetWidth; seg.style.setProperty('--i', to); }
  }
  if (prev.mode && prev.mode !== card.dataset.mode) card.classList.add('swap');
  if ($('#focus').classList.contains('focus-full')) return;
  const h = card.offsetHeight;
  if (Math.abs(h - prev.h) > 2) card.animate([{ height: prev.h + 'px', overflow: 'hidden' }, { height: h + 'px', overflow: 'hidden' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
const chips = (act, vals, cur, suffix = ' min', stack = false) => `<div class="chips-row even">${vals.map(v => `<button class="chip-btn ${v === cur ? 'on' : ''} ${stack ? 'stack' : ''}" data-act="${act}" data-v="${v}" aria-label="${v}${suffix}">${stack ? `<b>${v}</b><small>${suffix.trim()}</small>` : v + suffix}</button>`).join('')}</div>`;
/* Resumen de la última sesión terminada (se enseña una vez al volver) */
const SUMMARY_KEY = 'organizador.focusSummary';
function getSummary() { try { return JSON.parse(localStorage.getItem(SUMMARY_KEY)) || null; } catch { return null; } }
function setSummary(s) { try { s ? localStorage.setItem(SUMMARY_KEY, JSON.stringify(s)) : localStorage.removeItem(SUMMARY_KEY); } catch {} }
function summaryHTML(s, t) {
  const faces = [[1, '😣', 'Mal'], [2, '😐', 'Regular'], [3, '🙂', 'Bien'], [4, '🤩', 'Genial']];
  const ds = (s.distractions || []).map(task).filter(Boolean);
  return `<div class="focus-summary">
    <div class="done-badge" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15.5 27l7 7L37 19.5"/></svg></div>
    <div class="sum-big">${s.minutes} min</div>
    <div class="muted">de enfoque${s.rounds > 1 ? ` · ${s.rounds} rondas` : ''}${t.subtasks.length ? ` · ${t.subtasks.filter(x => x.done).length}/${t.subtasks.length} pasos` : ''}</div>
    ${ds.length ? `<div class="sum-dis"><div class="small muted">Apuntaste para después:</div><ul class="plain small">${ds.map(x => `<li>${esc(x.title)}</li>`).join('')}</ul></div>` : ''}
    <div class="small muted">¿Cómo ha ido?</div>
    <div class="chips-row rate">${faces.map(([v, f, l]) => `<button class="chip-btn ${s.rating === v ? 'on' : ''}" data-act="focus-rate" data-v="${v}" aria-label="${l}" title="${l}">${f}</button>`).join('')}</div>
  </div>`;
}
function renderFocus(noMorph) {
  const t = task(focusTaskId);
  if (!t) { closeFocus(); return; }
  const layer = $('#focus'), prevCard = layer.hidden ? null : layer.querySelector('.focus-card');
  const prevRing = prevCard && $('#focus-ring') ? $('#focus-ring').style.strokeDashoffset || $('#focus-ring').getAttribute('stroke-dashoffset') : null;
  const prev = prevCard && { h: prevCard.offsetHeight, mode: prevCard.dataset.mode, i: prevCard.querySelector('.focus-mode') ? prevCard.querySelector('.focus-mode').style.getPropertyValue('--i') : null };
  const sum = getSummary(), showSum = sum && sum.taskId === t.id && !getTimer();
  const full = $('#focus').classList.contains('focus-full');
  const timer = getTimer(), mine = timer && timer.taskId === t.id, paused = mine && timer.pausedLeft != null;
  const other = timer && !mine, plan = focusPlan();
  const total = plan.rounds * plan.work + (plan.rounds - 1) * plan.brk;
  const setup = mine ? '' : `
      <div class="segmented compact focus-mode seg-slide" role="tablist" style="--i:${plan.mode === 'long' ? 1 : 0}">
        <button role="tab" class="${plan.mode === 'single' ? 'on' : ''}" data-act="focus-mode" data-v="single">Sesión única</button>
        <button role="tab" class="${plan.mode === 'long' ? 'on' : ''}" data-act="focus-mode" data-v="long">Con descansos</button>
      </div>
      ${plan.mode === 'single' ? chips('focus-min', SINGLE_MINS, focusMins, ' min', true) : `
      <div class="focus-plan">
        <span>Trabajo</span>${chips('focus-plan-work', LONG_OPTS.work, plan.work)}
        <span>Descanso</span>${chips('focus-plan-brk', LONG_OPTS.brk, plan.brk)}
        <span>Rondas</span>${chips('focus-plan-rounds', LONG_OPTS.rounds, plan.rounds, '')}
      </div>`}`;
  const sub = paused ? 'En pausa.'
    : mine ? (timer.mode === 'long' ? `${timer.phase === 'break' ? `Vuelves a las ${clockAt(timer.endAt)}` : timer.round < timer.rounds ? `Descanso a las ${clockAt(timer.endAt)}` : `Termina a las ${clockAt(timer.endAt)}`}. Puedes salir de la app: te avisaré.` : `Termina a las ${clockAt(timer.endAt)}. Puedes salir de la app: te avisaré.`)
    : other ? 'Hay otro temporizador en marcha; si empiezas este, lo sustituye.'
    : plan.mode === 'long' ? `${plan.rounds} rondas de ${plan.work} min con ${plan.brk} min de descanso: ${total >= 60 ? Math.floor(total / 60) + ' h ' + (total % 60 ? total % 60 + ' min' : '') : total + ' min'} en total.`
    : 'Una sola sesión, sin descansos. El círculo es una hora: lo de color es el tiempo de tu sesión.';
  const startMins = plan.mode === 'long' ? plan.work : focusMins;
  layer.innerHTML = `<div class="focus-card glass ${showSum ? 'is-summary' : ''} ${mine ? 'is-running' : ''} ${prevCard ? 'no-pop' : ''}" data-mode="${mine ? 'run' : showSum ? 'sum' : plan.mode}" role="dialog" aria-label="Enfoque">
    <button class="icon-btn round focus-close" data-act="focus-close" aria-label="Cerrar">${I.close}</button>
    <button class="icon-btn round focus-fullbtn" data-act="focus-full" aria-label="${full ? 'Salir de pantalla completa' : 'Pantalla completa'}" title="${full ? 'Salir de pantalla completa' : 'Pantalla completa'}">${full ? I.shrink : I.expand}</button>
    <div class="eyebrow">${showSum ? 'Sesión terminada' : 'Enfoque'}</div>
    <h2 class="focus-title ${t.done ? 'done' : ''}">${esc(t.title)}</h2>
    ${showSum ? summaryHTML(sum, t) : ''}
    <label class="field focus-extra">¿Por dónde empiezas?<input type="text" data-input="first-step" data-id="${t.id}" value="${esc(t.firstStep)}" placeholder="Ej.: abrir el documento y escribir el título" enterkeyhint="done">
      <span class="hint">Una acción pequeña y concreta, de menos de 2 minutos. Así arrancar cuesta mucho menos.</span></label>
    ${t.subtasks.length ? `<div class="focus-subs focus-extra">${t.subtasks.map(s => `<label><input type="checkbox" class="check sm" data-act="sub-toggle" data-id="${t.id}" data-sub="${s.id}" ${s.done ? 'checked' : ''}><span>${esc(s.title)}</span></label>`).join('')}</div>` : ''}
    <div class="focus-timer ${paused ? 'is-paused' : ''} ${mine && timer.phase === 'break' ? 'is-break' : ''} ${showSum ? 'is-hidden' : ''}">
      ${mine && timer.mode === 'long' ? `<div class="focus-phase">${timer.phase === 'break' ? 'Descanso' : 'Trabajo'}<span>${timer.round}/${timer.rounds}</span></div>` : ''}
      <div class="ring big" aria-hidden="true">
        <svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="38"/>${RING_TICKS}<circle class="bar" id="focus-ring" cx="42" cy="42" r="38" stroke-dasharray="${RING}" stroke-dashoffset="${prevRing != null ? prevRing : ringOffset((mine ? timerLeft(timer) : startMins * 60000))}"/></svg>
        <div class="time" id="focus-time">${pad(startMins)}:00</div>
      </div>
      ${setup}
      <p class="muted small" id="focus-sub">${sub}</p>
    </div>
    ${mine ? `<form class="focus-dis" data-act="focus-distraction">
      <input type="text" name="title" placeholder="¿Te viene algo a la cabeza? Apúntalo y sigue" autocomplete="off" enterkeyhint="done" aria-label="Apuntar distracción">
      <button class="icon-btn round" type="submit" aria-label="Apuntar">${I.plus}</button>
    </form>${(timer.distractions || []).length ? `<p class="muted small dis-count">${timer.distractions.length} apuntada${timer.distractions.length === 1 ? '' : 's'} en la bandeja para después</p>` : ''}` : ''}
    <div class="focus-actions">
      ${mine ? `<button class="btn" data-act="focus-reset">${I.reset}<span>Reiniciar</span></button>
        <button class="btn" data-act="${paused ? 'focus-resume' : 'focus-pause'}">${paused ? I.play + '<span>Seguir</span>' : I.pause + '<span>Pausar</span>'}</button>`
      : showSum ? `<button class="btn" data-act="focus-again">${I.repeat}<span>Otra sesión</span></button>`
      : `<button class="btn" data-act="focus-start">${I.play}<span>Empezar</span></button>`}
      <button class="btn primary" data-act="focus-done" data-id="${t.id}">${t.done ? 'Hecha ✓' : 'Completar tarea'}</button>
    </div>
  </div>`;
  if (prev && !noMorph) morphFocus(layer.querySelector('.focus-card'), prev);
  /* El círculo pasa suave de la duración anterior a la nueva */
  if ($('#focus-ring')) $('#focus-ring').getBoundingClientRect();
  updateTimerUI();
  if (showSum && sum.at && celebratedAt !== sum.at) {
    celebratedAt = sum.at;
    const badge = layer.querySelector('.done-badge');
    if (badge && !reduceMotion()) { badge.classList.add('play'); setTimeout(() => checkBurst(badge, true), 780); }
  }
}
/* Minutos de trabajo hechos en la fase actual (lo de rondas anteriores ya está apuntado) */
function workedNow(tm) { return tm.phase === 'break' ? 0 : Math.floor((tm.minutes * 60000 - timerLeft(tm)) / 60000); }
function logFocus(minutes, taskId) { if (minutes >= 1) state.focusLog.push({ date: todayStr(), minutes, taskId: taskId || null }); }
/* Para el contador sin terminar la sesión: al reiniciar, al borrar la tarea o al completarla */
function cancelTimer(log) {
  const tm = getTimer();
  if (!tm) return;
  if (log) logFocus(workedNow(tm), tm.taskId);
  setTimer(null);
  save();
  updateTimerUI();
}
function focusAction(act) {
  const tm = getTimer();
  if (act === 'start') {
    askNotify();
    setSummary(null);
    const plan = focusPlan(), long = plan.mode === 'long', mins = long ? plan.work : focusMins;
    setTimer({ taskId: focusTaskId, mode: plan.mode, work: long ? plan.work : mins, brk: plan.brk, rounds: long ? plan.rounds : 1, round: 1, phase: 'work', minutes: mins, endAt: Date.now() + mins * 60000, pausedLeft: null });
    toast(long ? `A por ello: ronda 1 de ${plan.rounds}, ${mins} minutos.` : `A por ello: ${mins} minutos solo para esto.`);
  } else if (!tm) return;
  else if (act === 'pause') setTimer({ ...tm, pausedLeft: timerLeft(tm) });
  else if (act === 'resume') setTimer({ ...tm, endAt: Date.now() + tm.pausedLeft, pausedLeft: null });
  else if (act === 'reset') {
    /* Lo ya trabajado cuenta en Progreso */
    if (tm.mode !== 'long') focusMins = tm.minutes;
    cancelTimer(true);
  }
  renderFocus();
}
/* La tarea del contador ya no existe o se ha completado: el contador se va con ella */
function timerOrphan(tm) {
  const t = tm.taskId && task(tm.taskId);
  if (t && !t.done) return false;
  cancelTimer(!!t);
  if (!$('#focus').hidden) { if (t) renderFocus(); else closeFocus(); }
  return true;
}
function updateTimerUI() {
  let timer = getTimer();
  const pill = $('#focus-pill');
  const layerOpen = !$('#focus').hidden;
  if (timer && timerOrphan(timer)) timer = null;
  if (!timer) {
    document.title = 'P Organizer';
    pill.hidden = true;
    const el = $('#focus-time');
    const m0 = focusPlan().mode === 'long' ? focusPlan().work : focusMins || 25;
    if (el) { el.textContent = pad(m0) + ':00'; $('#focus-ring').style.strokeDashoffset = ringOffset(m0 * 60000); }
    closeFocusNote();
    return;
  }
  const left = timerLeft(timer), paused = timer.pausedLeft != null;
  if (!paused && left <= 0) { advanceTimer(timer); return; }
  const txt = mmss(left), brk = timer.phase === 'break';
  document.title = `${paused ? '⏸ ' : brk ? '☕ ' : ''}${txt} · P Organizer`;
  const t = timer.taskId && task(timer.taskId);
  pill.hidden = layerOpen;
  pill.classList.toggle('is-paused', paused);
  pill.innerHTML = `${paused ? I.pause : I.play}<span class="one-line">${brk ? 'Descanso' : esc(t ? t.title : 'Enfoque')}</span><b>${txt}</b>`;
  const el = $('#focus-time');
  if (el && timer.taskId === focusTaskId) {
    el.textContent = txt;
    $('#focus-ring').style.strokeDashoffset = ringOffset(left);
  }
  if (document.visibilityState !== 'visible') focusNote();
}
/* Pasa a la siguiente fase (o termina). Si la app estuvo cerrada, recupera todas las fases que pasaron. */
function advanceTimer(tm) {
  let n = { ...tm }, last = null;
  while (n.pausedLeft == null && n.endAt <= Date.now()) {
    if (n.phase === 'work') logFocus(n.minutes, n.taskId);
    if (n.mode !== 'long' || (n.phase === 'work' && n.round >= n.rounds)) { last = 'end'; n = null; break; }
    if (n.phase === 'work') { n = { ...n, phase: 'break', minutes: n.brk, endAt: n.endAt + n.brk * 60000 }; last = 'break'; }
    else { n = { ...n, phase: 'work', round: n.round + 1, minutes: n.work, endAt: n.endAt + n.work * 60000 }; last = 'work'; }
  }
  if (last === 'end') {
    const total = tm.mode === 'long' ? tm.rounds * tm.work : tm.minutes;
    setSummary({ taskId: tm.taskId, minutes: total, rounds: tm.mode === 'long' ? tm.rounds : 1, distractions: tm.distractions || [], date: todayStr(), at: Date.now(), rating: null });
  }
  setTimer(n);
  save();
  haptic([200, 100, 200]);
  beep();
  const t = tm.taskId && task(tm.taskId), name = t ? t.title : '';
  const msg = last === 'end' ? `Enfoque completado${name ? ': ' + name : ''}.${tm.mode === 'long' ? ` ${tm.rounds} rondas hechas.` : ''} Buen trabajo.`
    : last === 'break' ? `Ronda ${n.round} de ${n.rounds} hecha. Descanso de ${n.brk} min.`
    : `Vuelta al trabajo: ronda ${n.round} de ${n.rounds}.`;
  toast(msg);
  /* Con avisos push activos, los avisos de cambio los manda el servidor (llegan aunque la app esté cerrada) */
  if (document.visibilityState !== 'visible' && !pushActive()) notify('focus:' + tm.endAt, last === 'end' ? 'Enfoque completado' : last === 'break' ? 'Descanso' : `Ronda ${n.round} de ${n.rounds}`, msg, 'focus-live');
  if (last === 'end' && tm.taskId && task(tm.taskId) && $('#focus').hidden && document.visibilityState === 'visible') openFocus(tm.taskId);
  else if (!$('#focus').hidden) renderFocus();
  else updateTimerUI();
}
/* Apuntar una distracción: queda como tarea en la bandeja, sin salir del enfoque */
function addDistraction(form) {
  const inp = form.querySelector('input'), v = inp.value.trim(), tm = getTimer();
  if (!v || !tm) return;
  const cur = task(tm.taskId);
  const t = newTask({ title: v, notes: cur ? `Apuntado durante el enfoque en «${cur.title}»` : '' });
  state.tasks.push(t);
  setTimer({ ...tm, distractions: [...(tm.distractions || []), t.id] });
  save();
  inp.value = '';
  toast('Apuntado en la bandeja. ¡Sigue!');
  const c = $('.dis-count');
  const n = getTimer().distractions.length, txt = `${n} apuntada${n === 1 ? '' : 's'} en la bandeja para después`;
  if (c) c.textContent = txt; else form.insertAdjacentHTML('afterend', `<p class="muted small dis-count">${txt}</p>`);
  inp.focus();
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
function notify(key, title, body, tag) {
  if (state.notified[key]) return;
  state.notified[key] = Date.now();
  save(true);
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: tag || key };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(e => console.warn('Notificación', e));
    else new Notification(title, opts);
  } catch (e) { console.warn('Notificación', e); }
}
function checkReminders() {
  const r = state.settings.reminders;
  if (!r.enabled || pushActive() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = nowHHMM(), today = todayStr();
  /* Limpia avisos antiguos */
  const old = Date.now() - 4 * 86400000;
  Object.keys(state.notified).forEach(k => { if (state.notified[k] < old) delete state.notified[k]; });
  if (r.morning && now >= r.morning && toMin(now) - toMin(r.morning) < 180) {
    const m = morningSummary(today);
    notify(`morning:${today}`, m.title, m.body);
  }
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
  if (t.done) { const tm = getTimer(); if (tm && tm.taskId === id) cancelTimer(true); }
  const next = t.done ? spawnNextRepeat(t) : (unspawnRepeat(t), null);
  save();
  /* En el sitio: la fila no se mueve ni cambia de tamaño */
  $$(`[data-task="${id}"]`).forEach(li => {
    li.classList.toggle('done', t.done);
    const c = $('.check', li); if (c) c.checked = t.done;
    /* Pequeña animación al marcar (solo transformaciones: la fila no cambia de tamaño) */
    if (t.done) { li.classList.remove('just-done'); void li.offsetWidth; li.classList.add('just-done'); setTimeout(() => li.classList.remove('just-done'), 700); }
  });
  if (t.done) checkBurst(checkbox && checkbox.closest ? checkbox : $(`[data-task="${id}"] .check`));
  refreshLive();
  haptic();
  if (silent) return;
  if (t.done) {
    const msg = t.routineId ? `Hecha la del ${fmtShortDate(t.routineDate)}` : next ? `¡Hecho! La próxima: ${relDay(next.due).toLowerCase()}` : pick(['¡Hecho!', '¡Una menos!', '¡Bien! Sigue así.', '¡Genial!']);
    toast(msg, { action: 'Deshacer', onAction: () => toggleTask(id, null, { silent: true }) });
  }
}
/* v28: al completar, una onda y unas chispas salen del círculo. Va por encima de todo (posición fija),
   así que no mueve ni cambia de tamaño nada de la pantalla. Con «Reducir movimiento» no aparece. */
function checkBurst(anchor, big = false) {
  if (!anchor || reduceMotion()) return;
  const r = anchor.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  const n = big ? 10 : 8, r0 = big ? 30 : 10, r1 = big ? 64 : 24;
  const b = document.createElement('div');
  b.className = 'chk-burst' + (big ? ' big' : '');
  b.setAttribute('aria-hidden', 'true');
  b.style.left = (r.left + r.width / 2) + 'px'; b.style.top = (r.top + r.height / 2) + 'px';
  b.innerHTML = '<i class="ring-w"></i>' + Array.from({ length: n }, (_, i) => `<i class="spark" style="--a:${Math.round(i * 360 / n + 12)}deg;--r0:${r0}px;--r1:${i % 2 ? r1 * .8 : r1}px"></i>`).join('');
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 900);
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
    case 'focus-mode': setFocusPlan('mode', el.dataset.v); renderFocus(); return;
    case 'focus-plan-work': setFocusPlan('work', Number(el.dataset.v)); renderFocus(); return;
    case 'focus-plan-brk': setFocusPlan('brk', Number(el.dataset.v)); renderFocus(); return;
    case 'focus-plan-rounds': setFocusPlan('rounds', Number(el.dataset.v)); renderFocus(); return;
    case 'focus-start': focusAction('start'); return;
    case 'focus-pause': focusAction('pause'); return;
    case 'focus-resume': focusAction('resume'); return;
    case 'focus-reset': focusAction('reset'); return;
    case 'focus-pill': { const tm = getTimer(); if (tm && tm.taskId) openFocus(tm.taskId); return; }
    case 'focus-done': {
      const t = task(id);
      const tm = getTimer(); if (tm && tm.taskId === id) cancelTimer(true);
      if (!t.done) { checkBurst(el, true); toggleTask(id, null); }
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
    case 'fit-adjust': fitAdjustSheet(el.dataset.date); return;
    case 'ext-event': extEventSheet(id); return;
    case 'search': openSearch(); return;
    case 'copy-week': copyWeekSheet(el.dataset.ws); return;
    case 'cal-add': calendarModal(); return;
    case 'cal-edit': calendarModal((state.settings.calendars || []).find(c => c.id === id)); return;
    case 'cal-refresh': el.disabled = true; refreshCalendars(true).then(() => { toast('Calendarios actualizados'); rerender(); }); return;
    case 'journal': {
      const d = el.dataset.date, k = el.dataset.k, v = Number(el.dataset.v), j = journalOf(d);
      setJournal(d, { [k]: j && j[k] === v ? null : v });
      save(); haptic(6);
      const card = el.closest('[data-live="journal"]');
      if (card) {
        const tpl = document.createElement('template'); tpl.innerHTML = journalCard(d).trim();
        const fresh = tpl.content.firstElementChild, ta = $('.j-note', card);
        if (fresh) { fresh.querySelector('.j-note').value = ta ? ta.value : ''; card.replaceWith(fresh); }
      }
      return;
    }
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
      t.done = true; t.doneAt = Date.now(); save(); refreshLive(); haptic(); checkBurst(el);
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
      softSwap(); return;
    }
    case 'week': {
      const n = Number(el.dataset.n), mode = state.settings.ui.weekMode || '7';
      if (mode === '1') { viewDate = n === 0 ? todayStr() : addDays(viewDate, n); weekStart = startOfWeek(viewDate); }
      else { weekStart = n === 0 ? startOfWeek(todayStr()) : addDays(weekStart, 7 * n); if (n === 0) viewDate = todayStr(); }
      softSwap(); return;
    }
    case 'week-mode': {
      const v = el.dataset.v;
      if (v === '1' && !weekDays(weekStart).includes(viewDate)) viewDate = weekDays(weekStart).includes(todayStr()) ? todayStr() : weekStart;
      state.settings.ui.weekMode = v; save(); softSwap(); return;
    }
    case 'theme': setTheme(el.dataset.v, el.closest('.theme-seg')); return;
    case 'skin': setSkin(el.dataset.v, el.closest('.skin-grid')); return;
    case 'set-ui': {
      const k = el.dataset.k, v = el.dataset.v;
      state.settings.ui[k] = k === 'projectsArchived' ? !!v : v;
      save(); softSwap(); return;
    }
    case 'tasks-tab': state.settings.ui.tasksTab = el.dataset.v; save(); softSwap(); return;
    case 'new-project': newProjectSheet(); return;
    case 'tpl-pick': { const t = projectTemplateById(el.dataset.id); if (t) templatePreview(t); return; }
    case 'templates': templatesSheet(el.dataset.kind, { ws: el.dataset.ws || startOfWeek(todayStr()), projectId: id || null }); return;
    case 'trash-open': trashSheet(); return;
    case 'bulk-resched': bulkReschedSheet(); return;
    case 'propose-plan': proposeWeekPlan(reviewWeekStart()); return;
    case 'review-why': {
      const wp = state.weekPlans[el.dataset.ws] = state.weekPlans[el.dataset.ws] || { priorities: [] };
      wp.reasons = wp.reasons || {};
      wp.reasons[id] = wp.reasons[id] === el.dataset.v ? undefined : el.dataset.v;
      break;
    }
    case 'review-trash': deleteWithUndo('task', id); rerender(); return;
    case 'reserve-all': {
      const ws = reviewWeekStart(), we = addDays(ws, 6), from = todayStr() > ws ? todayStr() : ws;
      const ids = ((state.weekPlans[ws] || {}).priorities || []).filter(x => task(x) && !state.events.some(e => e.taskId === x && !e.recurrence && e.date >= ws && e.date <= we));
      let n = 0;
      const added = ids.map(x => { const t = task(x), s = findSlot(t.estimate || 60, from, we); n++; return scheduleTask(t, s.date, s.start, s.end).id; });
      save(); rerender();
      toast(n ? `Tiempo reservado para ${n} prioridad${n === 1 ? '' : 'es'}` : 'Todas tus prioridades ya tienen tiempo reservado', n ? { action: 'Deshacer', onAction: () => { state.events = state.events.filter(x => !added.includes(x.id)); save(); rerender(); } } : {});
      return;
    }
    case 'focus-full': toggleFocusFull(); return;
    case 'focus-rate': { const s = getSummary(); if (s) { s.rating = Number(el.dataset.v); setSummary(s); const log = state.focusLog.filter(f => f.taskId === s.taskId && f.date === s.date); log.forEach(f => { f.rating = s.rating; }); save(); renderFocus(); } return; }
    case 'focus-again': setSummary(null); renderFocus(); return;
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
    case 'sync-now': syncNow(true); return;
    case 'onboarding': startOnboarding(); return;
    case 'tour': startTour(); return;
    case 'tour-screens': resetTours(); setFlag(TOUR_KEY); toast('Verás de nuevo la explicación al entrar en cada pantalla'); return;
    case 'sign-out': if (!confirm('¿Cerrar sesión? Tus datos se quedan en este dispositivo y en tu cuenta.')) return; signOut().then(() => { toast('Sesión cerrada'); rerender(); }); return;
    case 'push-toggle':
      (pushActive() ? unsubscribePush().then(() => toast('Avisos push desactivados'))
        : subscribePush().then(ok => { if (ok) { state.settings.reminders.enabled = true; save(); toast('Te avisaré aunque la app esté cerrada'); } else toast('Sin permiso para avisar en este dispositivo'); }))
        .catch(err => toast('No se pudo: ' + err.message)).finally(rerender);
      return;
    case 'export': exportData(); return;
    case 'reset':
      if (!confirm('¿Seguro? Se borrarán todas tus tareas, proyectos y objetivos de este dispositivo.')) return;
      seedState(); setTimer(null); toast('Todo borrado'); break;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
    default: return;
  }
  save(); rerender();
});

document.addEventListener('keydown', e => {
  /* Atajos de teclado (ordenador): N nueva tarea, / o Ctrl+K buscar, F enfoque, H hoy, S semana */
  const typing = e.target.matches('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (!typing && !modal.open && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); openSearch(); return; }
    if (k === 'n') { e.preventDefault(); taskModal({ due: parseHash().name === 'hoy' ? viewDate : null }); return; }
    if (k === 'f') { e.preventDefault(); startFocusShortcut(); return; }
    if (k === 'h') { location.hash = '#hoy'; return; }
    if (k === 's') { location.hash = '#semana'; return; }
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.block[data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && !$('#focus').hidden && !modal.open) closeFocus();
  if (e.key === 'Enter' && e.target.dataset.input === 'first-step') e.target.blur();
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.act === 'focus-distraction') { e.preventDefault(); addDistraction(f); return; }
  if (f.dataset.act === 'login' || f.dataset.act === 'new-password') {
    e.preventDefault();
    const btns = [...f.querySelectorAll('button')]; btns.forEach(x => { x.disabled = true; });
    const how = (e.submitter && e.submitter.value) || 'in';
    const email = f.elements.email ? f.elements.email.value.trim() : '', pass = f.elements.password.value;
    let job;
    if (f.dataset.act === 'new-password') job = setNewPassword(pass).then(() => toast('Contraseña cambiada'));
    else if (how === 'reset') job = email ? sendPasswordReset(email) : Promise.reject(new Error('Escribe tu email arriba'));
    else if (pass.length < 6) job = Promise.reject(new Error('La contraseña debe tener al menos 6 caracteres'));
    else if (how === 'up') job = signUp(email, pass).then(ok => toast(ok ? '¡Cuenta creada! Tus datos ya se sincronizan.' : 'Mira tu email para confirmar la cuenta'));
    else job = signIn(email, pass).then(() => toast('¡Dentro! Tus datos ya se sincronizan.'));
    job.then(() => rerender(), err => { toast(err.message); btns.forEach(x => { x.disabled = false; }); });
    return;
  }
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
  const parsed = parseQuick(title);
  const t = addParsedTask(title, { due: f.dataset.due || null, projectId: f.dataset.project || null, goalId: f.dataset.goal || null });
  if (!t) return;
  save(); rerender();
  if (input.dataset.voiced) { delete input.dataset.voiced; voiceSavedToast(t, parsed.found); }
  else if (parsed.found.length) toast('Añadida · ' + parsed.found.join(' · '));
  const sel = Object.keys(f.dataset).filter(k => k !== 'act').map(k => `[data-${k}="${f.dataset[k]}"]`).join('');
  const again = $(`form[data-act="quick-add"]${sel} input[name=title]`);
  if (again) again.focus();
});

document.addEventListener('input', e => {
  const el = e.target, k = el.dataset.input;
  if (k === 'journal-note') { setJournal(el.dataset.date, { note: el.value }); clearTimeout(el._t); el._t = setTimeout(() => save(), 600); }
  if (k === 'quick') {
    const prev = el.form && el.form.nextElementSibling;
    if (prev && prev.classList.contains('qa-preview')) {
      const found = el.value.trim().length > 2 ? parseQuick(el.value).found : [];
      prev.innerHTML = foundChips(found);
      prev.classList.toggle('on', found.length > 0);
    }
  }
  if (k === 'first-step') { const t = task(el.dataset.id); if (t) { t.firstStep = el.value; save(); } }
  if (k === 'week-note') { const wp = state.weekPlans[el.dataset.ws] = state.weekPlans[el.dataset.ws] || { priorities: [] }; wp.note = el.value; clearTimeout(el._t); el._t = setTimeout(() => save(), 600); }
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
    if (path === 'focusMinutes') { focusMins = v; setFocusPlan('mode', 'single'); }
    save();
    if (path === 'reminders.enabled' && v && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission().then(p => {
        if (p !== 'granted') { state.settings.reminders.enabled = false; save(); toast('Sin permiso para avisar'); }
        else { toast('Recordatorios activados'); checkReminders(); if (getSession() && CFG.vapidPublicKey) subscribePush().then(() => rerender()).catch(err => toast('Avisos push: ' + err.message)); }
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
  if (created) save(true);
  return created || changed;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { save(true); focusNote(true); return; }
  closeFocusNote();
  { const s = getSummary(); if (s && !getTimer() && $('#focus').hidden && task(s.taskId) && Date.now() - s.at < 3 * 3600000) setTimeout(() => openFocus(s.taskId), 300); }
  if (modal.open) return;
  const fresh = loadState();
  if (fresh) state = fresh;
  onNewDayOrReturn();
  const typing = document.activeElement && document.activeElement.matches('input, textarea');
  if (!typing) rerender();
  checkReminders();
  syncNow();
});
window.addEventListener('pagehide', () => save(true));
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
const cameFromLogin = captureAuthRedirect();
state = loadState();
/* Dispositivo nuevo: sin datos guardados todavía */
const firstRun = !state;
/* Nueva versión: todos empiezan de cero (ajustes y cuenta se conservan) */
const wasReset = isOldEpoch(state);
if (wasReset) { state = resetForNewEpoch(state); setTimer(null); resetTours(); }
syncInfo.freshDevice = firstRun;
if (!state) { let demo = false; try { demo = localStorage.getItem('organizador.demo') === '1'; } catch { /* sin almacenamiento */ } if (demo) seedDemo(); else seedState(); }
generateRoutines();
purgeTrash();
save(true);
const pendingShortcut = ['nueva', 'enfoque', 'buscar'].includes(parseHash().name) ? parseHash().name : null;
if (pendingShortcut) history.replaceState(null, '', location.pathname + '#hoy');
route();
if (pendingShortcut) setTimeout(() => runShortcut(pendingShortcut), 50);
/* Bienvenida solo para quien es nuevo: sin datos, sin sesión y sin haberla visto */
if (firstRun && !getSession() && !cameFromLogin && !onboardingSeen()) startOnboarding();
else {
  if (!onboardingSeen()) markOnboarded();
  /* Tutorial de los primeros pasos: una vez, para nuevos y tras empezar de cero */
  if (!tourSeen() && !pendingShortcut) setTimeout(() => startTour(), 700);
  else if (!pendingShortcut) maybeScreenTour();
}
if (wasReset) { save(); toast('Nueva versión: empiezas con la app vacía. Tus ajustes y tu cuenta siguen igual.'); }
setTimeout(checkReminders, 2000);
refreshCalendars().then(changed => { if (changed && !modal.open) rerender(); }).catch(() => {});
if (cameFromLogin) firstSync().then(rerender).catch(e => toast(e.message)); else syncNow();
setInterval(() => { if (document.visibilityState === 'visible' && !modal.open) syncNow(); }, 120000);
