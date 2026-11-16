/* P Organizer — Semana: vistas de semana y día, horarios, arrastrar y soltar. */
'use strict';

let weekStart = null;            /* primer día de la semana visible */
let suppressClickUntil = 0;      /* evita que un arrastre termine abriendo un formulario */
const SNAP = 15;                 /* minutos */

function weekNumber(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/* ---------- Vista: Semana ---------- */

function viewWeek() {
  const mode = state.settings.ui.weekMode || '7';
  if (!weekStart) weekStart = startOfWeek(viewDate || todayStr());
  const days = weekDays(weekStart);
  const shown = mode === '1' ? [viewDate] : days;
  const today = todayStr();
  const first = parseYmd(days[0]), last = parseYmd(days[6]);
  const range = `${first.getDate()} ${first.toLocaleDateString('es-ES', { month: 'short' })} – ${last.getDate()} ${last.toLocaleDateString('es-ES', { month: 'short' })}`;
  const title = mode === '1' ? cap(parseYmd(viewDate).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })) : cap(first.toLocaleDateString('es-ES', { month: 'long' }));
  const isCurrent = mode === '1' ? viewDate === today : days.includes(today);
  const reviewed = state.settings.ui.lastReview === startOfWeek(today);

  /* Panel lateral: tareas de la semana sin hora, plazos cercanos y bandeja */
  const open = state.tasks.filter(t => !t.done && !isRoutineTask(t));
  const soon = open.filter(t => t.due && t.due >= today && daysBetween(today, t.due) <= 14).sort(sortByDue);
  const soonGoals = state.goals.filter(g => goalStatus(g) === 'activo' && g.due && daysBetween(today, g.due) <= 30).sort(sortByDue);
  const unscheduled = open.filter(t => t.due && t.due >= days[0] && t.due <= days[6] && !hasBlockInRange(t.id, days[0], days[6])).sort(sortByDue);
  const inbox = open.filter(t => !t.due && !t.projectId && !t.goalId && !blocksOfTask(t.id).length);
  const wp = state.weekPlans[weekStart];
  const weekPrios = ((wp && wp.priorities) || []).map(task).filter(t => t && !t.done);

  return `
  <div class="page page-week">
  ${pageHead({
    eyebrow: `${first.getFullYear()} · Semana ${weekNumber(weekStart)} · ${range}`,
    title: esc(title),
    actions: `${isCurrent ? '' : `<button class="btn small" data-act="week" data-n="0">Hoy</button>`}
      <button class="icon-btn round" data-act="week" data-n="-1" aria-label="Anterior">${I.left}</button>
      <button class="icon-btn round" data-act="week" data-n="1" aria-label="Siguiente">${I.right}</button>`,
  })}
  <div class="week-toolbar">
    <div class="segmented compact" role="tablist" aria-label="Vista">
      <button role="tab" class="${mode === '1' ? 'on' : ''}" data-act="week-mode" data-v="1">Día</button>
      <button role="tab" class="${mode === '3' ? 'on' : ''} mobile-only-inline" data-act="week-mode" data-v="3">3 días</button>
      <button role="tab" class="${mode === '7' ? 'on' : ''}" data-act="week-mode" data-v="7">Semana</button>
    </div>
    <div class="toolbar-right">
      <a class="btn small ${reviewed ? '' : 'attention'}" href="#revision">${I.review}<span>Revisión${reviewed ? ' ✓' : ''}</span></a>
      <button class="btn small" data-act="new-event">${I.plus}<span>Evento</span></button>
    </div>
  </div>
  <div class="week-layout">
    <aside class="tray glass" data-drop="tray">
      ${weekPrios.length ? traySection('Prioridades de la semana', weekPrios, '') : ''}
      ${traySection('Sin hora esta semana', unscheduled, 'Todo tiene su hueco')}
      ${traySection('Plazos cercanos', soon, 'Nada vence pronto', soonGoals)}
      ${traySection('Bandeja', inbox, 'Bandeja vacía')}
    </aside>
    ${calendarGrid(shown, { mode })}
  </div>
  <p class="hint desktop-only">Arrastra una tarea a una hora para reservarle tiempo (su plazo no cambia). Arrástrala a la cabecera de otro día para cambiar su plazo. Mueve o estira los bloques. Toca un hueco para crear un evento.</p>
  </div>`;
}

