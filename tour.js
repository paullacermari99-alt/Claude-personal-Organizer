/* P Organizer — tutoriales guiados: oscurecen la pantalla, resaltan una zona y explican qué hacer.
   · Primeros pasos: deja un hueco para tocar solo lo que pide y avanza cuando lo haces.
   · Por pantalla: la primera vez que entras en cada pantalla, un repaso breve (solo mirar). */
'use strict';

const TOUR_KEY = 'organizador.tour';
const SCREEN_KEY = 'organizador.tour.';
const tour = { on: false, steps: [], step: 0, key: TOUR_KEY, main: true, layer: null, raf: 0, taskId: null, startTasks: 0, waitSince: 0 };

const flag = k => { try { return localStorage.getItem(k) === '1'; } catch { return true; } };
const setFlag = k => { try { localStorage.setItem(k, '1'); } catch { /* sin almacenamiento */ } };
function tourSeen() { return flag(TOUR_KEY); }
function markTourSeen() { setFlag(TOUR_KEY); }
/* Al empezar de cero se vuelven a mostrar todos los tutoriales */
function resetTours() {
  try { Object.keys(localStorage).filter(k => k === TOUR_KEY || k.startsWith(SCREEN_KEY)).forEach(k => localStorage.removeItem(k)); } catch { /* sin almacenamiento */ }
}

const tourTask = () => tour.taskId && document.querySelector(`li.task[data-task="${tour.taskId}"]`);
const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const firstVisible = sel => [...document.querySelectorAll(sel)].find(visible) || null;
/* Sección de la pantalla cuyo título empieza por… */
const sectionBy = txt => [...document.querySelectorAll('.page .section')].find(s => { const h = s.querySelector('h2'); return h && visible(s) && h.textContent.trim().toLowerCase().startsWith(txt); }) || null;

const TOUR_STEPS = [
  {
    hash: 'hoy',
    target: () => firstVisible('.page form.quick-add input[name=title]'),
    title: 'Crea tu primera tarea',
    text: 'Escribe aquí algo que tengas que hacer y pulsa Intro. Prueba con «Llamar a mamá 18h».',
    done: () => state.tasks.filter(t => !t.routineId).length > tour.startTasks,
    after: () => { const t = state.tasks.filter(x => !x.routineId).sort((a, b) => b.createdAt - a.createdAt)[0]; tour.taskId = t && t.id; },
  },
  {
    target: () => { const li = tourTask(); return li && (li.querySelector('.body') || li); },
    title: 'Ábrela para ver los detalles',
    text: 'Toca la tarea. Ahí puedes ponerle plazo, duración, prioridad, proyecto o hacer que se repita.',
    done: () => modal.open,
    fallback: () => { const t = tour.taskId && task(tour.taskId); if (t) taskModal(t); },
  },
  {
    inModal: true,
    target: () => modal.open && modal.querySelector('.sheet-head button[type=submit]'),
    title: 'Ajusta lo que quieras y guarda',
    text: 'Cambia lo que necesites y pulsa «Guardar». Si no quieres cambiar nada, guarda igualmente.',
    done: () => !modal.open,
  },
  {
    target: () => { const li = tourTask(); return li && li.querySelector('.check'); },
    title: 'Márcala cuando la hagas',
    text: 'Toca el círculo para completarla. Nada se mueve de sitio y tu progreso del día avanza.',
    done: () => { const t = tour.taskId && task(tour.taskId); return !t || t.done; },
  },
  {
    target: () => firstVisible('.fab') || firstVisible('.nav-new'),
    title: 'El botón + lo crea todo',
    text: 'Con él añades tareas, bloques en el calendario, hábitos diarios, objetivos y proyectos. Lo usarás cuando acabe el tutorial.',
    next: 'Entendido',
  },
  {
    target: () => firstVisible('nav a[data-nav="semana"]'),
    title: 'Planifica tu semana',
    text: 'Toca «Semana» para ver tu calendario.',
    done: () => location.hash.startsWith('#semana'),
  },
  {
    hash: 'semana',
    target: () => firstVisible('aside.tray') || firstVisible('.ptray-head'),
    title: 'Dale una hora a tus tareas',
    text: 'Aquí están las tareas sin hora. Arrástralas al calendario para reservarles tiempo. ¡Ya sabes lo básico!',
    next: '¡Listo!',
  },
];

