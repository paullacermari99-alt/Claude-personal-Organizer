/* v50: Boldup Pro — SOLO VISTA DE PRUEBA. No hay cobros ni ningún servicio de pago conectado.
   Ajustes → Boldup Pro (prueba) → «Probar modo Pro». Apagado (por defecto) la app queda exactamente igual.
   Encendido: botón PRO arriba, funciones marcadas como Pro y la tienda a pantalla completa
   (la ✕ aparece a los 5 s) al tocar algo Pro o al entrar en unas pocas pantallas.
   «Desbloquear» solo simula la compra en este dispositivo para poder probarlo. */
const PRO_KEY = 'boldup.proPreview', PRO_DEMO_KEY = 'boldup.proDemo';
const PRO_WAIT = 5; /* segundos hasta que se puede cerrar la tienda */
const PRO_PRICE = { month: '3,99 €', year: '29,99 €', yearMonth: '2,50 €', save: '37 %', trial: 7 };
const PRO_FREE_TEMPLATES = 1, PRO_FREE_HABITS = 3;
/* Pantallas que enseñan la tienda al entrar: una vez por pantalla cada vez que abres la app y
   nunca dos seguidas en menos de 3 minutos, para que no moleste */
const PRO_SCREENS = { progreso: 'stats', revision: 'stats', 'ajustes/calendarios': 'calendars' };
const PRO_GAP = 3 * 60 * 1000;

const PRO_FEATURES = [
  ['assistant', '✨', 'Asistente inteligente', 'Planifica tu día por ti, reparte las tareas en tus huecos y divide las grandes en pasos.', 'Próximamente'],
  ['stats', '📊', 'Estadísticas avanzadas', 'Tus meses de un vistazo: horas de enfoque, rachas, ánimo y energía y qué te frena.', ''],
  ['styles', '🎨', 'Estilos de interfaz', 'Sereno, Vivo y Compacto, además de Cristal.', ''],
  ['voice', '🎙️', 'Hablar con la app', 'Crea tareas y pregunta «¿qué tengo hoy?» con la voz.', ''],
  ['calendars', '📅', 'Google Calendar y otros', 'Ve tus citas de otros calendarios junto a tu plan.', ''],
  ['templates', '📋', 'Plantillas propias ilimitadas', `Guarda tus proyectos y semanas para repetirlos (gratis: ${PRO_FREE_TEMPLATES}).`, ''],
  ['habits', '🔥', 'Hábitos ilimitados', `Todos los hábitos que quieras con sus rachas (gratis: ${PRO_FREE_HABITS}).`, ''],
];

const proLS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };
const proPreview = () => proLS(PRO_KEY) === '1';
const proUnlocked = () => proLS(PRO_DEMO_KEY) === '1';
/* ¿Hay que frenar esta función? Solo con la vista de prueba encendida y sin Pro simulado */
const proLocked = () => proPreview() && !proUnlocked();
function proApply() {
  const el = document.documentElement;
  if (!proPreview()) el.removeAttribute('data-pro'); else el.setAttribute('data-pro', proUnlocked() ? 'pro' : 'free');
}
proApply();

const PRO_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/></svg>';
function proPill() { return `<button class="ph-pro" type="button" data-pro-open="pill" aria-label="Boldup Pro">${PRO_STAR}<span>PRO</span></button>`; }

