/* Boldup — bienvenida para quien abre la app por primera vez:
   8 pantallas con demostraciones animadas de la app y, al final, entrar o crear cuenta. */
'use strict';

const OB_KEY = 'organizador.onboarded';
const ob = { el: null, i: 0, timers: [], x0: null, dx: 0 };

function onboardingSeen() { let l = true; try { l = localStorage.getItem(OB_KEY) === '1'; } catch { /* sin almacenamiento */ } return l || (typeof seenInAccount === 'function' && seenInAccount(OB_KEY)); }
function markOnboarded() { if (typeof setFlag === 'function') setFlag(OB_KEY); else try { localStorage.setItem(OB_KEY, '1'); } catch { /* sin almacenamiento */ } }

const OB_CHECK = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.4l2.6 2.6L11 4.4"/></svg>';
const obTask = (title, meta, cls = '') => `<div class="ob-task ${cls}"><span class="ob-check">${OB_CHECK}</span><div><div class="ob-t">${title}</div>${meta ? `<div class="ob-m">${meta}</div>` : ''}</div></div>`;

const OB_SLIDES = [
  {
    title: 'Planifica tu día y deja de procrastinar',
    text: 'Boldup junta tus tareas, tu calendario y tus objetivos en un solo sitio. Te enseño lo principal en un minuto.',
    demo: `<div class="demo-welcome">
      <img class="dw-icon" src="icons/icon.svg" alt="">
      <div class="dw-card dw-1">☀️ Elige lo importante</div>
      <div class="dw-card dw-2">🗓️ Dale una hora</div>
      <div class="dw-card dw-3">🎯 Avanza hacia tus metas</div>
    </div>`,
  },
  {
    title: 'Hoy: tres prioridades',
    text: 'Cada mañana eliges las 3 cosas que de verdad importan. Al marcarlas, la barra avanza y nada salta de sitio.',
    demo: `<div class="demo-today ob-card">
      <div class="ob-head"><span>Prioridades</span><span class="dt-count"><span class="dt-num"><b class="n0">0</b><b class="n1">1</b><b class="n2">2</b><b class="n3">3</b></span> de 3</span></div>
      <div class="ob-bar"><span></span></div>
      ${obTask('Terminar el informe', '⭐ Trabajo · 1 h', 'dt-1')}
      ${obTask('Llamar al dentista', '⭐ Personal · 5 min', 'dt-2')}
      ${obTask('Ir al gimnasio', '⭐ Salud · 19:00', 'dt-3')}
    </div>`,
  },
  {
    title: 'Apunta como hablas',
    text: 'Escribe la tarea tal cual y la app entiende el día, la hora, la etiqueta, la duración y si se repite.',
    demo: `<div class="demo-quick ob-card">
      <div class="dq-input"><span class="dq-text"></span><span class="dq-caret"></span><span class="dq-plus">+</span></div>
      <div class="dq-chips"><span class="ob-chip c1">📅 Mañana</span><span class="ob-chip c2">🕔 17:00</span><span class="ob-chip c3">#Salud</span></div>
      ${obTask('Dentista', 'Mañana · 17:00 · Salud', 'dq-task')}
    </div>`,
    typing: 'dentista mañana 17h #salud',
  },
  {
    title: 'Dale una hora en tu semana',
    text: 'Arrastra una tarea al calendario para reservarle tiempo. Mueve o estira los bloques cuando cambien tus planes.',
    demo: `<div class="demo-week ob-card">
      <div class="dw-days"><span>L</span><span class="on">M</span><span>X</span><span>J</span><span>V</span></div>
      <div class="dw-grid">${Array.from({ length: 20 }, () => '<i></i>').join('')}
        <div class="dw-block b1">Gimnasio</div>
        <div class="dw-block b2">Clase</div>
        <div class="dw-drag">Informe<span class="dw-hand"></span></div>
      </div>
    </div>`,
  },
  {
    title: '¿Me cabe hoy?',
    text: 'La app suma lo que tienes y te dice si te da tiempo. Si no, te propone qué mover a otro día.',
    demo: `<div class="demo-fit ob-card">
      <div class="df-row"><span class="df-ic">⏱</span><div class="grow"><div class="df-title"><span class="ok">Te cabe. Te sobran 2 h 30</span><span class="ko">No te cabe: faltan 45 min</span></div><div class="ob-m">De 9:00 a 21:00</div></div></div>
      <div class="df-bar"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span></div>
      <div class="df-btn">Ajustar mi día</div>
    </div>`,
  },
  {
    title: 'Modo enfoque',
    text: 'Pulsa ▶ en una tarea y empieza un temporizador sin distracciones. Lo que trabajas cuenta en tu progreso.',
    demo: `<div class="demo-focus">
      <svg viewBox="0 0 120 120" class="df-ring"><circle cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="52" class="arc"/></svg>
      <div class="df-time">25:00</div>
      <div class="df-label">Terminar el informe</div>
    </div>`,
  },
  {
    title: 'Objetivos y proyectos',
    text: 'Pon a cada objetivo su «para qué». Las tareas que completas hacen avanzar su progreso solas.',
    demo: `<div class="demo-goals">
      <div class="ob-card dg-card"><div class="dg-h"><span class="dg-ic" style="--c:#34c759">◎</span><b>Ponerme en forma</b></div><div class="ob-m">Para qué: tener más energía cada día</div><div class="ob-bar"><span class="g1"></span></div></div>
      <div class="ob-card dg-card"><div class="dg-h"><span class="dg-ic" style="--c:#0a84ff">💻</span><b>Lanzar mi web</b></div><div class="ob-m">3 de 5 tareas</div><div class="ob-bar"><span class="g2"></span></div></div>
    </div>`,
  },
  {
    title: 'Hábitos, progreso y todos tus dispositivos',
    text: 'Crea tareas diarias, mira tu racha y tu semana, y lleva tus datos del móvil al ordenador con tu cuenta.',
    demo: `<div class="demo-progress ob-card">
      <div class="dp-top"><span class="dp-fire">🔥</span><b class="dp-n">5</b><span class="ob-m">días seguidos</span></div>
      <div class="dp-bars">${[40, 65, 30, 80, 55, 90, 70].map((h, i) => `<span style="--h:${h}%;--d:${i * 70}ms"></span>`).join('')}</div>
      <div class="dp-sync"><span>📱</span><span class="dp-dots"><i></i><i></i><i></i></span><span>💻</span></div>
    </div>`,
  },
];