/* Repaso breve de cada pantalla (solo mirar: todo lo demás queda bloqueado) */
const SCREEN_TOURS = {
  hoy: [
    { target: () => firstVisible('.page .day-hero') || sectionBy('prioridades'), title: 'Tu día en un vistazo', text: 'Cuántas tareas llevas, si te da tiempo y qué toca ahora. «Planificar mi día» te ayuda a elegir 3 prioridades en un minuto.' },
    { target: () => sectionBy('prioridades'), title: 'Prioridades', text: 'Las 3 cosas que de verdad importan hoy. Con «Elegir» las cambias cuando quieras.' },
    { target: () => sectionBy('horario') || firstVisible('.page [data-act="day"]'), title: 'Tu horario', text: 'Los bloques de tiempo del día. Con las flechas de arriba miras otros días.' },
  ],
  semana: [
    { target: () => firstVisible('.page .week-toolbar .segmented') || firstVisible('.page .week-toolbar'), title: 'Cómo ver la semana', text: 'Elige ver la semana entera, 3 días o un solo día.' },
    { target: () => firstVisible('.page aside.tray') || firstVisible('.page .ptray'), title: 'Por planificar', text: 'Las tareas sin hora y los plazos cercanos. Arrástralas al calendario para reservarles tiempo.' },
    { target: () => firstVisible('.page [data-act="copy-week"]'), title: 'Copiar la semana anterior', text: 'Si tus semanas se parecen, copia los bloques de la anterior de una vez.' },
  ],
  tareas: [
    { target: () => firstVisible('.page .segmented'), title: 'Todas tus tareas', text: 'Bandeja son las que no tienen fecha; Próximas, las que tienen plazo; también ves las vencidas y las hechas.' },
    { target: () => firstVisible('.page .filters'), title: 'Filtra', text: 'Busca por texto o filtra por proyecto, etiqueta o prioridad.' },
    { target: () => firstVisible('.page form.quick-add'), title: 'Apunta rápido', text: 'Escribe como hablas: «dentista mañana 17h #salud» y la app entiende fecha, hora y etiqueta.' },
  ],
  objetivos: [
    { target: () => firstVisible('.page [data-act="new-goal"]'), title: 'Tus objetivos', text: 'Crea objetivos con su «para qué». Las tareas que les asignes hacen avanzar su progreso.' },
    { target: () => firstVisible('.page .toolbar'), title: 'Corto, medio y largo plazo', text: 'Fíltralos por horizonte, por proyecto o por estado.' },
  ],
  proyectos: [
    { target: () => firstVisible('.page [data-act="new-project"]'), title: 'Tus proyectos', text: 'Agrupa tareas, objetivos y bloques de algo grande, como un trabajo o una asignatura.' },
    { target: () => firstVisible('.page .segmented.icons') || firstVisible('.page .toolbar'), title: 'Cómo verlos', text: 'En tarjetas o en lista, activos o archivados, y ordenados como prefieras.' },
  ],
  diarias: [
    { target: () => firstVisible('.page [data-act="new-routine"]'), title: 'Hábitos diarios', text: 'Crea tareas que se repiten los días que elijas, como beber agua o leer.' },
    { target: () => firstVisible('.page .hint.intro') || firstVisible('.page .routine'), title: 'No se pierden', text: 'Si un día no la haces, se acumula en un contador. «Hecha» marca la más antigua y tu racha sigue.' },
  ],
  progreso: [
    { target: () => firstVisible('.page .stat-tiles'), title: 'Tu progreso', text: 'Tareas hechas, minutos de enfoque, tu mejor racha y objetivos conseguidos esta semana.' },
    { target: () => sectionBy('tareas hechas') || firstVisible('.page .section'), title: 'Tu semana en gráficos', text: 'Cómo vas día a día. Más abajo verás tu enfoque, tu ánimo y tus rachas.' },
  ],
  revision: [
    { target: () => firstVisible('.page .section.step'), title: 'Revisión semanal', text: 'Unos 10 minutos a la semana: primero repasas lo pendiente y lo reprogramas o lo borras.' },
    { target: () => document.querySelectorAll('.page .section.step')[1] || null, title: 'Elige tus prioridades', text: 'Marca lo que de verdad quieres sacar esta semana (hasta 5).' },
    { target: () => firstVisible('.page [data-act="review-done"]'), title: 'Termina', text: 'Dales hueco en el calendario y pulsa «Terminar revisión».' },
  ],
};