function traySection(title, tasks, empty, goals = []) {
  return `<div class="tray-sec">
    <div class="tray-head"><h2>${title} · ${tasks.length + goals.length}</h2></div>
    <div class="tray-list">
      ${tasks.map(t => taskChip(t, true)).join('')}
      ${goals.map(g => `<a class="chip goal-chip" href="#objetivo/${g.id}" style="--c:${g.color}">${I.target}<span class="chip-title">${esc(g.title)}</span><span class="chip-due">${esc(relDay(g.due))}</span></a>`).join('')}
      ${tasks.length + goals.length ? '' : `<div class="tray-empty">${empty}</div>`}
    </div>
  </div>`;
}

function taskChip(t, showDue) {
  return `<div class="chip ${t.done ? 'done' : ''} ${isOverdue(t) ? 'late' : ''}" data-task="${t.id}" data-drag="task" data-id="${t.id}" style="--c:${colorOfTask(t)}">
    <input type="checkbox" class="check sm" data-act="toggle-task" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Completar ${esc(t.title)}">
    <span class="chip-title" data-act="edit-task" data-id="${t.id}">${t.priority === 'high' ? '❗' : ''}${esc(t.title)}</span>
    ${showDue && t.due ? `<span class="chip-due">${esc(relDay(t.due))}</span>` : ''}
  </div>`;
}

/* Reparte los bloques que se solapan en carriles para que no se tapen */
function layoutEvents(evs0) {
  const evs = evs0.map(b => ({ b, s: toMin(b.start), e: Math.max(toMin(b.end), toMin(b.start) + 15) })).sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], clusterEnd = -1;
  const flush = () => { const n = Math.max(...cluster.map(x => x.lane)) + 1; cluster.forEach(x => { x.n = n; }); cluster = []; };
  for (const ev of evs) {
    if (cluster.length && ev.s >= clusterEnd) flush();
    const used = new Set(cluster.filter(x => x.e > ev.s).map(x => x.lane));
    let lane = 0; while (used.has(lane)) lane++;
    ev.lane = lane; cluster.push(ev); clusterEnd = Math.max(clusterEnd, ev.e);
  }
  if (cluster.length) flush();
  return evs;
}

