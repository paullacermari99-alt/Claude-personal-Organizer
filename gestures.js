/* Boldup — gestos táctiles y ventanas por encima.
   v42: con una ventana abierta (hoja, panel de voz, enfoque, lista desplegable) lo de detrás no se toca ni se
   desplaza; tocar fuera la cierra sin pulsar lo de debajo. Los gestos del móvil (deslizar tareas, cerrar hojas
   arrastrando, cambiar de semana) usan eventos táctiles y deciden la dirección en el primer movimiento, así el
   iPhone no empieza a desplazar la página a medias y el gesto no se atasca. */
'use strict';

const rm = () => typeof reduceMotion === 'function' && reduceMotion();
const EASE = 'cubic-bezier(.2,.9,.3,1)';

/* ---------- Toques que no atraviesan ---------- */

/* Dónde empezó el toque actual: un fondo solo cierra si el toque empezó Y acabó en él
   (si empiezas dentro de la hoja y sueltas fuera, no se cierra). */
let downOn = null;
/* «Comerse» el clic de este toque: se usa cuando el toque solo sirve para cerrar algo */
let eatClick = false, eatTimer = 0;
window.addEventListener('pointerdown', e => { downOn = e.target; eatClick = false; }, true);
function eatNextClick() {
  eatClick = true;
  clearTimeout(eatTimer);
  eatTimer = setTimeout(() => { eatClick = false; }, 900);
}
window.addEventListener('click', e => {
  if (!eatClick) return;
  eatClick = false;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);

/* ¿Este clic es un toque en el fondo de la ventana `el`? Ignora el toque que la abrió (p. ej. al soltar
   tras mantener pulsado) y los toques que empezaron dentro. */
function backdropTap(e, el) {
  return e.target === el && downOn === el && Date.now() - (el._openedAt || 0) > 350;
}
function markOpened(el) { if (el) el._openedAt = Date.now(); }

/* ---------- Lo de detrás no se desplaza ---------- */

function overlayOpen() {
  const m = document.getElementById('modal'), v = document.getElementById('voice'), f = document.getElementById('focus');
  const ps = document.getElementById('pro-store'), pw = document.getElementById('pro-welcome'), nk = document.getElementById('soc-dlg');
  return !!((m && m.open) || (ps && ps.open) || (pw && pw.open) || (nk && nk.open) || (v && !v.hidden) || (f && !f.hidden) || document.querySelector('.sel-pop'));
}
/* ¿Puede algo entre `el` y `stop` desplazarse en esa dirección? (dy > 0 = el dedo baja) */
function canScroll(el, stop, dx, dy) {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
        if (dy > 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
      }
    } else if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) {
      if (dx > 0 ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
    }
    if (n === stop) break;
  }
  return false;
}

/* ---------- Estado de los gestos ---------- */
let swipe = null;      /* deslizar una tarea */
let sheet = null;      /* arrastrar la hoja hacia abajo */
let lastTouch = null;  /* para saber hacia dónde va el dedo */
const SWIPE_DONE = 80;

function touchPt(e) { const t = e.touches[0] || e.changedTouches[0]; return { x: t.clientX, y: t.clientY }; }

document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { endSwipe(false); endSheet(false); return; }
  const p = touchPt(e);
  lastTouch = p;
  startSheet(e, p);
  startSwipe(e, p);
}, { passive: true });

