/* Boldup — Planificar el día por horas (v27).
   Arriba, las tareas del día sin hora; abajo, el horario. Se colocan arrastrando (mantener pulsado en el móvil)
   o tocando la tarea y luego la hora. Colocar crea un bloque vinculado: el plazo de la tarea no cambia. */
'use strict';

let planPickId = null;   /* tarea elegida para colocar con dos toques */
const planDur = t => Math.max(15, t.estimate || 30);

function planCandidates(d) {
  const today = todayStr();
  const placed = new Set(eventsOn(d).filter(e => e.taskId).map(e => e.taskId));
  const prios = dayPriorities(d).map(task).filter(t => t && !t.done);
  const seen = new Set();
  const out = [];
  const add = (t, why) => { if (!t || t.done || seen.has(t.id) || placed.has(t.id) || isRoutineTask(t)) return; seen.add(t.id); out.push({ t, why }); };
  prios.forEach(t => add(t, 'prio'));
  state.tasks.filter(t => t.due === d).sort(stable).forEach(t => add(t, 'day'));
  if (d === today) state.tasks.filter(t => t.due && t.due < d).sort(sortByDue).forEach(t => add(t, 'late'));
  return out;
}

function planChip(t, why) {
  const dur = planDur(t);
  return `<div class="chip plan-chip ${planPickId === t.id ? 'picked' : ''} ${why === 'late' ? 'late' : ''}" data-drag="task" data-id="${t.id}" data-act="plan-pick" role="button" tabindex="0" style="--c:${colorOfTask(t)}" aria-pressed="${planPickId === t.id}">
    ${why === 'prio' ? '<span class="pc-star">★</span>' : ''}<span class="chip-title">${esc(t.title)}</span><span class="chip-due">${durLabel(t.estimate || 30)}</span>
  </div>`;
}

function viewPlanDay() {
  const d = viewDate, today = todayStr();
  const cands = planCandidates(d);
  if (planPickId && !cands.some(c => c.t.id === planPickId)) planPickId = null;
  const placed = eventsOn(d).filter(e => e.taskId && task(e.taskId));
  const needMin = cands.reduce((a, c) => a + planDur(c.t), 0);
  const [d0, d1] = dayBounds();
  const from = d === today ? Math.max(d0, toMin(nowHHMM())) : d0;
  const freeMin = Math.max(0, d1 - from - busyOn(d).reduce((a, [s, e]) => a + Math.max(0, Math.min(e, d1) - Math.max(s, from)), 0));
  const weekday = cap(dtf('es-ES', { weekday: 'long' }).format(parseYmd(d)));
  return `
  <div class="page page-plan">
  ${pageHead({
    eyebrow: backLink('#hoy', 'Hoy'),
    title: `Planificar ${d === today ? 'hoy' : esc(relDay(d).toLowerCase())}`,
    actions: `<button class="icon-btn round" data-act="day" data-n="-1" aria-label="Día anterior">${I.left}</button>
      ${d === today ? '' : `<button class="btn small" data-act="day" data-n="0">Hoy</button>`}
      <button class="icon-btn round" data-act="day" data-n="1" aria-label="Día siguiente">${I.right}</button>`,
  })}
  <div class="plan-layout">
    <aside class="plan-tray glass" data-drop="tray-plan">
      <div class="plan-tray-head">
        <h2>Por colocar · ${cands.length}</h2>
        ${cands.length ? `<button class="btn small" data-act="plan-auto">${I.star}<span>Colocar solas</span></button>` : ''}
      </div>
      ${cands.length ? `<div class="plan-chips">${cands.map(c => planChip(c.t, c.why)).join('')}</div>`
        : `<div class="tray-empty">${placed.length ? 'Todo tiene su hora. ✓' : `No hay tareas para ${d === today ? 'hoy' : 'este día'}.`} <button class="btn small ghost" data-act="new-task" data-due="${d}">${I.plus}<span>Tarea</span></button></div>`}
      <div class="plan-msg small ${planPickId ? 'on' : ''}" aria-live="polite">${planPickId ? `Ahora toca una hora del horario para «${esc((task(planPickId) || {}).title || '')}».` : cands.length ? (isPhone() ? 'Toca una tarea y después la hora. También puedes mantenerla pulsada y arrastrarla.' : 'Arrastra una tarea a una hora, o haz clic en ella y luego en la hora.') : ''}</div>
      <div class="plan-sum small muted">${weekday} · ${durLabel(needMin || 0)} por colocar · ${durLabel(Math.max(0, freeMin))} libres${needMin > freeMin && cands.length ? ' · <span class="warn-text">no cabe todo</span>' : ''}</div>
      ${(state.settings.calendars || []).length ? '' : `<button class="btn small ghost plan-gcal" data-act="cal-add">${I.cal}<span>Ver aquí mis citas de Google Calendar</span></button>`}
    </aside>
    ${calendarGrid([d], { compact: true, mode: '1', phone: isPhone() })}
  </div>
  <p class="hint">Colocar una tarea le reserva tiempo; su plazo no cambia. Toca un bloque para cambiarlo o quitarlo, o arrástralo para moverlo.</p>
  </div>`;
}

