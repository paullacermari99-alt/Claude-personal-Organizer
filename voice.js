/* Boldup — hablar con la app (gratis, sin cuentas): el dictado lo hace el navegador y las órdenes
   las entiende la propia app. «dentista mañana a las 10», «objetivo correr 10 km en 3 meses»,
   «mueve el informe al viernes», «he terminado la compra», «¿qué tengo hoy?», «abre la semana»…
   Siempre enseña lo que ha entendido antes de cambiar nada, y después se puede deshacer. */
'use strict';

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceOK = !!SpeechRec;
I.mic = svg('<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>', 'stroke-width="2.1"');

/* ---------- Dictado (una sola escucha a la vez; siempre se puede parar) ---------- */
let voiceRec = null;
function stopListening(abort) {
  const r = voiceRec;
  if (!r) return;
  try { abort ? r.abort() : r.stop(); } catch (_) { /* ya parado */ }
  /* Si el navegador no avisa de que ha parado, se da por parado igualmente */
  clearTimeout(r._kill);
  r._kill = setTimeout(() => { if (voiceRec === r) r._finish(); }, abort ? 0 : 1500);
}
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const VOICE_LANG = /^es\b/i.test(navigator.language || '') ? navigator.language : 'es-ES';
/* Qué decir cuando el dictado falla, según el error del navegador */
function voiceErrorText(code) {
  if (code === 'not-allowed') return isIOS
    ? 'El iPhone no deja usar el micrófono aquí. Ve a Ajustes → Safari → Micrófono y elige «Permitir», y comprueba que Ajustes → General → Teclado → Dictado está activado.'
    : 'El micrófono está bloqueado para la app. Toca el candado junto a la dirección (o Ajustes de Chrome → Configuración de sitios → Micrófono) y permítelo.';
  if (code === 'service-not-allowed') return isIOS
    ? 'El iPhone no deja dictar dentro de la app instalada. Usa el micrófono del teclado (abajo), o abre la app en Safari.'
    : 'Este navegador no deja dictar aquí. Usa el micrófono del teclado (abajo).';
  if (code === 'audio-capture') return 'No encuentro el micrófono. Comprueba que ninguna otra app lo está usando.';
  if (code === 'network') return 'Para dictar hace falta conexión a internet.';
  if (code === 'no-speech') return 'No te he oído. Pulsa el micrófono y habla justo después.';
  if (code === 'language-not-supported') return 'El dictado en español no está disponible en este navegador. Usa el micrófono del teclado (abajo).';
  if (code === 'silent') return 'El micrófono no ha llegado a arrancar en este navegador. Usa el micrófono del teclado (abajo): funciona igual.';
  return 'No se ha podido dictar (' + code + '). Usa el micrófono del teclado (abajo).';
}
/* listen({ onText(texto), onDone(texto), onError(código), onAudio() }) */
function listen(h) {
  if (!voiceOK) return false;
  stopListening(true);
  const rec = new SpeechRec();
  rec.lang = VOICE_LANG; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let heard = '', done = false, audio = false, errored = false, started = false;
  rec._finish = () => {
    if (done) return;
    done = true; clearTimeout(rec._kill); clearTimeout(rec._max);
    if (voiceRec === rec) voiceRec = null;
    h.onDone && h.onDone(heard.trim());
  };
  const gotAudio = () => { if (!audio) { audio = true; clearTimeout(rec._wait); h.onAudio && h.onAudio(); } };
  rec.onstart = () => { started = true; };
  rec.onaudiostart = gotAudio; rec.onspeechstart = gotAudio; rec.onsoundstart = gotAudio;
  rec.onresult = e => { gotAudio(); heard = Array.from(e.results).map(r => r[0].transcript).join(' '); h.onText && h.onText(heard); };
  rec.onerror = e => {
    if (e.error === 'aborted') return;
    errored = true;
    h.onError && h.onError(e.error || 'desconocido');
  };
  rec.onend = () => { if (!heard && !errored && !audio && h.onError) { errored = true; h.onError(started ? 'no-speech' : 'silent'); } rec._finish(); };
  try { rec.start(); } catch (err) { h.onError && h.onError((err && err.name) || 'start'); return false; }
  voiceRec = rec;
  /* Si en 5 s el micrófono no ha arrancado, se dice claramente (pasa en algunas apps instaladas del iPhone) */
  rec._wait = setTimeout(() => { if (!audio && !started && !errored && voiceRec === rec) { errored = true; h.onError && h.onError('silent'); stopListening(true); } }, 5000);
  rec._max = setTimeout(() => stopListening(false), 15000); /* nunca se queda escuchando para siempre */
  return true;
}