function calendarGrid(dates, opts = {}) {
  const today = todayStr();
  const nowM = toMin(nowHHMM());
  const heads = dates.map(d => {
    const dt = parseYmd(d);
    const due = state.tasks.filter(t => t.due === d && !isRoutineTask(t)).sort(sortByDue);
    return `<div class="cal-dayhead ${d === today ? 'is-today' : ''}" data-date="${d}">
      <button class="cal-dtitle" data-act="open-day" data-date="${d}"><span class="cal-dname">${DOW_SHORT[dt.getDay()]}</span><span class="cal-dnum">${dt.getDate()}</span></button>
      ${opts.compact ? '' : `<div class="cal-lane" data-drop="lane" data-date="${d}" title="Plazos de este día">${due.map(t => taskChip(t)).join('')}</div>`}
    </div>`;
  }).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="cal-hour"><span>${h ? pad(h) + ':00' : ''}</span></div>`).join('');
  const cols = dates.map(d => {
    const clash = overlapIds(d);
    const evs = layoutEvents(eventsOn(d));
    return `<div class="cal-col ${d === today ? 'is-today' : ''}" data-drop="col" data-date="${d}">
      ${evs.map(({ b, s, e, lane, n }) => {
        const t = b.taskId && task(b.taskId);
        const past = d < today || (d === today && e <= nowM);
        return `<div class="ev ${past ? 'past' : ''} ${t && t.done ? 'done' : ''} ${e - s <= 30 ? 'short' : ''} ${clash.has(b.id) ? 'clash' : ''}" data-drag="block" data-act="edit-event" data-id="${b.id}"
          style="--c:${colorOfEvent(b)};top:calc(var(--hour-h) * ${s / 60});height:calc(var(--hour-h) * ${(e - s) / 60} - 2px);left:calc(${lane / n * 100}% + 2px);width:calc(${100 / n}% - 4px)">
          <div class="ev-title">${clash.has(b.id) ? '<span class="ev-warn" title="Se solapa con otro bloque">⚠</span>' : ''}${b.recurrence ? '<span class="ev-rep" title="Se repite">↻</span>' : ''}${t ? '<span class="ev-task" title="Tiempo reservado para una tarea">☑</span>' : ''}${esc(b.title)}</div>
          <div class="ev-time">${esc(b.start)}–${esc(b.end)}${t && t.due ? ` · plazo ${esc(relDay(t.due).toLowerCase())}` : ''}</div>
          <div class="ev-resize" data-drag="resize" data-id="${b.id}" aria-hidden="true"></div>
        </div>`;
      }).join('')}
      ${d === today ? `<div class="now-line" style="top:calc(var(--hour-h) * ${nowM / 60})"></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="cal-scroll glass ${opts.compact || dates.length === 1 ? 'compact' : ''} mode-${opts.mode || '7'}" data-key="${dates[0]}:${dates.length}" style="--days:${dates.length}">
    <div class="cal-grid">
      <div class="cal-corner"></div>
      ${heads}
      <div class="cal-hours">${hours}</div>
      ${cols}
    </div>
  </div>`;
}

function hourHeight(scroller) { return parseFloat(getComputedStyle(scroller).getPropertyValue('--hour-h')) || 52; }

/* Tras pintar: conserva la posición de scroll o va a la hora actual / hoy */
function afterRenderCalendar(keep) {
  const sc = $('.cal-scroll');
  if (!sc) return;
  if (keep && keep.key === sc.dataset.key) { sc.scrollTop = keep.top; sc.scrollLeft = keep.left; return; }
  const hh = hourHeight(sc);
  const todayCol = sc.querySelector('.cal-col.is-today');
  sc.scrollTop = (todayCol ? Math.max(0, toMin(nowHHMM()) / 60 - 1.5) : 7.5) * hh;
  const target = todayCol || sc.querySelector('.cal-col');
  if (target && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, target.offsetLeft - sc.querySelector('.cal-hours').offsetWidth);
}
function refreshNowLine() {
  const m = toMin(nowHHMM());
  $$('.now-line').forEach(el => { el.style.top = `calc(var(--hour-h) * ${m / 60})`; });
}

/* Tocar un hueco crea un evento a esa hora */
document.addEventListener('click', e => {
  if (Date.now() < suppressClickUntil) return;
  const col = e.target.closest('.cal-col');
  if (col && e.target === col) {
    const y = e.clientY - col.getBoundingClientRect().top;
    const m = clamp(Math.floor(y / hourHeight(col.closest('.cal-scroll')) * 60 / 30) * 30, 0, 23 * 60);
    eventModal({ date: col.dataset.date, start: fmtHM(m), end: fmtHM(Math.min(m + 60, 24 * 60 - 1)) });
    return;
  }
  const open = e.target.closest('[data-act="open-day"]');
  if (open) {
    viewDate = open.dataset.date;
    if (location.hash.startsWith('#semana')) { state.settings.ui.weekMode = '1'; save(); route(); } else location.hash = '#hoy';
  }
});

/* ---------- Mover eventos ---------- */

/* Mueve un evento a otra fecha/hora. En un horario recurrente mueve solo esa vez. */
function moveEvent(id, date, start, end) {
  const [sid, occ] = String(id).split('@');
  const e = byId(state.events, sid);
  if (!e) return null;
  if (occ && e.recurrence) {
    e.exceptions = [...(e.exceptions || []), occ];
    const copy = { ...e, id: uid(), date, start, end, recurrence: null, exceptions: [] };
    delete copy.seriesId;
    state.events.push(copy);
    return copy;
  }
  Object.assign(e, { date, start, end });
  return e;
}
function warnOverlap(ev) {
  const o = overlapsWith(ev.date, ev.start, ev.end, ev.id);
  if (o.length) toast(`⚠ Se solapa con «${o[0].title}»${o.length > 1 ? ` y ${o.length - 1} más` : ''}`);
  return o.length > 0;
}
/* Reserva tiempo para una tarea (crea un bloque vinculado; el plazo no cambia) */
function scheduleTask(t, date, start, end) {
  const ev = { id: uid(), title: t.title, date, start, end, taskId: t.id, color: null, tagId: null, projectId: null, goalId: null, recurrence: null, exceptions: [] };
  state.events.push(ev);
  return ev;
}

/* ---------- Arrastrar y soltar (ratón y táctil) ---------- */

let pending = null, drag = null, lastPt = { x: 0, y: 0 };

document.addEventListener('pointerdown', e => {
  if ((e.pointerType === 'mouse' && e.button !== 0) || drag) return;
  const handle = e.target.closest('[data-drag]');
  if (!handle) return;
  const kind = handle.dataset.drag;
  if (kind !== 'resize' && e.target.closest('input, button, select, textarea')) return;
  if (kind === 'task' && handle.matches('li.task') && e.pointerType !== 'mouse') return; /* en móvil las filas se deslizan */
  const el = kind === 'resize' ? handle.closest('.ev') : handle;
  lastPt = { x: e.clientX, y: e.clientY };
  pending = { kind, id: el.dataset.id, el, x0: e.clientX, y0: e.clientY, type: e.pointerType };
  if (kind === 'resize') { e.preventDefault(); startDrag(pending); return; }
  if (e.pointerType !== 'mouse') {
    const p = pending;
    p.timer = setTimeout(() => { if (pending === p) { startDrag(p); haptic(12); } }, 300);
  }
});
document.addEventListener('pointermove', e => {
  lastPt = { x: e.clientX, y: e.clientY };
  if (drag) { e.preventDefault(); moveDrag(); return; }
  if (!pending) return;
  const dist = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0);
  if (pending.type === 'mouse') { if (dist > 5) startDrag(pending); }
  else if (dist > 10) cancelPending();
}, { passive: false });
document.addEventListener('pointerup', () => { if (drag) endDrag(true); else cancelPending(); });
document.addEventListener('pointercancel', () => { if (drag) endDrag(false); else cancelPending(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) endDrag(false); });
document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (drag || pending) e.preventDefault(); });
function cancelPending() { if (pending) { clearTimeout(pending.timer); pending = null; } }

