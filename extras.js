/* P Organizer — papelera, reprogramar en bloque, plantillas, resumen de la mañana y revisión guiada */

/* ---------- Papelera (10 días) ---------- */
const TRASH_DAYS = 10;
function trashList() { if (!Array.isArray(state.trash)) state.trash = []; return state.trash; }
function purgeTrash() {
  const limit = Date.now() - TRASH_DAYS * 86400000, list = trashList();
  const keep = list.filter(x => x.deletedAt >= limit);
  if (keep.length !== list.length) { state.trash = keep; return true; }
  return false;
}
const TRASH_KIND = { task: 'Tarea', project: 'Proyecto', goal: 'Objetivo' };
const trashName = x => x.kind === 'project' ? x.item.name : x.item.title;

/* Quita un elemento y guarda lo necesario para devolverlo tal cual estaba */
function trashTask(id) {
  const t = task(id);
  if (!t) return null;
  const events = state.events.filter(e => e.taskId === id);
  const plans = [];
  for (const [k, p] of Object.entries(state.dayPlans)) if ((p.priorities || []).includes(id)) plans.push(['day', k]);
  for (const [k, p] of Object.entries(state.weekPlans)) if ((p.priorities || []).includes(id)) plans.push(['week', k]);
  const tm = typeof getTimer === 'function' && getTimer();
  if (tm && tm.taskId === id) cancelTimer(false);
  state.tasks = state.tasks.filter(x => x.id !== id);
  state.events = state.events.filter(e => e.taskId !== id);
  Object.values(state.dayPlans).concat(Object.values(state.weekPlans)).forEach(p => { p.priorities = (p.priorities || []).filter(x => x !== id); });
  const entry = { id: uid(), kind: 'task', item: t, events, plans, deletedAt: Date.now() };
  trashList().unshift(entry);
  return entry;
}
function trashProject(id) {
  const p = project(id);
  if (!p) return null;
  const links = {};
  for (const k of ['tasks', 'events', 'goals', 'routines']) links[k] = state[k].filter(x => x.projectId === id).map(x => x.id);
  state.projects = state.projects.filter(x => x.id !== id);
  [state.tasks, state.events, state.goals, state.routines].forEach(list => list.forEach(x => { if (x.projectId === id) x.projectId = null; }));
  const entry = { id: uid(), kind: 'project', item: p, links, deletedAt: Date.now() };
  trashList().unshift(entry);
  return entry;
}
function trashGoal(id) {
  const g = goal(id);
  if (!g) return null;
  const links = {};
  for (const k of ['tasks', 'events', 'routines']) links[k] = state[k].filter(x => x.goalId === id).map(x => x.id);
  state.goals = state.goals.filter(x => x.id !== id);
  [state.tasks, state.events, state.routines].forEach(list => list.forEach(x => { if (x.goalId === id) x.goalId = null; }));
  const entry = { id: uid(), kind: 'goal', item: g, links, deletedAt: Date.now() };
  trashList().unshift(entry);
  return entry;
}
function restoreTrash(entryId) {
  const e = trashList().find(x => x.id === entryId);
  if (!e) return false;
  state.trash = trashList().filter(x => x.id !== entryId);
  if (e.kind === 'task') {
    if (!task(e.item.id)) state.tasks.push(e.item);
    e.events.forEach(ev => { if (!state.events.some(x => x.id === ev.id)) state.events.push(ev); });
    (e.plans || []).forEach(([kind, k]) => {
      const plans = kind === 'day' ? state.dayPlans : state.weekPlans, max = kind === 'day' ? 3 : 5;
      const p = plans[k] = plans[k] || { priorities: [] };
      p.priorities = p.priorities || [];
      if (!p.priorities.includes(e.item.id) && p.priorities.length < max) p.priorities.push(e.item.id);
    });
  } else {
    const key = e.kind === 'project' ? 'projectId' : 'goalId';
    const list = e.kind === 'project' ? state.projects : state.goals;
    if (!list.some(x => x.id === e.item.id)) list.push(e.item);
    for (const [k, ids] of Object.entries(e.links || {})) state[k].forEach(x => { if (ids.includes(x.id) && !x[key]) x[key] = e.item.id; });
  }
  return e;
}
/* Borra con aviso y opción de deshacer al momento; se puede recuperar 10 días desde Ajustes → Papelera */
function deleteWithUndo(kind, id) {
  const entry = kind === 'task' ? trashTask(id) : kind === 'project' ? trashProject(id) : trashGoal(id);
  if (!entry) return;
  save();
  toast(`${TRASH_KIND[kind]} a la papelera`, { action: 'Deshacer', onAction: () => { restoreTrash(entry.id); save(); rerender(); } });
}
function trashSheet() {
  purgeTrash();
  const list = trashList();
  const left = x => Math.max(1, Math.ceil((x.deletedAt + TRASH_DAYS * 86400000 - Date.now()) / 86400000));
  openModal('Papelera', list.length ? `
    <p class="sheet-sub">Lo que borras se guarda ${TRASH_DAYS} días. Después se elimina solo.</p>
    <div class="settings-group glass trash-list">${list.map(x => `<div class="item">
      <div class="grow"><div>${esc(trashName(x))}</div><div class="small muted">${TRASH_KIND[x.kind]} · se borra en ${left(x)} día${left(x) === 1 ? '' : 's'}</div></div>
      <button type="button" class="btn small" data-modal="restore" data-id="${x.id}">Recuperar</button>
    </div>`).join('')}</div>
    <button type="button" class="btn wide danger" data-modal="empty">Vaciar papelera</button>` : `<div class="empty">La papelera está vacía. Lo que borres se guarda aquí ${TRASH_DAYS} días.</div>`, {
    saveLabel: 'Listo',
    onSave: () => {},
    actions: {
      restore: el => { const e = restoreTrash(el.dataset.id); save(); rerender(); modal.close(); if (e) toast(`Recuperado: ${trashName(e)}`); trashSheet(); },
      empty: () => { if (!confirm('¿Vaciar la papelera? No se podrá deshacer.')) return; state.trash = []; save(); modal.close(); toast('Papelera vaciada'); },
    },
  });
}