/* Limpia lo que devuelve el dictado: «10:00 a. m.», el punto final, espacios */
function cleanVoice(s) {
  return String(s || '').replace(/\b([ap])\.\s?m\./gi, (m0, x) => x.toLowerCase() + 'm').replace(/[.。¿?¡!]+\s*$/, '').replace(/^[¿¡]/, '').replace(/\s+/g, ' ').trim();
}

/* ---------- Micrófono en las casillas de «Nueva tarea» (solo escribe; guardas tú) ---------- */
const micBtn = (cls = '') => voiceOK && !isIOS ? `<button type="button" class="icon-btn round mic-btn ${cls}" aria-label="Dictar la tarea" title="Dictar">${I.mic}</button>` : '';
function startDictation(input, btn) {
  if (!input) return;
  if (voiceRec && voiceRec._input === input) { stopListening(false); return; }
  const base = input.value.trim(), ph = input.placeholder;
  const put = text => { input.value = (base ? base + ' ' : '') + text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const ok = listen({
    onText: put,
    onError: code => toast(voiceErrorText(code)),
    onDone: heard => {
      btn && btn.classList.remove('listening');
      input.placeholder = ph;
      if (heard) { put(cleanVoice(heard).replace(/^(?:recu[eé]rdame(?:\s+que)?|ap[uú]nta(?:me)?|a[nñ]ade|anota(?:me)?|nueva tarea)[\s,:]+/i, '')); input.dataset.voiced = '1'; }
    },
  });
  if (!ok) return;
  voiceRec._input = input;
  btn && btn.classList.add('listening');
  input.placeholder = 'Te escucho…';
}
document.addEventListener('click', e => {
  const b = e.target.closest('.mic-btn');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const box = b.closest('.mic-in, form');
  startDictation(box && box.querySelector('input[name=title]'), b);
}, true);
const voiceModal = document.getElementById('modal');
if (voiceModal) voiceModal.addEventListener('close', () => { if (voiceRec && voiceRec._input) stopListening(true); });

function voiceSavedToast(t, found) {
  toast('Añadida' + (found && found.length ? ' · ' + found.join(' · ') : ': ' + t.title), {
    action: 'Deshacer',
    onAction: () => {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      state.events = state.events.filter(ev => ev.taskId !== t.id);
      save(); rerender(); toast('Quitada');
    },
  });
}

/* ---------- Entender órdenes ---------- */
const PAGES = {
  hoy: ['hoy', 'Hoy'], semana: ['semana', 'Semana'], calendario: ['semana', 'Semana'], agenda: ['semana', 'Semana'], tareas: ['tareas', 'Tareas'],
  progreso: ['progreso', 'Progreso'], objetivos: ['objetivos', 'Objetivos'], proyectos: ['proyectos', 'Proyectos'], habitos: ['habitos', 'Hábitos'],
  diarias: ['diarias', 'Diarias'], ajustes: ['ajustes', 'Ajustes'], revision: ['revision', 'Revisión'], planificar: ['planificar', 'Planificar por horas'],
};
const ARTICLE = /^(?:(?:la|el|los|las|lo|mi|mis)\s+)?(?:(?:tarea|tareas)\s+(?:de\s+)?)?(?:(?:lo|la|el)\s+de\s+)?/;

/* Busca una tarea pendiente por cómo la nombras */
function findTaskByName(q, { done = false } = {}) {
  const words = norm(q).replace(ARTICLE, '').trim();
  if (!words) return null;
  const parts = words.split(/\s+/).filter(w => w.length > 2);
  const today = todayStr();
  let best = null, bestScore = 0;
  for (const t of state.tasks) {
    if (!!t.done !== done) continue;
    const n = norm(t.title);
    let s = n === words ? 100 : n.includes(words) ? 60 : words.includes(n) && n.length > 3 ? 40 : 0;
    if (!s && parts.length) { const hit = parts.filter(w => n.includes(w)).length; if (hit === parts.length) s = 30; else if (hit && hit >= parts.length - 1 && parts.length > 2) s = 15; }
    if (!s) continue;
    if (t.due && t.due <= today) s += 5; /* mejor la de hoy o atrasada */
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best;
}
/* Fecha dicha suelta: «a mañana», «al viernes», «para el 3 de diciembre» */
function dateOf(text) {
  const p = parseQuick('x ' + text, todayStr());
  return { due: p.due, time: p.time, found: p.found };
}
const listTitles = ts => ts.slice(0, 8).map(t => `<li${taskColor(t) ? ` class="has-dot" style="--c:${taskColor(t)}"` : ''}>${esc(t.title)}${t.due && t.due < todayStr() ? ' <span class="muted small">· atrasada</span>' : ''}</li>`).join('') + (ts.length > 8 ? `<li class="muted">y ${ts.length - 8} más</li>` : '');
const chipsOf = foundChips;

/* Devuelve { say, html?, run?() , go? } — run cambia datos (se confirma antes); go navega al momento */
function interpret(raw) {
  const text = cleanVoice(raw).replace(/^(?:oye|vale|venga|por favor|porfa)[,\s]+/i, '').replace(/[,\s]+por favor$/i, '');
  const n = norm(text);
  const tail = re => { const m = re.exec(n); return m ? text.slice(m[0].length).trim() : null; };
  if (!n) return { say: 'No te he entendido. Prueba otra vez.' };

  /* Abrir pantallas */
  let m = /^(?:abre|abrir|ve a|ir a|vete a|vamos a|llevame a|ensename|muestrame|ver|pon)\s+(?:(?:la|el|los|las|mis?|pantalla de)\s+)*(\w+)/.exec(n);
  if (m && PAGES[m[1]]) { const [h, l] = PAGES[m[1]]; return { say: 'Abro ' + l, go: () => { location.hash = '#' + h; } }; }

  /* v32: colores. «¿qué tareas verdes tengo?», «mueve las rojas a mañana», «pon el informe en azul» */
  const cw = COLOR_WORD_RE.exec(n), fam = cw && familyOfWord(cw[1]);
  if (fam) {
    const cname = COLOR_NAMES[fam], open = state.tasks.filter(t => !t.done);
    const ofColor = open.filter(t => colorFamily(taskColor(t)) === fam);
    /* Mover las de un color */
    m = /^(?:mueve|mover|pasa|pasar|aplaza|aplazar|cambia|lleva|deja)\s+(?:todas\s+|todos\s+)?(?:las|los)?\s*(?:tareas\s+)?(?:de\s+color\s+|en\s+)?\S+\s+(?:de hoy\s+)?(?:a|al|para)\s+(.+)$/.exec(n);
    if (m && familyOfWord(n.split(/\s+/).find(w => familyOfWord(w)) || '') === fam && !/^(?:mueve|pasa|cambia|lleva)\s+(?:el|la)\s/.test(n)) {
      const d = dateOf(text.slice(text.length - m[1].length));
      const ts = /de hoy/.test(n) ? ofColor.filter(t => t.due && t.due <= todayStr()) : ofColor;
      if (!d.due) return { say: '¿A qué día? Prueba «mueve las ' + cname + 's a mañana».' };
      if (!ts.length) return { say: `No tienes tareas ${cname}s pendientes.` };
      return { say: `Pasar ${ts.length} tarea${ts.length > 1 ? 's' : ''} ${cname}${ts.length > 1 ? 's' : ''} a ${relDay(d.due).toLowerCase()}`, html: `<ul class="voice-list">${listTitles(ts)}</ul>`, run: () => { ts.forEach(t => { t.due = d.due; }); return 'Movidas a ' + relDay(d.due).toLowerCase(); } };
    }
    /* Pintar una tarea u objetivo: «pon el informe en azul», «cambia el color de correr a verde» */
    m = /^(?:pon|ponme|ponle|cambia|cambiar|pinta|pintar|marca|colorea)\s+(?:el\s+color\s+(?:de|del)\s+)?(.+?)\s+(?:en|de|a|al|con)\s+(?:color\s+|el\s+)?\S+$/.exec(n);
    if (m && familyOfWord(n.split(/\s+/).pop())) {
      const start = m[0].indexOf(m[1]), name = text.slice(start, start + m[1].length).replace(/^(?:el|la)\s+objetivo\s+/i, '');
      const t = findTaskByName(name), gq = norm(name).replace(ARTICLE, '').replace(/^objetivo\s+/, '');
      const g = !t && state.goals.find(x => norm(x.title).includes(gq));
      if (!t && !g) return { say: `No encuentro ninguna tarea ni objetivo que se llame «${name}».` };
      if (g) return { say: `Poner en ${cname} el objetivo «${g.title}»`, html: `<div class="voice-chips"><span class="tag dot" style="--c:${paletteColor(fam)}">${esc(cap(cname))}</span></div>`, run: () => { g.color = paletteColor(fam); return 'Color cambiado'; } };
      /* Una tarea toma el color de su etiqueta: uso una tuya de ese color, o creo una con el nombre del color */
      const tg = state.tags.find(x => t.tags.includes(x.id) && colorFamily(x.color) === fam) || state.tags.find(x => colorFamily(x.color) === fam);
      const label = tg ? tg.name : cap(cname);
      return {
        say: `Poner en ${cname} «${t.title}»`, html: `<div class="voice-chips"><span class="tag dot" style="--c:${tg ? tg.color : paletteColor(fam)}">${esc(label)}</span></div>${tg ? '' : `<p class="muted small">Creo la etiqueta «${esc(label)}».</p>`}`,
        run: () => {
          const use = tg || (state.tags.push({ id: uid(), name: label, color: paletteColor(fam) }), state.tags[state.tags.length - 1]);
          const themed = new Set(CONTEXTS.map(c => norm(c.name)));
          t.tags = [use.id, ...t.tags.filter(id => id !== use.id && !themed.has(norm((tag(id) || {}).name || '')))];
          return 'Color cambiado';
        },
      };
    }
    /* Preguntar por un color: «¿qué tareas verdes tengo?», «¿qué tengo en rojo?», «objetivos azules» */
    if (/^(?:que|cuales|y que|dime|muestrame|ensename|ver|lista|mis)\b|^(?:tareas|objetivos)\b/.test(n)) {
      if (/objetivo/.test(n)) {
        const gs = state.goals.filter(g => g.status !== 'cumplido' && colorFamily(g.color) === fam);
        return { say: gs.length ? `Tienes ${gs.length} objetivo${gs.length > 1 ? 's' : ''} ${cname}${gs.length > 1 ? 's' : ''}:` : `No tienes objetivos ${cname}s.`, html: gs.length ? `<ul class="voice-list">${gs.slice(0, 8).map(g => `<li class="has-dot" style="--c:${g.color}">${esc(g.title)}</li>`).join('')}</ul>` : '' };
      }
      return { say: ofColor.length ? `Tienes ${ofColor.length} tarea${ofColor.length > 1 ? 's' : ''} ${cname}${ofColor.length > 1 ? 's' : ''}:` : `No tienes tareas ${cname}s pendientes.`, html: ofColor.length ? `<ul class="voice-list">${listTitles(ofColor)}</ul>` : '' };
    }
  }

  /* Preguntas: ¿qué tengo hoy / mañana / atrasado? */
  if (/^(?:que|y que)\s+(?:tengo|hay|me queda|queda|tengo que hacer)|^(?:que tareas|mis tareas)/.test(n)) {
    const today = todayStr();
    const open = state.tasks.filter(t => !t.done);
    if (/atrasad|pendiente de antes|retrasad/.test(n)) {
      const ts = open.filter(t => t.due && t.due < today);
      return { say: ts.length ? `Tienes ${ts.length} atrasada${ts.length > 1 ? 's' : ''}:` : 'No tienes nada atrasado. ¡Bien!', html: ts.length ? `<ul class="voice-list">${listTitles(ts)}</ul>` : '' };
    }
    const day = /pasado manana/.test(n) ? addDays(today, 2) : /manana/.test(n) ? addDays(today, 1) : (dateOf(text).due || today);
    const ts = open.filter(t => t.due && (day === today ? t.due <= today : t.due === day));
    const evs = state.events.filter(e => e.date === day && !e.recurrence && !e.taskId).sort((a, b) => a.start.localeCompare(b.start));
    const label = relDay(day).toLowerCase();
    if (!ts.length && !evs.length) return { say: `No tienes nada para ${label}.` };
    return {
      say: `Para ${label} tienes ${ts.length} tarea${ts.length === 1 ? '' : 's'}${evs.length ? ` y ${evs.length} evento${evs.length > 1 ? 's' : ''}` : ''}:`,
      html: `<ul class="voice-list">${listTitles(ts)}${evs.slice(0, 4).map(e => `<li>🕐 ${esc(e.start)} ${esc(e.title)}</li>`).join('')}</ul>`,
    };
  }

  /* Mover todo lo de hoy */
  m = /^(?:mueve|mover|pasa|pasar|aplaza|aplazar|cambia|lleva)\s+(?:todo|todas(?:\s+las\s+tareas)?|todas las de)\s+(?:lo\s+)?(?:de\s+)?(?:hoy|las de hoy|lo pendiente)\s+(?:a|al|para)\s+(.+)$/.exec(n);
  if (m) {
    const d = dateOf(text.slice(text.length - m[1].length));
    const ts = state.tasks.filter(t => !t.done && t.due && t.due <= todayStr());
    if (!d.due) return { say: '¿A qué día? Prueba «mueve todo lo de hoy a mañana».' };
    if (!ts.length) return { say: 'No tienes nada pendiente para hoy.' };
    return { say: `Pasar ${ts.length} tarea${ts.length > 1 ? 's' : ''} a ${relDay(d.due).toLowerCase()}`, html: `<ul class="voice-list">${listTitles(ts)}</ul>`, run: () => { ts.forEach(t => { t.due = d.due; }); return 'Movidas a ' + relDay(d.due).toLowerCase(); } };
  }

  /* Mover una tarea: «mueve el informe al viernes» */
  m = /^(?:mueve|mover|pasa|pasar|aplaza|aplazar|pospon|posponer|cambia|cambiar|lleva|deja)\s+(.+?)\s+(?:a|al|para|hasta)\s+((?:el\s+|la\s+)?(?:hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana que viene|proxima semana|fin de semana|\d.*|en\s.*|las?\s+\d.*))$/.exec(n);
  if (m) {
    const name = text.slice(m[0].indexOf(m[1]), m[0].indexOf(m[1]) + m[1].length);
    const t = findTaskByName(name);
    const d = dateOf(text.slice(text.length - m[2].length));
    if (!t) return { say: `No encuentro ninguna tarea pendiente que se llame «${name}».` };
    if (!d.due) return { say: '¿A qué día? Prueba «mueve ' + t.title.toLowerCase() + ' a mañana».' };
    return {
      say: `Mover «${t.title}»`, html: `<div class="voice-chips">${chipsOf(d.found)}</div>`,
      run: () => {
        t.due = d.due;
        if (d.time) { state.events = state.events.filter(e => !(e.taskId === t.id && !e.recurrence && e.date >= todayStr())); scheduleTask(t, d.due, d.time, fmtHM(Math.min(toMin(d.time) + (t.estimate || 60), 24 * 60 - 1))); }
        return `Movida a ${relDay(d.due).toLowerCase()}${d.time ? ' a las ' + d.time : ''}`;
      },
    };
  }

  /* Completar: «he terminado la compra», «marca como hecha llamar a mamá» */
  let rest = tail(/^(?:completa|completar|marca(?:r)?(?:\s+como\s+(?:hecha|hecho|completada))?|tacha|tachar|termina|terminar|he\s+(?:terminado|hecho|acabado|completado)|ya\s+he\s+(?:terminado|hecho|acabado)|ya\s+(?:esta|he)|hecha|hecho|listo|lista)\s+(?:con\s+)?/);
  if (rest !== null && rest) {
    const t = findTaskByName(rest);
    if (!t) return { say: `No encuentro ninguna tarea pendiente que se llame «${rest}».` };
    return { say: `Marcar como hecha «${t.title}»`, run: () => { toggleTask(t.id, null, { silent: true }); return '¡Hecho! Una menos.'; } };
  }

  /* Borrar */
  rest = tail(/^(?:borra|borrar|elimina|eliminar|quita|quitar)\s+/);
  if (rest) {
    const t = findTaskByName(rest);
    if (!t) return { say: `No encuentro ninguna tarea pendiente que se llame «${rest}».` };
    return { say: `Borrar «${t.title}»`, run: () => { trashTask(t.id); return 'Borrada (está en la papelera 10 días)'; } };
  }

  /* Enfoque: «empieza el informe», «enfoque de 25 minutos con el informe» */
  rest = tail(/^(?:empieza|empezar|empiezo|arranca|ponme|pon|inicia|iniciar|haz|hacer)?\s*(?:un\s+)?(?:enfoque|concentrarme|a concentrarme|modo enfoque|temporizador|pomodoro)?\s*(?:de\s+\d+\s+minutos?\s*)?(?:con|en|a|para)?\s+/);
  const focusMin = (/(\d+)\s+minutos?/.exec(n) || [])[1];
  if (/^(?:empieza|empezar|empiezo|arranca|inicia|iniciar|ponme un enfoque|pon un enfoque|enfoque|concentrarme|pomodoro|temporizador)/.test(n)) {
    const name = (rest || '').replace(/\s*(?:de|durante)\s+\d+\s+minutos?/i, '').trim();
    const t = name && findTaskByName(name);
    if (!t) return { say: name ? `No encuentro la tarea «${name}». Di «empieza» y el nombre de la tarea.` : '¿Con qué tarea? Di, por ejemplo, «empieza el informe».' };
    return { say: `Empezar un enfoque con «${t.title}»${focusMin ? ` (${focusMin} min)` : ''}`, go: () => { if (focusMin && SINGLE_MINS.includes(Number(focusMin))) focusMins = Number(focusMin); openFocus(t.id); } };
  }

  /* Crear objetivo, proyecto o hábito */
  const CREATE = '^(?:(?:crea(?:r|me)?|nuevo|nueva|anade|anadir|apunta|apuntar|pon|quiero)\\s+)?(?:(?:un|una|el|la)\\s+)?(?:nuevo\\s+|nueva\\s+)?';
  rest = tail(new RegExp(CREATE + 'objetivo(?:\\s+de)?[\\s:,]+'));
  if (rest) {
    const p = parseQuick(rest, todayStr());
    const due = p.due || addMonths(todayStr(), 3);
    const title = summarize(rest) || p.title || cap(rest);
    const cx = p.context || contextOf(title), gColor = cx ? contextColor(cx) : COLORS[(state.goals.length + 1) % COLORS.length];
    return {
      say: 'Nuevo objetivo', title, html: `<div class="voice-chips">${cx ? `<span class="tag dot" style="--c:${gColor}">${esc(cx.name)}</span>` : ''}<span class="tag">🎯 ${esc(HORIZONS[horizonFor(due)])}</span><span class="tag">📅 ${esc(fmtShortDate(due))}</span></div>${p.due ? '' : '<p class="muted small">Sin fecha dicha: le pongo 3 meses. Puedes cambiarla luego.</p>'}`,
      run: tt => {
        const g = { id: uid(), title: tt || title, horizon: horizonFor(due), due, description: '', success: '', projectId: null, status: 'activo', achievedAt: null, progressMode: 'auto', progress: 0, color: gColor, createdAt: Date.now() };
        state.goals.push(g);
        return 'Objetivo creado';
      },
    };
  }
  rest = tail(new RegExp(CREATE + 'proyecto(?:\\s+de|\\s+llamado|\\s+que se llama)?[\\s:,]+'));
  if (rest) {
    const name = cap(rest);
    return { say: 'Nuevo proyecto', title: name, run: tt => { state.projects.push({ id: uid(), name: tt || name, icon: '📁', color: COLORS[state.projects.length % COLORS.length], archived: false, favorite: false, order: state.projects.length, defaultView: 'resumen', notes: '', createdAt: Date.now() }); return 'Proyecto creado'; } };
  }
  rest = tail(new RegExp(CREATE + 'habito(?:\\s+de)?[\\s:,]+'));
  if (rest) {
    const title = cap(rest.replace(/\s+(?:cada dia|todos los dias|a diario)$/i, ''));
    return { say: 'Nuevo hábito, cada día', title, run: tt => { habits().push({ id: uid(), title: tt || title, icon: HABIT_ICONS[0], color: COLORS[(habits().length + 2) % COLORS.length], freq: 'daily', days: [], n: 3, done: {}, createdAt: Date.now(), order: Date.now() }); return 'Hábito creado. ¡A por la racha!'; } };
  }

  /* Por defecto: una tarea («dentista mañana a las 10») */
  const body = text.replace(/^(?:recu[eé]rdame(?:\s+que)?|ap[uú]nta(?:me)?|a[nñ]ade|anota(?:me)?|(?:crea(?:r|me)?\s+)?(?:una\s+)?(?:nueva\s+)?tarea(?:\s+de)?|tengo que)[\s,:]+/i, '');
  const p = parseQuick(body, todayStr());
  if (!p.title) return { say: 'No te he entendido. Prueba otra vez.' };
  const ctx = location.hash.startsWith('#proyecto/') ? { projectId: location.hash.split('/')[1] } : {};
  const short = summarize(p.title);
  return {
    say: 'Nueva tarea', title: short || cap(p.title.replace(/^(?:quiero|quisiera|me gustaria|me gustaría|necesito)\s+/i, '')), html: p.found.length ? `<div class="voice-chips">${chipsOf(p.found)}</div>` : '<p class="muted small">Sin fecha: irá a la bandeja de Tareas.</p>',
    run: tt => {
      const t = addParsedTask(body, ctx);
      if (t && tt && tt !== t.title) { state.events.forEach(e => { if (e.taskId === t.id) e.title = tt; }); t.title = tt; }
      return 'Tarea añadida';
    },
  };
}

/* ---------- Panel de voz (flota encima del +, con transparencia) ---------- */
const VOICE_HINTS = ['«Dentista mañana a las 10»', '«Objetivo: correr 10 km en 3 meses»', '«Mueve el informe al viernes»', '«He terminado la compra»', '«¿Qué tengo hoy?»', '«Abre la semana»'];
document.body.insertAdjacentHTML('beforeend', `
  <button class="fab-mic" type="button" data-voice="open" aria-label="Hablar con la app">${I.mic}</button>
  <div id="voice-back" class="voice-back" hidden></div>
  <section id="voice" class="voice" hidden role="dialog" aria-modal="true" aria-label="Hablar con la app">
    <div class="voice-head"><b>¿Qué hago?</b><button type="button" class="icon-btn voice-x" data-voice="close" aria-label="Cerrar">${I.close}</button></div>
    <div class="voice-say" aria-live="polite"></div>
    <div class="voice-more"></div>
    <div class="voice-bar">
      <button type="button" class="voice-mic" data-voice="mic" aria-label="Hablar">${I.mic}</button>
      <div class="voice-btns"></div>
    </div>
    <form class="voice-type" autocomplete="off"><input type="text" name="q" placeholder="O escríbelo aquí" enterkeyhint="go" aria-label="Escribe lo que quieres hacer"></form>
  </section>`);
const vEl = $('#voice'), vBack = $('#voice-back');
let vPlan = null, vTimer = null, vSession = 0;
function vRender(say, more = '', btns = '') {
  $('.voice-say', vEl).textContent = say;
  $('.voice-more', vEl).innerHTML = more;
  $('.voice-btns', vEl).innerHTML = btns;
}
function vIdle() {
  vPlan = null;
  vEl.classList.remove('listening');
  vRender(voiceOK ? 'Pulsa el micrófono y dímelo.' : 'Escribe lo que quieres hacer.', `<p class="voice-hint">Por ejemplo: ${VOICE_HINTS[Math.floor(Math.random() * VOICE_HINTS.length)]}</p>`);
}
function vListen() {
  if (!voiceOK) { toast('Este navegador no deja dictar. Escríbelo, o usa el micrófono del teclado.'); $('.voice-type input', vEl).focus(); return; }
  if (voiceRec) { stopListening(false); return; }
  vPlan = null;
  const sid = ++vSession; /* si escribes o cierras, lo que llegue de esta escucha se ignora */
  let failed = false;
  vRender('Abriendo el micrófono…', '<p class="voice-hint">Pulsa el micrófono otra vez para parar.</p>');
  const ok = listen({
    onAudio: () => { if (sid !== vSession) return; if (!failed && /^Abriendo/.test($('.voice-say', vEl).textContent)) $('.voice-say', vEl).textContent = 'Te escucho… habla ahora'; },
    onText: t => { if (sid !== vSession) return; $('.voice-say', vEl).textContent = '«' + cleanVoice(t) + '»'; },
    onError: code => {
      if (sid !== vSession) return;
      failed = true; vEl.classList.remove('listening');
      vRender(voiceErrorText(code), code === 'no-speech' || code === 'network' ? '' : '<p class="voice-hint">Toca «O escríbelo aquí» y pulsa el micrófono de tu teclado para dictar.</p>',
        '<button type="button" class="btn" data-voice="kbd">Usar el teclado</button>');
    },
    onDone: heard => {
      if (sid !== vSession) return;
      vEl.classList.remove('listening');
      if (vEl.hidden) return;
      if (heard) vShow(heard);
      else if (!failed) vRender('No te he oído. Pulsa el micrófono y habla justo después.');
    },
  });
  if (ok) vEl.classList.add('listening');
}
function vShow(text) {
  const r = interpret(text);
  vPlan = r;
  const heard = `<p class="voice-heard">Has dicho: «${esc(cleanVoice(text))}»</p>`;
  if (r.go) { vRender(r.say, heard); clearTimeout(vTimer); vTimer = setTimeout(() => { closeVoice(); r.go(); }, 450); return; }
  /* El título se puede corregir antes de «Hacer» */
  const edit = r.title != null ? `<label class="voice-edit"><span>Título</span><input type="text" value="${esc(r.title)}" maxlength="120" enterkeyhint="done"></label>` : '';
  if (r.run) vRender(r.say, edit + heard + (r.html || ''), '<button type="button" class="btn" data-voice="idle">No</button><button type="button" class="btn primary" data-voice="do">Hacer</button>');
  else vRender(r.say, heard + (r.html || ''));
}
let vHideT = null;
function openVoice() {
  clearTimeout(vTimer); clearTimeout(vHideT);
  if (vBack.hidden) markOpened(vBack);
  vEl.hidden = false; vBack.hidden = false;
  const inp = $('.voice-type input', vEl);
  inp.value = '';
  vIdle();
  requestAnimationFrame(() => { vEl.classList.add('open'); vBack.classList.add('open'); });
  if (isIOS || !voiceOK) {
    /* iPhone: el dictado del navegador falla a menudo (sobre todo en la app instalada). El del teclado
       funciona siempre: se abre el teclado y basta con pulsar su micrófono. */
    vEl.classList.add('kbd-mode');
    vRender('Pulsa el micrófono 🎤 de tu teclado y habla', '<p class="voice-hint">Cuando acabes, pulsa «Ir» en el teclado. Por ejemplo: «dentista mañana a las 10».</p>');
    inp.placeholder = 'Dicta o escribe aquí';
    inp.focus(); /* dentro del toque: así el iPhone abre el teclado */
    vFollowKeyboard(true);
    return;
  }
  vEl.classList.remove('kbd-mode');
  vListen(); /* lo has pulsado tú: empieza a escuchar. Se para con el micrófono o con ✕ */
}
/* Con el teclado abierto, el panel sube para quedar justo encima de él */
function vPlace() {
  const vv = window.visualViewport;
  if (!vv || vEl.hidden) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  vEl.style.bottom = kb > 80 ? (kb + 10) + 'px' : '';
  vEl.style.maxHeight = kb > 80 ? (vv.height - 20) + 'px' : '';
}
function vFollowKeyboard(on) {
  const vv = window.visualViewport;
  if (!vv) return;
  vv[on ? 'addEventListener' : 'removeEventListener']('resize', vPlace);
  vv[on ? 'addEventListener' : 'removeEventListener']('scroll', vPlace);
  if (!on) { vEl.style.bottom = ''; vEl.style.maxHeight = ''; } else vPlace();
}
function closeVoice() {
  vSession++;
  vFollowKeyboard(false);
  stopListening(true);
  clearTimeout(vTimer);
  vPlan = null;
  /* Se desvanece y luego se oculta: sin saltos ni temblores */
  if (vEl.hidden) return;
  if (document.activeElement && vEl.contains(document.activeElement)) document.activeElement.blur();
  vEl.classList.remove('open', 'listening'); vBack.classList.remove('open');
  clearTimeout(vHideT);
  vHideT = setTimeout(() => { if (!vEl.classList.contains('open')) { vEl.hidden = true; vBack.hidden = true; } }, reduceMotion() ? 0 : 200);
}
function vDo() {
  const r = vPlan;
  if (!r || !r.run) return;
  const ed = $('.voice-edit input', vEl), title = ed ? ed.value.trim() : null;
  if (ed && !title) { ed.focus(); return; }
  const snap = JSON.parse(JSON.stringify(state));
  const msg = r.run(title);
  closeVoice();
  save(); rerender();
  toast(msg || 'Hecho', { action: 'Deshacer', onAction: () => { Object.keys(state).forEach(k => { if (!(k in snap)) delete state[k]; }); Object.assign(state, snap); save(); rerender(); toast('Deshecho'); } });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-voice]');
  if (!b) return;
  const k = b.dataset.voice;
  if (k === 'open') openVoice();
  else if (k === 'close') closeVoice();
  else if (k === 'mic') vListen();
  else if (k === 'do') vDo();
  else if (k === 'idle') vIdle();
  else if (k === 'kbd') { vSession++; stopListening(true); vEl.classList.remove('listening'); vRender('Pulsa el micrófono 🎤 de tu teclado y habla', '<p class="voice-hint">Cuando acabes, pulsa «Ir» en el teclado.</p>'); $('.voice-type input', vEl).focus(); vFollowKeyboard(true); }
});
vBack.addEventListener('click', e => { if (backdropTap(e, vBack)) closeVoice(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !vEl.hidden) closeVoice(); });
$('.voice-type', vEl).addEventListener('submit', e => {
  e.preventDefault();
  const inp = e.target.elements.q, v = inp.value.trim();
  if (!v) return;
  vSession++; stopListening(true); vEl.classList.remove('listening');
  inp.value = ''; inp.blur();
  vShow(v);
});
$('.voice-more', vEl).addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('.voice-edit')) { e.preventDefault(); vDo(); }
});
/* Si sales de la app mientras escucha, deja de escuchar */
document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(true); });
window.addEventListener('hashchange', () => { if (!vEl.hidden) closeVoice(); });