/* ---------- La tienda ---------- */
let proDlg = null, proTimer = 0, proLastAuto = 0, proPlan = 'year';
const proSeen = new Set();
function proEnsureDialog() {
  if (proDlg) return proDlg;
  proDlg = document.createElement('dialog');
  proDlg.id = 'pro-store';
  proDlg.setAttribute('aria-label', 'Boldup Pro');
  document.body.appendChild(proDlg);
  proDlg.addEventListener('cancel', e => { e.preventDefault(); if (proDlg.dataset.ready === '1') proClose(); });
  proDlg.addEventListener('click', e => {
    const b = e.target.closest('[data-pro]');
    if (!b) return;
    const a = b.dataset.pro;
    if (a === 'close') { if (proDlg.dataset.ready === '1') proClose(); }
    else if (a === 'plan') {
      proPlan = b.dataset.v;
      proDlg.querySelectorAll('.pro-plan').forEach(p => { const on = p.dataset.v === proPlan; p.classList.toggle('on', on); p.setAttribute('aria-checked', on); });
      const c = proDlg.querySelector('.pro-cta span'); if (c) c.textContent = proCtaText();
    }
    else if (a === 'buy') {
      proLS(PRO_DEMO_KEY, '1'); proApply(); proClose(true);
      if (typeof toast === 'function') toast('Pro desbloqueado en modo prueba. No se ha cobrado nada.');
      if (typeof rerender === 'function') rerender();
    }
    else if (a === 'free') { proLS(PRO_DEMO_KEY, null); proApply(); proClose(true); if (typeof rerender === 'function') rerender(); }
  });
  return proDlg;
}
const proCtaText = () => `Empezar ${PRO_PRICE.trial} días gratis · luego ${proPlan === 'year' ? PRO_PRICE.year + '/año' : PRO_PRICE.month + '/mes'}`;
function proStoreHTML(focus) {
  const has = proUnlocked();
  const feats = [...PRO_FEATURES].sort((a, b) => (b[0] === focus) - (a[0] === focus));
  return `<div class="pro-wrap">
    <button type="button" class="pro-x ${has ? 'ready' : ''}" data-pro="close" aria-label="${has ? 'Cerrar' : `Podrás cerrar en ${PRO_WAIT} segundos`}" ${has ? '' : 'aria-disabled="true"'}>
      <svg class="pro-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16"/><circle class="pro-ring-v" cx="18" cy="18" r="16" pathLength="100"/></svg>
      <span class="pro-n" aria-hidden="true">${PRO_WAIT}</span>
      <svg class="pro-xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
    </button>
    <div class="pro-scroll" tabindex="-1" autofocus>
      <div class="pro-hero">
        <span class="pro-badge">${PRO_STAR}</span>
        <h2>Boldup <b>Pro</b></h2>
        <p>${has ? 'Tienes Pro activado (simulado, sin cobros).' : 'Todo lo que necesitas para dejar de procrastinar y ser tu mejor versión.'}</p>
      </div>
      <ul class="pro-feats">${feats.map(([id, ic, t, d, soon]) => `<li class="${id === focus ? 'hit' : ''}"><span class="pf-ic">${ic}</span><span class="grow"><b>${t}${soon ? ` <em>${soon}</em>` : ''}</b><span>${d}</span></span>${has ? '<span class="pf-ok">✓</span>' : ''}</li>`).join('')}</ul>
      ${has ? `<button type="button" class="btn wide pro-free" data-pro="free">Volver a la versión gratis</button>` : `
      <div class="pro-plans" role="radiogroup" aria-label="Plan">
        <button type="button" role="radio" class="pro-plan ${proPlan === 'year' ? 'on' : ''}" aria-checked="${proPlan === 'year'}" data-pro="plan" data-v="year"><span class="pp-tag">Ahorras ${PRO_PRICE.save}</span><b>Anual</b><span class="pp-price">${PRO_PRICE.year}<small>/año</small></span><span class="pp-sub">${PRO_PRICE.yearMonth} al mes</span></button>
        <button type="button" role="radio" class="pro-plan ${proPlan === 'month' ? 'on' : ''}" aria-checked="${proPlan === 'month'}" data-pro="plan" data-v="month"><b>Mensual</b><span class="pp-price">${PRO_PRICE.month}<small>/mes</small></span><span class="pp-sub">Cancela cuando quieras</span></button>
      </div>
      <button type="button" class="btn primary wide pro-cta" data-pro="buy"><span>${proCtaText()}</span></button>
      <p class="pro-note">Vista de prueba: no se cobra nada. Este botón solo desbloquea Pro en este dispositivo para que veas cómo queda.</p>`}
    </div>
  </div>`;
}
function proOpen(focus, auto) {
  const d = proEnsureDialog();
  if (d.open) return;
  clearInterval(proTimer);
  d.innerHTML = proStoreHTML(focus);
  d.dataset.ready = proUnlocked() ? '1' : '0';
  d.classList.remove('closing');
  if (auto) proLastAuto = Date.now();
  d.showModal();
  if (typeof markOpened === 'function') markOpened(d);
  const sc = d.querySelector('.pro-scroll'); if (sc) sc.scrollTop = 0;
  if (proUnlocked()) return;
  /* Cuenta atrás: el aro se vacía en 5 s y el número baja; luego aparece la ✕ */
  const x = d.querySelector('.pro-x'), n = d.querySelector('.pro-n');
  const end = Date.now() + PRO_WAIT * 1000;
  x.style.setProperty('--wait', PRO_WAIT + 's');
  requestAnimationFrame(() => x.classList.add('counting'));
  proTimer = setInterval(() => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left > 0) { n.textContent = left; x.setAttribute('aria-label', `Podrás cerrar en ${left} segundo${left === 1 ? '' : 's'}`); return; }
    clearInterval(proTimer);
    d.dataset.ready = '1';
    x.classList.add('ready'); x.removeAttribute('aria-disabled'); x.setAttribute('aria-label', 'Cerrar');
  }, 200);
}
function proClose(now) {
  const d = proDlg;
  if (!d || !d.open) return;
  clearInterval(proTimer);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (now || reduce) { d.close(); return; }
  d.classList.add('closing');
  setTimeout(() => { d.classList.remove('closing'); d.close(); }, 220);
}
const proStoreOpen = () => !!(proDlg && proDlg.open);

