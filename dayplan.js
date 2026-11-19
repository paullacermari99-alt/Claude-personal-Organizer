/* Boldup — «Planificar mi día» (v82).
   Propone un horario con tus tareas según lo que importa, tu energía y tus huecos libres.
   Nada se guarda hasta que pulsas «Aceptar»: antes puedes quitar tareas, cambiar su orden o su duración. */
'use strict';

const DP_DURS = [15, 30, 45, 60, 90, 120];
const DP_ENERGY = {
  low:  { label: 'Baja',  cap: 240, longRest: 50, rest: 10, tip: 'Empiezas con algo corto para arrancar sin esfuerzo y descansas a menudo.' },
  mid:  { label: 'Media', cap: 360, longRest: 75, rest: 5,  tip: 'Primero lo más importante, con pequeñas pausas entre tareas.' },
  high: { label: 'Alta',  cap: 480, longRest: 90, rest: 5,  tip: 'Lo más difícil primero, mientras tienes la cabeza fresca.' },
};
const DP_PEAKS = [['manana', 'Mañana', 8 * 60, 13 * 60], ['tarde', 'Tarde', 15 * 60, 19 * 60], ['noche', 'Noche', 19 * 60, 23 * 60]];
const DP_REMIND = [[-1, 'No'], [0, 'A la hora'], [5, '5 min antes'], [10, '10 min antes']];

let dp = null;   /* propuesta en curso (solo en memoria) */

const dpScore = c => (c.why === 'prio' ? 100 : 0) + (c.why === 'late' ? 40 : 0) + (c.t.due && c.t.due <= dp.d ? 30 : 0)
  + PRI_ORDER[c.t.priority || 'none'] * 12 + (c.t.due && daysBetween(dp.d, c.t.due) <= 3 ? 8 : 0);
const dpHeavy = c => PRI_ORDER[c.t.priority || 'none'] >= 3 || c.dur >= 60 || (c.why === 'prio' && c.dur >= 45);

function dpCandidates(d) {
  const out = planCandidates(d).map(c => ({ ...c }));
  /* Si el día va flojo, sugiere lo importante que vence pronto */
  if (out.length < 4) {
    const have = new Set(out.map(c => c.t.id));
    const placed = new Set(eventsOn(d).filter(e => e.taskId).map(e => e.taskId));
    state.tasks.filter(t => !t.done && !isRoutineTask(t) && !have.has(t.id) && !placed.has(t.id)
      && (PRI_ORDER[t.priority || 'none'] >= 2 || (t.due && daysBetween(d, t.due) <= 3)) && (!t.due || t.due > d))
      .sort(sortByDue).slice(0, 4 - out.length).forEach(t => out.push({ t, why: 'soon' }));
  }
  return out;
}

function dpStart(d) {
  dp = {
    d, manual: false,
    energy: energyLevel((journalOf(d) || {}).energy) || 'mid',
    peak: state.settings.peak || '',
    remind: state.settings.planRemind != null ? state.settings.planRemind : 5,
    moveRest: true,
    items: dpCandidates(d).map(c => ({ ...c, dur: planDur(c.t), out: false })),
  };
  dpOrder();
}

/* Orden inicial según tu energía */
function dpOrder() {
  const byScore = (a, b) => dpScore(b) - dpScore(a);
  const all = [...dp.items].sort(byScore);
  let order;
  if (dp.energy === 'high') order = [...all.filter(dpHeavy), ...all.filter(c => !dpHeavy(c))];
  else if (dp.energy === 'low') {
    const quick = all.filter(c => !dpHeavy(c) && c.dur <= 30).sort((a, b) => a.dur - b.dur || byScore(a, b))[0];
    order = quick ? [quick, ...all.filter(c => c !== quick)] : all;
  } else order = all;
  dp.items = order;
  dp.manual = false;
}

