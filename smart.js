/* P Organizer — escribir en lenguaje normal, tareas que se repiten, búsqueda y diario. */
'use strict';

/* Quita tildes y pasa a minúsculas para comparar */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- 1. Lenguaje normal: «dentista mañana 17h #salud» ---------- */

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const NUM_WORDS = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const UNIT_WORDS = { dia: 'day', dias: 'day', semana: 'week', semanas: 'week', mes: 'month', meses: 'month', ano: 'year', anos: 'year' };

function nextWeekday(from, wd, strictlyAfter) {
  let n = (wd - dow(from) + 7) % 7;
  if (n === 0 && strictlyAfter) n = 7;
  return addDays(from, n);
}
function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? ymd(dt) : null;
}
/* Si no se dice el año, la próxima vez que llegue esa fecha */
function upcoming(m, d, today) {
  const y = Number(today.slice(0, 4));
  const a = validDate(y, m, d);
  return a && a >= today ? a : validDate(y + 1, m, d);
}

/* Devuelve { title, due, time, estimate, tags, newTags, projectId, priority, repeat, found[] } */
function parseQuick(text, today = todayStr()) {
  let s = ' ' + text + ' ';
  const out = { due: null, time: null, estimate: null, tags: [], newTags: [], projectId: null, priority: null, repeat: null, found: [] };
  /* Busca sin tildes ni mayúsculas en una copia carácter a carácter (mismas posiciones) y corta el texto original */
  const plain = () => s.split('').map(c => { const n = norm(c); return n.length === 1 ? n : c; }).join('');
  const take = (re, fn) => {
    const m = re.exec(plain());
    if (!m) return false;
    const orig = s.slice(m.index, m.index + m[0].length);
    if (fn(m, orig) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  /* Etiquetas #salud y proyecto @trabajo / +trabajo */
  take(/\s[@+]([\wÀ-ɏ-]+)/u, (m, orig) => {
    const name = norm(orig.trim().slice(1));
    const p = state.projects.find(x => !x.archived && norm(x.name) === name) || state.projects.find(x => !x.archived && norm(x.name).startsWith(name));
    if (!p) return false;
    out.projectId = p.id; out.found.push(`${p.icon || ''} ${p.name}`.trim());
  });
  while (take(/\s#([\wÀ-ɏ-]+)/u, (m, orig) => {
    const raw = orig.trim().slice(1), name = norm(raw);
    const tg = state.tags.find(x => norm(x.name) === name) || state.tags.find(x => norm(x.name).startsWith(name));
    if (tg) { if (!out.tags.includes(tg.id)) out.tags.push(tg.id); out.found.push('#' + tg.name); }
    else { out.newTags.push(cap(raw)); out.found.push('#' + cap(raw) + ' (nueva)'); }
  }));

  /* Prioridad: !alta !media !baja o !! */
  take(/\s(!!|!alta|!media|!baja|!1|!2|!3)(?=\s)/, m => {
    const v = { '!!': 'high', '!alta': 'high', '!1': 'high', '!media': 'med', '!2': 'med', '!baja': 'low', '!3': 'low' }[m[1]];
    out.priority = v; out.found.push('Prioridad ' + PRIORITIES[v].toLowerCase());
  });

  /* Repetición: cada día / cada semana / cada 2 semanas / cada mes / cada año / cada lunes */
  take(/\s(?:todos los|todas las|cada)\s+(?:(\d+)\s+)?(dias?|semanas?|mes(?:es)?|anos?|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)(?=\s)/, m => {
    const w = m[2].replace(/^(sabado|domingo)s$/, '$1');
    if (WEEKDAYS[w] !== undefined) {
      out.repeat = { n: 1, unit: 'week' };
      if (!out.due) out.due = nextWeekday(today, WEEKDAYS[w], false);
      out.found.push('↻ cada ' + w.replace('miercoles', 'miércoles').replace('sabado', 'sábado'));
    } else {
      const unit = UNIT_WORDS[m[2]];
      out.repeat = { n: Number(m[1]) || 1, unit };
      out.found.push('↻ ' + repeatLabel(out.repeat));
    }
  });

  /* Duración: 30 min, 1 hora, 2 horas, 1h30 */
  take(/\s(\d{1,3})\s?(?:min|mins|minutos?)(?=\s)/, m => { out.estimate = Number(m[1]); });
  if (!out.estimate) take(/\s(\d{1,2})(?:[.,](5))?\s?horas?(?=\s)/, m => { out.estimate = Number(m[1]) * 60 + (m[2] ? 30 : 0); });
  if (!out.estimate) take(/\s(\d)h(\d{2})(?:min)?(?=\s)/, m => { out.estimate = Number(m[1]) * 60 + Number(m[2]); });
  if (out.estimate) out.found.push('⏱ ' + durLabelShort(out.estimate));

  /* Hora: 17:30, 17h, a las 5, 9am, 5 de la tarde, a las diez y media, de 5 a 7, a mediodía */
  const setTime = (h, mi) => { if (h > 23 || mi > 59) return false; out.time = pad(h) + ':' + pad(mi); };
  /* Números en palabra tras «a las», «de», «hasta las»: «a las diez» → «a las 10» */
  const NW = '(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)', nw = w => NUM_WORDS[norm(w)] || w;
  s = s.replace(new RegExp(`(\\s(?:a\\s+las?|desde\\s+las?|hasta\\s+las?)\\s+)${NW}(?=\\s)`, 'gi'), (m0, pre, w) => pre + nw(w));
  s = s.replace(new RegExp(`(\\sde\\s+)(${NW}|\\d{1,2})(\\s+a\\s+(?:las?\\s+)?)(${NW}|\\d{1,2})(?=\\s)`, 'gi'), (m0, a, w1, x1, b, w2) => a + nw(w1) + b + nw(w2));
  const pmGuess = (h, part) => ((part === 'tarde' || part === 'noche') && h < 12) ? h + 12 : (!part && h >= 1 && h <= 7) ? h + 12 : h;
  const QUARTER = { 'y media': 30, 'y cuarto': 15, 'menos cuarto': -15 };
  /* Franja: «de 5 a 7», «de 17:00 a 18:30», «desde las 9 hasta las 11» */
  take(/\s(?:de|desde\s+las?)\s+(\d{1,2})(?:[:.](\d{2}))?\s*h?\s+(?:a|hasta)\s+(?:las?\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*h?(?:\s+(?:de la|por la)\s+(manana|tarde|noche))?(?=\s)/, m => {
    let h1 = Number(m[1]), h2 = Number(m[3]);
    const m1 = Number(m[2] || 0), m2 = Number(m[4] || 0);
    if (!m[2] || h1 < 8) h1 = pmGuess(h1, m[5]);
    if (!m[4] || h2 < 8) h2 = pmGuess(h2, m[5]);
    if (h2 * 60 + m2 <= h1 * 60 + m1 && h2 < 12) h2 += 12;
    const dur = h2 * 60 + m2 - (h1 * 60 + m1);
    if (dur <= 0 || dur > 16 * 60) return false;
    if (setTime(h1, m1) === false) return false;
    if (!out.estimate) { out.estimate = dur; out.found.push('⏱ ' + durLabelShort(dur)); }
  }) ||
  take(/\s(?:a|al|para)\s+(?:el\s+)?mediodia(?=\s)/, () => setTime(12, 0)) ||
  take(/\s(?:a las?\s+)(\d{1,2})\s+(y media|y cuarto|menos cuarto)(?:\s+(?:de la|por la)\s+(manana|tarde|noche))?(?=\s)/, m => {
    const h = pmGuess(Number(m[1]), m[3]), t = h * 60 + QUARTER[m[2]];
    return setTime(Math.floor(t / 60), t % 60);
  }) ||
  take(/\s(?:a las?\s+)?(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|h)?(?=\s)/, m => {
    let h = Number(m[1]); if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
    return setTime(h, Number(m[2]));
  }) ||
  take(/\s(?:a las?\s+)?(\d{1,2})\s?(am|pm|h)(?=\s)/, m => {
    let h = Number(m[1]); if (m[2] === 'pm' && h < 12) h += 12; if (m[2] === 'am' && h === 12) h = 0;
    return setTime(h, 0);
  }) ||
  take(/\s(?:a las?\s+)(\d{1,2})(?:\s+(?:de la|por la)\s+(manana|tarde|noche))?(?=\s)/, m => {
    let h = Number(m[1]);
    if ((m[2] === 'tarde' || m[2] === 'noche') && h < 12) h += 12;
    else if (!m[2] && h >= 1 && h <= 7) h += 12; /* «a las 5» → 17:00 */
    return setTime(h, 0);
  });
  if (out.time) out.found.push('🕐 ' + out.time);

  /* Fecha */
  const setDue = d => { if (!d) return false; out.due = d; };
  take(/\s(?:para\s+)?(?:el\s+)?pasado\s+manana(?=\s)/, () => setDue(addDays(today, 2))) ||
  take(/\s(?:para\s+)?(hoy|esta\s+noche|esta\s+tarde)(?=\s)/, () => setDue(today)) ||
  take(/\s(?:para\s+)?manana(?=\s)/, () => setDue(addDays(today, 1))) ||
  take(/\s(?:para\s+)?en\s+(\d{1,3}|un|una|dos|tres)\s+(dias?|semanas?|mes(?:es)?)(?=\s)/, m => {
    const n = { un: 1, una: 1, dos: 2, tres: 3 }[m[1]] || Number(m[1]);
    const u = UNIT_WORDS[m[2]];
    return setDue(u === 'day' ? addDays(today, n) : u === 'week' ? addDays(today, 7 * n) : addMonths(today, n));
  }) ||
  take(/\s(?:para\s+)?(?:el\s+)?(?:(proximo|que viene|siguiente)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(que viene|proximo))?(?=\s)/, m => {
    let d = nextWeekday(today, WEEKDAYS[m[2]], true);
    return setDue(d);
  }) ||
  take(/\s(?:para\s+)?(?:este\s+)?fin\s+de\s+semana(?=\s)/, () => setDue(nextWeekday(today, 6, false))) ||
  take(/\s(?:para\s+)?(?:la\s+)?(?:semana que viene|proxima semana)(?=\s)/, () => setDue(nextWeekday(today, 1, true))) ||
  take(/\s(?:para\s+)?(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, m => {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return setDue(y ? validDate(y, Number(m[2]), Number(m[1])) : upcoming(Number(m[2]), Number(m[1]), today));
  }) ||
  take(new RegExp(`\\s(?:para\\s+)?(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+(?:de\\s+)?(\\d{4}))?(?=\\s)`), m => {
    const mo = MONTHS.indexOf(m[2]) + 1;
    return setDue(m[3] ? validDate(Number(m[3]), mo, Number(m[1])) : upcoming(mo, Number(m[1]), today));
  });
  take(/\s(?:por|de|a)\s+la\s+(manana|tarde|noche)(?=\s)/, () => {});
  if ((out.time || out.repeat) && !out.due) out.due = today;
  if (out.due) out.found.unshift('📅 ' + relDay(out.due));

  out.title = s.replace(/\s+/g, ' ').replace(/\s+(a|el|la|para|de)$/i, '').trim();
  out.title = cap(out.title);
  return out;
}
const durLabelShort = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;

/* Crea la tarea (y su bloque si hay hora). Devuelve la tarea o null si no hay título */
function addParsedTask(text, ctx = {}) {
  const p = parseQuick(text, todayStr());
  if (!p.title) return null;
  for (const name of p.newTags) {
    const tg = { id: uid(), name, color: COLORS[state.tags.length % COLORS.length] };
    state.tags.push(tg); p.tags.push(tg.id);
  }
  const t = newTask({
    title: p.title, due: p.due || ctx.due || null, projectId: p.projectId || ctx.projectId || null, goalId: ctx.goalId || null,
    tags: p.tags, priority: p.priority || 'none', estimate: p.estimate, repeat: p.repeat,
  });
  state.tasks.push(t);
  if (p.time) {
    const dur = p.estimate || 60;
    const end = Math.min(toMin(p.time) + dur, 24 * 60 - 1);
    state.events.push({ id: uid(), title: t.title, date: t.due, start: p.time, end: fmtHM(end), taskId: t.id, color: null, tagId: null, projectId: null, goalId: null, recurrence: null, exceptions: [] });
  }
  return t;
}

/* ---------- 2. Tareas que se repiten (cada N días, semanas, meses o años) ---------- */

const REPEAT_UNITS = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'], year: ['año', 'años'] };
function repeatLabel(r) {
  if (!r) return '';
  const [one, many] = REPEAT_UNITS[r.unit] || REPEAT_UNITS.day;
  return r.n > 1 ? `cada ${r.n} ${many}` : `cada ${one}`;
}
function addMonths(s, n) {
  const d = parseYmd(s), day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return ymd(t);
}
function advance(s, r) {
  const n = Math.max(1, r.n || 1);
  if (r.unit === 'week') return addDays(s, 7 * n);
  if (r.unit === 'month') return addMonths(s, n);
  if (r.unit === 'year') return addMonths(s, 12 * n);
  return addDays(s, n);
}
/* Al completar una tarea que se repite se crea la siguiente (una sola vez) */
function spawnNextRepeat(t) {
  if (!t.repeat || t.nextId) return null;
  const today = todayStr();
  let next = advance(t.due || today, t.repeat);
  for (let i = 0; next <= today && i < 500; i++) next = advance(next, t.repeat);
  /* Si el plazo era futuro (se adelantó), la siguiente va después de ese plazo */
  const n = newTask({
    title: t.title, notes: t.notes, due: next, priority: t.priority, tags: [...(t.tags || [])], estimate: t.estimate,
    projectId: t.projectId, goalId: t.goalId, firstStep: t.firstStep, repeat: { ...t.repeat },
    subtasks: (t.subtasks || []).map(x => ({ ...x, id: uid(), done: false })),
  });
  state.tasks.push(n);
  t.nextId = n.id;
  return n;
}
/* Deshacer: si la siguiente no se ha tocado, se quita */
function unspawnRepeat(t) {
  const n = t.nextId && task(t.nextId);
  if (n && !n.done) state.tasks = state.tasks.filter(x => x.id !== n.id);
  t.nextId = null;
}

/* ---------- 8. Búsqueda global ---------- */

function searchAll(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const hit = (...fields) => { const h = norm(fields.join(' ')); return words.every(w => h.includes(w)); };
  const tasks = state.tasks.filter(t => !t.routineId && hit(t.title, t.notes, t.firstStep, (t.subtasks || []).map(x => x.title).join(' '), (t.tags || []).map(id => (tag(id) || {}).name || '').join(' ')))
    .sort((a, b) => (a.done - b.done) || sortByDue(a, b)).slice(0, 30);
  const projects = state.projects.filter(p => hit(p.name, p.notes)).slice(0, 10);
  const goals = state.goals.filter(g => hit(g.title, g.description, g.success)).slice(0, 10);
  const routines = state.routines.filter(r => hit(r.title)).slice(0, 10);
  const today = todayStr();
  const events = state.events.filter(e => hit(e.title) && (e.recurrence || e.date >= addDays(today, -7))).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 10);
  return { tasks, projects, goals, routines, events, total: tasks.length + projects.length + goals.length + routines.length + events.length };
}

/* ---------- 6. Diario del día: ánimo y energía ---------- */

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const MOOD_LABEL = ['Mal', 'Regular', 'Normal', 'Bien', 'Genial'];
function journalOf(d) { return (state.journal || {})[d] || null; }
function setJournal(d, patch) {
  state.journal = state.journal || {};
  const j = state.journal[d] = { mood: null, energy: null, note: '', ...(state.journal[d] || {}), ...patch };
  if (!j.mood && !j.energy && !j.note) delete state.journal[d];
}
/* Tareas hechas por día (sin contar diarias para no inflar) */
function doneCountByDay() {
  const m = new Map();
  for (const t of state.tasks) if (t.done && t.doneAt) { const k = dateOfTs(t.doneAt); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
/* Conclusiones sencillas para Progreso */
function journalInsights() {
  const today = todayStr(), done = doneCountByDay(), out = [];
  const entries = Object.entries(state.journal || {}).filter(([d]) => d <= today);
  const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const f1 = x => x.toFixed(1).replace('.0', '').replace('.', ',');
  const hi = entries.filter(([, j]) => j.energy >= 4).map(([d]) => done.get(d) || 0);
  const lo = entries.filter(([, j]) => j.energy && j.energy <= 2).map(([d]) => done.get(d) || 0);
  if (hi.length >= 2 && lo.length >= 2) out.push(`Con energía alta completas ${f1(avg(hi))} tareas de media; con energía baja, ${f1(avg(lo))}.`);
  const mGood = entries.filter(([, j]) => j.mood >= 4).map(([d]) => done.get(d) || 0);
  const mBad = entries.filter(([, j]) => j.mood && j.mood <= 2).map(([d]) => done.get(d) || 0);
  if (mGood.length >= 2 && mBad.length >= 2) out.push(`Los días que acabas de buen humor haces ${f1(avg(mGood))} tareas; los malos, ${f1(avg(mBad))}.`);
  /* Mejor día de la semana en las últimas 8 semanas */
  const byDow = Array.from({ length: 7 }, () => []);
  for (let i = 1; i <= 56; i++) { const d = addDays(today, -i); byDow[dow(d)].push(done.get(d) || 0); }
  const avgs = byDow.map(avg), best = avgs.indexOf(Math.max(...avgs));
  if (avgs[best] >= 1) out.push(`Tu día más productivo suele ser el ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][best]} (${f1(avgs[best])} tareas de media).`);
  const lowE = entries.filter(([d, j]) => j.energy && d >= addDays(today, -6)).map(([, j]) => j.energy);
  if (lowE.length >= 3 && avg(lowE) <= 2.2) out.push('Llevas una semana con poca energía. Quizá toca planificar menos y descansar más.');
  return out;
}
