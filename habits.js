/* P Organizer — Hábitos con rachas (v27).
   Un hábito se marca sí/no cada día: no crea tareas ni se acumula (eso son las Diarias).
   Datos (se sincronizan con el resto): state.habits = [{ id, title, icon, color, freq: 'daily'|'days'|'weekly',
   days: [0-6], n: veces por semana, done: { 'YYYY-MM-DD': 1 }, createdAt, order }] */
'use strict';

if (!I.check) I.check = svg('<path d="M5.5 12.5l4 4 9-9"/>', 'stroke-width="2.8"');
const HABIT_ICONS = ['💧', '📚', '🏃', '🧘', '🥗', '😴', '✍️', '🎸', '🧹', '💊', '📵', '🦷', '🚶', '💪', '🙏', '🌱'];
const HABIT_MILESTONES = [3, 7, 14, 21, 30, 50, 66, 100, 150, 200, 365];

function habits() { return (state.habits = state.habits || []); }
const habitById = id => habits().find(h => h.id === id);
const habitDone = (h, d) => !!(h.done && h.done[d]);
function habitStart(h) {
  const c = dateOfTs(h.createdAt || Date.now());
  const first = Object.keys(h.done || {}).sort()[0];
  return first && first < c ? first : c;
}
/* ¿Toca hoy? Los de «X veces por semana» se muestran cada día hasta cumplir */
function habitDueOn(h, d) {
  if (h.freq === 'days') return (h.days || []).includes(dow(d));
  return true;
}
function weekCount(h, ws) { return weekDays(ws).filter(d => habitDone(h, d)).length; }
function habitFreqLabel(h) {
  if (h.freq === 'weekly') return `${h.n || 3} ${h.n === 1 ? 'vez' : 'veces'} por semana`;
  if (h.freq === 'days') {
    const ds = [1, 2, 3, 4, 5, 6, 0].filter(x => (h.days || []).includes(x));
    if (ds.length === 5 && !ds.includes(0) && !ds.includes(6)) return 'De lunes a viernes';
    if (ds.length === 2 && ds.includes(0) && ds.includes(6)) return 'Fines de semana';
    return ds.map(x => DOW_SHORT[x]).join(', ') || 'Ningún día';
  }
  return 'Cada día';
}

/* Racha actual, mejor racha y % de cumplimiento (30 días). Unidad: días o semanas */
function habitStats(h) {
  const today = todayStr(), start = habitStart(h);
  if (h.freq === 'weekly') {
    const n = h.n || 3, ws0 = startOfWeek(today), wsStart = startOfWeek(start);
    let streak = 0, ws = ws0;
    if (weekCount(h, ws) < n) ws = addDays(ws, -7);       /* la semana en curso aún puede cumplirse */
    for (; ws >= wsStart; ws = addDays(ws, -7)) { if (weekCount(h, ws) >= n) streak++; else break; }
    let best = 0, run = 0;
    for (let w = wsStart; w <= ws0; w = addDays(w, 7)) {
      const ok = weekCount(h, w) >= n;
      run = ok ? run + 1 : (w === ws0 ? run : 0);
      best = Math.max(best, run);
    }
    return { streak, best: Math.max(best, streak), unit: 'week', week: weekCount(h, ws0), n };
  }
  let streak = 0, d = today;
  if (!habitDone(h, today)) d = addDays(today, -1);
  for (; d >= start; d = addDays(d, -1)) {
    if (!habitDueOn(h, d)) continue;
    if (habitDone(h, d)) streak++; else break;
  }
  let best = 0, run = 0, due30 = 0, done30 = 0;
  const from30 = addDays(today, -29);
  for (let x = start; x <= today; x = addDays(x, 1)) {
    if (!habitDueOn(h, x)) continue;
    const ok = habitDone(h, x);
    run = ok ? run + 1 : (x === today ? run : 0);
    best = Math.max(best, run);
    if (x >= from30 && (x < today || ok)) { due30++; if (ok) done30++; }
  }
  return { streak, best: Math.max(best, streak), unit: 'day', rate: due30 ? Math.round(done30 / due30 * 100) : null };
}
const streakWord = (n, unit) => unit === 'week' ? `${n} semana${n === 1 ? '' : 's'}` : `${n} día${n === 1 ? '' : 's'}`;
function habitSub(h, st) {
  const parts = [];
  if (st.streak) parts.push(`<span class="streak">🔥 ${streakWord(st.streak, st.unit)}</span>`);
  if (h.freq === 'weekly') parts.push(`${st.week}/${st.n} esta semana`);
  else if (!st.streak) parts.push(st.best ? `Mejor racha: ${streakWord(st.best, st.unit)}` : 'Empieza hoy tu racha');
  if (st.streak && st.best > st.streak) parts.push(`mejor ${st.best}`);
  return parts.join(' · ');
}

