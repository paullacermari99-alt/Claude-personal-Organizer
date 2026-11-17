/* Boldup — papelera, reprogramar en bloque, plantillas, resumen de la mañana y revisión guiada */

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
/* Abre otra hoja justo después de que se cierre la actual (submitModal cierra después de onSave) */
const thenOpen = fn => { if (fn) setTimeout(fn, 0); };
/* Copia un proyecto a datos de plantilla: fechas en días desde hoy */
function projectToTemplateData(pid) {
  const p = project(pid);
  if (!p) return null;
  const today = todayStr();
  const goals = state.goals.filter(g => g.projectId === pid);
  const off = d => d ? Math.max(0, daysBetween(today, d)) : null;
  const tasks = state.tasks.filter(t => !isRoutineTask(t) && (t.projectId === pid || goals.some(g => g.id === t.goalId)));
  return {
    project: { name: p.name, icon: p.icon, color: p.color, defaultView: p.defaultView, notes: p.notes },
    goals: goals.map(g => ({ ref: g.id, title: g.title, horizon: g.horizon, dueOff: off(g.due), description: g.description, success: g.success, progressMode: g.progressMode, color: g.color })),
    tasks: tasks.map(t => ({ title: t.title, notes: t.notes, priority: t.priority, estimate: t.estimate, firstStep: t.firstStep, tags: t.tags, goalRef: t.goalId, dueOff: off(t.due), subtasks: (t.subtasks || []).map(s => s.title) })),
  };
}
/* Guardar un proyecto como plantilla: abre el editor con todo ya puesto para revisarlo */
function saveProjectTemplate(pid, after) {
  const data = projectToTemplateData(pid);
  if (!data) return;
  templateEditor({ name: data.project.name, data }, { after, fromProject: true });
}
/* Elegir cómo crear una plantilla: de cero o copiando un proyecto */
function newTemplateFlow(after) {
  const ps = state.projects.filter(p => !p.archived);
  if (!ps.length) { templateEditor(null, { after }); return; }
  actionSheet('Crear plantilla', [
    ['Empezar de cero', I.plus, () => templateEditor(null, { after })],
    ...ps.map(p => [`Copiar «${esc(p.name)}»`, `<span class="swatch emoji sm" style="--c:${p.color}">${esc(p.icon || '📁')}</span>`, () => saveProjectTemplate(p.id, after)]),
  ], 'O copia uno de tus proyectos: se guardan sus objetivos y tareas, y las fechas pasan a contar desde el día que la uses.');
}
/* Editor de plantilla de proyecto: nombre, icono, color, objetivos con sus tareas y plazos en días */
function templateEditor(src, opts = {}) {
  const d = src ? src.data : { project: { name: '', icon: '📁', color: COLORS[templatesList().length % COLORS.length], defaultView: 'resumen', notes: '' }, goals: [], tasks: [] };
  const srcGoals = d.goals.slice(), srcTasks = d.tasks.slice();
  const icons = PROJECT_ICONS.includes(d.project.icon || '📁') ? PROJECT_ICONS : [d.project.icon, ...PROJECT_ICONS];
  const icon = d.project.icon || '📁';
  const num = v => v == null ? '' : v;
  const taskRow = (t, k) => `<div class="tpl-ed-line t" ${k != null ? `data-k="${k}"` : ''}>
      <input type="text" class="t-title" value="${esc(t ? t.title : '')}" placeholder="Tarea" maxlength="120" data-enter="next" enterkeyhint="next" aria-label="Tarea">
      <label class="tpl-ed-days"><input type="number" class="t-days" value="${t ? num(t.dueOff) : ''}" min="0" max="999" inputmode="numeric" placeholder="–" aria-label="Días hasta el plazo"><span>días</span></label>
      <button type="button" class="icon-btn" data-modal="rm" aria-label="Quitar">${I.close}</button></div>`;
  const goalBlock = (g, k) => {
    const ts = g ? srcTasks.map((t, i) => [t, i]).filter(([t]) => t.goalRef === g.ref) : [];
    return `<div class="tpl-ed-goal" ${k != null ? `data-k="${k}"` : ''}>
      <div class="tpl-ed-line g"><span class="tpl-ed-mark">◎</span>
        <input type="text" class="g-title" value="${esc(g ? g.title : '')}" placeholder="Objetivo (algo que puedas comprobar)" maxlength="120" data-enter="next" enterkeyhint="next" aria-label="Objetivo">
        <label class="tpl-ed-days"><input type="number" class="g-days" value="${g ? num(g.dueOff) : ''}" min="1" max="999" inputmode="numeric" placeholder="30" aria-label="Días hasta el plazo del objetivo"><span>días</span></label>
        <button type="button" class="icon-btn" data-modal="rm-goal" aria-label="Quitar objetivo">${I.close}</button></div>
      <div class="tpl-ed-tasks">${ts.map(([t, i]) => taskRow(t, i)).join('')}</div>
      <button type="button" class="btn small tpl-ed-add" data-modal="add-task">${I.plus}<span>Tarea</span></button></div>`;
  };
  const loose = srcTasks.map((t, i) => [t, i]).filter(([t]) => !t.goalRef || !srcGoals.some(g => g.ref === t.goalRef));
  const editing = opts.existing;
  openModal(editing ? 'Editar plantilla' : 'Nueva plantilla', `
    <p class="sheet-sub">Los días cuentan desde el día en que uses la plantilla. Pon cada tarea antes del plazo de su objetivo.</p>
    <label class="field">Nombre<input type="text" name="name" value="${esc(src ? src.name : '')}" maxlength="80" required placeholder="Ej.: Preparar una oposición"></label>
    <div class="field">Icono<div class="icon-pick">${icons.map(ic => `<label><input type="radio" name="icon" value="${esc(ic)}" ${ic === icon ? 'checked' : ''}><span>${esc(ic)}</span></label>`).join('')}</div></div>
    <div class="field">Color${colorField('color', d.project.color || COLORS[0])}</div>
    <div class="tpl-h">Objetivos y tareas</div>
    <div class="tpl-ed">
      ${srcGoals.map((g, i) => goalBlock(g, i)).join('')}
      ${!srcGoals.length && !src ? goalBlock(null) : ''}
      <div class="tpl-ed-goal loose"><div class="tpl-ed-line g"><span class="tpl-ed-mark">•</span><span class="grow small muted">Tareas sin objetivo</span></div>
        <div class="tpl-ed-tasks">${loose.map(([t, i]) => taskRow(t, i)).join('')}</div>
        <button type="button" class="btn small tpl-ed-add" data-modal="add-task">${I.plus}<span>Tarea</span></button></div>
    </div>
    <button type="button" class="btn wide" data-modal="add-goal">${I.target || I.plus}<span>Añadir objetivo</span></button>`, {
    saveLabel: 'Guardar',
    actions: {
      'add-task': b => { const box = b.closest('.tpl-ed-goal').querySelector('.tpl-ed-tasks'); box.insertAdjacentHTML('beforeend', taskRow(null)); box.lastElementChild.querySelector('input').focus(); },
      'add-goal': () => { const lo = modalForm.querySelector('.tpl-ed-goal.loose'); lo.insertAdjacentHTML('beforebegin', goalBlock(null)); lo.previousElementSibling.querySelector('.g-title').focus(); },
      rm: b => b.closest('.tpl-ed-line').remove(),
      'rm-goal': b => {
        const gEl = b.closest('.tpl-ed-goal'), rows = gEl.querySelectorAll('.tpl-ed-line.t');
        /* Sus tareas no se pierden: pasan a «sin objetivo» */
        const lo = modalForm.querySelector('.tpl-ed-goal.loose .tpl-ed-tasks');
        rows.forEach(r => { if (r.querySelector('.t-title').value.trim()) lo.appendChild(r); });
        gEl.remove();
      },
      /* Intro en un título: salta a la siguiente fila o crea una tarea nueva */
      next: inp => {
        const gEl = inp.closest('.tpl-ed-goal');
        const row = inp.closest('.tpl-ed-line');
        const nextRow = row.classList.contains('g') ? gEl.querySelector('.tpl-ed-line.t') : row.nextElementSibling;
        if (nextRow) { nextRow.querySelector('input').focus(); return; }
        if (!inp.value.trim()) { inp.blur(); return; }
        const box = gEl.querySelector('.tpl-ed-tasks');
        box.insertAdjacentHTML('beforeend', taskRow(null)); box.lastElementChild.querySelector('input').focus();
      },
    },
    onSave: f => {
      const days = (el, min) => { const v = el.value.trim(); if (v === '') return null; const n = Math.round(+v); return Number.isFinite(n) ? Math.min(999, Math.max(min, n)) : null; };
      const goals = [], tasks = [];
      const readTasks = (gEl, ref) => gEl.querySelectorAll('.tpl-ed-line.t').forEach(r => {
        const title = r.querySelector('.t-title').value.trim();
        if (!title) return;
        const old = r.dataset.k != null ? srcTasks[+r.dataset.k] : null;
        tasks.push({ notes: '', priority: 'none', estimate: null, firstStep: '', tags: [], subtasks: [], ...(old || {}), title, goalRef: ref, dueOff: days(r.querySelector('.t-days'), 0) });
      });
      modalForm.querySelectorAll('.tpl-ed-goal').forEach((gEl, i) => {
        if (gEl.classList.contains('loose')) { readTasks(gEl, null); return; }
        const title = gEl.querySelector('.g-title').value.trim();
        if (!title) { readTasks(gEl, null); return; }
        const old = gEl.dataset.k != null ? srcGoals[+gEl.dataset.k] : null;
        const ref = (old && old.ref) || 'g' + i + '-' + uid();
        const before = tasks.length;
        readTasks(gEl, ref);
        /* Coherencia: el objetivo no puede vencer antes que sus tareas */
        const latest = Math.max(0, ...tasks.slice(before).map(t => t.dueOff || 0));
        const dueOff = Math.max(days(gEl.querySelector('.g-days'), 1) || 30, latest || 1);
        goals.push({ description: '', success: '', progressMode: 'auto', ...(old || {}), ref, title, dueOff, horizon: horizonForDays(dueOff), color: (old && old.color) || readColor(f, 'color') || d.project.color });
      });
      if (!goals.length && !tasks.length) { toast('Añade al menos un objetivo o una tarea'); return false; }
      const name = (f.name || '').trim() || 'Mi plantilla';
      const data = { project: { ...d.project, name, icon: f.icon || '📁', color: readColor(f, 'color') || d.project.color || COLORS[0] }, goals, tasks };
      let saved;
      if (editing) { saved = templatesList().find(x => x.id === editing.id); if (saved) Object.assign(saved, { name, data, updatedAt: Date.now() }); }
      if (!saved) { saved = { id: uid(), kind: 'project', name, data, createdAt: Date.now() }; templatesList().push(saved); }
      toast(`Plantilla ${editing ? 'actualizada' : 'guardada'}: ${tplCount(saved)}`);
      thenOpen(opts.after && (() => opts.after(saved)));
    },
  });
}
function useProjectTemplate(tpl, name) {
  const today = todayStr(), d = tpl.data;
  const due = o => o == null ? null : addDays(today, Math.max(0, o));
  const p = { id: uid(), createdAt: Date.now(), order: state.projects.length, favorite: false, archived: false, ...d.project, name: (name || '').trim() || d.project.name };
  state.projects.push(p);
  const gmap = {};
  d.goals.forEach(g => {
    const gd = due(g.dueOff) || addDays(today, 30);
    const n = { id: uid(), status: 'activo', achievedAt: null, createdAt: Date.now(), progress: 0, projectId: p.id, title: g.title, horizon: horizonFor(gd), due: gd, description: g.description || '', success: g.success || '', progressMode: g.progressMode || 'auto', color: g.color || p.color };
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
function saveWeekTemplate(ws, after) {
  const we = addDays(ws, 6);
  const evs = state.events.filter(e => !e.recurrence && e.date >= ws && e.date <= we);
  if (!evs.length) { toast('Esta semana no tiene bloques para guardar (los que se repiten ya aparecen solos)'); return; }
  openModal('Guardar semana', `
    <p class="sheet-sub">Se guardan ${evs.length} bloque${evs.length === 1 ? '' : 's'} de la semana del ${esc(fmtShortDate(ws))} para ponerlos en otra semana de un toque.</p>
    <label class="field">Nombre de la plantilla<input type="text" name="name" value="Semana tipo" maxlength="80" required></label>`, {
    saveLabel: 'Guardar',
    onSave: f => {
      const data = { events: evs.map(e => ({ day: daysBetween(ws, e.date), start: e.start, end: e.end, title: e.title, color: e.color, tagId: e.tagId, projectId: e.projectId, goalId: e.goalId, notes: e.notes || '' })) };
      templatesList().push({ id: uid(), kind: 'week', name: (f.name || '').trim() || 'Semana tipo', data, createdAt: Date.now() });
      toast(`Plantilla guardada con ${evs.length} bloque${evs.length === 1 ? '' : 's'}`);
      thenOpen(after);
    },
  });
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
  const count = t => kind === 'week' ? `${t.data.events.length} bloques` : tplCount(t);
  const title = kind === 'week' ? 'Plantillas de semana' : 'Plantillas de proyecto';
  const reopen = () => templatesSheet(kind, ctx);
  openModal(title, `
    <p class="sheet-sub">${kind === 'week' ? `Guarda los bloques de una semana tipo y ponlos en otra de un toque. Se aplican a la semana del ${esc(fmtShortDate(ctx.ws))}.` : 'Guarda un proyecto con sus objetivos y tareas para empezar otro igual. Las fechas se ajustan a partir de hoy.'}</p>
    ${list.length ? `<div class="settings-group glass">${list.map(t => `<div class="item">
      <div class="grow"><div>${esc(t.name)}</div><div class="small muted">${count(t)}</div></div>
      <button type="button" class="btn small primary" data-modal="use" data-id="${t.id}">${kind === 'week' ? 'Aplicar' : 'Usar'}</button>
      ${kind === 'week' ? '' : `<button type="button" class="btn small" data-modal="edit" data-id="${t.id}">Editar</button>`}
      <button type="button" class="icon-btn" data-modal="del" data-id="${t.id}" aria-label="Eliminar plantilla">${I.close}</button>
    </div>`).join('')}</div>` : `<div class="empty">Aún no tienes plantillas${kind === 'week' ? ' de semana' : ' de proyecto'}.</div>`}
    ${kind === 'week' ? `<button type="button" class="btn wide" data-modal="save">${I.plus}<span>Guardar esta semana como plantilla</span></button>`
      : ctx.projectId ? `<button type="button" class="btn wide" data-modal="save">${I.plus}<span>Guardar este proyecto como plantilla</span></button>`
      : `<button type="button" class="btn wide" data-modal="new">${I.plus}<span>Crear plantilla</span></button>`}`, {
    actions: {
      use: el => { const t = templatesList().find(x => x.id === el.dataset.id); if (!t) return; if (kind === 'week') { modal.close(); useWeekTemplate(t, ctx.ws); } else templatePreview(t); },
      edit: el => { const t = templatesList().find(x => x.id === el.dataset.id); if (t) templateEditor(t, { existing: t, after: reopen }); },
      del: el => { if (!confirm('¿Eliminar la plantilla?')) return; state.templates = templatesList().filter(x => x.id !== el.dataset.id); save(); reopen(); },
      save: () => { kind === 'week' ? saveWeekTemplate(ctx.ws, reopen) : saveProjectTemplate(ctx.projectId, reopen); },
      new: () => newTemplateFlow(reopen),
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

/* ---------- Plantillas de proyecto ya hechas (revisadas en v29) ----------
   Reglas: objetivos concretos y comprobables; tareas en orden, cada una acerca a su objetivo
   y ninguna vence después que él; plazos holgados para alguien con trabajo o estudios;
   «minutos» = tiempo total aproximado (si es largo, va repartido en subtareas/sesiones).
   g: [título, días hasta el plazo, cómo sabré que lo he conseguido]
   t: [título, nº de objetivo o null, días hasta el plazo o null, minutos, primer paso, subtareas] */
const horizonForDays = n => n <= 90 ? 'corto' : n <= 365 ? 'medio' : 'largo';
function builtinTpl(id, name, icon, color, about, goals, tasks) {
  return { id: 'b:' + id, builtin: true, kind: 'project', name, about, data: {
    project: { name, icon, color, defaultView: 'resumen', notes: about },
    goals: goals.map(([title, dueOff, success], i) => ({ ref: 'g' + i, title, horizon: horizonForDays(dueOff), dueOff, success, description: '', progressMode: 'auto', color })),
    tasks: tasks.map(([title, gi, dueOff, estimate, firstStep, subtasks]) => ({ title, goalRef: gi == null ? null : 'g' + gi, dueOff, estimate: estimate || null, firstStep: firstStep || '', priority: 'none', tags: [], notes: '', subtasks: subtasks || [] })),
  } };
}
const BUILTIN_TEMPLATES = [
  builtinTpl('reforma', 'Reforma o mudanza', '🏠', '#ff9500', 'De la idea a estar ya instalado, sin que se te escape nada. Pensada para unos 2 meses y medio.',
    [['Cerrar presupuesto, profesional y fechas', 21, 'Presupuesto firmado y fecha de inicio acordada'],
     ['Terminar la obra y estar instalado', 75, 'Obra revisada, pagada y todo en su sitio']],
    [['Hacer la lista de lo que quiero cambiar', 0, 2, 30, 'Recorrer la casa con el móvil y apuntar cada cosa'],
     ['Fijar el presupuesto máximo', 0, 4, 20, 'Mirar cuánto puedo gastar sin tocar el colchón para imprevistos'],
     ['Pedir 3 presupuestos', 0, 10, 60, 'Buscar 3 profesionales con buenas opiniones', ['Pedir el primero', 'Pedir el segundo', 'Pedir el tercero']],
     ['Comparar presupuestos y elegir profesional', 0, 17, 45],
     ['Firmar el presupuesto y fijar fechas', 0, 21, 30],
     ['Avisar a la comunidad y pedir permisos si hacen falta', 1, 25, 20],
     ['Elegir y encargar materiales', 1, 30, 90, null, ['Hacer la lista', 'Comparar precios', 'Encargar']],
     ['Vaciar y proteger la zona de obra', 1, 34, 120],
     ['Revisar la obra con el profesional cada semana', 1, 63, 80, null, ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4']],
     ['Repasar los detalles antes del pago final', 1, 68, 45],
     ['Limpiar y colocar todo', 1, 75, 240, null, ['Limpiar', 'Montar muebles', 'Colocar las cosas']]]),
  builtinTpl('web', 'Lanzar una web o app', '💻', '#007aff', 'De la idea a tenerla publicada y con las primeras personas usándola, en unas 10 semanas.',
    [['Tener una primera versión que funcione', 42, 'Alguien puede usar la función principal de principio a fin'],
     ['Publicarla y conseguir 10 usuarios', 70, '10 personas la han probado y me han dado su opinión']],
    [['Escribir para quién es y qué problema resuelve', 0, 2, 30, 'Abrir una nota y escribir una frase'],
     ['Elegir las 3 funciones imprescindibles', 0, 4, 30, 'Apuntar todas las ideas y quedarte solo con 3'],
     ['Dibujar las pantallas principales', 0, 8, 60],
     ['Construir la función principal', 0, 18, 360, null, ['Preparar el proyecto', 'Hacer la función', 'Probarla']],
     ['Construir las otras dos funciones', 0, 32, 480, null, ['Función 2', 'Función 3']],
     ['Probarla con 3 personas y apuntar fallos', 0, 38, 90],
     ['Arreglar los fallos más importantes', 0, 42, 180],
     ['Elegir nombre y dominio', 1, 46, 30],
     ['Publicarla', 1, 50, 60],
     ['Contarlo donde está tu público', 1, 56, 60, null, ['Escribir el mensaje', 'Publicarlo en 2 sitios', 'Pedir a 5 conocidos que la prueben']],
     ['Hablar con los primeros usuarios y decidir mejoras', 1, 70, 60]]),
  builtinTpl('forma', 'Ponerse en forma', '🏋️', '#34c759', 'Crear el hábito en 4 semanas y llegar a una meta medible en 3 meses.',
    [['Entrenar 3 días por semana durante 4 semanas', 30, '12 entrenamientos hechos'],
     ['Conseguir mi meta física en 3 meses', 90, 'La meta con número que elijas, por ejemplo correr 5 km seguidos']],
    [['Elegir una meta concreta y medible', 1, 1, 15, 'Escribirla con un número: «correr 5 km», «hacer 10 flexiones»…'],
     ['Bloquear 3 huecos fijos para entrenar', 0, 2, 10, 'Mirar la semana y elegir días y horas'],
     ['Apuntar cómo estoy hoy', 1, 2, 15, null, ['Peso o medidas', 'Marca de partida (tiempo, repeticiones)']],
     ['Preparar ropa y material', 0, 3, 20],
     ['Hacer un plan sencillo de 4 semanas', 0, 4, 45, 'Empezar suave: sesiones de 20 a 30 minutos'],
     ['Primer entrenamiento', 0, 5, 30],
     ['Revisar la alimentación', 1, 14, 30, null, ['Apuntar lo que como 3 días', 'Elegir 2 cambios fáciles']],
     ['Repasar las 4 primeras semanas', 0, 30, 20, 'Contar cuántos entrenamientos hiciste'],
     ['Subir un poco la intensidad del plan', 1, 32, 30],
     ['Medir el progreso a mitad de camino', 1, 60, 20],
     ['Prueba final de la meta', 1, 90, 45]]),
  builtinTpl('examen', 'Preparar un examen', '📚', '#5856d6', 'Para un examen dentro de 6 semanas: 4 de estudio (una hora al día) y 2 de repaso.',
    [['Estudiar todo el temario una vez', 28, 'Todos los temas leídos y resumidos'],
     ['Llegar al examen con todo repasado', 42, 'Dos simulacros hechos y las dudas resueltas']],
    [['Reunir apuntes y material', 0, 1, 30, 'Juntar todo en una carpeta'],
     ['Repartir los temas en 4 semanas', 0, 2, 30, 'Contar los temas y dividirlos entre 4'],
     ['Semana 1 de estudio', 0, 7, 300, null, ['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4', 'Sesión 5']],
     ['Semana 2 de estudio', 0, 14, 300, null, ['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4', 'Sesión 5']],
     ['Semana 3 de estudio', 0, 21, 300, null, ['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4', 'Sesión 5']],
     ['Semana 4 de estudio', 0, 28, 300, null, ['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4', 'Sesión 5']],
     ['Apuntar las dudas y preguntarlas', 1, 31, 30],
     ['Simulacro 1 con un examen de otros años', 1, 33, 120],
     ['Repasar los temas que peor llevas', 1, 37, 240, null, ['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4']],
     ['Simulacro 2', 1, 39, 120],
     ['Repaso ligero de los resúmenes', 1, 41, 60],
     ['Preparar lo necesario para el día', 1, 41, 15, null, ['DNI', 'Bolígrafos', 'Calculadora si se permite', 'Cómo llegar y a qué hora']]]),
  builtinTpl('viaje', 'Organizar un viaje', '✈️', '#30b0c7', 'Para un viaje dentro de 6 semanas: transporte, alojamiento, plan y maleta, en orden.',
    [['Tener transporte y alojamiento reservados', 14, 'Billetes y alojamiento confirmados'],
     ['Salir de viaje con todo listo', 42, 'Maleta hecha, documentos a mano y plan para cada día']],
    [['Decidir destino, fechas y presupuesto', 0, 2, 30, 'Apuntar 2 o 3 destinos y cuánto puedo gastar'],
     ['Comparar y reservar el transporte', 0, 7, 45],
     ['Reservar el alojamiento', 0, 10, 45],
     ['Guardar todas las reservas en un solo sitio', 0, 14, 10],
     ['Revisar documentos (DNI, pasaporte, seguro)', 1, 15, 20, 'Mirar la fecha de caducidad: renovarlo puede tardar semanas'],
     ['Hacer un plan sencillo para cada día', 1, 30, 60],
     ['Preparar dinero y tarjetas para el viaje', 1, 36, 15],
     ['Hacer la maleta', 1, 40, 45, 'Sacar la maleta y la lista', ['Ropa', 'Neceser', 'Cargadores', 'Documentos']],
     ['Hacer el check-in online', 1, 41, 10]]),
  builtinTpl('evento', 'Organizar un evento', '⭐', '#af52de', 'Cumpleaños, boda, reunión o fiesta dentro de 6 semanas: lugar, invitados y detalles.',
    [['Tener fecha, lugar e invitaciones enviadas', 21, 'Lugar reservado e invitaciones enviadas'],
     ['Celebrar el evento sin agobios', 45, 'Todo preparado el día antes']],
    [['Decidir fecha, tipo de evento y presupuesto', 0, 2, 30],
     ['Hacer la lista de invitados', 0, 4, 30],
     ['Buscar y reservar el lugar', 0, 12, 90, null, ['Mirar 3 opciones', 'Preguntar precios y disponibilidad', 'Reservar']],
     ['Enviar las invitaciones', 0, 21, 30],
     ['Elegir comida y bebida', 1, 28, 60],
     ['Preparar decoración y música', 1, 32, 60],
     ['Confirmar asistentes', 1, 38, 20],
     ['Encargar la comida y lo que falte', 1, 40, 30],
     ['Preparar todo el día antes', 1, 44, 120]]),
  builtinTpl('trabajo', 'Buscar trabajo', '💼', '#64748b', 'CV listo en 10 días, candidaturas cada semana y entrevistas preparadas.',
    [['Tener CV y perfil listos', 10, 'CV actualizado y perfil profesional al día'],
     ['Conseguir 3 entrevistas', 45, '3 entrevistas hechas'],
     ['Conseguir el nuevo trabajo', 90, 'Oferta aceptada']],
    [['Decidir qué tipo de puesto busco', 0, 2, 30, 'Escribir 3 puestos que me encajan'],
     ['Actualizar el CV', 0, 6, 90, null, ['Experiencia', 'Logros con números', 'Revisar faltas']],
     ['Actualizar el perfil profesional', 0, 8, 45],
     ['Preparar una carta de presentación base', 0, 10, 45],
     ['Enviar 5 candidaturas (semana 1)', 1, 17, 120],
     ['Pedir recomendaciones a 3 contactos', 1, 20, 30],
     ['Enviar 5 candidaturas (semana 2)', 1, 24, 120],
     ['Preparar las entrevistas', 1, 28, 90, null, ['Preguntas típicas', 'Mis logros', 'Preguntas para ellos']],
     ['Enviar 5 candidaturas (semana 3)', 1, 31, 120],
     ['Revisar qué funciona y ajustar el CV', 1, 45, 30],
     ['Comparar ofertas y decidir', 2, 90, 45]]),
  builtinTpl('ahorro', 'Ahorrar dinero', '💰', '#0f766e', 'Saber en qué se va el dinero el primer mes y apartar cada mes durante medio año.',
    [['Saber en qué se va mi dinero', 30, 'Un mes de gastos apuntados y un presupuesto mensual'],
     ['Llegar a mi meta de ahorro en 6 meses', 180, 'Tener apartada la cantidad que me propuse']],
    [['Fijar cuánto quiero ahorrar y para qué', 1, 1, 15, 'Elegir una cifra y dividirla entre 6 meses'],
     ['Revisar los gastos del último mes', 0, 3, 30, 'Abrir el banco y mirar los últimos movimientos'],
     ['Revisar suscripciones y cancelar las que sobran', 0, 7, 30],
     ['Apuntar los gastos cada semana', 0, 28, 40, null, ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4']],
     ['Hacer un presupuesto mensual', 0, 30, 45],
     ['Programar una transferencia automática el día de cobro', 1, 31, 10],
     ['Revisar cómo va el ahorro (mes 2)', 1, 60, 15],
     ['Revisar cómo va el ahorro (mes 4)', 1, 120, 15],
     ['Comprobar si has llegado a la meta', 1, 180, 15]]),
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
    <div class="tpl-h tpl-mine">Tus plantillas</div>
    ${mine.length ? `<div class="tpl-grid">${mine.map(tplCard).join('')}</div>` : '<p class="hint">Aún no tienes. Crea una desde cero o copiando un proyecto tuyo, y la tendrás aquí para repetirlo cuando quieras.</p>'}
    <button type="button" class="btn wide" data-modal="own">${I.plus}<span>Crear plantilla</span></button>`, {
    actions: {
      blank: () => { modal.close(); const { showMine, ...c } = ctx; projectModal(c); },
      pick: el => { const t = projectTemplateById(el.dataset.id); if (t) templatePreview(t); },
      own: () => newTemplateFlow(() => newProjectSheet({ ...ctx, showMine: true })),
    },
  });
  /* Recién creada: se baja hasta «Tus plantillas» para verla */
  if (ctx.showMine) requestAnimationFrame(() => { const h = modalForm.querySelector('.tpl-mine'); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
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
    ${gs.map(g => `<div class="tpl-goal"><div class="tpl-goal-h"><span>◎ ${esc(g.title)}</span>${g.dueOff != null ? `<span class="muted small">meta ${when(g.dueOff)}</span>` : ''}</div>${g.success ? `<div class="small muted tpl-success">✓ ${esc(g.success)}</div>` : ''}${list(tasksOf(g.ref))}</div>`).join('')}
    ${loose.length ? `<div class="tpl-goal"><div class="tpl-goal-h">Otras tareas</div>${list(loose)}</div>` : ''}
    <p class="hint">Las fechas cuentan desde hoy. Después puedes cambiar, borrar o añadir lo que quieras.</p>
    ${t.builtin ? '' : `<button type="button" class="btn wide" data-modal="edit">Editar plantilla</button>`}`, {
    actions: { edit: () => templateEditor(t, { existing: t, after: saved => templatePreview(saved) }) },
    onSave: f => { useProjectTemplate(t, f.name); },
    saveLabel: 'Crear',
    ...(t.builtin ? {} : { onDelete: () => { if (!confirm('¿Eliminar esta plantilla? Los proyectos ya creados no cambian.')) return false; state.templates = templatesList().filter(x => x.id !== t.id); save(); toast('Plantilla eliminada'); }, deleteLabel: 'Eliminar plantilla' }),
  });
}
