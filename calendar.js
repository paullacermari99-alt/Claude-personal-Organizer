/* P Organizer — calendario (vista Semana y agenda del día) y arrastrar y soltar.
   Se carga antes que app.js; usa sus funciones y datos cuando se ejecuta. */
'use strict';

let weekStart = null;            /* lunes de la semana visible (YYYY-MM-DD) */
let weekMode = (() => { try { return localStorage.getItem('organizador.weekMode') || '3'; } catch { return '3'; } })();
let suppressClickUntil = 0;      /* evita que un arrastre termine abriendo un formulario */
const SNAP = 15;                 /* minutos */
const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function startOfWeek(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; /* lunes = 0 */
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
function weekNumber(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
const fmtHM = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function colorOfBlock(b) {
  const p = b.projectId && project(b.projectId);
  const g = b.goalId && goal(b.goalId);
  return p ? p.color : g ? g.color : 'var(--accent)';
}

/* ---------- Vista: Semana ---------- */

function viewWeek() {
  if (!weekStart) weekStart = startOfWeek(viewDate || todayStr());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const first = parseYmd(days[0]), last = parseYmd(days[6]);
  const month = cap(first.toLocaleDateString('es-ES', { month: 'long' }));
  const range = first.getMonth() === last.getMonth()
    ? `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString('es-ES', { month: 'short' })}`
    : `${first.getDate()} ${first.toLocaleDateString('es-ES', { month: 'short' })} – ${last.getDate()} ${last.toLocaleDateString('es-ES', { month: 'short' })}`;
  const isThisWeek = days.includes(todayStr());
  const undated = sortTasks(state.tasks.filter(t => !t.done && !t.date));
  const weekTasks = state.tasks.filter(t => t.date && days.includes(t.date));
  const doneW = weekTasks.filter(t => t.done).length;

  return `
  <div class="page page-week">
  ${pageHead({
    eyebrow: `${first.getFullYear()} · Semana ${weekNumber(weekStart)} · ${range} · ${doneW}/${weekTasks.length} hechas`,
    title: esc(month),
    actions: `<button class="icon-btn round" data-act="week" data-n="-1" aria-label="Semana anterior">${I.left}</button>
      ${isThisWeek ? '' : `<button class="btn small" data-act="week" data-n="0">Hoy</button>`}
      <button class="icon-btn round" data-act="week" data-n="1" aria-label="Semana siguiente">${I.right}</button>`,
  })}
  <div class="week-layout">
    <aside class="tray glass" data-drop="tray">
      <div class="tray-head"><h2>Sin fecha · ${undated.length}</h2>
        <div class="segmented compact mobile-only" role="tablist">
          <button role="tab" class="${weekMode === '3' ? 'on' : ''}" data-act="week-mode" data-v="3">3 días</button>
          <button role="tab" class="${weekMode === '7' ? 'on' : ''}" data-act="week-mode" data-v="7">7 días</button>
        </div></div>
      <div class="tray-list">
        ${undated.length ? undated.map(t => taskChip(t)).join('') : `<div class="tray-empty">Todo planificado</div>`}
      </div>
      ${quickAdd({})}
    </aside>
    ${calendarGrid(days, { mode: weekMode })}
  </div>
  <p class="hint desktop-only">Arrastra tareas entre días o a una hora para reservarles tiempo. En el móvil, mantén pulsado para arrastrar. Toca un hueco para crear un bloque.</p>
  </div>`;
}

function taskChip(t) {
  const p = t.projectId && project(t.projectId);
  const c = p ? p.color : (goalOfTask(t) || {}).color || 'var(--muted)';
  return `<div class="chip ${t.done ? 'done' : ''} ${t.important ? 'imp' : ''}" data-task="${t.id}" data-drag="task" data-id="${t.id}" style="--c:${c}">
    <input type="checkbox" class="check sm" data-act="toggle-task" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Completar ${esc(t.title)}">
    <span class="chip-title" data-act="edit-task" data-id="${t.id}">${esc(t.title)}</span>
  </div>`;
}

/* Reparte los bloques que se solapan en carriles para que no se tapen */
function layoutEvents(blocks) {
  const evs = blocks.map(b => ({ b, s: toMin(b.start), e: Math.max(toMin(b.end), toMin(b.start) + 15) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
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
    const tasks = sortTasks(state.tasks.filter(t => t.date === d));
    return `<div class="cal-dayhead ${d === today ? 'is-today' : ''}" data-date="${d}">
      <button class="cal-dtitle" data-act="open-day" data-date="${d}"><span class="cal-dname">${DAY_NAMES[(dt.getDay() + 6) % 7]}</span><span class="cal-dnum">${dt.getDate()}</span></button>
      ${opts.compact ? '' : `<div class="cal-lane" data-drop="lane" data-date="${d}">${tasks.map(taskChip).join('')}</div>`}
    </div>`;
  }).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="cal-hour"><span>${h ? pad(h) + ':00' : ''}</span></div>`).join('');
  const cols = dates.map(d => {
    const evs = layoutEvents(state.blocks.filter(b => b.date === d));
    return `<div class="cal-col ${d === today ? 'is-today' : ''}" data-drop="col" data-date="${d}">
      ${evs.map(({ b, s, e, lane, n }) => {
        const t = b.taskId && task(b.taskId);
        const past = d < today || (d === today && e <= nowM);
        return `<div class="ev ${past ? 'past' : ''} ${t && t.done ? 'done' : ''} ${e - s <= 30 ? 'short' : ''}" data-drag="block" data-act="edit-block" data-id="${b.id}"
          style="--c:${colorOfBlock(b)};top:calc(var(--hour-h) * ${s / 60});height:calc(var(--hour-h) * ${(e - s) / 60} - 2px);left:calc(${lane / n * 100}% + 2px);width:calc(${100 / n}% - 4px)">
          <div class="ev-title">${esc(b.title)}</div>
          <div class="ev-time">${esc(b.start)}–${esc(b.end)}</div>
          <div class="ev-resize" data-drag="resize" data-id="${b.id}" aria-hidden="true"></div>
        </div>`;
      }).join('')}
      ${d === today ? `<div class="now-line" style="top:calc(var(--hour-h) * ${nowM / 60})"></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="cal-scroll glass ${opts.compact ? 'compact' : ''} mode-${opts.mode || '7'}" data-key="${dates[0]}:${dates.length}" style="--days:${dates.length}">
    <div class="cal-grid">
      <div class="cal-corner"></div>
      ${heads}
      <div class="cal-hours">${hours}</div>
      ${cols}
    </div>
  </div>`;
}

function hourHeight(scroller) {
  return parseFloat(getComputedStyle(scroller).getPropertyValue('--hour-h')) || 52;
}

/* Tras pintar: conserva la posición de scroll o va a la hora actual / hoy */
function afterRenderCalendar(keep) {
  const sc = $('.cal-scroll');
  if (!sc) return;
  if (keep && keep.key === sc.dataset.key) { sc.scrollTop = keep.top; sc.scrollLeft = keep.left; return; }
  const hh = hourHeight(sc);
  const todayCol = sc.querySelector('.cal-col.is-today');
  const startH = todayCol ? Math.max(0, new Date().getHours() - 1.5) : 7.5;
  sc.scrollTop = startH * hh;
  const target = todayCol || sc.querySelector('.cal-col');
  if (target && sc.scrollWidth > sc.clientWidth) {
    const gutter = sc.querySelector('.cal-hours').offsetWidth;
    sc.scrollLeft = Math.max(0, target.offsetLeft - gutter);
  }
}

/* Mueve la línea de «ahora» y el estado de los bloques sin repintar */
function refreshNowLine() {
  const m = toMin(nowHHMM());
  $$('.now-line').forEach(el => { el.style.top = `calc(var(--hour-h) * ${m / 60})`; });
}

/* Tocar un hueco del calendario crea un bloque a esa hora */
document.addEventListener('click', e => {
  if (Date.now() < suppressClickUntil) return;
  const col = e.target.closest('.cal-col');
  if (col && e.target === col) {
    const sc = col.closest('.cal-scroll');
    const y = e.clientY - col.getBoundingClientRect().top;
    const m = clamp(Math.floor(y / hourHeight(sc) * 60 / 30) * 30, 0, 23 * 60);
    blockModal({ date: col.dataset.date, start: fmtHM(m), end: fmtHM(Math.min(m + 60, 24 * 60 - 1)) });
    return;
  }
  const open = e.target.closest('[data-act="open-day"]');
  if (open) { viewDate = open.dataset.date; location.hash = '#hoy'; }
});

/* ---------- Arrastrar y soltar (ratón y táctil) ---------- */

let pending = null;   /* pulsación que aún no es arrastre */
let drag = null;      /* arrastre en curso */
let lastPt = { x: 0, y: 0 };

document.addEventListener('pointerdown', e => {
  if ((e.pointerType === 'mouse' && e.button !== 0) || drag) return;
  const handle = e.target.closest('[data-drag]');
  if (!handle) return;
  const kind = handle.dataset.drag;
  if (kind !== 'resize' && e.target.closest('input, button, select, textarea, a')) return;
  /* En el móvil las filas de tareas usan deslizar; se arrastran solo con ratón */
  if (kind === 'task' && handle.matches('li.task') && e.pointerType !== 'mouse') return;
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
  else if (dist > 10) cancelPending(); /* el dedo se movió: es un scroll */
}, { passive: false });

document.addEventListener('pointerup', () => { if (drag) endDrag(true); else cancelPending(); });
document.addEventListener('pointercancel', () => { if (drag) endDrag(false); else cancelPending(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) endDrag(false); });
/* Mientras se arrastra con el dedo, la página no debe desplazarse */
document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (drag || pending) e.preventDefault(); });

function cancelPending() { if (pending) { clearTimeout(pending.timer); pending = null; } }

function startDrag(p) {
  clearTimeout(p.timer);
  pending = null;
  const rect = p.el.getBoundingClientRect();
  drag = { ...p, rect, grabY: p.y0 - rect.top, target: null };
  document.body.classList.add('dragging');
  if (p.kind === 'resize') {
    const b = byId(state.blocks, p.id);
    drag.block = b; drag.s = toMin(b.start); drag.e0 = toMin(b.end);
    p.el.classList.add('resizing');
    return;
  }
  p.el.classList.add('drag-source');
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost glass';
  ghost.style.setProperty('--c', getComputedStyle(p.el).getPropertyValue('--c') || 'var(--accent)');
  if (p.kind === 'block') {
    const b = byId(state.blocks, p.id);
    drag.block = b; drag.dur = Math.max(toMin(b.end) - toMin(b.start), 15);
    ghost.textContent = b.title;
  } else {
    const t = task(p.id);
    drag.task = t; drag.dur = 60; drag.grabY = 12;
    ghost.textContent = t.title;
  }
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  moveDrag();
  autoScrollLoop();
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest('[data-drop]');
}

function clearPreview() {
  if (drag.preview) { drag.preview.remove(); drag.preview = null; }
  $$('.drop-over').forEach(el => el.classList.remove('drop-over'));
}

function moveDrag() {
  const { x, y } = lastPt;
  if (drag.kind === 'resize') {
    const sc = drag.el.closest('.cal-scroll');
    const col = drag.el.closest('.cal-col');
    const hh = hourHeight(sc);
    const m = (y - col.getBoundingClientRect().top) / hh * 60;
    drag.e = clamp(Math.round(m / SNAP) * SNAP, drag.s + SNAP, 24 * 60 - 1);
    drag.el.style.height = `calc(var(--hour-h) * ${(drag.e - drag.s) / 60} - 2px)`;
    $('.ev-time', drag.el).textContent = `${fmtHM(drag.s)}–${fmtHM(drag.e)}`;
    drag.sc = sc;
    return;
  }
  drag.ghost.style.transform = `translate(${x - 14}px, ${y - 18}px)`;
  const target = dropTargetAt(x, y);
  clearPreview();
  drag.target = null;
  if (!target) return;
  const kind = target.dataset.drop;
  if (kind === 'col') {
    const sc = target.closest('.cal-scroll');
    drag.sc = sc;
    const hh = hourHeight(sc);
    let m = (y - drag.grabY - target.getBoundingClientRect().top) / hh * 60;
    m = clamp(Math.round(m / SNAP) * SNAP, 0, 24 * 60 - drag.dur);
    const pv = document.createElement('div');
    pv.className = 'ev preview';
    pv.style.cssText = `--c:${drag.ghost.style.getPropertyValue('--c')};top:calc(var(--hour-h) * ${m / 60});height:calc(var(--hour-h) * ${drag.dur / 60} - 2px);left:2px;width:calc(100% - 4px)`;
    pv.innerHTML = `<div class="ev-time">${fmtHM(m)}–${fmtHM(Math.min(m + drag.dur, 24 * 60 - 1))}</div>`;
    target.appendChild(pv);
    drag.preview = pv;
    drag.target = { kind, date: target.dataset.date, m };
  } else if ((kind === 'lane' || kind === 'tray') && drag.kind === 'task') {
    target.classList.add('drop-over');
    drag.sc = target.closest('.cal-scroll');
    drag.target = { kind, date: target.dataset.date || null };
  }
}

/* Desplaza el calendario cuando arrastras cerca de un borde */
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
  let msg = '';
  if (d.kind === 'resize') {
    if (d.e) { d.block.end = fmtHM(d.e); msg = `Hasta las ${d.block.end}`; }
  } else if (d.target) {
    const tg = d.target;
    if (d.kind === 'block' && tg.kind === 'col') {
      d.block.date = tg.date; d.block.start = fmtHM(tg.m); d.block.end = fmtHM(Math.min(tg.m + d.dur, 24 * 60 - 1));
      msg = `${relDay(tg.date)}, ${d.block.start}`;
    } else if (d.kind === 'task' && tg.kind === 'col') {
      const t = d.task;
      t.date = tg.date;
      state.blocks.push({ id: uid(), title: t.title, date: tg.date, start: fmtHM(tg.m), end: fmtHM(Math.min(tg.m + d.dur, 24 * 60 - 1)), projectId: t.projectId || null, goalId: t.goalId || null, taskId: t.id });
      msg = `Tiempo reservado: ${relDay(tg.date).toLowerCase()} a las ${fmtHM(tg.m)}`;
    } else if (d.kind === 'task' && tg.kind === 'lane') {
      d.task.date = tg.date; msg = `Movida a ${relDay(tg.date).toLowerCase()}`;
    } else if (d.kind === 'task' && tg.kind === 'tray') {
      d.task.date = null; msg = 'Sin fecha';
    }
  }
  if (msg) { save(); haptic(10); toast(msg); }
  rerender();
}