/* ---------- Piezas ---------- */

function habitCheck(h, d) {
  const on = habitDone(h, d);
  return `<button class="habit-check ${on ? 'on' : ''}" data-act="habit-toggle" data-id="${h.id}" data-date="${d}" style="--c:${h.color}" aria-pressed="${on}" aria-label="${on ? 'Desmarcar' : 'Marcar'} ${esc(h.title)}">
    <span class="hc-icon">${esc(h.icon || '✓')}</span><span class="hc-tick">${I.check}</span></button>`;
}
/* Fila compacta (Hoy) */
function habitRow(h, d) {
  const st = habitStats(h);
  return `<li class="habit-row" data-habit="${h.id}" data-kind="row" data-date="${d}">
    ${habitCheck(h, d)}
    <button class="habit-main" data-act="habit-edit" data-id="${h.id}">
      <span class="habit-title">${esc(h.title)}</span>
      <span class="habit-sub">${habitSub(h, st)}</span>
    </button>
  </li>`;
}
/* Tarjeta con la semana (pantalla Hábitos) */
function habitCard(h) {
  const today = todayStr(), st = habitStats(h);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return `<div class="habit-card glass" data-habit="${h.id}" data-kind="card" style="--c:${h.color}">
    <div class="habit-top">
      ${habitCheck(h, today)}
      <button class="habit-main" data-act="habit-edit" data-id="${h.id}">
        <span class="habit-title">${esc(h.title)}</span>
        <span class="habit-sub">${esc(habitFreqLabel(h))}</span>
      </button>
      <div class="habit-streak ${st.streak ? 'on' : ''}"><b>${st.streak ? '🔥 ' : ''}${st.streak}</b><span>${st.unit === 'week' ? (st.streak === 1 ? 'semana' : 'semanas') : (st.streak === 1 ? 'día' : 'días')}</span></div>
    </div>
    <div class="habit-week">${days.map(d => {
      const due = habitDueOn(h, d), on = habitDone(h, d);
      return `<button class="hw-day ${on ? 'on' : ''} ${due ? '' : 'off'} ${d === today ? 'is-today' : ''}" data-act="habit-toggle" data-id="${h.id}" data-date="${d}" aria-pressed="${on}" aria-label="${esc(fmtLongDate(d))}">
        <span class="hw-l">${DOW_LETTER[dow(d)]}</span><span class="hw-dot"></span></button>`;
    }).join('')}</div>
    <div class="habit-foot small muted">${st.best ? `Mejor racha: ${streakWord(st.best, st.unit)}` : 'Aún sin racha'}${st.rate !== null && st.rate !== undefined ? ` · ${st.rate}% en 30 días` : ''}${h.freq === 'weekly' ? ` · ${st.week}/${st.n} esta semana` : ''}</div>
  </div>`;
}

/* Sección de Hoy */
function habitsTodaySection(d) {
  const list = habits().filter(h => habitDueOn(h, d)).sort(habitOrder);
  if (!habits().length) {
    if (state.settings.ui.habitHintOff || d !== todayStr()) return '';
    return `<div class="plan-card glass habit-hint">
      <div class="grow"><div class="title">Crea un hábito 🔥</div><div class="small muted">Márcalo cada día y mira crecer tu racha.</div></div>
      <button class="btn small" data-act="habit-new">Crear</button>
      <button class="icon-btn" data-act="habit-hint-off" aria-label="Ahora no">${I.close}</button>
    </div>`;
  }
  if (!list.length) return '';
  const done = list.filter(h => habitDone(h, d)).length;
  return collapsible('habitos', 'Hábitos', `${done}/${list.length}`, `<ul class="habit-list glass">${list.map(h => habitRow(h, d)).join('')}</ul>`,
    `<a class="btn small ghost" href="#habitos">Ver todos</a>`);
}
const habitOrder = (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);