function eventById(id) {
  const [sid, occ] = String(id).split('@');
  const e = byId(state.events, sid);
  return e && occ ? { ...e, date: occ, id } : e;
}

function startDrag(p) {
  clearTimeout(p.timer);
  pending = null;
  const rect = p.el.getBoundingClientRect();
  drag = { ...p, rect, grabY: p.y0 - rect.top, target: null };
  document.body.classList.add('dragging');
  if (p.kind === 'resize') {
    const ev = eventById(p.id);
    drag.ev = ev; drag.s = toMin(ev.start);
    p.el.classList.add('resizing');
    return;
  }
  p.el.classList.add('drag-source');
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost glass';
  ghost.style.setProperty('--c', p.el.style.getPropertyValue('--c') || 'var(--accent)');
  if (p.kind === 'block') {
    const ev = eventById(p.id);
    drag.ev = ev; drag.dur = Math.max(toMin(ev.end) - toMin(ev.start), 15);
    ghost.textContent = ev.title;
  } else {
    const t = task(p.id);
    drag.task = t; drag.dur = t.estimate || 60; drag.grabY = 12;
    ghost.textContent = t.title;
  }
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  moveDrag();
  autoScrollLoop();
}

function clearPreview() {
  if (drag.preview) { drag.preview.remove(); drag.preview = null; }
  $$('.drop-over').forEach(el => el.classList.remove('drop-over'));
}