/* Coloca las tareas en los huecos libres. Devuelve { placed:[{c,s,e}], left:[c] } */
function dpFrom(d) {
  const [d0] = dayBounds();
  return d === todayStr() ? Math.max(d0, Math.ceil((toMin(nowHHMM()) + 5) / 15) * 15) : d0;
}
function dpPack() {
  const d = dp.d, E = DP_ENERGY[dp.energy];
  const d1 = dayBounds()[1], from = dpFrom(d);
  const busy = busyOn(d).map(([s, e]) => [s, e]);
  const peak = DP_PEAKS.find(p => p[0] === dp.peak);
  const placed = [], left = [];
  let used = 0, cursor = from;
  const fits = (m, dur) => m + dur <= d1 && !busy.some(([s, e]) => m < e && s < m + dur);
  const firstFit = (m0, dur) => { for (let m = m0; m + dur <= d1; m += 5) if (fits(m, dur)) return m; return null; };
  for (const c of dp.items) {
    if (c.out) continue;
    if (used + c.dur > E.cap) { left.push(c); continue; }
    let m = null;
    if (dp.manual) m = firstFit(cursor, c.dur);
    else {
      if (peak && dpHeavy(c) && peak[2] > from) m = firstFit(Math.max(from, peak[2]), c.dur);
      if (m == null) m = firstFit(from, c.dur);
    }
    if (m == null) { left.push(c); continue; }
    const rest = c.dur >= E.longRest ? 15 : E.rest;
    busy.push([m, m + c.dur + rest]);
    placed.push({ c, s: m, e: m + c.dur });
    used += c.dur;
    cursor = m + c.dur + rest;
  }
  placed.sort((a, b) => a.s - b.s);
  return { placed, left, used };
}

function dpWhy(c) {
  const t = c.t, bits = [];
  if (c.why === 'prio') bits.push('★ Prioridad');
  if (c.why === 'late') bits.push('Atrasada');
  else if (t.due === dp.d) bits.push(dp.d === todayStr() ? 'Vence hoy' : 'Vence ese día');
  else if (t.due) bits.push('Vence ' + relDay(t.due).toLowerCase());
  if (PRI_ORDER[t.priority || 'none'] >= 3 && c.why !== 'prio') bits.push('Importante');
  if (dpHeavy(c)) bits.push('Exige concentración');
  return bits.join(' · ');
}