/* Sección de Progreso */
function habitsStatsSection() {
  const list = habits().slice().sort(habitOrder);
  return `<div class="section"><div class="section-head"><h2>Hábitos</h2><a class="btn small ghost" href="#habitos">${list.length ? 'Ver hábitos' : 'Crear hábito'}</a></div>
    ${list.length ? `<div class="settings-group glass">${list.map(h => { const st = habitStats(h); return `<a class="item" href="#habitos"><span class="habit-ico" style="--c:${h.color}">${esc(h.icon || '✓')}</span><div class="grow"><div>${esc(h.title)}</div><div class="small muted">Mejor racha ${streakWord(st.best, st.unit)}${st.rate !== null && st.rate !== undefined ? ` · ${st.rate}% en 30 días` : ''}</div></div><b class="streak big">🔥 ${st.streak}</b></a>`; }).join('')}</div>`
      : emptyBox('Los hábitos son cosas que quieres hacer a menudo, como leer o hacer deporte. Márcalos cada día y verás tu racha aquí.')}
  </div>`;
}
function bestHabitStreak() { return Math.max(0, ...habits().filter(h => h.freq !== 'weekly').map(h => habitStats(h).streak)); }

/* ---------- Pantalla Hábitos ---------- */

function viewHabits() {
  const list = habits().slice().sort(habitOrder);
  const today = todayStr();
  const due = list.filter(h => habitDueOn(h, today)), done = due.filter(h => habitDone(h, today)).length;
  return `
  <div class="page page-mid page-habits">
  ${pageHead({ eyebrow: backLink('#progreso', 'Progreso'), title: 'Hábitos', actions: `<button class="btn primary" data-act="habit-new">${I.plus}<span>Nuevo</span></button>` })}
  <p class="hint intro">Márcalos cada día y tu racha 🔥 crece. No crean tareas ni se acumulan.</p>
  ${list.length ? `<div class="section day-prog">${statRow('habits-today', due.length ? Math.round(done / due.length * 100) : 0, due.length ? `Hoy ${done} de ${due.length}` : 'Hoy no toca ninguno')}</div>
    <div class="habit-cards">${list.map(habitCard).join('')}</div>
    <p class="hint">Toca un día de la semana para marcarlo si se te olvidó. Toca el nombre para cambiarlo.</p>`
    : `<div class="habit-empty">
        ${emptyBox('Aún no tienes hábitos. Empieza por uno pequeño: beber agua, leer 10 páginas, caminar 20 minutos…')}
        <div class="habit-ideas">${[['💧', 'Beber 2 litros de agua'], ['📚', 'Leer 10 páginas'], ['🚶', 'Caminar 20 minutos'], ['🧘', 'Meditar 5 minutos'], ['📵', 'Sin móvil antes de dormir'], ['😴', 'Dormir antes de las 12']].map(([ic, t]) => `<button class="pick-chip" data-act="habit-idea" data-icon="${ic}" data-title="${esc(t)}">${ic} ${esc(t)}</button>`).join('')}</div>
      </div>`}
  </div>`;
}