/* ---------- Qué es Pro: al tocarlo con Pro bloqueado sale la tienda en vez de la función ---------- */
function proGateOf(el) {
  const o = el.closest('[data-pro-open]');
  if (o) return { open: o.dataset.proOpen === 'pill' ? '' : o.dataset.proOpen };
  if (!proLocked()) return '';
  const sk = el.closest('[data-act="skin"]');
  if (sk && sk.dataset.v) return 'styles';
  if (el.closest('[data-voice="open"]')) return 'voice';
  if (el.closest('[data-act="cal-add"]')) return 'calendars';
  if (el.closest('[data-act="habit-new"], [data-act="habit-idea"]') && (state.habits || []).length >= PRO_FREE_HABITS) return 'habits';
  if (el.closest('[data-modal="own"], [data-modal="new"], [data-modal="save"]') && (state.templates || []).length >= PRO_FREE_TEMPLATES) return 'templates';
  return '';
}
document.addEventListener('click', e => {
  if (!(e.target instanceof Element) || e.target.closest('#pro-store')) return;
  const g = proGateOf(e.target);
  if (!g) return;
  e.preventDefault(); e.stopImmediatePropagation();
  proOpen(typeof g === 'object' ? g.open : g);
}, true);

/* ---------- Unas pocas pantallas enseñan la tienda al entrar ---------- */
function proCheckScreen() {
  if (!proLocked() || proStoreOpen()) return;
  const h = location.hash.replace(/^#/, ''), key = Object.keys(PRO_SCREENS).find(k => h === k);
  if (!key || proSeen.has(key) || Date.now() - proLastAuto < PRO_GAP) return;
  setTimeout(() => {
    if (location.hash.replace(/^#/, '') !== key || proStoreOpen() || !proLocked()) return;
    const busy = (typeof overlayOpen === 'function' && overlayOpen()) || document.querySelector('.tour-tip, .onb, #onboarding');
    if (busy) return;
    proSeen.add(key);
    proOpen(PRO_SCREENS[key], true);
  }, 650);
}
window.addEventListener('hashchange', proCheckScreen);
window.addEventListener('load', () => setTimeout(proCheckScreen, 900));

/* ---------- Ajustes → Boldup Pro (prueba) ---------- */
function proSettingsSummary() { return !proPreview() ? 'Vista de suscripción apagada' : proUnlocked() ? 'Encendida · Pro simulado' : 'Encendida · versión gratis'; }
function proSettingsSection() {
  const on = proPreview(), has = proUnlocked();
  return `<div class="section">
    <div class="section-head"><h2>Vista de suscripción</h2></div>
    <div class="settings-group glass">
      <label class="item"><span>Probar modo Pro<span class="muted small item-sub">Enseña el botón PRO, las funciones Pro y la tienda</span></span><input type="checkbox" class="switch" data-pro-toggle ${on ? 'checked' : ''}></label>
      ${on ? `<div class="item"><span>Estado<span class="muted small item-sub">${has ? 'Pro desbloqueado (simulado)' : 'Versión gratis'}</span></span><button class="btn small" data-pro-open="">Ver la tienda</button></div>
      <div class="item"><span>${has ? 'Volver a la versión gratis' : 'Desbloquear Pro sin la tienda'}</span><button class="btn small" data-pro-demo="${has ? '0' : '1'}">${has ? 'Volver' : 'Desbloquear'}</button></div>` : ''}
    </div>
    <p class="hint">Es solo para ver cómo quedaría la suscripción: no se cobra nada ni hay ningún pago conectado. Se guarda en este dispositivo. Apagado, la app queda como siempre y todo es gratis.</p>
  </div>`;
}
document.addEventListener('change', e => {
  if (!e.target.matches || !e.target.matches('[data-pro-toggle]')) return;
  proLS(PRO_KEY, e.target.checked ? '1' : null);
  if (!e.target.checked) proLS(PRO_DEMO_KEY, null);
  proApply();
  if (typeof rerender === 'function') rerender();
});
document.addEventListener('click', e => {
  const b = e.target instanceof Element && e.target.closest('[data-pro-demo]');
  if (!b) return;
  proLS(PRO_DEMO_KEY, b.dataset.proDemo === '1' ? '1' : null);
  proApply();
  if (typeof rerender === 'function') rerender();
});