function dpBody() {
  const d = dp.d, E = DP_ENERGY[dp.energy];
  const { placed, left, used } = dpPack();
  const outs = dp.items.filter(c => c.out);
  /* Línea de tiempo: tus bloques propuestos + lo que ya tenías + descansos */
  const ext = typeof extEventsOn === 'function' ? extEventsOn(d).filter(e => !e.allDay) : [];
  const [d0] = dayBounds();
  const startAt = placed.length ? placed[0].s : d0;
  const existing = [...eventsOn(d), ...ext].map(e => ({ fixed: true, title: e.title, s: toMin(e.start), e: toMin(e.end) }))
    .filter(x => x.e > Math.min(startAt, dpFrom(d)) && (!placed.length || x.s < placed[placed.length - 1].e));
  const rows = [...placed.map(p => ({ ...p })), ...existing].sort((a, b) => a.s - b.s);
  const idx = id => dp.items.findIndex(c => c.t.id === id);
  const vis = placed.map(p => p.c.t.id);
  let html = '', prevEnd = null;
  for (const r of rows) {
    if (prevEnd != null && r.s - prevEnd >= 10 && !r.fixed) html += `<div class="dp-rest">☕ Descanso · ${durLabel(r.s - prevEnd)}</div>`;
    if (r.fixed) html += `<div class="dp-row fixed"><span class="dp-time">${fmtHM(r.s)}<small>${fmtHM(r.e)}</small></span><div class="dp-main"><b>${esc(r.title)}</b><span class="dp-why">Ya estaba en tu horario</span></div></div>`;
    else {
      const c = r.c, k = dp.manual ? idx(c.t.id) : vis.indexOf(c.t.id);
      const n = dp.manual ? dp.items.length : vis.length;
      html += `<div class="dp-row" style="--c:${colorOfTask(c.t)}">
        <span class="dp-time">${fmtHM(r.s)}<small>${fmtHM(r.e)}</small></span>
        <div class="dp-main"><b>${esc(c.t.title)}</b><span class="dp-why">${esc(dpWhy(c))}</span>
        <div class="dp-tools">
          <button type="button" class="dp-dur" data-modal="dp-dur" data-id="${c.t.id}" aria-label="Duración: ${durLabel(c.dur)}. Toca para cambiarla">${durLabel(c.dur)}</button>
          <button type="button" class="icon-btn" data-modal="dp-up" data-id="${c.t.id}" aria-label="Antes" ${k <= 0 ? 'disabled' : ''}><span class="dp-up">${I.down}</span></button>
          <button type="button" class="icon-btn" data-modal="dp-down" data-id="${c.t.id}" aria-label="Después" ${k >= n - 1 ? 'disabled' : ''}>${I.down}</button>
          <button type="button" class="icon-btn" data-modal="dp-out" data-id="${c.t.id}" aria-label="Quitar del plan">${I.close}</button>
        </div></div>
      </div>`;
    }
    prevEnd = Math.max(prevEnd || 0, r.e);
  }
  const chips = (k, opts, cur) => `<div class="chips-row wrap dp-chips">${opts.map(([v, l]) => `<button type="button" class="chip-btn ${String(cur) === String(v) ? 'on' : ''}" data-modal="dp-set" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const later = left.filter(c => c.t.due && c.t.due <= d);
  return `
    <div class="field">Tu energía ${d === todayStr() ? 'hoy' : 'ese día'}${chips('energy', Object.entries(DP_ENERGY).map(([k, v]) => [k, v.label]), dp.energy)}<span class="small muted dp-tip">${E.tip}</span></div>
    <div class="field">Cuándo rindes más ${chips('peak', [['', 'Me da igual'], ...DP_PEAKS.map(p => [p[0], p[1]])], dp.peak)}</div>
    <div class="field">
      <div class="dp-head"><span>Tu plan</span><span class="small muted">${placed.length ? `${placed.length} tarea${placed.length === 1 ? '' : 's'} · ${durLabel(used)}` : ''}</span></div>
      ${placed.length ? `<div class="dp-list glass">${html}</div>`
        : emptyBox(dp.items.length ? 'No queda hueco libre en tu jornada para estas tareas.' : `No tienes tareas pendientes para ${d === todayStr() ? 'hoy' : 'ese día'}. Apunta alguna y vuelve a planificar.`)}
      ${placed.length ? `<span class="small muted dp-hint">Toca la duración para cambiarla. Las flechas cambian el orden.</span>` : ''}
    </div>
    ${left.length || outs.length ? `<div class="field">
      <div class="dp-head"><span>${left.length ? 'No cabe hoy' : 'Fuera del plan'}</span><span class="small muted">${left.length && used + Math.min(...left.map(c => c.dur)) > E.cap ? `Con energía ${E.label.toLowerCase()}, mejor no pasar de ${durLabel(E.cap)}` : ''}</span></div>
      <div class="dp-left">${[...left, ...outs].map(c => `<button type="button" class="chip-btn ${c.out ? 'off' : ''}" data-modal="dp-in" data-id="${c.t.id}" title="${c.out ? 'Volver a añadir' : ''}">${c.out ? '+ ' : ''}${esc(c.t.title)} <span class="muted">${durLabel(c.dur)}</span></button>`).join('')}</div>
      ${later.length ? `<label class="toggle-row small"><span>Pasar a mañana lo que no cabe (${later.length})</span><input type="checkbox" class="switch" data-modal="dp-move" ${dp.moveRest ? 'checked' : ''}></label>` : ''}
    </div>` : ''}
    ${placed.length ? `<div class="field">Avisarme de cada tarea${chips('remind', DP_REMIND, dp.remind)}</div>
    <button type="button" class="btn wide" data-modal="dp-adjust">${I.clock}<span>Aceptar y ajustar en el horario</span></button>` : ''}`;
}

function dpRender() {
  const box = $('#dp-body', modalForm);
  if (box) box.innerHTML = dpBody();
  const btn = modalForm.querySelector('button[type=submit]');
  if (btn) btn.disabled = !dpPack().placed.length;
}