/* ---------- Reprogramar en bloque ---------- */
function overdueTasks() {
  const today = todayStr();
  return state.tasks.filter(t => !t.done && !isRoutineTask(t) && t.due && t.due < today);
}
/* Reparte por los días que quedan de la semana (al menos 3), primero lo importante, en el día con menos carga */
function spreadPlan(list) {
  const today = todayStr();
  let days = [];
  for (let d = today; d <= addDays(startOfWeek(today), 6); d = addDays(d, 1)) days.push(d);
  if (days.length < 3) days = Array.from({ length: 5 }, (_, i) => addDays(today, i));
  const load = new Map(days.map(d => [d, state.tasks.filter(t => !t.done && !isRoutineTask(t) && t.due === d).length]));
  const sorted = list.slice().sort((a, b) => (PRI_ORDER[b.priority] - PRI_ORDER[a.priority]) || sortByDue(a, b));
  return sorted.map(t => {
    const d = days.reduce((best, x) => load.get(x) < load.get(best) ? x : best, days[0]);
    load.set(d, load.get(d) + 1);
    return [t, d];
  });
}
function bulkReschedSheet(list) {
  list = list || overdueTasks();
  if (!list.length) { toast('No hay tareas atrasadas'); return; }
  const today = todayStr(), n = list.length;
  const apply = (pairs, label) => {
    const prev = pairs.map(([t]) => [t, t.due]);
    pairs.forEach(([t, d]) => { t.due = d; });
    save(); rerender();
    toast(label, { action: 'Deshacer', onAction: () => { prev.forEach(([t, d]) => { t.due = d; }); save(); rerender(); } });
  };
  const spread = spreadPlan(list);
  const spreadDays = [...new Set(spread.map(([, d]) => d))].sort();
  openModal('Reprogramar atrasadas', `
    <div class="sheet-sub">${n} tarea${n === 1 ? '' : 's'} con el plazo pasado.</div>
    <div class="sheet-list">
      <button type="button" class="sheet-item" data-modal="b-today">${I.clock}<span>Todas a hoy</span></button>
      <button type="button" class="sheet-item" data-modal="b-tomorrow">${I.right}<span>Todas a mañana</span><span class="muted small">${esc(fmtShortDate(addDays(today, 1)))}</span></button>
      <button type="button" class="sheet-item" data-modal="b-spread">${I.cal}<span>Repartir en la semana</span><span class="muted small">${spreadDays.length} día${spreadDays.length === 1 ? '' : 's'}, lo importante primero</span></button>
      <button type="button" class="sheet-item" data-modal="b-none">${I.archive}<span>Quitarles la fecha (bandeja)</span></button>
    </div>
    <details class="spread-preview"><summary class="small muted">Ver cómo quedaría el reparto</summary>
      <div class="small">${spreadDays.map(d => `<div><b>${esc(relDay(d))}</b>: ${spread.filter(([, x]) => x === d).map(([t]) => esc(t.title)).join(', ')}</div>`).join('')}</div>
    </details>`, {
    actions: {
      'b-today': () => { modal.close(); apply(list.map(t => [t, today]), `${n} pasada${n === 1 ? '' : 's'} a hoy`); },
      'b-tomorrow': () => { modal.close(); apply(list.map(t => [t, addDays(today, 1)]), `${n} pasada${n === 1 ? '' : 's'} a mañana`); },
      'b-spread': () => { modal.close(); apply(spread, `${n} repartida${n === 1 ? '' : 's'} en ${spreadDays.length} día${spreadDays.length === 1 ? '' : 's'}`); },
      'b-none': () => { modal.close(); apply(list.map(t => [t, null]), `${n} a la bandeja, sin fecha`); },
    },
  });
}