function habitModal(h0) {
  const isNew = !h0 || !h0.id;
  const h = isNew ? { title: '', icon: HABIT_ICONS[0], color: COLORS[(habits().length + 2) % COLORS.length], freq: 'daily', days: [1, 2, 3, 4, 5], n: 3, ...(h0 || {}) } : h0;
  openModal(isNew ? 'Nuevo hábito' : 'Hábito', `
    <label class="field">Qué quieres hacer<input type="text" name="title" required value="${esc(h.title)}" placeholder="Leer 10 páginas, caminar…" maxlength="80"></label>
    <div class="field">Icono<div class="icon-pick">${HABIT_ICONS.map(ic => `<label><input type="radio" name="icon" value="${ic}" ${ic === h.icon ? 'checked' : ''}><span>${ic}</span></label>`).join('')}</div></div>
    <div class="field">Cuándo<div class="seg-radio">${[['daily', 'Cada día'], ['days', 'Algunos días'], ['weekly', 'Por semana']].map(([v, l]) => `<label><input type="radio" name="freq" value="${v}" ${h.freq === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <div class="field hf-days">Días${daysPicker('hday', h.days || [])}</div>
    <div class="field hf-weekly">Cuántas veces por semana<div class="seg-radio">${[1, 2, 3, 4, 5, 6].map(n => `<label><input type="radio" name="n" value="${n}" ${(h.n || 3) === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
    <div class="field">Color${colorField('color', h.color)}</div>
    <p class="hint">La racha cuenta los ${h.freq === 'weekly' ? 'días o semanas' : 'días'} seguidos que lo cumples. Si un día no toca, no la rompe.</p>`, {
    onSave: (d, fd) => {
      const title = d.title.trim();
      if (!title) { toast('Escribe el hábito'); return false; }
      const days = fd.getAll('hday').map(Number);
      if (d.freq === 'days' && !days.length) { toast('Elige al menos un día'); return false; }
      const obj = isNew ? { id: uid(), done: {}, createdAt: Date.now(), order: Date.now() } : habitById(h.id);
      Object.assign(obj, { title, icon: d.icon || '✓', color: readColor(d, 'color') || h.color, freq: d.freq || 'daily', days: d.freq === 'days' ? days : [], n: clamp(Number(d.n) || 3, 1, 6) });
      if (isNew) habits().push(obj);
      toast(isNew ? 'Hábito creado. ¡A por la racha!' : 'Guardado');
    },
    onDelete: isNew ? null : () => {
      const i = habits().findIndex(x => x.id === h.id);
      if (i < 0) return;
      const [gone] = habits().splice(i, 1);
      toast('Hábito eliminado', { action: 'Deshacer', onAction: () => { habits().splice(i, 0, gone); save(); rerender(); } });
    },
    deleteLabel: 'Eliminar hábito',
  });
  modalForm.dataset.hf = h.freq;
}

/* Marca o desmarca sin repintar la pantalla: solo cambian el botón y su fila */
function toggleHabit(id, d) {
  const h = habitById(id);
  if (!h) return;
  h.done = h.done || {};
  const before = habitStats(h).streak;
  if (h.done[d]) delete h.done[d]; else h.done[d] = 1;
  save();
  haptic(h.done[d] ? 12 : 6);
  const st = habitStats(h);
  $$(`[data-habit="${id}"]`).forEach(el => {
    const tpl = document.createElement('template');
    tpl.innerHTML = el.dataset.kind === 'card' ? habitCard(h) : habitRow(h, el.dataset.date);
    const fresh = tpl.content.firstElementChild;
    el.replaceWith(fresh);
    const b = fresh.querySelector(`.habit-check[data-date="${d}"], .hw-day[data-date="${d}"]`);
    if (b && h.done[d]) { b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 400); }
  });
  refreshLive();
  if (h.done[d] && st.streak > before && HABIT_MILESTONES.includes(st.streak)) toast(`🔥 ¡${streakWord(st.streak, st.unit)} seguid${st.unit === 'week' ? 'as' : 'os'}! Sigue así.`);
  else if (h.done[d] && d === todayStr()) toast(pick(['¡Hecho! 🔥', '¡Bien!', '¡Uno más!', '¡Sigue así!']));
}

document.addEventListener('click', e => {
  if (typeof suppressClickUntil !== 'undefined' && Date.now() < suppressClickUntil) return;
  const el = e.target.closest('[data-act^="habit-"]');
  if (!el || el.closest('#modal')) return;
  const act = el.dataset.act;
  if (act === 'habit-toggle') { e.preventDefault(); toggleHabit(el.dataset.id, el.dataset.date); }
  else if (act === 'habit-new') habitModal();
  else if (act === 'habit-edit') { const h = habitById(el.dataset.id); if (h) habitModal(h); }
  else if (act === 'habit-idea') habitModal({ title: el.dataset.title, icon: el.dataset.icon });
  else if (act === 'habit-hint-off') {
    state.settings.ui.habitHintOff = true; save(true);
    const c = el.closest('.habit-hint'); if (c) c.remove();
  }
});
document.addEventListener('change', e => {
  if (e.target.name === 'freq' && e.target.closest('#modal-form')) $('#modal-form').dataset.hf = e.target.value;
});