function moveDrag() {
  const { x, y } = lastPt;
  if (drag.kind === 'resize') {
    const sc = drag.el.closest('.cal-scroll'), col = drag.el.closest('.cal-col');
    const m = (y - col.getBoundingClientRect().top) / hourHeight(sc) * 60;
    drag.e = clamp(Math.round(m / SNAP) * SNAP, drag.s + SNAP, 24 * 60 - 1);
    drag.el.style.height = `calc(var(--hour-h) * ${(drag.e - drag.s) / 60} - 2px)`;
    $('.ev-time', drag.el).textContent = `${fmtHM(drag.s)}–${fmtHM(drag.e)}`;
    drag.sc = sc;
    return;
  }
  drag.ghost.style.transform = `translate(${x - 14}px, ${y - 18}px)`;
  const el = document.elementFromPoint(x, y);
  const target = el && el.closest('[data-drop]');
  clearPreview();
  drag.target = null;
  if (!target) return;
  const kind = target.dataset.drop;
  if (kind === 'col') {
    const sc = target.closest('.cal-scroll');
    drag.sc = sc;
    let m = (y - drag.grabY - target.getBoundingClientRect().top) / hourHeight(sc) * 60;
    m = clamp(Math.round(m / SNAP) * SNAP, 0, 24 * 60 - drag.dur);
    const end = Math.min(m + drag.dur, 24 * 60 - 1);
    const clash = overlapsWith(target.dataset.date, fmtHM(m), fmtHM(end), drag.ev ? drag.ev.id : null).length > 0;
    const pv = document.createElement('div');
    pv.className = `ev preview ${clash ? 'clash' : ''}`;
    pv.style.cssText = `--c:${drag.ghost.style.getPropertyValue('--c')};top:calc(var(--hour-h) * ${m / 60});height:calc(var(--hour-h) * ${drag.dur / 60} - 2px);left:2px;width:calc(100% - 4px)`;
    pv.innerHTML = `<div class="ev-time">${clash ? '⚠ ' : ''}${fmtHM(m)}–${fmtHM(end)}</div>`;
    target.appendChild(pv);
    drag.preview = pv;
    drag.target = { kind, date: target.dataset.date, m };
  } else if ((kind === 'lane' || kind === 'tray') && drag.kind === 'task') {
    target.classList.add('drop-over');
    drag.sc = target.closest('.cal-scroll');
    drag.target = { kind, date: target.dataset.date || null };
  }
}

function autoScrollLoop() {
  if (!drag) return;
  const sc = drag.sc || $('.cal-scroll');
  if (sc) {
    const r = sc.getBoundingClientRect(), { x, y } = lastPt, edge = 48, step = 14;
    let dx = 0, dy = 0;
    if (y < r.top + edge && y > r.top - 20) dy = -step; else if (y > r.bottom - edge && y < r.bottom + 20) dy = step;
    if (x < r.left + edge + 40 && x > r.left) dx = -step; else if (x > r.right - edge && x < r.right + 20) dx = step;
    if (dx || dy) { sc.scrollBy(dx, dy); moveDrag(); }
  }
  requestAnimationFrame(autoScrollLoop);
}

function endDrag(commit) {
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging');
  suppressClickUntil = Date.now() + 350;
  if (d.ghost) d.ghost.remove();
  if (d.preview) d.preview.remove();
  $$('.drop-over').forEach(el => el.classList.remove('drop-over'));
  d.el.classList.remove('drag-source', 'resizing');
  if (!commit) { rerender(); return; }
  let msg = '', moved = null;
  if (d.kind === 'resize') {
    if (d.e) { moved = moveEvent(d.ev.id, d.ev.date, d.ev.start, fmtHM(d.e)); msg = `Hasta las ${fmtHM(d.e)}`; }
  } else if (d.target) {
    const tg = d.target;
    if (d.kind === 'block' && tg.kind === 'col') {
      moved = moveEvent(d.ev.id, tg.date, fmtHM(tg.m), fmtHM(Math.min(tg.m + d.dur, 24 * 60 - 1)));
      const t = moved.taskId && task(moved.taskId);
      msg = `${relDay(tg.date)}, ${moved.start}${t && t.due ? ` · el plazo sigue siendo ${relDay(t.due).toLowerCase()}` : ''}`;
    } else if (d.kind === 'task' && tg.kind === 'col') {
      moved = scheduleTask(d.task, tg.date, fmtHM(tg.m), fmtHM(Math.min(tg.m + d.dur, 24 * 60 - 1)));
      msg = `Tiempo reservado: ${relDay(tg.date).toLowerCase()} a las ${fmtHM(tg.m)}`;
    } else if (d.kind === 'task' && tg.kind === 'lane') {
      d.task.due = tg.date; msg = `Plazo: ${relDay(tg.date).toLowerCase()}`;
    } else if (d.kind === 'task' && tg.kind === 'tray') {
      d.task.due = null; msg = 'Sin plazo';
    }
  }
  if (msg) {
    save(); haptic(10);
    if (!(moved && warnOverlap(moved))) toast(msg);
  }
  rerender();
}