function planPick(id) {
  planPickId = planPickId === id ? null : id;
  haptic(6);
  $$('.plan-chip').forEach(c => { const on = c.dataset.id === planPickId; c.classList.toggle('picked', on); c.setAttribute('aria-pressed', String(on)); });
  const msg = $('.plan-msg');
  const t = planPickId && task(planPickId);
  if (msg) { msg.textContent = t ? `Ahora toca una hora del horario para «${t.title}».` : (isPhone() ? 'Toca una tarea y después la hora. También puedes mantenerla pulsada y arrastrarla.' : 'Arrastra una tarea a una hora, o haz clic en ella y luego en la hora.'); msg.classList.toggle('on', !!t); }
  document.body.classList.toggle('plan-picking', !!t);
}

function planAuto() {
  const d = viewDate, created = [];
  let missing = 0;
  for (const { t } of planCandidates(d)) {
    const slot = nextFreeSlot(d, planDur(t));
    if (!slot) { missing++; continue; }
    created.push(scheduleTask(t, d, slot.start, slot.end).id);
  }
  planPickId = null; document.body.classList.remove('plan-picking');
  if (!created.length) { toast('No quedan huecos libres en tu jornada'); return; }
  save(); rerender(); haptic(10);
  toast(`${created.length} colocada${created.length === 1 ? '' : 's'}${missing ? ` · ${missing} no caben` : ''}`, {
    action: 'Deshacer', onAction: () => { state.events = state.events.filter(e => !created.includes(e.id)); save(); rerender(); },
  });
}

/* Tocar una hora con una tarea elegida la coloca ahí (se adelanta al «crear evento») */
document.addEventListener('click', e => {
  if (!location.hash.startsWith('#planificar')) return;
  if (typeof suppressClickUntil !== 'undefined' && Date.now() < suppressClickUntil) return;
  const chip = e.target.closest('[data-act="plan-pick"]');
  if (chip) { if (!e.target.closest('input')) { e.stopPropagation(); planPick(chip.dataset.id); } return; }
  if (e.target.closest('[data-act="plan-auto"]')) { e.stopPropagation(); planAuto(); return; }
  if (!planPickId) return;
  const col = e.target.closest('.cal-col');
  if (!col) return;
  const t = task(planPickId);
  if (!t) return;
  e.stopPropagation(); e.preventDefault();
  const sc = col.closest('.cal-scroll');
  const y = e.clientY - col.getBoundingClientRect().top;
  const dur = planDur(t);
  const m = clamp(Math.floor(y / hourHeight(sc) * 60 / 15) * 15, 0, 24 * 60 - dur);
  const ev = scheduleTask(t, col.dataset.date, fmtHM(m), fmtHM(Math.min(m + dur, 24 * 60 - 1)));
  planPickId = null; document.body.classList.remove('plan-picking');
  save(); rerender(); haptic(10);
  if (!warnOverlap(ev)) toast(`«${t.title}» a las ${ev.start}`, { action: 'Deshacer', onAction: () => { state.events = state.events.filter(x => x.id !== ev.id); save(); rerender(); } });
}, true);
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#planificar')) { planPickId = null; document.body.classList.remove('plan-picking'); } });