/* Un único oyente que puede frenar el desplazamiento: decide en el primer movimiento */
document.addEventListener('touchmove', e => {
  if (e.touches.length !== 1) return;
  const p = touchPt(e);
  const ddx = lastTouch ? p.x - lastTouch.x : 0, ddy = lastTouch ? p.y - lastTouch.y : 0;
  lastTouch = p;
  if (sheet && moveSheet(p)) { if (e.cancelable) e.preventDefault(); return; }
  if (swipe && moveSwipe(p)) { if (e.cancelable) e.preventDefault(); return; }
  if (typeof pswipeMove === 'function' && pswipeMove(p)) { if (e.cancelable) e.preventDefault(); return; }
  if (typeof drag !== 'undefined' && drag) { if (e.cancelable) e.preventDefault(); return; }
  /* Con una ventana abierta, solo se desplaza lo que está dentro de ella */
  if (overlayOpen() && e.cancelable) {
    const box = e.target.closest && e.target.closest('#modal, #voice, #focus, .sel-pop');
    if (!box || !canScroll(e.target, box, ddx, ddy)) e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchend', e => { if (e.touches.length) return; endSheet(true); endSwipe(true); }, { passive: true });
document.addEventListener('touchcancel', () => { endSheet(false); endSwipe(false); }, { passive: true });

/* ---------- Deslizar una tarea (estilo iOS) ----------
   Derecha → completar. Izquierda → pasar a mañana. */
function startSwipe(e, p) {
  const row = e.target.closest && e.target.closest('li.task .task-row');
  if (!row || e.target.closest('input, textarea, .sel-btn')) return;
  swipe = { li: row.parentElement, row, x0: p.x, y0: p.y, dx: 0, axis: null, id: row.parentElement.dataset.task, raf: 0 };
}
function moveSwipe(p) {
  const s = swipe;
  const dx = p.x - s.x0, dy = p.y - s.y0;
  if (!s.axis) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return false;
    if (Math.abs(dx) <= Math.abs(dy)) { swipe = null; return false; }   /* es un desplazamiento: déjalo */
    s.axis = 'x';
    s.x0 += Math.sign(dx) * 5;                                           /* sin salto al empezar */
    s.li.classList.add('swiping');
    s.row.style.transition = 'none';
    s.row.style.willChange = 'transform';
  }
  const raw = p.x - s.x0;
  const lim = SWIPE_DONE * 1.6;
  s.dx = Math.abs(raw) > lim ? Math.sign(raw) * (lim + (Math.abs(raw) - lim) * .25) : raw;
  if (!s.raf) s.raf = requestAnimationFrame(() => {
    s.raf = 0;
    if (swipe !== s) return;
    s.row.style.transform = `translate3d(${s.dx}px,0,0)`;
    const pass = Math.abs(s.dx) >= SWIPE_DONE;
    s.li.classList.toggle('swipe-right', s.dx > 0);
    s.li.classList.toggle('swipe-left', s.dx < 0);
    if (pass !== !!s.pass) { s.pass = pass; s.li.classList.toggle('swipe-pass', pass); if (pass) haptic(10); }
  });
  return true;
}
function endSwipe(commit) {
  const s = swipe;
  swipe = null;
  if (!s || s.axis !== 'x') return;
  cancelAnimationFrame(s.raf);
  suppressClickUntil = Date.now() + 300;
  const { li, row } = s;
  const clean = () => { li.classList.remove('swiping', 'swipe-right', 'swipe-left', 'swipe-pass'); row.style.transition = ''; row.style.willChange = ''; };
  row.style.transition = rm() ? 'none' : `transform .28s ${EASE}`;
  const t = task(s.id);
  if (commit && t && s.dx >= SWIPE_DONE) {
    row.style.transform = '';
    setTimeout(clean, rm() ? 0 : 280);
    toggleTask(s.id, null);
  } else if (commit && t && s.dx <= -SWIPE_DONE && !t.routineId && !t.done) {
    const prev = t.due;
    const base = t.due && t.due >= todayStr() ? t.due : todayStr();
    t.due = addDays(base, 1);
    save();
    toast('Plazo: ' + relDay(t.due).toLowerCase(), { action: 'Deshacer', onAction: () => { t.due = prev; save(); rerender(); } });
    if (rm()) { rerender(); return; }
    row.style.transform = 'translate3d(-110%,0,0)';
    /* La fila se recoge suavemente antes de repintar */
    li.style.height = li.offsetHeight + 'px';
    requestAnimationFrame(() => { li.classList.add('collapsing'); li.style.height = '0px'; });
    setTimeout(rerender, 300);
  } else {
    row.style.transform = '';
    setTimeout(clean, rm() ? 0 : 280);
  }
}

/* ---------- Hoja: arrastrar hacia abajo para cerrar ----------
   Desde la barra de arriba, o desde cualquier sitio de la hoja si ya está arriba del todo. */
function startSheet(e, p) {
  const dlg = document.getElementById('modal');
  if (!dlg || !dlg.open || dlg.classList.contains('is-closing') || innerWidth >= 640) return;
  const t = e.target;
  if (!dlg.contains(t) || t === dlg) return;
  if (t.closest('input[type=range], input[type=color], textarea, .sel-pop')) return;
  const head = !!t.closest('.grabber, .sheet-head');
  if (head && t.closest('button')) return;   /* Cancelar / Guardar se pulsan, no se arrastran */
  sheet = { dlg, x0: p.x, y0: p.y, head, on: false, dy: 0, pts: [], raf: 0, target: t };
}
function moveSheet(p) {
  const s = sheet;
  const dx = p.x - s.x0, dy = p.y - s.y0;
  if (!s.on) {
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return s.head;
    /* Desde el contenido: solo si el dedo baja y no hay nada que desplazar hacia arriba */
    if (!s.head && (dy <= 0 || Math.abs(dx) > Math.abs(dy) || canScroll(s.target, s.dlg, 0, 1))) { sheet = null; return false; }
    if (s.head && Math.abs(dx) > Math.abs(dy) * 2) { sheet = null; return true; }
    s.on = true; s.y0 = p.y;
    swipe = null;
    if (document.activeElement && s.dlg.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) document.activeElement.blur();
    /* Si aún está subiendo, se termina ya la entrada para que siga al dedo sin saltos */
    if (s.dlg.getAnimations) s.dlg.getAnimations().forEach(a => { try { a.finish(); } catch (_) { /* sin animación */ } });
    s.dlg.style.transition = 'none';
    s.dlg.style.willChange = 'transform';
  }
  const d = p.y - s.y0;
  s.dy = d > 0 ? d : -Math.min(14, Math.sqrt(-d) * 2);   /* hacia arriba apenas cede */
  const now = performance.now();
  s.pts.push([now, p.y]);
  while (s.pts.length > 2 && now - s.pts[0][0] > 100) s.pts.shift();
  if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; if (sheet === s) s.dlg.style.transform = `translate3d(0,${s.dy}px,0)`; });
  return true;
}
function endSheet(commit) {
  const s = sheet;
  sheet = null;
  if (!s || !s.on) return;
  cancelAnimationFrame(s.raf);
  const { dlg, dy, pts } = s;
  const a = pts[0], b = pts[pts.length - 1];
  const v = a && b && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;   /* px/ms, en los últimos 100 ms */
  const h = dlg.offsetHeight;
  const reset = () => { dlg.style.transform = ''; dlg.style.transition = ''; dlg.style.willChange = ''; };
  if (commit && (dy > Math.min(140, h * .35) || (dy > 24 && v > .45))) {
    const left = Math.max(0, h + 20 - dy);
    const ms = rm() ? 0 : Math.round(Math.max(120, Math.min(260, left / Math.max(v, 1.4))));
    suppressClickUntil = Date.now() + 350;
    dlg.style.transition = ms ? `transform ${ms}ms cubic-bezier(.3,.7,.4,1)` : 'none';
    dlg.style.transform = `translate3d(0,${h + 20}px,0)`;
    setTimeout(() => { HTMLDialogElement.prototype.close.call(dlg); reset(); }, ms);
  } else {
    dlg.style.transition = rm() ? 'none' : `transform .3s ${EASE}`;
    dlg.style.transform = '';
    setTimeout(reset, rm() ? 0 : 310);
  }
}