function dpMove(id, dir) {
  if (!dp.manual) {   /* a partir de aquí manda tu orden: se respeta tal cual */
    const { placed, left } = dpPack();
    dp.items = [...placed.map(p => p.c), ...left, ...dp.items.filter(c => c.out)];
    dp.manual = true;
  }
  const i = dp.items.findIndex(c => c.t.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= dp.items.length) return;
  [dp.items[i], dp.items[j]] = [dp.items[j], dp.items[i]];
}

function dpAccept() {
  const d = dp.d, { placed, left } = dpPack();
  if (!placed.length) return false;
  const created = [], moved = [], prevPlan = state.dayPlans[d] ? { ...state.dayPlans[d] } : null;
  for (const p of placed) {
    const ev = scheduleTask(p.c.t, d, fmtHM(p.s), fmtHM(p.e));
    ev.remind = dp.remind;
    created.push(ev.id);
  }
  if (dp.moveRest) left.filter(c => c.t.due && c.t.due <= d).forEach(c => { moved.push([c.t, c.t.due]); c.t.due = addDays(d, 1); });
  const prios = dayPriorities(d).length ? dayPriorities(d)
    : placed.map(p => p.c).sort((a, b) => dpScore(b) - dpScore(a)).slice(0, 3).map(c => c.t.id);
  state.dayPlans[d] = { ...(state.dayPlans[d] || {}), priorities: prios, planned: true };
  state.settings.peak = dp.peak;
  state.settings.planRemind = dp.remind;
  const lv = { low: 2, mid: 4, high: 5 }[dp.energy];
  if (energyLevel((journalOf(d) || {}).energy) !== dp.energy) setJournal(d, { energy: lv });
  if (dp.remind >= 0) ensureReminders();
  const first = placed[0];
  toast(`Día planificado · empiezas a las ${fmtHM(first.s)}${moved.length ? ` · ${moved.length} a mañana` : ''}`, {
    action: 'Deshacer', onAction: () => {
      state.events = state.events.filter(e => !created.includes(e.id));
      moved.forEach(([t, due]) => { t.due = due; });
      if (prevPlan) state.dayPlans[d] = prevPlan; else delete state.dayPlans[d];
      save(); rerender();
    },
  });
  haptic(12);
}

function planDaySheet(d = todayStr()) {
  dpStart(d);
  openModal(d === todayStr() ? 'Planificar mi día' : `Planificar ${esc(relDay(d).toLowerCase())}`, `
    <p class="sheet-sub">Te propongo un horario. Cámbialo a tu gusto y acéptalo.</p>
    <div id="dp-body">${dpBody()}</div>`, {
    saveLabel: 'Aceptar',
    onSave: () => dpAccept(),
    actions: {
      'dp-set': b => {
        const k = b.dataset.k, v = b.dataset.v;
        if (k === 'remind') dp.remind = Number(v);
        else { dp[k] = v; dpOrder(); }
        dpRender();
      },
      'dp-dur': b => { const c = dp.items.find(x => x.t.id === b.dataset.id); if (c) { c.dur = DP_DURS[(DP_DURS.indexOf(c.dur) + 1) % DP_DURS.length] || 30; dpRender(); } },
      'dp-up': b => { dpMove(b.dataset.id, -1); dpRender(); },
      'dp-down': b => { dpMove(b.dataset.id, 1); dpRender(); },
      'dp-out': b => { const c = dp.items.find(x => x.t.id === b.dataset.id); if (c) { c.out = true; dpRender(); } },
      'dp-in': b => {
        const i = dp.items.findIndex(x => x.t.id === b.dataset.id);
        if (i < 0) return;
        const [c] = dp.items.splice(i, 1);
        c.out = false;
        /* Vuelve justo detrás de lo ya colocado */
        const { placed } = dpPack();
        const last = placed.length ? dp.items.indexOf(placed[placed.length - 1].c) : -1;
        dp.items.splice(last + 1, 0, c);
        dpRender();
      },
      'dp-move': b => { dp.moveRest = b.checked; },
      'dp-adjust': () => { if (submitModal()) { viewDate = dp.d; location.hash = '#planificar'; } },
    },
  });
  const btn = modalForm.querySelector('button[type=submit]');
  if (btn) btn.disabled = !dpPack().placed.length;
}