function obLoginSlide() {
  const ready = typeof cloudReady === 'function' && cloudReady();
  return `<section class="ob-slide ob-login" aria-label="Entrar">
    <div class="ob-login-box">
      <img class="ob-logo" src="icons/icon.svg" alt="">
      <h2>${ready ? 'Crea tu cuenta o entra' : '¡Listo para empezar!'}</h2>
      <p>${ready ? 'Con tu cuenta tendrás los mismos datos en el móvil y en el ordenador, y avisos aunque la app esté cerrada.' : 'Tus datos se guardan en este dispositivo.'}</p>
      ${ready ? `<form class="ob-form" data-act="ob-login" novalidate>
        <input type="email" name="email" placeholder="Email" autocomplete="email" aria-label="Email" required>
        <input type="password" name="password" placeholder="Contraseña (mínimo 6)" autocomplete="current-password" aria-label="Contraseña" minlength="6">
        <div class="ob-msg" role="status" aria-live="polite"></div>
        <button class="btn primary wide" type="submit" value="up">Crear cuenta</button>
        <button class="btn wide" type="submit" value="in">Ya tengo cuenta: entrar</button>
        <button class="btn ghost small" type="submit" value="reset">¿Olvidaste la contraseña?</button>
      </form>
      <button class="ob-later" data-ob="finish">Usar sin cuenta por ahora</button>`
      : `<button class="btn primary wide" data-ob="finish">Empezar</button>`}
    </div>
  </section>`;
}

