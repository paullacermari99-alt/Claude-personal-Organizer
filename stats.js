/* v68: gráficas por periodo en Progreso.
   Cada apartado (tareas, enfoque, ánimo, energía, hábitos, diarias) tiene su pantalla
   #progreso/<apartado> con selector Diaria / Semanal / Mensual / Anual, flechas para ir hacia
   atrás, una gráfica y un veredicto («Buen mes», «Semana floja»…) comparado con el periodo anterior. */

const STAT_PERIODS = [['dia', 'Diaria'], ['semana', 'Semanal'], ['mes', 'Mensual'], ['ano', 'Anual']];
/* Nombre del periodo para el veredicto: [palabra, femenino] */
const PERIOD_WORD = { dia: ['día', false], semana: ['semana', true], mes: ['mes', false], ano: ['año', false] };
const MONTH_LETTER = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
let statOff = 0;   /* 0 = periodo actual; -1 = el anterior… */

const f1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.0', '').replace('.', ',');
const monthLong = d => dtf('es-ES', { month: 'long' }).format(parseYmd(d));
function daysFrom(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function firstOfMonth(y, m) { const Y = y + Math.floor(m / 12), M = ((m % 12) + 12) % 12; return `${Y}-${String(M + 1).padStart(2, '0')}-01`; }
function monthDays(first) { const [y, m] = first.split('-').map(Number); return daysFrom(first, addDays(firstOfMonth(y, m), -1)); }

/* Primer día con datos: los periodos de antes de empezar a usar la app no cuentan como «malos» */
function statsStart() {
  const ds = [];
  state.tasks.forEach(t => { if (t.createdAt) ds.push(dateOfTs(t.createdAt)); if (t.doneAt) ds.push(dateOfTs(t.doneAt)); });
  state.focusLog.forEach(f => ds.push(f.date));
  Object.keys(state.journal || {}).forEach(d => ds.push(d));
  habits().forEach(h => ds.push(habitStart(h)));
  return ds.length ? ds.reduce((a, b) => a < b ? a : b) : todayStr();
}

/* ---------- Datos por día de cada apartado ---------- */
function statData() {
  const done = new Map(), focus = new Map(), sessions = new Map(), rout = new Map();
  state.tasks.forEach(t => {
    if (t.done && t.doneAt) { const k = dateOfTs(t.doneAt); done.set(k, (done.get(k) || 0) + 1); }
    if (t.routineId && t.routineDate) { const r = rout.get(t.routineDate) || [0, 0]; r[1]++; if (t.done) r[0]++; rout.set(t.routineDate, r); }
  });
  state.focusLog.forEach(f => { focus.set(f.date, (focus.get(f.date) || 0) + f.minutes); sessions.set(f.date, (sessions.get(f.date) || 0) + 1); });
  const hs = habits().map(h => ({ h, start: habitStart(h) }));
  const habitDay = d => {
    let dn = 0, ex = 0;
    for (const { h, start } of hs) {
      if (d < start) continue;
      if (h.freq === 'weekly') { ex += (h.n || 3) / 7; if (habitDone(h, d)) dn += (h.n || 3) / 7; }
      else if (habitDueOn(h, d)) { ex++; if (habitDone(h, d)) dn++; }
    }
    return [dn, ex];
  };
  return { done, focus, sessions, rout, habitDay, start: statsStart(), today: todayStr() };
}

const STAT_METRICS = {
  tareas: {
    title: 'Tareas hechas', icon: '✅', kind: 'sum', floor: 5, unit: n => `${n} tarea${n === 1 ? '' : 's'}`,
    day: (D, d) => D.done.get(d) || 0, fmt: n => String(Math.round(n)), per: n => f1(n),
    empty: 'Marca tareas como hechas y aquí verás cuántas completas cada día.',
  },
  enfoque: {
    title: 'Enfoque', icon: '⏱️', kind: 'sum', floor: 60, unit: n => durLabel(Math.round(n)),
    day: (D, d) => D.focus.get(d) || 0, fmt: n => durLabel(Math.round(n)), per: n => durLabel(Math.round(n)), short: n => n >= 60 ? f1(n / 60) + 'h' : String(Math.round(n)),
    empty: 'Usa el modo Enfoque y aquí verás cuánto tiempo trabajas concentrado.',
  },
  animo: {
    title: 'Ánimo', icon: '🙂', kind: 'avg', max: 5,
    day: (D, d) => { const j = journalOf(d); return j && j.mood ? j.mood : null; },
    lvl: v => v >= 3.5 ? 'high' : v >= 2.5 ? 'mid' : 'low', fmt: v => `${MOODS[Math.round(v) - 1]} ${f1(v)}`,
    word: v => MOOD_LABEL[Math.round(v) - 1].toLowerCase(),
    cuts: [4.2, 3.5, 2.6],
    empty: 'A partir de las 18:00, en Hoy, anota cómo ha ido el día y aquí verás tu ánimo.',
  },
  energia: {
    title: 'Energía', icon: '⚡', kind: 'avg', max: ENERGY_MAX,
    day: (D, d) => { const j = journalOf(d); return j && j.energy ? j.energy : null; },
    lvl: v => energyLevel(Math.round(v)), fmt: v => `${f1(v)} de ${ENERGY_MAX}`,
    word: v => ({ low: 'baja', mid: 'media', high: 'alta' })[energyLevel(Math.round(v))],
    cuts: [5, 4, 3],
    empty: 'A partir de las 18:00, en Hoy, anota tu energía del día y aquí verás cómo cambia.',
  },
  habitos: {
    title: 'Hábitos', icon: '🔥', kind: 'rate',
    day: (D, d) => D.habitDay(d), cuts: [85, 65, 40],
    empty: 'Crea un hábito y márcalo cada día: aquí verás qué parte cumples.',
  },
  diarias: {
    title: 'Diarias', icon: '🔁', kind: 'rate',
    day: (D, d) => D.rout.get(d) || [0, 0], cuts: [85, 65, 40],
    empty: 'Crea una diaria y aquí verás qué parte de los días la cumples.',
  },
};
const rateLvl = v => v >= 70 ? 'high' : v >= 40 ? 'mid' : 'low';

/* Junta varios días en un valor. n = días que cuentan (con datos o ya vividos). */
function agg(m, D, days) {
  const ok = days.filter(d => d <= D.today && d >= D.start);
  if (m.kind === 'sum') { const v = ok.reduce((a, d) => a + m.day(D, d), 0); return { v, n: ok.length, per: ok.length ? v / ok.length : null }; }
  if (m.kind === 'avg') { const xs = ok.map(d => m.day(D, d)).filter(x => x != null); return { v: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length }; }
  let dn = 0, ex = 0; ok.forEach(d => { const [a, b] = m.day(D, d); dn += a; ex += b; });
  return { v: ex ? Math.min(100, Math.round(dn / ex * 100)) : null, n: ok.length, dn, ex };
}

/* ---------- Periodos ---------- */
function statRange(p, off) {
  const t = todayStr();
  if (p === 'dia') {
    const d = addDays(t, off), days = daysFrom(addDays(d, -13), d);
    return { p, focus: [d], base: days.slice(0, 13), buckets: days.map(x => ({ days: [x], lab: DOW_LETTER[dow(x)], tip: fmtLongDate(x), cur: x === d })),
      title: off === 0 ? 'Hoy' : off === -1 ? 'Ayer' : fmtLongDate(d), sub: off >= -1 ? fmtLongDate(d) : '', prev: 'tu media de los 13 días anteriores', prevShort: 'tu media', live: off === 0 };
  }
  if (p === 'semana') {
    const ws = addDays(startOfWeek(t), off * 7), days = weekDays(ws);
    return { p, focus: days, base: weekDays(addDays(ws, -7)), buckets: days.map(x => ({ days: [x], lab: DOW_LETTER[dow(x)], tip: fmtLongDate(x), cur: x === t })),
      title: off === 0 ? 'Esta semana' : off === -1 ? 'Semana pasada' : `Semana ${weekNumber(ws)}`, sub: `${fmtShortDate(ws)} – ${fmtShortDate(addDays(ws, 6))}`,
      prev: off === 0 ? 'la semana pasada' : 'la semana anterior', prevShort: off === 0 ? 'semana pasada' : 'semana anterior', live: off === 0 };
  }
  const [y, mo] = t.split('-').map(Number);
  if (p === 'mes') {
    const first = firstOfMonth(y, mo - 1 + off), days = monthDays(first), pf = firstOfMonth(y, mo - 2 + off);
    const marks = new Set([1, 5, 10, 15, 20, 25, days.length]);
    return { p, focus: days, base: monthDays(pf), buckets: days.map((x, i) => ({ days: [x], lab: marks.has(i + 1) && !(i + 1 === 25 && days.length < 28) ? String(i + 1) : '', tip: fmtLongDate(x), cur: x === t })),
      title: cap(monthLong(first)) + (first.slice(0, 4) !== String(y) ? ' ' + first.slice(0, 4) : ''), sub: off === 0 ? 'Este mes' : first.slice(0, 4),
      prev: monthLong(pf), prevShort: monthLong(pf), live: off === 0 };
  }
  const Y = y + off, months = Array.from({ length: 12 }, (_, i) => monthDays(firstOfMonth(Y, i)));
  return { p, focus: months.flat(), base: Array.from({ length: 12 }, (_, i) => monthDays(firstOfMonth(Y - 1, i))).flat(),
    buckets: months.map((ds, i) => ({ days: ds, lab: MONTH_LETTER[i], tip: cap(monthLong(ds[0])), cur: ds[0] <= t && t <= ds[ds.length - 1] })),
    title: String(Y), sub: off === 0 ? 'Este año' : '', prev: String(Y - 1), prevShort: String(Y - 1), live: off === 0, months: true };
}

/* ---------- Veredicto ---------- */
const V_EMOJI = { great: '🚀', good: '👍', normal: '😐', low: '🌧️', none: '📊' };
function verdictLabel(lvl, p, live) {
  const [w, fem] = PERIOD_WORD[p], a = fem ? 'a' : '';
  if (lvl === 'none') return 'Sin datos';
  const txt = { great: [`Muy buen${a} ${w}`, `un${a} muy buen${a} ${w}`], good: [`Buen${a} ${w}`, `un${a} buen${a} ${w}`],
    normal: [`${cap(w)} normal`, `un${a} ${w} normal`], low: [`${cap(w)} floj${fem ? 'a' : 'o'}`, `un${a} ${w} floj${fem ? 'a' : 'o'}`] }[lvl];
  return live ? `Va siendo ${txt[1]}` : txt[0];
}
function statVerdict(m, D, R) {
  const cur = agg(m, D, R.focus), base = agg(m, D, R.base);
  const level = (v, cuts) => v >= cuts[0] ? 'great' : v >= cuts[1] ? 'good' : v >= cuts[2] ? 'normal' : 'low';
  if (m.kind === 'sum') {
    if (!cur.n) return { lvl: 'none', cur, base, text: 'Este periodo es anterior a tus primeros datos.' };
    const has = base.n > 0 && base.per != null;
    if (!cur.v) return { lvl: has && base.v ? 'low' : 'none', cur, base, text: !(has && base.v) ? m.empty
      : R.p === 'dia' ? `Nada${R.live ? ' todavía' : ''}. Tu media es ${m.per(base.per)} al día.` : `Nada${R.live ? ' todavía' : ''}. En ${R.prev}: ${m.unit(base.v)}.` };
    const total = `${cap(m.unit(cur.v))}${R.p !== 'dia' && cur.n > 1 ? ` · ${m.per(cur.per)} al día` : ''}`;
    if (!has || !base.v) return { lvl: 'good', cur, base, text: `${total}. ${has ? `Más que ${R.prev}.` : 'Es tu primer periodo con datos.'}` };
    const r = cur.per / base.per, pct = Math.round((r - 1) * 100);
    const cmp = Math.abs(pct) < 5 ? `parecido a ${R.prev}` : pct > 0 ? `${pct} % más que ${R.prev}` : `${-pct} % menos que ${R.prev}`;
    return { lvl: r >= 1.25 ? 'great' : r >= .95 ? 'good' : r >= .7 ? 'normal' : 'low', cur, base, text: `${total} · ${cmp}${R.live && R.p !== 'dia' ? ' (media por día)' : ''}.`,
      short: `${cap(m.unit(cur.v))} · ${Math.abs(pct) < 5 ? 'como' : (pct > 0 ? '+' : '−') + Math.abs(pct) + ' % vs'} ${R.prevShort}` };
  }
  if (cur.v == null) return { lvl: 'none', cur, base, text: m.empty };
  const lvl = level(cur.v, m.cuts);
  let main, short, cmp = '';
  if (m.kind === 'avg') {
    main = `${m.title} ${m.word(cur.v)} (${m.fmt(cur.v)})`;
    if (base.v != null) { const d = cur.v - base.v; cmp = Math.abs(d) < .25 ? ` · parecido a ${R.prev}` : ` · ${d > 0 ? 'mejor' : 'peor'} que ${R.prev} (${f1(base.v)})`; }
    short = `Media ${m.fmt(cur.v)}${base.v != null ? ` · ${R.prevShort} ${f1(base.v)}` : ''}`;
  } else {
    main = `${cur.v} % cumplido`;
    if (base.v != null) { const d = cur.v - base.v; cmp = Math.abs(d) < 3 ? ` · parecido a ${R.prev}` : ` · ${Math.abs(d)} puntos ${d > 0 ? 'más' : 'menos'} que ${R.prev}`; }
    short = `${cur.v} % cumplido${base.v != null ? ` · ${R.prevShort} ${base.v} %` : ''}`;
  }
  return { lvl, cur, base, text: main + cmp + '.', short };
}

/* ---------- Gráfica ---------- */
function statChart(m, D, R) {
  const vals = R.buckets.map(b => {
    const fut = b.days[0] > D.today, a = agg(m, D, b.days);
    return { ...b, fut, v: m.kind === 'sum' ? (a.n ? a.v : null) : a.v };
  });
  const dense = vals.length > 14;
  const base = agg(m, D, R.base);
  /* Línea de referencia: lo normal en el periodo anterior, en la misma escala que cada barra */
  let ref = null;
  if (m.kind === 'sum') { if (base.per) ref = R.months ? base.per * 30.44 : base.per; }
  else ref = base.v;
  const max = m.kind === 'sum' ? Math.max(m.floor * (R.months ? 10 : 1), ref || 0, ...vals.map(x => x.v || 0)) : m.kind === 'avg' ? m.max : 100;
  const lv = v => v == null ? '' : m.kind === 'avg' ? 'lv-' + m.lvl(v) : m.kind === 'rate' ? 'lv-' + rateLvl(v) : '';
  const label = x => x == null ? '' : m.kind === 'avg' ? (m.title === 'Ánimo' ? MOODS[Math.round(x) - 1] : f1(x)) : m.kind === 'rate' ? x + '%' : (m.short ? m.short(x) : String(Math.round(x)));
  const tip = x => x.v == null ? `${x.tip}: sin datos` : `${x.tip}: ${m.kind === 'sum' ? m.unit(x.v) : m.kind === 'rate' ? x.v + ' %' : m.fmt(x.v)}`;
  return `<div class="pchart ${dense ? 'dense' : ''} ${m.kind === 'sum' ? 'is-sum' : ''}" style="--n:${vals.length}" role="img" aria-label="${esc(m.title)}: ${esc(R.title)}">
    ${vals.map(x => `<div class="pc-col ${x.cur ? 'cur' : ''} ${x.fut ? 'fut' : ''} ${lv(x.v)}" title="${esc(tip(x))}">
      <span class="pc-val">${dense ? '' : esc(label(x.v))}</span>
      <div class="pc-track"><div class="pc-bar" style="height:${x.v ? Math.max(2, Math.round(x.v / max * 100)) : 0}%"></div></div>
      <span class="pc-lab">${esc(x.lab)}</span></div>`).join('')}
    ${ref ? `<div class="pc-ref" style="--r:${Math.min(1, ref / max).toFixed(3)}"></div>` : ''}
  </div>
  ${ref ? `<p class="pc-legend"><i></i>${R.p === 'dia' ? 'Tu media de los días anteriores' : `Lo normal en ${esc(R.prev)}`}${R.months && m.kind === 'sum' ? ' (por mes)' : m.kind === 'sum' ? ' (por día)' : ''}</p>` : ''}`;
}

/* Tres cifras del periodo */
function statKpis(key, m, D, R) {
  const days = R.focus.filter(d => d <= D.today && d >= D.start), a = agg(m, D, R.focus);
  const k = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  let out = [];
  if (m.kind === 'sum') {
    let best = null;
    if (R.months) R.buckets.forEach(b => { const x = agg(m, D, b.days); if (x.v && (!best || x.v > best.v)) best = { v: x.v, l: b.tip }; });
    else days.forEach(d => { const v = m.day(D, d); if (v && (!best || v > best.v)) best = { v, l: R.p === 'dia' ? '' : fmtShortDate(d) }; });
    out = [k(m.fmt(a.v), 'en total'), k(a.per != null ? m.per(a.per) : '–', 'de media al día'),
      key === 'enfoque' ? k(days.reduce((s, d) => s + (D.sessions.get(d) || 0), 0), 'sesiones') : k(best ? `${m.fmt(best.v)}` : '–', best && best.l ? `mejor ${R.months ? 'mes' : 'día'} · ${esc(best.l)}` : `mejor ${R.months ? 'mes' : 'día'}`)];
  } else if (m.kind === 'avg') {
    const xs = days.map(d => m.day(D, d)).filter(x => x != null), hi = xs.filter(x => m.lvl(x) === 'high').length;
    out = [k(a.v != null ? m.fmt(a.v) : '–', 'de media'), k(xs.length, `día${xs.length === 1 ? '' : 's'} anotado${xs.length === 1 ? '' : 's'}`), k(hi, key === 'animo' ? 'días buenos' : 'con energía alta')];
  } else {
    out = [k(a.v != null ? a.v + ' %' : '–', 'cumplido'), k(Math.round(a.dn || 0), key === 'habitos' ? 'veces marcado' : 'hechas'),
      key === 'habitos' ? k(habits().length, `hábito${habits().length === 1 ? '' : 's'}`) : k(Math.round(a.ex || 0), 'tocaban')];
  }
  return `<div class="kpis">${out.join('')}</div>`;
}

/* ---------- Pantalla de un apartado ---------- */
function viewStatDetail(key) {
  const m = STAT_METRICS[key];
  if (!m) { setTimeout(() => { location.hash = '#progreso'; }); return ''; }
  const ui = state.settings.ui, p = STAT_PERIODS.some(([v]) => v === ui.statsPeriod) ? ui.statsPeriod : 'mes';
  const D = statData(), R = statRange(p, statOff), V = statVerdict(m, D, R);
  const link = { habitos: '#habitos', diarias: '#diarias' }[key];
  return `
  <div class="page page-mid page-stat">
  ${pageHead({ eyebrow: backLink('#progreso', 'Progreso'), title: `${m.title}`, actions: link ? `<a class="btn small" href="${link}">${key === 'habitos' ? 'Ver hábitos' : 'Ver diarias'}</a>` : '' })}
  <div class="segmented" role="tablist">${STAT_PERIODS.map(([v, l]) => `<button role="tab" class="${p === v ? 'on' : ''}" data-act="stats-period" data-v="${v}" aria-selected="${p === v}">${l}</button>`).join('')}</div>
  <div class="stat-nav">
    <button class="icon-btn round" data-act="stats-nav" data-n="-1" aria-label="Periodo anterior">${I.left}</button>
    <div class="sn-text"><b>${esc(R.title)}</b>${R.sub ? `<span>${esc(R.sub)}</span>` : ''}</div>
    <button class="icon-btn round" data-act="stats-nav" data-n="1" aria-label="Periodo siguiente" ${statOff >= 0 ? 'disabled' : ''}>${I.right}</button>
  </div>
  <div class="verdict glass lv-${V.lvl}">
    <span class="v-badge" aria-hidden="true">${V_EMOJI[V.lvl]}</span>
    <div class="grow"><h2>${esc(verdictLabel(V.lvl, p, R.live))}</h2><p>${esc(V.text)}</p></div>
  </div>
  <div class="card glass pchart-card">${statChart(m, D, R)}</div>
  ${statKpis(key, m, D, R)}
  <p class="hint">${p === 'dia' ? 'Cada barra es un día; la última es el día que estás viendo.' : p === 'ano' ? 'Cada barra es un mes.' : 'Cada barra es un día.'} Usa las flechas para ver periodos anteriores.</p>
  </div>`;
}

/* ---------- Lista de apartados en Progreso (con el veredicto del mes) ---------- */
function statsLinksSection() {
  const D = statData(), R = statRange('mes', 0);
  const rows = Object.entries(STAT_METRICS).filter(([k]) => k !== 'habitos' || habits().length).filter(([k]) => k !== 'diarias' || state.routines.length).map(([k, m]) => {
    const V = statVerdict(m, D, R);
    const short = V.lvl === 'none' ? 'Sin datos' : verdictLabel(V.lvl, 'mes', false);
    return `<a class="item stat-link" href="#progreso/${k}"><span class="sl-ico" aria-hidden="true">${m.icon}</span>
      <div class="grow"><div class="sl-top"><span>${esc(m.title)}</span><span class="v-chip lv-${V.lvl}">${esc(short)}</span></div><div class="small muted sl-sub">${esc(V.lvl === 'none' ? 'Toca para ver la gráfica' : V.short || V.text)}</div></div>
      ${I.right}</a>`;
  });
  return `<div class="section"><div class="section-head"><h2>Gráficas · ${esc(R.title.toLowerCase())}</h2></div>
    <div class="settings-group glass stat-links">${rows.join('')}</div>
    <p class="hint">Entra en cada uno para verlo por día, semana, mes o año.</p></div>`;
}