function startTour(steps = TOUR_STEPS, key = TOUR_KEY) {
  /* Nunca encima de la bienvenida: empieza cuando esta termine */
  if (tour.on || (typeof ob !== 'undefined' && ob.el)) return;
  if (typeof closeSelect === 'function') closeSelect();
  if (modal.open) modal.close();
  Object.assign(tour, { on: true, steps, key, main: steps === TOUR_STEPS, step: 0, taskId: null });
  tour.startTasks = state.tasks.filter(t => !t.routineId).length;
  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.innerHTML = `
    <div class="tour-shade"></div>
    <div class="tour-block"></div>
    <div class="tour-ring"></div>
    <div class="tour-tip" role="dialog" aria-live="polite">
      <div class="tour-count"></div>
      <div class="tour-title"></div>
      <div class="tour-text"></div>
      <div class="tour-actions"><button type="button" class="tour-skip">${tour.main ? 'Saltar tutorial' : 'Saltar'}</button><button type="button" class="btn small primary tour-next"></button></div>
    </div>`;
  layer.querySelector('.tour-skip').addEventListener('click', () => endTour(false));
  layer.querySelector('.tour-next').addEventListener('click', () => tourAdvance());
  if (layer.showPopover) layer.popover = 'manual';
  tour.layer = layer;
  tourShowStep();
  tour.raf = requestAnimationFrame(tourFrame);
}

