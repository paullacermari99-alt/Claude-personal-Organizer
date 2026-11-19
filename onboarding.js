/* Boldup — bienvenida para quien abre la app por primera vez:
   7 pantallas cortas con demostraciones animadas de la app y, al final, entrar o crear cuenta. */
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
    text: 'Tus tareas, tu calendario, tus proyectos y tus metas en un solo sitio. Te enseño lo principal en un minuto.',
    demo: `<div class="demo-welcome">
      <img class="dw-icon" src="icons/icon.svg" alt="">
      <div class="dw-card dw-1">☀️ Elige lo importante</div>
      <div class="dw-card dw-2">🔔 Te aviso a tiempo</div>
      <div class="dw-card dw-3">👥 Avanza con amigos</div>
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
    text: 'Escribe la tarea tal cual y la app entiende el día, la hora y la etiqueta. En Tareas, «Filtros» te enseña solo lo que buscas.',
    demo: `<div class="demo-quick ob-card">
      <div class="dq-input"><span class="dq-text"></span><span class="dq-caret"></span><span class="dq-plus">+</span></div>
      <div class="dq-chips"><span class="ob-chip c1">📅 Mañana</span><span class="ob-chip c2">🕔 17:00</span><span class="ob-chip c3">#Salud</span></div>
      ${obTask('Dentista', 'Mañana · 17:00 · Salud', 'dq-task')}
    </div>`,
    typing: 'dentista mañana 17h #salud',
  },
  {
    title: 'Dale una hora en tu semana',
    text: 'Arrastra una tarea al calendario para reservarle tiempo. Si un día no te cabe todo, la app te lo dice.',
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
    title: 'Te avisa antes de empezar',
    text: 'Ponle hora a una tarea y elige en «Avisarme» cuándo: a la hora, unos minutos antes o el día anterior.',
    demo: `<div class="demo-remind">
      <div class="dr-note"><img src="icons/icon.svg" alt=""><div class="grow"><div class="dr-app"><b>Boldup</b><span>ahora</span></div><div class="dr-t">Dentista en 15 min</div><div class="ob-m">Hoy a las 17:00</div></div></div>
      <div class="ob-card dr-card">
        ${obTask('Dentista', 'Hoy · 17:00 · Salud')}
        <div class="dr-row"><span>Avisarme</span><span class="dr-opts"><span class="ob-chip o1">A la hora</span><span class="ob-chip o2">🔔 15 min antes</span></span></div>
      </div>
    </div>`,
  },
  {
    title: 'Proyectos, solo o con amigos',
    text: 'Agrupa las tareas y los objetivos de algo grande. Pulsa «Añadir amigos» en cualquier proyecto y lo lleváis juntos.',
    demo: `<div class="demo-goals demo-team">
      <div class="ob-card dg-card"><div class="dg-h"><span class="dg-ic" style="--c:#ff9f0a">✈️</span><b class="grow">Viaje a Lisboa</b><span class="dt-avs"><span class="dt-av a1" style="--c:#5e5ce6">L</span><span class="dt-av a2" style="--c:#34c759">M</span><span class="dt-av a3" style="--c:#ff375f">🐼</span></span></div><div class="ob-m">Ahora toca: reservar el hotel</div><div class="ob-bar"><span class="g1"></span></div><span class="dt-add">👥 Añadir amigos</span></div>
      <div class="ob-card dg-card"><div class="dg-h"><span class="dg-ic" style="--c:#0a84ff">💻</span><b>Lanzar mi web</b></div><div class="ob-m">3 de 5 tareas</div><div class="ob-bar"><span class="g2"></span></div></div>
    </div>`,
  },
  {
    title: 'Concéntrate y mira cómo avanzas',
    text: 'Pulsa ▶ en una tarea para empezar un temporizador sin distracciones. En Progreso ves tu racha y todo lo que llevas.',
    demo: `<div class="demo-focus">
      <svg viewBox="0 0 120 120" class="df-ring"><circle cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="52" class="arc"/></svg>
      <div class="df-time">25:00</div>
      <div class="df-label">Terminar el informe</div>
      <div class="df-streak">🔥 5 días seguidos</div>
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
      ${ready ? `<form class="ob-form" data-act="ob-login" data-mode="up" novalidate>
        <label class="ob-nick only-up"><span>@</span><input name="nick" placeholder="Tu nick (para tus amigos)" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" aria-label="Nick"></label>
        <div class="ob-nick-msg only-up" aria-live="polite"></div>
        <input type="text" inputmode="email" name="email" placeholder="Email" autocomplete="email" autocapitalize="none" spellcheck="false" aria-label="Email" required>
        <input type="password" name="password" placeholder="Contraseña (mínimo 6)" autocomplete="new-password" aria-label="Contraseña" minlength="6">
        <div class="ob-msg" role="status" aria-live="polite"></div>
        <button class="btn primary wide only-up" type="submit" value="up">Crear cuenta</button>
        <button class="btn primary wide only-in" type="submit" value="in">Entrar</button>
        <button class="btn ghost small only-in" type="submit" value="reset">¿Olvidaste la contraseña?</button>
        <button class="ob-switch" type="button" data-ob-mode>${'<span class="only-up">¿Ya tienes cuenta? <b>Entra</b></span><span class="only-in">¿Eres nuevo? <b>Crea tu cuenta</b></span>'}</button>
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
  const how = (e.submitter && e.submitter.value) || (f.dataset.mode === 'in' ? 'in' : 'up');
  const email = f.elements.email.value.trim(), pass = f.elements.password.value;
  const nick = f.elements.nick ? f.elements.nick.value.trim().toLowerCase().replace(/^@/, '') : '';
  const msg = f.querySelector('.ob-msg');
  const say = (t, bad) => { msg.innerHTML = t; msg.classList.toggle('bad', !!bad); };
  /* v69: para entrar vale el email o el nick; para crear la cuenta, email + nick */
  const isNick = how === 'in' && !email.includes('@') && /^@?[a-z0-9][a-z0-9_.]{2,19}$/i.test(email);
  if (!isNick && !/^\S+@\S+\.\S+$/.test(email)) { say(how === 'in' ? 'Escribe tu email o tu nick' : 'Escribe tu email', true); f.elements.email.focus(); return; }
  if (how === 'reset' && !email.includes('@')) { say('Para recuperar la contraseña escribe tu email', true); f.elements.email.focus(); return; }
  if (how === 'up' && nick && f.dataset.nickOk !== nick) { say('Comprobando tu nick…'); obNickCheck(f, true); return; }
  if (how !== 'reset' && pass.length < 6) { say('La contraseña debe tener al menos 6 caracteres', true); f.elements.password.focus(); return; }
  const btns = [...f.querySelectorAll('button')];
  btns.forEach(x => { x.disabled = true; });
  say('Un momento…');
  const job = how === 'reset' ? sendPasswordReset(email).then(() => 'reset')
    : how === 'in' ? signIn(email, pass).then(() => 'in')
    : signUp(email, pass, nick || null).then(ok => ok ? 'in' : 'mail');
  job.then(r => {
    if (r === 'in') { finishOnboarding(); toast('¡Dentro! Tus datos ya se sincronizan.'); rerender(); return; }
    say(syncInfo.notice || 'Revisa tu email');
    btns.forEach(x => { x.disabled = false; });
    if (r === 'mail') f.classList.add('sent');
  }, err => { say(esc(err.message), true); btns.forEach(x => { x.disabled = false; }); });
}

/* Nick al crear la cuenta: se comprueba en la base de datos mientras escribes */
let obNickT = 0, obNickSeq = 0;
function obNickCheck(f, now) {
  const inp = f.elements.nick, out = f.querySelector('.ob-nick-msg');
  const v = inp.value.trim().toLowerCase().replace(/^@/, '');
  if (inp.value !== v) inp.value = v;
  f.dataset.nickOk = '';
  const say = (t, k) => { out.textContent = t; out.className = 'ob-nick-msg only-up ' + (k || ''); };
  clearTimeout(obNickT);
  if (!v) { say(''); f.dataset.nickOk = ''; return; }
  if (!/^[a-z0-9][a-z0-9_.]{2,19}$/.test(v)) { say(v.length < 3 ? 'Mínimo 3 caracteres' : 'Solo minúsculas, números, punto y guion bajo', 'bad'); return; }
  say('Comprobando…');
  const my = ++obNickSeq;
  obNickT = setTimeout(async () => {
    try {
      const st = await sb('/rest/v1/rpc/username_status', { method: 'POST', auth: false, body: { name: v } });
      if (my !== obNickSeq) return;
      if (st === 'ok') { f.dataset.nickOk = v; say('✓ @' + v + ' está libre', 'ok'); if (now) f.requestSubmit(f.querySelector('button[value=up]')); }
      else say(st === 'taken' ? '@' + v + ' ya está cogido' : st === 'reserved' ? 'Ese nick está reservado' : 'Nick no válido', 'bad');
    } catch (e) {
      if (my !== obNickSeq) return;
      /* Sin esa parte en el servidor todavía: se guarda y se reserva más tarde */
      f.dataset.nickOk = v; say(''); if (now) f.requestSubmit(f.querySelector('button[value=up]'));
    }
  }, now ? 0 : 350);
}
document.addEventListener('input', e => { const f = e.target.form; if (f && f.dataset.act === 'ob-login' && e.target.name === 'nick') obNickCheck(f); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ob-mode]'); if (!b) return;
  const f = b.form, inMode = f.dataset.mode !== 'in';
  f.dataset.mode = inMode ? 'in' : 'up';
  f.elements.email.placeholder = inMode ? 'Email o nick' : 'Email';
  f.elements.email.setAttribute('autocomplete', inMode ? 'username' : 'email');
  f.elements.password.setAttribute('autocomplete', inMode ? 'current-password' : 'new-password');
  f.querySelector('.ob-msg').textContent = '';
});

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
