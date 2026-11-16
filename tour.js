/* P Organizer — tutorial guiado de los primeros pasos: oscurece la pantalla, deja un hueco
   sobre lo que hay que tocar y explica cada paso. Avanza cuando haces lo que te pide. */
'use strict';

const TOUR_KEY = 'organizador.tour';
const tour = { on: false, step: 0, layer: null, raf: 0, taskId: null, startTasks: 0, waitSince: 0 };

function tourSeen() { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return true; } }
function markTourSeen() { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* sin almacenamiento */ } }

const tourTask = () => tour.taskId && document.querySelector(`li.task[data-task="${tour.taskId}"]`);
const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const firstVisible = sel => [...document.querySelectorAll(sel)].find(visible) || null;

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
    text: 'Con él añades tareas, bloques en el calendario, hábitos diarios, objetivos y proyectos.',
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

function startTour() {
  /* Nunca encima de la bienvenida: empieza cuando esta termine */
  if (tour.on || (typeof ob !== 'undefined' && ob.el)) return;
  if (typeof closeSelect === 'function') closeSelect();
  if (modal.open) modal.close();
  tour.on = true;
  tour.step = 0;
  tour.taskId = null;
  tour.startTasks = state.tasks.filter(t => !t.routineId).length;
  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.innerHTML = `
    <div class="tour-shade"></div>
    <div class="tour-ring"></div>
    <div class="tour-tip" role="dialog" aria-live="polite">
      <div class="tour-count"></div>
      <div class="tour-title"></div>
      <div class="tour-text"></div>
      <div class="tour-actions"><button type="button" class="tour-skip">Saltar tutorial</button><button type="button" class="btn small primary tour-next"></button></div>
    </div>`;
  layer.querySelector('.tour-skip').addEventListener('click', () => endTour(false));
  layer.querySelector('.tour-next').addEventListener('click', () => tourAdvance());
  if (layer.showPopover) layer.popover = 'manual';
  tour.layer = layer;
  tourShowStep();
  tour.raf = requestAnimationFrame(tourFrame);
}

/* La capa va en la capa superior; si hay un formulario abierto, dentro de él para que siga activo */
function tourMount() {
  const host = TOUR_STEPS[tour.step].inModal && modal.open ? modal : document.body;
  const l = tour.layer;
  if (l.parentNode !== host) {
    if (l.hidePopover && l.matches(':popover-open')) try { l.hidePopover(); } catch (_) { /* cerrada */ }
    host.appendChild(l);
  }
  if (l.showPopover && !l.matches(':popover-open')) try { l.showPopover(); } catch (_) { /* sin capa superior */ }
}

function tourShowStep() {
  const s = TOUR_STEPS[tour.step];
  if (s.hash && !location.hash.startsWith('#' + s.hash)) location.hash = '#' + s.hash;
  const l = tour.layer;
  l.querySelector('.tour-count').textContent = `Paso ${tour.step + 1} de ${TOUR_STEPS.length}`;
  l.querySelector('.tour-title').textContent = s.title;
  l.querySelector('.tour-text').textContent = s.text;
  const nb = l.querySelector('.tour-next');
  nb.textContent = s.next || 'Siguiente';
  nb.hidden = !s.next;
  tour.waitSince = Date.now();
  tour.rect = null;
  tour.scrolled = false;
  const tip = l.querySelector('.tour-tip');
  tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
  tourMount();
}

function tourAdvance() {
  const s = TOUR_STEPS[tour.step];
  if (s.after) s.after();
  if (tour.step >= TOUR_STEPS.length - 1) { endTour(true); return; }
  tour.step++;
  tourShowStep();
}

/* Cada fotograma: sigue al elemento (aunque la pantalla se repinte o se desplace) y comprueba si ya lo has hecho */
function tourFrame() {
  if (!tour.on) return;
  const s = TOUR_STEPS[tour.step];
  if (s.done && s.done()) { tourAdvance(); tour.raf = requestAnimationFrame(tourFrame); return; }
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
    const pad = 8, x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.width + pad * 2), h = r.height + pad * 2;
    const key = [x, y, w, h].map(Math.round).join();
    if (key !== tour.rect) {
      tour.rect = key;
      shade.style.clipPath = `path(evenodd, 'M0 0H${W}V${H}H0Z M${x} ${y}h${w}v${h}h${-w}Z')`;
      Object.assign(ring.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: 1 });
      /* La explicación va debajo del hueco si cabe; si no, encima */
      const th = tip.offsetHeight, tw = Math.min(340, W - 24);
      tip.style.width = tw + 'px';
      tip.style.left = Math.max(12, Math.min(x + w / 2 - tw / 2, W - tw - 12)) + 'px';
      const below = y + h + 14;
      tip.style.top = (below + th < H - 12 ? below : Math.max(12, y - th - 14)) + 'px';
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
  tour.on = false;
  cancelAnimationFrame(tour.raf);
  if (!keepPending) markTourSeen();
  const l = tour.layer;
  tour.layer = null;
  tour.scrolled = false;
  if (l) {
    l.classList.add('out');
    setTimeout(() => { if (l.hidePopover && l.matches(':popover-open')) try { l.hidePopover(); } catch (_) { /* cerrada */ } l.remove(); }, 250);
  }
  if (completed) toast('¡Listo! Ya sabes lo básico. Puedes repetir el tutorial en Ajustes.');
}