/* Al entrar en una pantalla por primera vez, su repaso breve */
function maybeScreenTour() {
  if (tour.on || (typeof ob !== 'undefined' && ob.el) || !tourSeen()) return;
  const page = (location.hash.replace(/^#/, '') || 'hoy').split('/')[0];
  const steps = SCREEN_TOURS[page];
  if (!steps || flag(SCREEN_KEY + page)) return;
  clearTimeout(tour.screenTimer);
  tour.screenTimer = setTimeout(() => {
    const now = (location.hash.replace(/^#/, '') || 'hoy').split('/')[0];
    if (now !== page || modal.open || tour.on) return;
    startTour(steps, SCREEN_KEY + page);
  }, 500);
}

/* La capa va en la capa superior; si hay un formulario abierto, dentro de él para que siga activo */
function tourMount() {
  const host = tour.steps[tour.step].inModal && modal.open ? modal : document.body;
  const l = tour.layer;
  if (l.parentNode !== host) {
    if (l.hidePopover && l.matches(':popover-open')) try { l.hidePopover(); } catch (_) { /* cerrada */ }
    host.appendChild(l);
  }
  if (l.showPopover && !l.matches(':popover-open')) try { l.showPopover(); } catch (_) { /* sin capa superior */ }
}

/* Un paso es «solo mirar» si se avanza con un botón: entonces no se puede tocar nada más */
const lookOnly = s => !s.done;

function tourShowStep() {
  const s = tour.steps[tour.step];
  if (s.hash && !location.hash.startsWith('#' + s.hash)) location.hash = '#' + s.hash;
  const l = tour.layer, n = tour.steps.length, last = tour.step === n - 1;
  l.querySelector('.tour-count').textContent = n > 1 ? `${tour.main ? 'Paso ' : ''}${tour.step + 1} de ${n}` : '';
  l.querySelector('.tour-title').textContent = s.title;
  l.querySelector('.tour-text').textContent = s.text;
  const nb = l.querySelector('.tour-next');
  nb.textContent = s.next || (last ? 'Entendido' : 'Siguiente');
  nb.hidden = !lookOnly(s);
  l.classList.toggle('look', lookOnly(s));
  tour.waitSince = Date.now();
  tour.rect = null;
  tour.scrolled = false;
  const tip = l.querySelector('.tour-tip');
  tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
  tourMount();
}

function tourAdvance() {
  const s = tour.steps[tour.step];
  if (s.after) s.after();
  if (tour.step >= tour.steps.length - 1) { endTour(true); return; }
  tour.step++;
  tourShowStep();
}

/* Cada fotograma: sigue al elemento (aunque la pantalla se repinte o se desplace) y comprueba si ya lo has hecho */
function tourFrame() {
  if (!tour.on) return;
  const s = tour.steps[tour.step];
  if (s.done && s.done()) { tourAdvance(); tour.raf = requestAnimationFrame(tourFrame); return; }
  /* En un paso de solo mirar no se abre nada: si algo se abrió, se cierra */
  if (lookOnly(s) && !s.inModal && modal.open) modal.close();
  tourMount();
  const el = s.target();
  const l = tour.layer, ring = l.querySelector('.tour-ring'), shade = l.querySelector('.tour-shade'), tip = l.querySelector('.tour-tip');
  const W = innerWidth, H = innerHeight;
  if (el && visible(el)) {
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > H - 60) {
      /* Lo trae a la vista una sola vez por paso */
      if (!tour.scrolled) { tour.scrolled = true; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    const pad = 8, x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.width + pad * 2), h = Math.min(r.height + pad * 2, H - 8 - y);
    const key = [x, y, w, h, W, H].map(Math.round).join();
    if (key !== tour.rect) {
      tour.rect = key;
      shade.style.clipPath = `path(evenodd, 'M0 0H${W}V${H}H0Z M${x} ${y}h${w}v${h}h${-w}Z')`;
      Object.assign(ring.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: 1 });
      /* La explicación va debajo del hueco si cabe; si no, encima; si tampoco, dentro abajo */
      const th = tip.offsetHeight, tw = Math.min(340, W - 24);
      tip.style.width = tw + 'px';
      tip.style.left = Math.max(12, Math.min(x + w / 2 - tw / 2, W - tw - 12)) + 'px';
      const below = y + h + 14, above = y - th - 14;
      tip.style.top = (below + th < H - 12 ? below : above >= 12 ? above : H - th - 16) + 'px';
    }
  } else {
    /* Sin elemento a la vista: pantalla oscura y explicación centrada */
    if (tour.rect !== 'none') {
      tour.rect = 'none';
      shade.style.clipPath = 'none';
      ring.style.opacity = 0;
      const tw = Math.min(340, W - 24);
      tip.style.width = tw + 'px';
      tip.style.left = (W - tw) / 2 + 'px';
      tip.style.top = (H - tip.offsetHeight) / 2 + 'px';
    }
    /* Si no está a la vista (por ejemplo, una tarea para otro día), se ayuda o se deja seguir */
    if (Date.now() - tour.waitSince > 1500) {
      tour.waitSince = Infinity;
      if (s.fallback) s.fallback();
      else { const nb = l.querySelector('.tour-next'); nb.textContent = s.next || 'Siguiente'; nb.hidden = false; }
    }
  }
  tour.raf = requestAnimationFrame(tourFrame);
}

function endTour(completed, keepPending) {
  const wasMain = tour.main;
  tour.on = false;
  cancelAnimationFrame(tour.raf);
  if (!keepPending) setFlag(tour.key);
  const l = tour.layer;
  tour.layer = null;
  tour.scrolled = false;
  if (l) {
    l.classList.add('out');
    setTimeout(() => { if (l.hidePopover && l.matches(':popover-open')) try { l.hidePopover(); } catch (_) { /* cerrada */ } l.remove(); }, 250);
  }
  if (completed && wasMain) toast('¡Listo! Ya sabes lo básico. Puedes repetir el tutorial en Ajustes.');
}
