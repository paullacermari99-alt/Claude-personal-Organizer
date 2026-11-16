/* P Organizer — gestos táctiles: deslizar tareas y cerrar hojas arrastrando hacia abajo. */
'use strict';

/* ---------- Deslizar una tarea (estilo apps de tareas de iOS) ----------
   Derecha → completar. Izquierda → pasar a mañana. */
let swipe = null;
const SWIPE_DONE = 80;

document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || swipe) return;
  const row = e.target.closest('li.task .task-row');
  if (!row || e.target.closest('input')) return;
  swipe = { li: row.parentElement, row, x0: e.clientX, y0: e.clientY, dx: 0, axis: null, id: row.parentElement.dataset.task };
});

document.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
  if (!swipe.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (swipe.axis === 'y') { swipe = null; return; }
    swipe.li.classList.add('swiping');
  }
  /* Resistencia al pasar el umbral, como en iOS */
  const lim = SWIPE_DONE * 1.6;
  swipe.dx = Math.abs(dx) > lim ? Math.sign(dx) * (lim + (Math.abs(dx) - lim) * .25) : dx;
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  const pass = Math.abs(swipe.dx) >= SWIPE_DONE;
  swipe.li.classList.toggle('swipe-right', swipe.dx > 0);
  swipe.li.classList.toggle('swipe-left', swipe.dx < 0);
  if (pass !== !!swipe.pass) { swipe.pass = pass; if (pass) haptic(10); }
  swipe.li.classList.toggle('swipe-pass', pass);
});

function endSwipe(commit) {
  const s = swipe;
  swipe = null;
  if (!s || s.axis !== 'x') return;
  suppressClickUntil = Date.now() + 300;
  const { li, row } = s;
  row.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1)';
  const t = task(s.id);
  if (commit && t && s.dx >= SWIPE_DONE) {
    row.style.transform = '';
    setTimeout(() => { li.classList.remove('swiping', 'swipe-right', 'swipe-left', 'swipe-pass'); row.style.transition = ''; }, 280);
    toggleTask(s.id, null);
  } else if (commit && t && s.dx <= -SWIPE_DONE && !t.routineId && !t.done) {
    row.style.transform = 'translateX(-110%)';
    const prev = t.due;
    const base = t.due && t.due >= todayStr() ? t.due : todayStr();
    t.due = addDays(base, 1);
    save();
    toast('Plazo: ' + relDay(t.due).toLowerCase(), { action: 'Deshacer', onAction: () => { t.due = prev; save(); rerender(); } });
    /* La fila se recoge suavemente antes de repintar */
    li.style.height = li.offsetHeight + 'px';
    requestAnimationFrame(() => { li.classList.add('collapsing'); li.style.height = '0px'; });
    setTimeout(rerender, 300);
  } else {
    row.style.transform = '';
    setTimeout(() => { li.classList.remove('swiping', 'swipe-right', 'swipe-left', 'swipe-pass'); row.style.transition = ''; }, 280);
  }
}
document.addEventListener('pointerup', () => endSwipe(true));
document.addEventListener('pointercancel', () => endSwipe(false));

/* ---------- Hoja modal: arrastrar hacia abajo para cerrar ---------- */
let sheet = null;
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  const head = e.target.closest('#modal .grabber, #modal .sheet-head');
  if (!head || e.target.closest('button')) return;
  const dlg = $('#modal');
  sheet = { dlg, y0: e.clientY, t0: performance.now(), dy: 0 };
  dlg.style.transition = 'none';
});
document.addEventListener('pointermove', e => {
  if (!sheet) return;
  sheet.dy = Math.max(0, e.clientY - sheet.y0);
  sheet.dlg.style.transform = `translateY(${sheet.dy}px)`;
});
function endSheet() {
  if (!sheet) return;
  const { dlg, dy, t0 } = sheet;
  sheet = null;
  const v = dy / Math.max(1, performance.now() - t0);
  dlg.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1)';
  if (dy > 120 || (dy > 30 && v > .6)) {
    dlg.style.transform = 'translateY(100%)';
    setTimeout(() => { dlg.close(); dlg.style.transform = ''; dlg.style.transition = ''; }, 230);
  } else {
    dlg.style.transform = '';
    setTimeout(() => { dlg.style.transition = ''; }, 260);
  }
}
document.addEventListener('pointerup', endSheet);
document.addEventListener('pointercancel', endSheet);
