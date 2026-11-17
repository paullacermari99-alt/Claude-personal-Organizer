/* Boldup — desplegables propios: sustituyen la lista nativa del navegador (que no sigue el diseño)
   por una lista integrada. El <select> real sigue en el formulario, oculto, así que guardar funciona igual. */
'use strict';

const selUI = { pop: null, sel: null, btn: null, idx: -1 };

function selLabel(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : '';
}
function enhanceSelect(sel) {
  if (sel.dataset.enhanced || sel.multiple) return;
  sel.dataset.enhanced = '1';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const aria = sel.getAttribute('aria-label') || (sel.closest('label') && sel.closest('label').firstChild && sel.closest('label').firstChild.textContent.trim()) || '';
  if (aria) btn.setAttribute('aria-label', aria);
  if (sel.disabled) btn.disabled = true;
  btn.innerHTML = `<span class="sel-val"></span>`;
  btn.querySelector('.sel-val').textContent = selLabel(sel);
  if (sel.className) btn.classList.add(...sel.className.split(/\s+/).filter(Boolean).map(c => 'sel-' + c));
  sel.after(btn);
  sel.classList.add('sel-native');
  btn._sel = sel;
  sel._btn = btn;
  sel.addEventListener('change', () => { btn.querySelector('.sel-val').textContent = selLabel(sel); });
}
function enhanceSelects(root = document) {
  (root.matches && root.matches('select') ? [root] : root.querySelectorAll ? root.querySelectorAll('select:not([data-enhanced])') : []).forEach(enhanceSelect);
}

function openSelect(btn) {
  closeSelect();
  const sel = btn._sel;
  const pop = document.createElement('div');
  pop.className = 'sel-pop';
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = [...sel.options].map((o, i) => `<div class="sel-opt ${i === sel.selectedIndex ? 'on' : ''} ${o.disabled ? 'off' : ''}" role="option" data-i="${i}" aria-selected="${i === sel.selectedIndex}">${esc(o.textContent)}</div>`).join('');
  /* La lista va en la "capa superior" (popover): así no la recorta ni la desplaza el formulario,
     que tiene desenfoque y desplazamiento propios. Dentro del formulario para que siga activa. */
  (btn.closest('dialog') || document.body).appendChild(pop);
  if (pop.showPopover) { pop.popover = 'manual'; try { pop.showPopover(); } catch (_) { /* sin capa superior */ } }
  Object.assign(selUI, { pop, sel, btn, idx: sel.selectedIndex });
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('open');
  placeSelect();
  const cur = pop.querySelector('.sel-opt.on');
  if (cur) pop.scrollTop = cur.offsetTop - (pop.clientHeight - cur.offsetHeight) / 2;
  highlight(selUI.idx);
}
function placeSelect() {
  const { pop, btn } = selUI;
  if (!pop) return;
  const r = btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
  const below = vh - r.bottom - 12, above = r.top - 12;
  const up = below < 220 && above > below;
  const maxH = Math.max(160, Math.min(320, up ? above : below));
  const w = Math.max(r.width, 180);
  pop.style.maxHeight = maxH + 'px';
  pop.style.width = w + 'px';
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  pop.style.bottom = '';
  pop.style.left = left + 'px';
  pop.style.top = '0px';
  const h = pop.offsetHeight;
  const top = up ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
  pop.style.top = top + 'px';
  /* Si algún contenedor desplaza la referencia (navegadores sin popover), se compensa la diferencia.
     Se mide sin la animación de entrada, que mueve la lista unos píxeles. */
  pop.style.animation = 'none';
  const got = pop.getBoundingClientRect();
  pop.style.animation = '';
  if (Math.abs(got.left - left) > 1) pop.style.left = (left + left - got.left) + 'px';
  if (Math.abs(got.top - top) > 1) pop.style.top = (top + top - got.top) + 'px';
}
function highlight(i) {
  const { pop } = selUI;
  if (!pop) return;
  pop.querySelectorAll('.sel-opt.hi').forEach(x => x.classList.remove('hi'));
  const el = pop.querySelector(`.sel-opt[data-i="${i}"]`);
  if (el) {
    el.classList.add('hi');
    /* Desplaza solo la lista: scrollIntoView movería también el formulario y lo cerraría */
    if (el.offsetTop < pop.scrollTop) pop.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > pop.scrollTop + pop.clientHeight) pop.scrollTop = el.offsetTop + el.offsetHeight - pop.clientHeight;
  }
  selUI.idx = i;
}
function chooseSelect(i) {
  const { sel, btn } = selUI;
  if (!sel || !sel.options[i] || sel.options[i].disabled) return;
  const changed = sel.selectedIndex !== i;
  sel.selectedIndex = i;
  closeSelect();
  btn.focus({ preventScroll: true });
  if (changed) {
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function closeSelect() {
  if (!selUI.pop) return;
  if (selUI.pop.hidePopover && selUI.pop.matches(':popover-open')) try { selUI.pop.hidePopover(); } catch (_) { /* ya cerrada */ }
  selUI.pop.remove();
  if (selUI.btn) { selUI.btn.setAttribute('aria-expanded', 'false'); selUI.btn.classList.remove('open'); }
  selUI.pop = null;
}

document.addEventListener('click', e => {
  const opt = e.target.closest('.sel-opt');
  if (opt && selUI.pop && selUI.pop.contains(opt)) { e.preventDefault(); e.stopPropagation(); chooseSelect(Number(opt.dataset.i)); return; }
  const btn = e.target.closest('.sel-btn');
  if (btn) { e.preventDefault(); e.stopPropagation(); if (selUI.pop && selUI.btn === btn) closeSelect(); else openSelect(btn); }
}, true);
document.addEventListener('pointerdown', e => {
  /* Tocar fuera solo cierra la lista: ese toque no pulsa lo que hay debajo (v42) */
  if (selUI.pop && !selUI.pop.contains(e.target) && !e.target.closest('.sel-btn')) { closeSelect(); if (typeof eatNextClick === 'function') eatNextClick(); }
}, true);
document.addEventListener('keydown', e => {
  const btn = e.target.closest && e.target.closest('.sel-btn');
  if (!selUI.pop) {
    if (btn && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openSelect(btn); }
    return;
  }
  const n = selUI.sel.options.length;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = selUI.btn; closeSelect(); b.focus(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(n - 1, selUI.idx + 1)); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, selUI.idx - 1)); return; }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseSelect(selUI.idx); return; }
  if (e.key === 'Tab') { closeSelect(); return; }
  if (e.key.length === 1) {
    /* Escribir una letra salta a la primera opción que empieza por ella */
    const k = norm(e.key), opts = [...selUI.sel.options];
    const start = selUI.idx + 1;
    const order = [...opts.slice(start), ...opts.slice(0, start)];
    const hit = order.find(o => norm(o.textContent).startsWith(k));
    if (hit) highlight(opts.indexOf(hit));
  }
}, true);
window.addEventListener('resize', closeSelect);
document.addEventListener('scroll', e => { if (selUI.pop && !selUI.pop.contains(e.target)) closeSelect(); }, true);
/* Al cerrar un formulario también se cierra la lista */
document.addEventListener('close', closeSelect, true);

/* Cualquier <select> que aparezca (pantallas, formularios, ajustes) se convierte solo */
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhanceSelects(n);
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => enhanceSelects());
enhanceSelects();