/* ---------- Resumen de la mañana ---------- */
function morningSummary(d = todayStr()) {
  const prios = dayPriorities(d).map(task).filter(t => t && !t.done);
  const evs = eventsOn(d).sort((a, b) => a.start.localeCompare(b.start));
  const diarias = state.tasks.filter(t => isRoutineTask(t) && !t.done && t.routineDate <= d).length;
  const dueToday = state.tasks.filter(t => !t.done && !isRoutineTask(t) && t.due === d && !prios.includes(t)).length;
  const lines = [];
  lines.push(prios.length ? `Prioridades: ${prios.map(t => t.title).join(' · ')}` : 'Aún no has elegido tus 3 prioridades. Toca para planificar el día.');
  if (evs.length) lines.push(`${evs.length} bloque${evs.length === 1 ? '' : 's'}: ${evs.slice(0, 3).map(e => `${e.start} ${e.title}`).join(', ')}${evs.length > 3 ? '…' : ''}`);
  const rest = [dueToday ? `${dueToday} tarea${dueToday === 1 ? '' : 's'} más para hoy` : '', diarias ? `${diarias} diaria${diarias === 1 ? '' : 's'} pendiente${diarias === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (rest.length) lines.push(rest.join(' · '));
  return { title: 'Tu día', body: lines.join('\n') };
}

/* ---------- Plantillas ---------- */
function templatesList() { if (!Array.isArray(state.templates)) state.templates = []; return state.templates; }
function saveProjectTemplate(pid) {
  const p = project(pid);
  if (!p) return;
  const today = todayStr();
  const goals = state.goals.filter(g => g.projectId === pid);
  const off = d => d ? daysBetween(today, d) : null;
  const tasks = state.tasks.filter(t => !isRoutineTask(t) && (t.projectId === pid || goals.some(g => g.id === t.goalId)));
  const data = {
    project: { name: p.name, icon: p.icon, color: p.color, defaultView: p.defaultView, notes: p.notes },
    goals: goals.map(g => ({ ref: g.id, title: g.title, horizon: g.horizon, dueOff: off(g.due), description: g.description, success: g.success, progressMode: g.progressMode, color: g.color })),
    tasks: tasks.map(t => ({ title: t.title, notes: t.notes, priority: t.priority, estimate: t.estimate, firstStep: t.firstStep, tags: t.tags, goalRef: t.goalId, dueOff: off(t.due), subtasks: (t.subtasks || []).map(s => s.title) })),
  };
  const name = prompt('Nombre de la plantilla', p.name);
  if (name === null) return;
  templatesList().push({ id: uid(), kind: 'project', name: name.trim() || p.name, data, createdAt: Date.now() });
  save();
  toast(`Plantilla guardada: ${data.goals.length} objetivo${data.goals.length === 1 ? '' : 's'} y ${data.tasks.length} tarea${data.tasks.length === 1 ? '' : 's'}`);
}
function useProjectTemplate(tpl, name) {
  const today = todayStr(), d = tpl.data;
  const due = o => o == null ? null : addDays(today, Math.max(0, o));
  const p = { id: uid(), createdAt: Date.now(), order: state.projects.length, favorite: false, archived: false, ...d.project, name: (name || '').trim() || d.project.name };
  state.projects.push(p);
  const gmap = {};
  d.goals.forEach(g => {
    const n = { id: uid(), status: 'activo', achievedAt: null, createdAt: Date.now(), progress: 0, projectId: p.id, title: g.title, horizon: g.horizon, due: due(g.dueOff) || addDays(today, 30), description: g.description || '', success: g.success || '', progressMode: g.progressMode || 'auto', color: g.color };
    gmap[g.ref] = n.id; state.goals.push(n);
  });
  d.tasks.forEach(t => state.tasks.push(newTask({ title: t.title, notes: t.notes || '', priority: t.priority || 'none', estimate: t.estimate || null, firstStep: t.firstStep || '', tags: (t.tags || []).filter(id => tag(id)), projectId: p.id, goalId: gmap[t.goalRef] || null, due: due(t.dueOff), subtasks: (t.subtasks || []).map(title => ({ id: uid(), title, done: false })) })));
  save();
  location.hash = '#proyecto/' + p.id;
  toast(`Proyecto creado desde «${tpl.name}»`, { action: 'Deshacer', onAction: () => {
    state.projects = state.projects.filter(x => x.id !== p.id);
    state.goals = state.goals.filter(x => x.projectId !== p.id);
    state.tasks = state.tasks.filter(x => x.projectId !== p.id);
    save(); location.hash = '#proyectos';
  } });
}
function saveWeekTemplate(ws) {
  const we = addDays(ws, 6);
  const evs = state.events.filter(e => !e.recurrence && e.date >= ws && e.date <= we);
  if (!evs.length) { toast('Esta semana no tiene bloques para guardar (los que se repiten ya aparecen solos)'); return; }
  const name = prompt('Nombre de la plantilla de semana', 'Semana tipo');
  if (name === null) return;
  const data = { events: evs.map(e => ({ day: daysBetween(ws, e.date), start: e.start, end: e.end, title: e.title, color: e.color, tagId: e.tagId, projectId: e.projectId, goalId: e.goalId, notes: e.notes || '' })) };
  templatesList().push({ id: uid(), kind: 'week', name: name.trim() || 'Semana tipo', data, createdAt: Date.now() });
  save();
  toast(`Plantilla guardada con ${evs.length} bloque${evs.length === 1 ? '' : 's'}`);
}
function useWeekTemplate(tpl, ws) {
  const added = [];
  tpl.data.events.forEach(e => {
    const date = addDays(ws, e.day);
    if (state.events.some(x => !x.recurrence && x.date === date && x.start === e.start && x.title === e.title)) return;
    const n = { id: uid(), title: e.title, date, start: e.start, end: e.end, taskId: null, color: e.color || null, tagId: e.tagId && tag(e.tagId) ? e.tagId : null, projectId: e.projectId && project(e.projectId) ? e.projectId : null, goalId: e.goalId && goal(e.goalId) ? e.goalId : null, recurrence: null, exceptions: [], notes: e.notes || '' };
    state.events.push(n); added.push(n.id);
  });
  save(); rerender();
  toast(added.length ? `${added.length} bloque${added.length === 1 ? '' : 's'} añadido${added.length === 1 ? '' : 's'} desde «${tpl.name}»` : 'Esa semana ya tenía esos bloques',
    added.length ? { action: 'Deshacer', onAction: () => { state.events = state.events.filter(x => !added.includes(x.id)); save(); rerender(); } } : {});
}
function templatesSheet(kind, ctx = {}) {
  const list = templatesList().filter(t => t.kind === kind);
  const count = t => kind === 'week' ? `${t.data.events.length} bloques` : `${t.data.goals.length} objetivos · ${t.data.tasks.length} tareas`;
  const title = kind === 'week' ? 'Plantillas de semana' : 'Plantillas de proyecto';
  openModal(title, `
    <p class="sheet-sub">${kind === 'week' ? `Guarda los bloques de una semana tipo y ponlos en otra de un toque. Se aplican a la semana del ${esc(fmtShortDate(ctx.ws))}.` : 'Guarda un proyecto con sus objetivos y tareas para empezar otro igual. Las fechas se ajustan a partir de hoy.'}</p>
    ${list.length ? `<div class="settings-group glass">${list.map(t => `<div class="item">
      <div class="grow"><div>${esc(t.name)}</div><div class="small muted">${count(t)}</div></div>
      <button type="button" class="btn small primary" data-modal="use" data-id="${t.id}">${kind === 'week' ? 'Aplicar' : 'Usar'}</button>
      <button type="button" class="icon-btn" data-modal="del" data-id="${t.id}" aria-label="Eliminar plantilla">${I.close}</button>
    </div>`).join('')}</div>` : `<div class="empty">Aún no tienes plantillas${kind === 'week' ? ' de semana' : ' de proyecto'}.</div>`}
    ${kind === 'week' ? `<button type="button" class="btn wide" data-modal="save">${I.plus}<span>Guardar esta semana como plantilla</span></button>`
      : ctx.projectId ? `<button type="button" class="btn wide" data-modal="save">${I.plus}<span>Guardar este proyecto como plantilla</span></button>`
      : '<p class="hint">Para crear una, abre un proyecto y pulsa «Plantilla».</p>'}`, {
    actions: {
      use: el => { const t = templatesList().find(x => x.id === el.dataset.id); modal.close(); if (!t) return; kind === 'week' ? useWeekTemplate(t, ctx.ws) : useProjectTemplate(t); },
      del: el => { if (!confirm('¿Eliminar la plantilla?')) return; state.templates = templatesList().filter(x => x.id !== el.dataset.id); save(); modal.close(); templatesSheet(kind, ctx); },
      save: () => { modal.close(); kind === 'week' ? saveWeekTemplate(ctx.ws) : saveProjectTemplate(ctx.projectId); },
    },
  });
}

/* ---------- Revisión semanal guiada: cómo fue la semana ---------- */
const REASONS = [['tiempo', 'No tuve tiempo'], ['grande', 'Era demasiado grande'], ['bloqueo', 'Me atasqué'], ['importa', 'Ya no importa']];
const REASON_TIP = {
  tiempo: 'Pásala a esta semana como prioridad y resérvale hueco.',
  grande: 'Divídela en subtareas pequeñas y escribe por dónde empezar.',
  bloqueo: 'Escribe la primera acción concreta (de menos de 2 minutos).',
  importa: 'Bórrala sin culpa: irá a la papelera 10 días.',
};
function lastWeekReport(ws) {
  /* ws = semana que se planifica; se revisa la anterior */
  const pws = addDays(ws, -7), pwe = addDays(ws, -1);
  const inWeek = ts => { if (!ts) return false; const d = ymd(new Date(ts)); return d >= pws && d <= pwe; };
  const done = state.tasks.filter(t => t.done && !isRoutineTask(t) && inWeek(t.doneAt));
  const prioIds = (state.weekPlans[pws] || {}).priorities || [];
  const prios = prioIds.map(task).filter(Boolean);
  const behind = state.tasks.filter(t => !t.done && !isRoutineTask(t) && ((t.due && t.due >= pws && t.due <= pwe) || prioIds.includes(t.id)));
  const focusMin = state.focusLog.filter(f => f.date >= pws && f.date <= pwe).reduce((a, f) => a + f.minutes, 0);
  const rDone = state.tasks.filter(t => isRoutineTask(t) && t.routineDate >= pws && t.routineDate <= pwe);
  return { pws, pwe, done, prios, behind, focusMin, routinesPct: rDone.length ? Math.round(100 * rDone.filter(t => t.done).length / rDone.length) : null };
}
function reviewLookback(ws) {
  const r = lastWeekReport(ws);
  const wp = state.weekPlans[r.pws] = state.weekPlans[r.pws] || { priorities: [] };
  const reasons = wp.reasons || {};
  const nothing = !r.done.length && !r.behind.length && !r.prios.length;
  return `<div class="section step">
    <div class="step-head"><span class="step-num">1</span><div><h3>Cómo fue la semana pasada</h3><p class="muted small">Del ${esc(fmtShortDate(r.pws))} al ${esc(fmtShortDate(r.pwe))}. Sin juzgarte: solo para aprender.</p></div></div>
    ${nothing ? emptyBox('No hay datos de la semana pasada. ¡Empieza esta con buen pie!') : `
    <div class="review-tiles">
      <div class="tile glass"><b>${r.done.length}</b><span>tareas hechas</span></div>
      <div class="tile glass"><b>${r.prios.length ? `${r.prios.filter(t => t.done).length}/${r.prios.length}` : '—'}</b><span>prioridades cumplidas</span></div>
      <div class="tile glass"><b>${r.focusMin >= 60 ? (r.focusMin / 60).toFixed(1).replace('.0', '') + ' h' : r.focusMin + ' min'}</b><span>de enfoque</span></div>
      ${r.routinesPct != null ? `<div class="tile glass"><b>${r.routinesPct}%</b><span>de diarias</span></div>` : ''}
    </div>
    ${r.done.length ? `<details class="review-done"><summary class="small muted">Ver lo que hiciste (${r.done.length})</summary><ul class="plain small">${r.done.map(t => `<li>✓ ${esc(t.title)}</li>`).join('')}</ul></details>` : ''}
    ${r.behind.length ? `<h4 class="review-sub">Se quedó atrás · ${r.behind.length}</h4>
      <p class="muted small">¿Por qué? Elegirlo te da una propuesta concreta.</p>
      <div class="settings-group glass behind-list">${r.behind.map(t => {
        const why = reasons[t.id];
        return `<div class="item behind" data-task="${t.id}">
          <div class="grow"><div>${esc(t.title)}</div>
            <div class="chips-row reasons">${REASONS.map(([k, l]) => `<button class="chip-btn ${why === k ? 'on' : ''}" data-act="review-why" data-id="${t.id}" data-ws="${r.pws}" data-v="${k}">${l}</button>`).join('')}</div>
            ${why ? `<div class="small muted why-tip">${REASON_TIP[why]}</div>
              <div class="why-actions">${why === 'tiempo' ? `<button class="btn small" data-act="week-prio" data-id="${t.id}">${(state.weekPlans[ws] || {}).priorities?.includes(t.id) ? '★ Prioridad' : 'Hacerla prioridad'}</button>`
                : why === 'importa' ? `<button class="btn small danger" data-act="review-trash" data-id="${t.id}">Borrar</button>`
                : `<button class="btn small" data-act="edit-task" data-id="${t.id}">Editar la tarea</button>`}</div>` : ''}
          </div>
        </div>`;
      }).join('')}</div>` : r.prios.length ? '<p class="small">Cumpliste todas tus prioridades. 🎉</p>' : ''}
    <label class="field review-note">Una cosa que harás distinto esta semana <span class="muted small">(opcional)</span>
      <input type="text" data-input="week-note" data-ws="${r.pws}" value="${esc(wp.note || '')}" placeholder="Ej.: reservar las mañanas para lo difícil"></label>`}
  </div>`;
}
/* Propuesta de prioridades: lo que se quedó atrás por falta de tiempo, luego lo que vence antes y lo más importante */
function proposeWeekPlan(ws) {
  const r = lastWeekReport(ws);
  const reasons = (state.weekPlans[r.pws] || {}).reasons || {};
  const we = addDays(ws, 6);
  const open = state.tasks.filter(t => !t.done && !isRoutineTask(t) && reasons[t.id] !== 'importa');
  const score = t => (reasons[t.id] === 'tiempo' ? 100 : 0) + (r.prios.includes(t) ? 40 : 0) + (t.due && t.due <= we ? 30 + Math.max(0, 7 - daysBetween(ws, t.due)) : 0) + PRI_ORDER[t.priority] * 8;
  const pick = open.map(t => [t, score(t)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t.id);
  const wp = state.weekPlans[ws] = state.weekPlans[ws] || { priorities: [] };
  const prev = wp.priorities.slice();
  wp.priorities = pick;
  save(); rerender();
  toast(pick.length ? `Propuesta: ${pick.length} prioridad${pick.length === 1 ? '' : 'es'}. Cámbialas si quieres.` : 'No hay nada urgente: elige tú las prioridades.', pick.length ? { action: 'Deshacer', onAction: () => { wp.priorities = prev; save(); rerender(); } } : {});
}

/* ---------- v24: plantillas de proyecto ya hechas ---------- */
/* g: [título, horizonte, días hasta el plazo, cómo sabré que lo he conseguido]
   t: [título, nº de objetivo o null, días hasta el plazo o null, minutos, primer paso, subtareas] */
function builtinTpl(id, name, icon, color, about, goals, tasks) {
  return { id: 'b:' + id, builtin: true, kind: 'project', name, about, data: {
    project: { name, icon, color, defaultView: 'resumen', notes: about },
    goals: goals.map(([title, horizon, dueOff, success], i) => ({ ref: 'g' + i, title, horizon, dueOff, success, description: '', progressMode: 'auto', color })),
    tasks: tasks.map(([title, gi, dueOff, estimate, firstStep, subtasks]) => ({ title, goalRef: gi == null ? null : 'g' + gi, dueOff, estimate: estimate || null, firstStep: firstStep || '', priority: 'none', tags: [], notes: '', subtasks: subtasks || [] })),
  } };
}
const BUILTIN_TEMPLATES = [
  builtinTpl('reforma', 'Reforma o mudanza', '🏠', '#ff9500', 'De la idea a estar ya instalado, sin que se te escape nada.',
    [['Tener claro qué hacer y cuánto cuesta', 'corto', 14, 'Presupuesto cerrado y fechas acordadas'], ['Terminar y estar instalado', 'medio', 60, 'Todo hecho y en su sitio']],
    [['Hacer lista de lo que quiero cambiar', 0, 2, 20, 'Recorrer la casa y apuntar cada cosa'], ['Pedir 3 presupuestos', 0, 7, 45, 'Buscar 3 profesionales con buenas opiniones'], ['Fijar el presupuesto máximo', 0, 9, 20], ['Elegir profesional y fechas', 0, 14, 30],
     ['Comprar materiales', 1, 21, 90, null, ['Hacer la lista', 'Comparar precios', 'Pedir o comprar']], ['Avisar a comunidad y vecinos', 1, 18, 10], ['Revisar la obra cada semana', 1, 30, 30], ['Limpiar y colocar todo', 1, 60, 180]]),
  builtinTpl('web', 'Lanzar una web o app', '💻', '#007aff', 'Desde la idea hasta tenerla publicada y con los primeros usuarios.',
    [['Tener una primera versión', 'corto', 30, 'Se puede usar de principio a fin'], ['Publicarla y conseguir usuarios', 'medio', 60, 'Primeras 10 personas usándola']],
    [['Escribir para quién es y qué problema resuelve', 0, 2, 30, 'Abrir una nota y escribir una frase'], ['Listar lo mínimo que debe hacer', 0, 4, 30], ['Bocetos de las pantallas', 0, 7, 60], ['Construir la primera versión', 0, 25, 240, null, ['Estructura', 'Funciones principales', 'Pulir detalles']],
     ['Probarla con 3 personas', 0, 30, 60], ['Elegir nombre y dominio', 1, 35, 30], ['Publicarla', 1, 45, 60], ['Contarlo donde está tu público', 1, 50, 45]]),
  builtinTpl('forma', 'Ponerse en forma', '🏋️', '#34c759', 'Crear el hábito poco a poco y notar el progreso.',
    [['Entrenar 3 días por semana', 'corto', 30, '4 semanas seguidas cumpliendo'], ['Llegar a mi meta física', 'medio', 90, 'Correr 5 km, levantar X o la meta que elijas']],
    [['Apuntar cómo estoy hoy (peso, medidas, marcas)', 1, 1, 15], ['Elegir horario fijo para entrenar', 0, 2, 10, 'Mirar la semana y bloquear 3 huecos'], ['Preparar ropa y material', 0, 3, 20], ['Plan de entrenamiento para 4 semanas', 0, 5, 45],
     ['Revisar la alimentación', 1, 10, 30, null, ['Apuntar lo que como 3 días', 'Elegir 2 cambios fáciles']], ['Revisar el progreso', 1, 30, 20], ['Ajustar el plan', 1, 31, 30]]),
  builtinTpl('examen', 'Preparar un examen', '📚', '#5856d6', 'Repartir el temario y llegar con repasos hechos.',
    [['Terminar el temario', 'corto', 30, 'Todos los temas estudiados una vez'], ['Aprobar el examen', 'medio', 45, 'Nota que me propongo']],
    [['Reunir apuntes y material', 0, 1, 30, 'Juntar todo en una carpeta'], ['Dividir el temario por semanas', 0, 2, 30], ['Estudiar la primera mitad', 0, 14, 600], ['Estudiar la segunda mitad', 0, 28, 600],
     ['Hacer exámenes de otros años', 1, 35, 180], ['Repaso general', 1, 42, 240, null, ['Resúmenes', 'Dudas', 'Simulacro']], ['Preparar lo necesario para el día', 1, 44, 15]]),
  builtinTpl('viaje', 'Organizar un viaje', '✈️', '#30b0c7', 'Transporte, alojamiento, plan y maleta, en orden.',
    [['Tener todo reservado', 'corto', 21, 'Billetes y alojamiento confirmados'], ['Salir con todo listo', 'corto', 40, 'Maleta hecha y documentos a mano']],
    [['Decidir destino, fechas y presupuesto', 0, 2, 30], ['Reservar transporte', 0, 7, 45], ['Reservar alojamiento', 0, 10, 45], ['Revisar documentos (DNI, pasaporte, seguro)', 1, 14, 20],
     ['Plan día a día', 1, 30, 60], ['Hacer la maleta', 1, 39, 45, 'Sacar la maleta y la lista', ['Ropa', 'Neceser', 'Cargadores', 'Documentos']], ['Check-in online', 1, 39, 10]]),
  builtinTpl('evento', 'Organizar un evento', '⭐', '#af52de', 'Cumpleaños, boda, reunión o fiesta: invitados, lugar y detalles.',
    [['Tener lugar e invitados confirmados', 'corto', 21, 'Lugar reservado y lista cerrada'], ['Que el evento salga bien', 'medio', 45, 'Todo preparado el día antes']],
    [['Decidir fecha, estilo y presupuesto', 0, 2, 30], ['Hacer lista de invitados', 0, 4, 30], ['Reservar el lugar', 0, 10, 60], ['Enviar invitaciones', 0, 14, 30],
     ['Comida y bebida', 1, 30, 60], ['Decoración y música', 1, 35, 60], ['Confirmar asistentes', 1, 38, 20], ['Preparar todo el día antes', 1, 44, 120]]),
  builtinTpl('trabajo', 'Buscar trabajo', '💼', '#64748b', 'Preparar el CV, enviar candidaturas y llevar el seguimiento.',
    [['Tener CV y perfil listos', 'corto', 10, 'CV actualizado y perfil profesional al día'], ['Conseguir el nuevo trabajo', 'medio', 90, 'Oferta aceptada']],
    [['Decidir qué tipo de puesto busco', 0, 2, 30, 'Escribir 3 puestos que me encajan'], ['Actualizar el CV', 0, 6, 90], ['Actualizar el perfil profesional', 0, 8, 45], ['Preparar carta de presentación base', 0, 10, 45],
     ['Enviar 5 candidaturas por semana', 1, 17, 120], ['Pedir recomendaciones a contactos', 1, 20, 30], ['Preparar entrevistas', 1, 30, 90, null, ['Preguntas típicas', 'Mis logros', 'Preguntas para ellos']]]),
  builtinTpl('ahorro', 'Ahorrar dinero', '💰', '#0f766e', 'Saber en qué se va el dinero y apartar cada mes.',
    [['Saber en qué gasto', 'corto', 14, 'Gastos de un mes apuntados'], ['Llegar a mi meta de ahorro', 'largo', 180, 'Tener la cantidad que me propongo']],
    [['Fijar cuánto quiero ahorrar y para qué', 1, 1, 15], ['Apuntar los gastos de este mes', 0, 14, 10, 'Abrir el banco y mirar los últimos movimientos'], ['Revisar suscripciones y cancelar las que sobran', 0, 7, 30], ['Hacer un presupuesto mensual', 0, 15, 45],
     ['Programar una transferencia automática', 1, 16, 10], ['Revisar el ahorro cada mes', 1, 45, 20]]),
];
function projectTemplateById(id) { return BUILTIN_TEMPLATES.find(t => t.id === id) || templatesList().find(t => t.id === id); }
function tplCount(t) { const g = t.data.goals.length, n = t.data.tasks.length; return `${g} objetivo${g === 1 ? '' : 's'} · ${n} tarea${n === 1 ? '' : 's'}`; }
function tplCard(t) {
  const p = t.data.project;
  return `<button type="button" class="tpl-card" data-modal="pick" data-id="${esc(t.id)}" style="--c:${p.color || '#007aff'}">
    <span class="tpl-ic">${esc(p.icon || '📁')}</span><span class="tpl-name">${esc(t.name)}</span><span class="tpl-meta">${tplCount(t)}</span></button>`;
}
/* Hoja «Nuevo proyecto»: vacío, plantillas hechas y las tuyas */
function newProjectSheet(ctx = {}) {
  const mine = templatesList().filter(t => t.kind === 'project');
  openModal('Nuevo proyecto', `
    <button type="button" class="tpl-blank" data-modal="blank"><span class="tpl-ic">${I.plus}</span><span class="grow"><b>Proyecto vacío</b><span class="small muted">Empieza de cero y ponle tus objetivos y tareas</span></span></button>
    <div class="tpl-h">Plantillas</div>
    <div class="tpl-grid">${BUILTIN_TEMPLATES.map(tplCard).join('')}</div>
    <div class="tpl-h">Tus plantillas</div>
    ${mine.length ? `<div class="tpl-grid">${mine.map(tplCard).join('')}</div>` : '<p class="hint">Aún no tienes. Crea una a partir de un proyecto tuyo: guarda sus objetivos y tareas para repetirlo cuando quieras.</p>'}
    <button type="button" class="btn wide" data-modal="own">${I.template}<span>Crear plantilla desde un proyecto</span></button>`, {
    actions: {
      blank: () => { modal.close(); projectModal(ctx); },
      pick: el => { const t = projectTemplateById(el.dataset.id); if (t) templatePreview(t); },
      own: () => {
        const ps = state.projects.filter(p => !p.archived);
        if (!ps.length) { toast('Primero crea un proyecto; luego podrás guardarlo como plantilla'); return; }
        actionSheet('¿Qué proyecto guardas?', ps.map(p => [esc(p.name), `<span class="swatch emoji sm" style="--c:${p.color}">${esc(p.icon || '📁')}</span>`, () => saveProjectTemplate(p.id)]), 'Se guardan sus objetivos y tareas; las fechas pasan a contar desde el día que la uses.');
      },
    },
  });
}
/* Vista previa: cambia el nombre, mira qué trae y créalo */
function templatePreview(t) {
  const d = t.data, gs = d.goals;
  const when = o => o == null ? '' : o <= 0 ? 'hoy' : o === 1 ? 'mañana' : `en ${o} días`;
  const tasksOf = ref => d.tasks.filter(x => (x.goalRef || null) === ref);
  const list = arr => `<ul class="tpl-tasks">${arr.map(x => `<li><span>${esc(x.title)}</span>${x.dueOff != null ? `<span class="muted small">${when(x.dueOff)}</span>` : ''}</li>`).join('')}</ul>`;
  const loose = d.tasks.filter(x => !x.goalRef || !gs.some(g => g.ref === x.goalRef));
  openModal(esc(t.name), `
    <div class="tpl-hero" style="--c:${d.project.color || '#007aff'}"><span class="tpl-ic">${esc(d.project.icon || '📁')}</span><span class="small muted">${esc(t.about || d.project.notes || 'Tu plantilla')}</span></div>
    <label class="field">Nombre del proyecto<input type="text" name="name" value="${esc(d.project.name)}" maxlength="80" required></label>
    ${gs.map(g => `<div class="tpl-goal"><div class="tpl-goal-h">◎ ${esc(g.title)}</div>${list(tasksOf(g.ref))}</div>`).join('')}
    ${loose.length ? `<div class="tpl-goal"><div class="tpl-goal-h">Otras tareas</div>${list(loose)}</div>` : ''}
    <p class="hint">Las fechas cuentan desde hoy. Después puedes cambiar, borrar o añadir lo que quieras.</p>`, {
    onSave: f => { useProjectTemplate(t, f.name); },
    saveLabel: 'Crear',
    ...(t.builtin ? {} : { onDelete: () => { if (!confirm('¿Eliminar esta plantilla? Los proyectos ya creados no cambian.')) return false; state.templates = templatesList().filter(x => x.id !== t.id); save(); toast('Plantilla eliminada'); }, deleteLabel: 'Eliminar plantilla' }),
  });
}