function startOnboarding() {
  if (ob.el) return;
  /* Si el tutorial estaba en marcha, se aparta y vuelve al terminar la bienvenida */
  if (typeof tour !== 'undefined' && tour.on) endTour(false, true);
  const n = OB_SLIDES.length;
  const el = document.createElement('div');
  el.id = 'onboarding';
  el.className = 'ob';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Bienvenida a Boldup');
  el.innerHTML = `
    <button class="ob-skip" data-ob="skip">Saltar</button>
    <div class="ob-track">
      ${OB_SLIDES.map((s, i) => `<section class="ob-slide" aria-label="${i + 1} de ${n}">
        <div class="ob-stage">${s.demo}</div>
        <div class="ob-copy"><div class="ob-step">${i + 1} de ${n}</div><h2>${s.title}</h2><p>${s.text}</p></div>
      </section>`).join('')}
      ${obLoginSlide()}
    </div>
    <div class="ob-foot">
      <button class="ob-back" data-ob="back" aria-label="Anterior">${typeof I !== 'undefined' ? I.left : '‹'}</button>
      <div class="ob-dots">${Array.from({ length: n + 1 }, (_, i) => `<button data-ob="go" data-i="${i}" aria-label="Pantalla ${i + 1}"></button>`).join('')}</div>
      <button class="btn primary ob-next" data-ob="next">Siguiente</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('ob-open');
  ob.el = el;
  el.addEventListener('click', obClick);
  el.addEventListener('submit', obSubmit);
  el.addEventListener('pointerdown', obDown);
  el.addEventListener('keydown', obKey);
  obGo(0, true);
  requestAnimationFrame(() => el.classList.add('in'));
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

function obGo(i, instant) {
  const n = OB_SLIDES.length;
  i = Math.max(0, Math.min(n, i));
  ob.i = i;
  const el = ob.el, track = el.querySelector('.ob-track');
  track.style.transition = instant ? 'none' : '';
  track.style.transform = `translateX(${-i * 100}%)`;
  el.querySelectorAll('.ob-slide').forEach((s, k) => {
    s.classList.toggle('on', false);
    s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    s.inert = k !== i;
  });
  /* Reinicia las animaciones de la pantalla que entra */
  const cur = el.querySelectorAll('.ob-slide')[i];
  void cur.offsetWidth;
  cur.classList.add('on');
  el.querySelectorAll('.ob-dots button').forEach((d, k) => d.classList.toggle('on', k === i));
  el.classList.toggle('last', i === n);
  el.classList.toggle('first', i === 0);
  const next = el.querySelector('.ob-next');
  next.textContent = i === n - 1 ? 'Empezar' : 'Siguiente';
  obRunScripts(i);
  if (i === n) setTimeout(() => { const f = el.querySelector('.ob-form input'); if (f && matchMedia('(pointer: fine)').matches) f.focus(); }, 450);
}

/* Partes animadas con JS: escribir texto y la cuenta atrás del enfoque */
function obRunScripts(i) {
  ob.timers.forEach(t => clearInterval(t) || clearTimeout(t));
  ob.timers = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const s = OB_SLIDES[i];
  const slide = ob.el.querySelectorAll('.ob-slide')[i];
  if (s && s.typing) {
    const out = slide.querySelector('.dq-text');
    if (reduced) { out.textContent = s.typing; return; }
    out.textContent = '';
    let k = 0;
    ob.timers.push(setTimeout(() => {
      ob.timers.push(setInterval(() => {
        out.textContent = s.typing.slice(0, ++k);
        if (k >= s.typing.length) { clearInterval(ob.timers[ob.timers.length - 1]); slide.classList.add('typed'); }
      }, 75));
    }, 500));
    slide.classList.remove('typed');
  }
  if (slide && slide.querySelector('.df-time')) {
    const t = slide.querySelector('.df-time');
    let sec = 25 * 60;
    t.textContent = '25:00';
    if (reduced) return;
    ob.timers.push(setTimeout(() => {
      ob.timers.push(setInterval(() => {
        sec -= 7;
        if (sec < 24 * 60) sec = 25 * 60;
        t.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      }, 120));
    }, 400));
  }
}

function obClick(e) {
  const b = e.target.closest('[data-ob]');
  if (!b) return;
  const k = b.dataset.ob;
  if (k === 'next') obGo(ob.i + 1);
  else if (k === 'back') obGo(ob.i - 1);
  else if (k === 'go') obGo(Number(b.dataset.i));
  else if (k === 'skip') obGo(OB_SLIDES.length);
  else if (k === 'finish') finishOnboarding();
}
function obKey(e) {
  if (e.target.matches('input')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); obGo(ob.i + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); obGo(ob.i - 1); }
}

/* Deslizar con el dedo: la pantalla sigue al dedo y se queda en la más cercana */
function obDown(e) {
  if (e.target.closest('input, button, a, form') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  ob.x0 = e.clientX; ob.y0 = e.clientY; ob.dx = 0; ob.drag = false;
  const track = ob.el.querySelector('.ob-track'), w = ob.el.clientWidth;
  const move = ev => {
    const dx = ev.clientX - ob.x0, dy = ev.clientY - ob.y0;
    if (!ob.drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { ob.drag = true; track.style.transition = 'none'; }
    if (!ob.drag) return;
    const edge = (ob.i === 0 && dx > 0) || (ob.i === OB_SLIDES.length && dx < 0);
    ob.dx = edge ? dx / 3 : dx;
    track.style.transform = `translateX(calc(${-ob.i * 100}% + ${ob.dx}px))`;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!ob.drag) return;
    track.style.transition = '';
    if (Math.abs(ob.dx) > w * 0.18) obGo(ob.i + (ob.dx < 0 ? 1 : -1)); else obGo(ob.i);
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function obSubmit(e) {
  const f = e.target;
  if (f.dataset.act !== 'ob-login') return;
  e.preventDefault();
  e.stopPropagation();
  const how = (e.submitter && e.submitter.value) || 'up';
  const email = f.elements.email.value.trim(), pass = f.elements.password.value;
  const msg = f.querySelector('.ob-msg');
  const say = (t, bad) => { msg.innerHTML = t; msg.classList.toggle('bad', !!bad); };
  if (!/^\S+@\S+\.\S+$/.test(email)) { say('Escribe tu email', true); f.elements.email.focus(); return; }
  if (how !== 'reset' && pass.length < 6) { say('La contraseña debe tener al menos 6 caracteres', true); f.elements.password.focus(); return; }
  const btns = [...f.querySelectorAll('button')];
  btns.forEach(x => { x.disabled = true; });
  say('Un momento…');
  const job = how === 'reset' ? sendPasswordReset(email).then(() => 'reset')
    : how === 'in' ? signIn(email, pass).then(() => 'in')
    : signUp(email, pass).then(ok => ok ? 'in' : 'mail');
  job.then(r => {
    if (r === 'in') { finishOnboarding(); toast('¡Dentro! Tus datos ya se sincronizan.'); rerender(); return; }
    say(syncInfo.notice || 'Revisa tu email');
    btns.forEach(x => { x.disabled = false; });
    if (r === 'mail') f.classList.add('sent');
  }, err => { say(esc(err.message), true); btns.forEach(x => { x.disabled = false; }); });
}

function finishOnboarding() {
  markOnboarded();
  const el = ob.el;
  if (!el) return;
  ob.timers.forEach(t => clearInterval(t) || clearTimeout(t));
  ob.el = null;
  el.classList.add('out');
  document.body.classList.remove('ob-open');
  const done = () => el.remove();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 400);
  /* Si has entrado con tu cuenta, primero se mira si ya viste el tutorial en otro dispositivo */
  if (typeof startTourIfNew === 'function') startTourIfNew(500);
  else if (typeof startTour === 'function' && !tourSeen()) setTimeout(() => startTour(), 500);
}
