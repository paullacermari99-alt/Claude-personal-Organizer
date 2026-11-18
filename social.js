/* Boldup — amigos y proyectos compartidos (v69).
   - Nick único (se comprueba en la base de datos) + ID de amigo público (BU-XXXXXX) para buscarte.
   - Amigos: buscar por nick o ID, solicitudes, aceptar y rechazar.
   - Proyectos con amigos (dentro de Proyectos → «Con amigos»): tablero de columnas tipo Trello,
     objetivos, quién hace qué, calendario y cronología, y actividad del equipo.
   Todo vive en Supabase (supabase/social.sql) con reglas RLS: cada uno solo ve lo suyo y lo de sus
   proyectos compartidos. Si esa parte aún no está instalada en el servidor, la app sigue igual y solo
   muestra un aviso en «Con amigos». Nada de esto toca los datos personales ni su sincronización. */
'use strict';

const SOC = {
  backend: null,        /* null = sin comprobar · true = instalado · false = falta social.sql */
  profile: null,        /* mi perfil (nick, ID…) */
  profileLoaded: false,
  friends: null,        /* { list, incoming, outgoing } */
  teams: null,          /* mis proyectos compartidos (lista) */
  snaps: {},            /* proyecto → foto completa (tablero, objetivos, miembros, actividad) */
  myTasks: null,        /* tarjetas que me tocan (para Hoy) */
  found: null,          /* resultado de la búsqueda de amigos */
  filter: {},           /* proyecto → filtro del tablero */
  calMonth: {},         /* proyecto → 'AAAA-MM' del calendario */
  loading: new Set(),
  errors: {},
};
const SOC_CACHE = 'boldup.social';
const NICK_LATER = 'boldup.nickLater';
const PENDING_NICK = 'boldup.pendingNick';
const NICK_RE = /^[a-z0-9][a-z0-9_.]{2,19}$/;

/* ---------- Conexión ---------- */
const socUid = () => { const s = typeof getSession === 'function' && getSession(); return (s && s.user && s.user.id) || null; };
const socOn = () => typeof cloudReady === 'function' && cloudReady() && !!getSession();
const rpc = (fn, body = {}) => sb('/rest/v1/rpc/' + fn, { method: 'POST', body });
const rest = (path, opts) => sb('/rest/v1/' + path, opts);
const isMissing = e => /could not find the (function|table)|schema cache|PGRST20[0-9]|relation .* does not exist/i.test(String(e && e.message));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const NICK_ERRORS = { NICK_TAKEN: 'Ese nick ya lo tiene otra persona', NICK_INVALID: 'De 3 a 20 letras minúsculas, números, punto o guion bajo (empieza por letra o número)', NICK_RESERVED: 'Ese nick está reservado' };
function niceErr(e) {
  const m = String((e && e.message) || e || '');
  for (const k of Object.keys(NICK_ERRORS)) if (m.includes(k)) return NICK_ERRORS[k];
  if (typeof isNetErr === 'function' && isNetErr(e)) return 'Sin conexión: inténtalo cuando vuelva internet';
  if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para hacer eso en este proyecto';
  return m || 'Algo ha fallado';
}

function socSaveCache() {
  try {
    const snaps = Object.fromEntries(Object.entries(SOC.snaps).filter(([, v]) => v).slice(-8));
    localStorage.setItem(SOC_CACHE, JSON.stringify({ uid: socUid(), profile: SOC.profile, teams: SOC.teams, friends: SOC.friends, snaps, myTasks: SOC.myTasks, backend: SOC.backend }));
  } catch { /* sin espacio: no pasa nada */ }
}
function socLoadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(SOC_CACHE));
    if (!c || !c.uid || c.uid !== socUid()) return;
    Object.assign(SOC, { profile: c.profile || null, teams: c.teams || null, friends: c.friends || null, snaps: c.snaps || {}, myTasks: c.myTasks || null, backend: c.backend === false ? null : c.backend });
    SOC.profileLoaded = !!c.profile;
  } catch { /* nada guardado */ }
}
function socReset() {
  Object.assign(SOC, { backend: null, profile: null, profileLoaded: false, friends: null, teams: null, snaps: {}, myTasks: null, found: null });
  try { localStorage.removeItem(SOC_CACHE); } catch {}
}

/* Una carga a la vez por clave; marca el servidor como «sin instalar» si faltan las tablas */
async function socLoad(key, fn) {
  if (SOC.loading.has(key)) return;
  SOC.loading.add(key);
  try { const r = await fn(); SOC.backend = true; delete SOC.errors[key]; return r; }
  catch (e) {
    if (isMissing(e)) SOC.backend = false;
    else SOC.errors[key] = niceErr(e);
    throw e;
  } finally { SOC.loading.delete(key); }
}

async function loadProfile() {
  if (!socOn()) return null;
  const me = socUid() || (await fetchUser(), socUid());
  return socLoad('profile', async () => {
    const rows = await rest(`profiles?select=*&id=eq.${me}`);
    SOC.profile = rows[0] || null; SOC.profileLoaded = true; socSaveCache();
    return SOC.profile;
  });
}
async function loadFriends() {
  if (!socOn() || !SOC.profile) return;
  return socLoad('friends', async () => {
    const me = socUid();
    const rows = await rest('friendships?select=*&order=created_at.desc');
    const ids = [...new Set(rows.map(f => f.requester === me ? f.addressee : f.requester))];
    const profs = ids.length ? await rest(`profiles?select=*&id=in.(${ids.join(',')})`) : [];
    const pm = new Map(profs.map(p => [p.id, p]));
    const other = f => pm.get(f.requester === me ? f.addressee : f.requester);
    const wrap = f => ({ ...f, user: other(f) });
    SOC.friends = {
      list: rows.filter(f => f.status === 'accepted' && other(f)).map(wrap).sort((a, b) => dispName(a.user).localeCompare(dispName(b.user), 'es')),
      incoming: rows.filter(f => f.status === 'pending' && f.addressee === me && other(f)).map(wrap),
      outgoing: rows.filter(f => f.status === 'pending' && f.requester === me && other(f)).map(wrap),
    };
    socSaveCache();
  });
}
async function loadTeams() {
  if (!socOn() || !SOC.profile) return;
  return socLoad('teams', async () => { SOC.teams = await rpc('my_team_projects'); socSaveCache(); });
}
async function loadTeam(pid) {
  if (!socOn()) return;
  return socLoad('team:' + pid, async () => { SOC.snaps[pid] = (await rpc('team_snapshot', { pid })) || false; socSaveCache(); });
}
async function loadMyTasks() {
  if (!socOn() || !SOC.profile) return;
  return socLoad('mytasks', async () => { SOC.myTasks = await rpc('my_team_tasks'); socSaveCache(); });
}

/* Vuelve a pintar sin perder el sitio: ni el desplazamiento del tablero ni lo que escribes */
let socPending = false;
function socRefresh() {
  if (typeof rerender !== 'function') return;
  const a = document.activeElement;
  const chatIdle = a && a.id === 'tm-chat-in' && !a.value;
  if (tbDrag.on || (!chatIdle && a && $('#app').contains(a) && a.matches('input:not([type=checkbox]):not([type=radio]), textarea'))) { socPending = true; return; }
  socPending = false;
  const board = $('.tb-board'), left = board ? board.scrollLeft : 0;
  const lists = $$('.tb-list').map(l => [l.dataset.col, l.scrollTop]);
  const chat = $('.tm-chat-list'), atBottom = !chat || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60, chatTop = chat ? chat.scrollTop : 0;
  const pick = $('.tm-react-add.open'), pickAid = pick && pick.closest('[data-aid]') && pick.closest('[data-aid]').dataset.aid;
  rerender();
  if (pickAid) { const w = $(`.tm-feed li[data-aid="${pickAid}"] .tm-react-add`); if (w) w.classList.add('open'); }
  const nb = $('.tb-board'); if (nb) nb.scrollLeft = left;
  lists.forEach(([c, t]) => { const l = $(`.tb-list[data-col="${c}"]`); if (l) l.scrollTop = t; });
  const nc = $('.tm-chat-list'); if (nc) nc.scrollTop = atBottom ? nc.scrollHeight : chatTop;
  if (chatIdle) { const i = $('#tm-chat-in'); if (i) i.focus({ preventScroll: true }); }
}
/* Carga y repinta solo si ha cambiado algo */
function socFetch(job, key) {
  const before = JSON.stringify(key());
  return job.then(() => { if (JSON.stringify(key()) !== before) socRefresh(); }, () => { socRefresh(); });
}
document.addEventListener('focusout', () => { if (socPending) setTimeout(() => { if (socPending) socRefresh(); }, 50); });

/* ---------- Rachas: días seguidos en los que alguien del equipo terminó algo ---------- */
function localDay(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function teamStreak(doneTimes) {
  const days = new Set((doneTimes || []).filter(Boolean).map(localDay)), today = todayStr();
  let d = days.has(today) ? today : addDays(today, -1), cur = 0;
  while (days.has(d)) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0;
  for (let i = 119; i >= 0; i--) { if (days.has(addDays(today, -i))) { run++; best = Math.max(best, run); } else run = 0; }
  return { cur, best, today: days.has(today), last14: Array.from({ length: 14 }, (_, i) => { const x = addDays(today, i - 13); return { d: x, on: days.has(x) }; }) };
}
const streakTag = (st, min = 2) => st.cur >= min ? `<span class="tm-streak" title="${st.cur} días seguidos terminando algo">🔥 ${st.cur}</span>` : '';
/* Chat: hasta cuándo lo has leído (en este dispositivo) */
const chatSeenKey = pid => 'boldup.chatSeen.' + pid;
const chatSeen = pid => { try { return localStorage.getItem(chatSeenKey(pid)) || ''; } catch { return ''; } };
const chatUnread = (pid, last) => !!last && last > chatSeen(pid);
function markChatSeen(pid, ts) { try { if (ts && ts > chatSeen(pid)) localStorage.setItem(chatSeenKey(pid), ts); } catch {} }

/* ---------- Piezas ---------- */
const AV_COLORS = ['#4a72cf', '#34a853', '#f29900', '#e8467c', '#9c5ad8', '#0f9fb5', '#d4533b', '#6b7a99'];
function userColor(u) {
  if (u && u.color) return u.color;
  const s = String((u && u.id) || '');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
}
const dispName = u => (u && (u.display_name || u.username)) || 'Alguien';
/* Avatares para elegir: se guardan tal cual (máx. 16 caracteres en la base de datos) */
const AVATARS = [
  ['Animales', ['🦊', '🐼', '🐯', '🦁', '🐨', '🐸', '🐙', '🦉', '🐧', '🐢', '🦄', '🐶', '🐱', '🐰', '🐻', '🦖']],
  ['Caras', ['😀', '😎', '🤓', '🥳', '😇', '🤠', '🧐', '😴', '🤩', '😺', '👽', '🤖']],
  ['Cosas', ['🚀', '🔥', '🌱', '⚡', '🎧', '📚', '⚽', '🎨', '🎮', '🌈', '☕', '🍕', '🎸', '🏀', '🌙', '💎']],
];
const AV_BASE = ((window.PO_CONFIG && PO_CONFIG.supabaseUrl) || '').replace(/\/$/, '') + '/storage/v1/object/public/avatars/';
const photoUrl = path => AV_BASE + path.split('/').map(encodeURIComponent).join('/');
const nameStyle = u => u && /^#[0-9a-f]{6}$/i.test(u.name_color || '') ? ` style="color:${u.name_color}"` : '';
function avatar(u, size = '') {
  if (!u) return `<span class="av ${size} none" aria-hidden="true">?</span>`;
  const st = u.av_style === 'square' ? 'sq' : u.av_style === 'ring' ? 'ring' : '';
  const vars = `--c:${userColor(u)};--rc:${u.name_color || userColor(u)}`;
  if (u.photo) return `<span class="av ${size} ${st} photo" style="${vars}" title="${esc(dispName(u))}" aria-hidden="true"><img src="${photoUrl(u.photo)}" alt="" loading="lazy" decoding="async"></span>`;
  const t = u.avatar || dispName(u).trim().charAt(0).toUpperCase();
  return `<span class="av ${size} ${st} ${u.avatar ? 'emo' : ''}" style="${vars}" title="${esc(dispName(u))}" aria-hidden="true">${esc(t)}</span>`;
}
/* Rejilla de avatares (radio): vale para la hoja rápida y para «Tu perfil» */
function avatarGrid(p) {
  const c = userColor(p), cur = p.photo ? '@photo' : (p.avatar || '');
  const tile = (v, label) => `<label class="avp-tile" style="--c:${c}"><input type="radio" name="avatar" value="${esc(v)}" ${cur === v ? 'checked' : ''} aria-label="${esc(label)}"><span class="av md ${v ? 'emo' : ''}">${esc(v || dispName(p).trim().charAt(0).toUpperCase())}</span></label>`;
  const photo = p.photo ? `<label class="avp-tile" style="--c:${c}"><input type="radio" name="avatar" value="@photo" checked aria-label="Tu foto"><span class="av md photo"><img src="${photoUrl(p.photo)}" alt=""></span></label>` : '';
  return `<div class="avp">
    <div class="avp-g"><span class="avp-h">${p.photo ? 'Tu foto o tu inicial' : 'Tu inicial'}</span><div class="avp-row">${photo}${tile('', 'Inicial')}<button type="button" class="avp-up" data-avp-up aria-label="Subir una foto">${I.plus}<span>Foto</span></button></div></div>
    ${AVATARS.map(([n, list]) => `<div class="avp-g"><span class="avp-h">${n}</span><div class="avp-row">${list.map(e => tile(e, e)).join('')}</div></div>`).join('')}
  </div>`;
}
function saveProfile(body) {
  Object.assign(SOC.profile, body); socSaveCache(); socRefresh();
  return rest(`profiles?id=eq.${SOC.profile.id}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } });
}
/* ---------- Foto de perfil (Supabase Storage, carpeta propia) ---------- */
/* v76: el input vive dentro del documento (y dentro del popup si hay uno abierto): en iPhone,
   un input suelto o fuera del popup a veces no abre la galería o no avisa al elegir. */
let photoInput = null;
function pickPhoto() {
  if (photoInput) photoInput.remove();
  const inp = photoInput = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.className = 'photo-inp';
  inp.setAttribute('aria-hidden', 'true'); inp.tabIndex = -1;
  let done = false;
  const go = () => { if (done) return; const f = inp.files && inp.files[0]; if (!f) return; done = true; inp.remove(); if (photoInput === inp) photoInput = null; cropPhoto(f); };
  inp.addEventListener('change', go); inp.addEventListener('input', go);
  const host = document.querySelector('dialog[open]:not(.crop-dlg)') || document.body;
  host.appendChild(inp);
  inp.click();
}
function loadImg(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file), i = new Image();
    i.onload = () => ok({ img: i, url });
    i.onerror = () => { URL.revokeObjectURL(url); ko(new Error('No se pudo abrir esa imagen. Prueba con otra (JPG o PNG).')); };
    i.src = url;
  });
}
/* Pantalla de recorte: arrastra para mover, pellizca (o rueda / barra) para hacer zoom */
async function cropPhoto(file) {
  if (!/^image\//.test(file.type || 'image/')) { toast('Elige una imagen'); return; }
  let L;
  try { L = await loadImg(file); } catch (e) { toast(e.message); return; }
  const { img, url } = L, W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) { URL.revokeObjectURL(url); toast('No se pudo abrir esa imagen'); return; }
  const dlg = document.createElement('dialog');
  dlg.className = 'crop-dlg';
  dlg.innerHTML = `<div class="crop-head"><button type="button" class="btn" data-c="no">Cancelar</button><h3>Ajusta tu foto</h3><button type="button" class="btn primary" data-c="ok">Usar foto</button></div>
    <div class="crop-stage"><div class="crop-box"><img alt="" draggable="false"><div class="crop-mask" aria-hidden="true"></div></div></div>
    <p class="crop-tip muted small">Arrastra para elegir la zona y pellizca para acercar</p>
    <div class="crop-zoom"><span aria-hidden="true">−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span aria-hidden="true">+</span></div>`;
  document.body.appendChild(dlg);
  const box = dlg.querySelector('.crop-box'), im = dlg.querySelector('img'), range = dlg.querySelector('input[type=range]');
  im.src = url;
  let V = 280, z = 1, x = 0, y = 0;
  const base = () => Math.max(V / W, V / H);
  const clamp = () => {
    const s = base() * z, mx = Math.max(0, (W * s - V) / 2), my = Math.max(0, (H * s - V) / 2);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  const draw = () => {
    clamp();
    const s = base() * z;
    im.style.width = W * s + 'px'; im.style.height = H * s + 'px';
    im.style.transform = `translate(${V / 2 + x - W * s / 2}px, ${V / 2 + y - H * s / 2}px)`;
    range.value = z;
  };
  const zoomTo = (nz, cx = V / 2, cy = V / 2) => {
    nz = Math.min(4, Math.max(1, nz));
    /* Mantiene quieto el punto bajo los dedos */
    const k = nz / z; x = (x - (cx - V / 2)) * k + (cx - V / 2); y = (y - (cy - V / 2)) * k + (cy - V / 2); z = nz; draw();
  };
  const fit = () => { V = Math.round(box.getBoundingClientRect().width) || 280; draw(); };
  const pts = new Map(); let last = null;
  const rel = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  box.addEventListener('pointerdown', e => { e.preventDefault(); box.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e)); last = null; });
  box.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), cur = rel(e); pts.set(e.pointerId, cur);
    if (pts.size === 1) { x += cur[0] - prev[0]; y += cur[1] - prev[1]; draw(); return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (last) { x += c[0] - last.c[0]; y += c[1] - last.c[1]; zoomTo(z * d / last.d, c[0], c[1]); }
    last = { d, c };
  });
  const up = e => { pts.delete(e.pointerId); last = null; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', e => { e.preventDefault(); const [cx, cy] = rel(e); zoomTo(z * Math.exp(-e.deltaY / 300), cx, cy); }, { passive: false });
  range.addEventListener('input', () => zoomTo(+range.value));
  const ro = new ResizeObserver(fit); ro.observe(box);
  const close = () => { ro.disconnect(); URL.revokeObjectURL(url); dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('click', async e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'no') return close();
    b.disabled = true; b.textContent = 'Subiendo…';
    try {
      const s = base() * z, side = V / s, sx = W / 2 - (V / 2 + x) / s, sy = H / 2 - (V / 2 + y) / s;
      const out = Math.min(400, Math.round(side)) || 400;
      const cv = document.createElement('canvas'); cv.width = cv.height = Math.max(160, out);
      const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high';
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, sx, sy, side, side, 0, 0, cv.width, cv.height);
      const blob = await new Promise((ok, ko) => cv.toBlob(bb => bb ? ok(bb) : ko(new Error('No se pudo preparar la foto')), 'image/jpeg', 0.88));
      await uploadPhoto(blob);
      close();
    } catch (err) { b.disabled = false; b.textContent = 'Usar foto'; toast(niceErr(err)); }
  });
  dlg.showModal();
  requestAnimationFrame(fit);
}
async function storageFetch(method, path, body) {
  const tok = await accessToken();
  if (!tok) throw new Error('Sesión caducada: vuelve a entrar');
  const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/avatars/${path}`, { method, headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' } : {}) }, body });
  if (!r.ok) { const t = await r.text().catch(() => ''); let m = ''; try { m = JSON.parse(t).message || JSON.parse(t).error; } catch {} throw new Error(m || 'No se pudo subir la foto (' + r.status + ')'); }
}
function dropPhotoFile(path) { if (path) storageFetch('DELETE', path).catch(() => {}); }
async function uploadPhoto(blob) {
  const p = SOC.profile; if (!p) throw new Error('Entra en tu cuenta para poner una foto');
  const path = `${p.id}/${Date.now().toString(36)}.jpg`, old = p.photo;
  await storageFetch('POST', path, blob);
  await saveProfile({ photo: path });
  if (old && old !== path) dropPhotoFile(old);
  if (modal.open && $('.avp-prev', modalForm)) modal.close();
  toast('¡Foto de perfil puesta!'); haptic(12);
}
function removePhoto() {
  const p = SOC.profile; if (!p || !p.photo) return;
  const old = p.photo;
  saveProfile({ photo: null }).then(() => { dropPhotoFile(old); toast('Foto quitada'); }, e => toast(niceErr(e)));
}
document.addEventListener('click', e => { if (e.target.closest('[data-avp-up]')) { e.preventDefault(); pickPhoto(); } });

/* ---------- Ajustes › Tu perfil ---------- */
const NAME_COLORS = ['#4a72cf', '#34a853', '#f29900', '#e8467c', '#9c5ad8', '#0f9fb5', '#d4533b', '#6b7a99'];
function profileSettingsSection() {
  if (typeof cloudReady === 'function' && !cloudReady()) return socNotice('Tu perfil', 'Esta parte necesita la nube de Boldup.');
  if (!getSession()) return socNotice('Tu perfil', 'Entra en tu cuenta para tener nick, avatar y amigos.', `<a class="btn primary" href="#ajustes/cuenta">Entrar o crear cuenta</a>`);
  if (!SOC.profileLoaded) { (loadProfile() || Promise.resolve()).then(() => socRefresh(), () => socRefresh()); return `<div class="soc-loading glass"><span class="spin"></span>Cargando tu perfil…</div>`; }
  if (SOC.backend === false) return socNotice('Casi listo', 'Los perfiles se están activando en el servidor.');
  const p = SOC.profile;
  if (!p) return socNotice('Elige tu nick', 'Tu nick es tu nombre en Boldup: con él te encuentran tus amigos.', `<button class="btn primary" data-sact="nick">Elegir mi nick</button>`);
  const sw = (k, list, cur, auto) => `<div class="pf-sw">${auto ? `<button class="pf-dot auto ${!cur ? 'on' : ''}" data-sact="pf-set" data-k="${k}" data-v="" aria-label="Automático">A</button>` : ''}${list.map(c => `<button class="pf-dot ${cur && cur.toLowerCase() === c ? 'on' : ''}" style="--c:${c}" data-sact="pf-set" data-k="${k}" data-v="${c}" aria-label="Color ${c}"></button>`).join('')}</div>`;
  const styles = [['', 'Círculo'], ['ring', 'Con anillo'], ['square', 'Cuadrado']];
  return `<div class="pf-card glass">
      <button class="soc-av" data-sact="avatar" aria-label="Cambiar avatar">${avatar(p, 'xl')}<span class="soc-av-ed" aria-hidden="true">✎</span></button>
      <b class="pf-name"${nameStyle(p)}>${esc(dispName(p))}</b>
      <span class="muted">@${esc(p.username)} · ${esc(p.friend_code)}</span>
    </div>
    <div class="section"><div class="section-head"><h2>Foto o avatar</h2></div>
      <div class="settings-group glass">
        <button class="item set-btn" data-sact="pf-photo"><span>${p.photo ? 'Cambiar la foto' : 'Subir una foto'}<span class="muted small item-sub">Eliges la zona que quieres y la ven tus amigos y compañeros</span></span>${I.right}</button>
        ${p.photo ? `<button class="item set-btn danger" data-sact="pf-nophoto"><span>Quitar la foto</span></button>` : ''}
        <button class="item set-btn" data-sact="avatar"><span>Elegir un avatar<span class="muted small item-sub">Animales, caras, cosas o tu inicial</span></span>${I.right}</button>
      </div></div>
    <div class="section"><div class="section-head"><h2>Cómo te ven</h2></div>
      <div class="settings-group glass">
        <label class="item pf-in"><span>Nombre visible</span><input type="text" data-pf="display_name" value="${esc(p.display_name || '')}" maxlength="40" placeholder="${esc(p.username)}" enterkeyhint="done"></label>
        <div class="item"><span>Nick<span class="muted small item-sub">@${esc(p.username)}</span></span><button class="btn small" data-sact="pf-nick">Cambiar</button></div>
        <div class="item pf-col"><span>Color del avatar</span>${sw('color', AV_COLORS, p.color, true)}</div>
        <div class="item pf-col"><span>Color de tu nombre</span>${sw('name_color', NAME_COLORS, p.name_color, true)}</div>
        <div class="item"><span>Aspecto del avatar</span><div class="segmented compact">${styles.map(([v, l]) => `<button class="${(p.av_style || '') === v ? 'on' : ''}" data-sact="pf-set" data-k="av_style" data-v="${v}">${l}</button>`).join('')}</div></div>
      </div>
      <p class="hint">Tus amigos ven tu nombre, tu nick y tu avatar en los proyectos compartidos. Tus tareas personales nunca se comparten.</p></div>`;
}
document.addEventListener('change', e => {
  const inp = e.target.closest && e.target.closest('[data-pf]');
  if (!inp || !SOC.profile) return;
  const v = inp.value.trim();
  if ((SOC.profile[inp.dataset.pf] || '') === v) return;
  saveProfile({ [inp.dataset.pf]: v || null }).then(() => toast('Guardado'), err => toast(niceErr(err)));
});
function avatarSheet() {
  const p = SOC.profile;
  if (!p) return;
  openModal('Elige tu avatar', `<div class="avp-prev">${avatar(p, 'lg')}<span><b${nameStyle(p)}>${esc(dispName(p))}</b><span class="muted small">Lo verán tus amigos en los proyectos compartidos</span></span></div>${avatarGrid(p)}
    <div class="field">Color de fondo${colorField('color', p.color || userColor(p))}</div>`, {
    onSave: d => {
      const color = readColor(d, 'color'), keepPhoto = d.avatar === '@photo';
      const body = { color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : null };
      if (!keepPhoto) { body.avatar = d.avatar || null; if (p.photo) { body.photo = null; dropPhotoFile(p.photo); } }
      saveProfile(body).then(() => toast('Avatar guardado'), e => toast(niceErr(e)));
    },
  });
  /* Vista previa en directo mientras eliges */
  modalForm.addEventListener('change', function prev() {
    const box = $('.avp-prev', modalForm);
    if (!box) return modalForm.removeEventListener('change', prev);
    const fd = new FormData(modalForm), v = fd.get('avatar') || '', col = readColor(Object.fromEntries(fd), 'color') || userColor(p);
    box.firstElementChild.outerHTML = avatar(v === '@photo' ? { ...p, color: col } : { ...p, avatar: v, photo: null, color: col }, 'lg');
    $$('.avp-tile', modalForm).forEach(t => t.style.setProperty('--c', col));
  });
}
function avStack(list, max = 4, size = 'sm') {
  const more = list.length - max;
  return `<span class="av-stack">${list.slice(0, max).map(u => avatar(u, size)).join('')}${more > 0 ? `<span class="av ${size} more">+${more}</span>` : ''}</span>`;
}
function agoShort(ts) {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts, m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'ayer' : d < 7 ? `hace ${d} días` : fmtShortDate(ymd(new Date(t)));
}
function socNotice(title, text, action = '') {
  return `<div class="soc-gate glass"><div class="soc-gate-ic">👥</div><b>${title}</b><p>${text}</p>${action}</div>`;
}
/* Qué falta para poder usar lo social (o '' si todo está listo) */
function socGate() {
  if (typeof cloudReady !== 'function' || !cloudReady()) return socNotice('Proyectos con amigos', 'Esta parte necesita la nube de Boldup, que aún no está activada.');
  if (!getSession()) return socNotice('Trabaja en equipo', 'Entra en tu cuenta para elegir tu nick, añadir amigos y crear proyectos con ellos: un tablero compartido donde cada uno ve qué está haciendo el resto.', `<a class="btn primary" href="#ajustes/cuenta">Entrar o crear cuenta</a>`);
  if (SOC.backend === false) return socNotice('Casi listo', 'Los proyectos con amigos se están activando en el servidor. En cuanto estén, aparecerán aquí.', `<button class="btn" data-sact="soc-retry">Volver a mirar</button>`);
  if (!SOC.profileLoaded) {
    if (SOC.errors.profile) return socNotice('Sin conexión', esc(SOC.errors.profile), `<button class="btn" data-sact="soc-retry">Reintentar</button>`);
    return `<div class="soc-loading glass"><span class="spin"></span>Cargando…</div>`;
  }
  if (!SOC.profile) return socNotice('Elige tu nick', 'Tu nick es tu nombre en Boldup: tus amigos te encontrarán por él o por tu ID de amigo. Solo hace falta una vez.', `<button class="btn primary" data-sact="nick">Elegir mi nick</button>`);
  return '';
}

/* ---------- Elegir nick ---------- */
let nickDlg = null;
function nickSuggestions(base) {
  const b = (base || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_.]/g, '').replace(/^[._]+/, '').slice(0, 14) || 'boldup';
  const y = String(new Date().getFullYear()).slice(2);
  return [...new Set([b + y, b + '_' + Math.floor(10 + Math.random() * 89), b + '.' + (Math.floor(Math.random() * 900) + 100), b + '_ok'])].filter(s => NICK_RE.test(s)).slice(0, 3);
}
function openNickDialog({ initial = '', change = false, onDone } = {}) {
  if (nickDlg && nickDlg.open) return;
  if (!nickDlg) {
    nickDlg = document.createElement('dialog');
    nickDlg.id = 'soc-dlg';
    document.body.appendChild(nickDlg);
    nickDlg.addEventListener('cancel', e => { e.preventDefault(); if (nickDlg.dataset.change) closeNick(); });
  }
  if (change) nickDlg.dataset.change = '1'; else delete nickDlg.dataset.change;
  const cur = SOC.profile;
  nickDlg.innerHTML = `<form class="nick-box" novalidate>
    <div class="nick-hero"><span class="nick-at">@</span></div>
    <h2>${change ? 'Cambia tu nick' : 'Elige tu nick'}</h2>
    <p class="nick-sub">${change ? 'Tu ID de amigo no cambia: quien ya te tiene te seguirá viendo.' : 'Es tu nombre en Boldup. Tus amigos te encontrarán por él para hacer proyectos juntos. Tus tareas y datos siguen igual.'}</p>
    <label class="nick-field"><span>@</span><input name="nick" value="${esc(initial || (cur && cur.username) || '')}" placeholder="tu_nick" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" aria-label="Nick" required></label>
    <div class="nick-msg" role="status" aria-live="polite"></div>
    <div class="nick-sugg"></div>
    <label class="nick-field name"><input name="display" value="${esc((cur && cur.display_name) || '')}" placeholder="Tu nombre (opcional)" maxlength="40" aria-label="Nombre visible"></label>
    <button class="btn primary wide" type="submit" disabled>${change ? 'Guardar' : 'Guardar mi nick'}</button>
    <button class="nick-later" type="button" data-nick="later">${change ? 'Cancelar' : 'Ahora no'}</button>
  </form>`;
  const f = $('form', nickDlg), inp = f.elements.nick, msg = $('.nick-msg', f), sugg = $('.nick-sugg', f), btn = $('button[type=submit]', f);
  let seq = 0, timer = 0, okFor = '';
  const say = (t, k) => { msg.textContent = t; msg.className = 'nick-msg ' + (k || ''); };
  const showSugg = base => {
    sugg.innerHTML = nickSuggestions(base).map(s => `<button type="button" class="chip-btn" data-nick-s="${esc(s)}">@${esc(s)}</button>`).join('');
  };
  const check = () => {
    const v = inp.value.trim().toLowerCase().replace(/^@/, '');
    if (inp.value !== v) inp.value = v;
    okFor = ''; btn.disabled = true; sugg.innerHTML = '';
    clearTimeout(timer);
    if (!v) { say(''); return; }
    if (v.length < 3) { say('Mínimo 3 caracteres', 'bad'); return; }
    if (!NICK_RE.test(v)) { say('Solo letras minúsculas, números, punto y guion bajo', 'bad'); return; }
    if (cur && cur.username === v) { say('Es tu nick actual', 'ok'); okFor = v; btn.disabled = false; return; }
    say('Comprobando…', 'busy');
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const st = await sb('/rest/v1/rpc/username_status', { method: 'POST', auth: !!getSession(), body: { name: v } });
        if (my !== seq) return;
        if (st === 'ok') { say(`✓ @${v} está libre`, 'ok'); okFor = v; btn.disabled = false; }
        else { say(st === 'taken' ? `@${v} ya está cogido. Prueba otro:` : st === 'reserved' ? 'Ese nick está reservado. Prueba otro:' : NICK_ERRORS.NICK_INVALID, 'bad'); if (st !== 'invalid') showSugg(v); }
      } catch (e) { if (my === seq) say(niceErr(e), 'bad'); }
    }, 350);
  };
  inp.addEventListener('input', check);
  f.addEventListener('click', e => {
    const s = e.target.closest('[data-nick-s]');
    if (s) { inp.value = s.dataset.nickS; check(); return; }
    if (e.target.closest('[data-nick="later"]')) {
      if (!change) { try { localStorage.setItem(NICK_LATER, String(Date.now())); } catch {} toast('Puedes elegirlo cuando quieras en Proyectos → Con amigos'); }
      closeNick();
    }
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = inp.value.trim().toLowerCase();
    if (!okFor || okFor !== v) { check(); return; }
    btn.disabled = true; say('Guardando…', 'busy');
    try {
      const p = await rpc('claim_username', { name: v, display: f.elements.display.value.trim() || null });
      SOC.profile = p; SOC.profileLoaded = true; SOC.backend = true; socSaveCache();
      try { localStorage.removeItem(PENDING_NICK); localStorage.removeItem(NICK_LATER); } catch {}
      closeNick();
      toast(change ? `Ahora eres @${p.username}` : `¡Hola, @${p.username}! Tu ID de amigo es ${p.friend_code}`);
      if (onDone) onDone(p);
      socAfterProfile();
      socRefresh();
    } catch (err) {
      say(niceErr(err), 'bad'); btn.disabled = false;
      if (/NICK_TAKEN/.test(err.message)) { okFor = ''; btn.disabled = true; showSugg(v); }
    }
  });
  nickDlg.showModal();
  if (typeof markOpened === 'function') markOpened(nickDlg);
  if (inp.value) check();
  if (matchMedia('(pointer: fine)').matches) inp.focus();
}
function closeNick() { if (nickDlg && nickDlg.open) nickDlg.close(); }

/* Tras entrar: si aún no tienes nick, se coge el que elegiste al crear la cuenta o se te pide */
let nickAsked = false;
async function socAfterLogin() {
  if (!socOn()) return;
  if (!SOC.profileLoaded) socLoadCache();
  let p;
  try { p = await loadProfile(); } catch { return; }
  if (p) { socAfterProfile(); socRefresh(); return; }
  let wanted = '';
  try { wanted = localStorage.getItem(PENDING_NICK) || ''; } catch {}
  if (!wanted) { try { const u = await sb('/auth/v1/user'); wanted = (u && u.user_metadata && u.user_metadata.username) || ''; } catch {} }
  if (wanted && NICK_RE.test(wanted)) {
    try {
      SOC.profile = await rpc('claim_username', { name: wanted }); SOC.backend = true; socSaveCache();
      try { localStorage.removeItem(PENDING_NICK); } catch {}
      toast(`Tu nick es @${SOC.profile.username} · ID ${SOC.profile.friend_code}`);
      socAfterProfile(); socRefresh(); return;
    } catch (e) { if (isMissing(e)) return; }
  }
  askNickSoon(wanted);
}
/* Se pide el nick en cuanto no haya nada delante (bienvenida, tutorial, otra ventana) */
function askNickSoon(initial = '', tries = 0) {
  if (nickAsked || SOC.profile || SOC.backend === false || !socOn()) return;
  let later = 0; try { later = Number(localStorage.getItem(NICK_LATER)) || 0; } catch {}
  if (Date.now() - later < 20 * 3600000) return;
  const busy = (typeof ob !== 'undefined' && ob.el) || (typeof tour !== 'undefined' && tour.on) || document.querySelector('dialog[open]') || (typeof overlayOpen === 'function' && overlayOpen());
  if (busy) { if (tries < 40) setTimeout(() => askNickSoon(initial, tries + 1), 6000); return; }
  nickAsked = true;
  openNickDialog({ initial: initial || nickSuggestions((getSession().user && getSession().user.email || '').split('@')[0])[0] || '' });
}
function socAfterProfile() {
  let pend = ''; try { pend = localStorage.getItem(PENDING_FRIEND) || ''; } catch {}
  if (pend && parseHash().name !== 'amigos') setTimeout(() => { location.hash = '#amigos'; }, 400);
  loadFriends().then(() => { socBadge(); }).catch(() => {});
  Promise.all([loadMyTasks(), loadTeams()]).then(() => { if (parseHash().name === 'hoy') socRefresh(); }).catch(() => {});
}
/* Punto en «Proyectos» del menú cuando tienes solicitudes de amistad */
function socBadge() {
  const n = (SOC.friends && SOC.friends.incoming.length) || 0;
  $$('[data-nav="proyectos"]').forEach(a => { a.classList.toggle('has-badge', n > 0); a.dataset.badge = n || ''; });
}

/* ---------- Proyectos → «Con amigos» ---------- */
const seenKey = pid => 'boldup.seen.' + pid;
function seenAct(pid) { try { return Number(localStorage.getItem(seenKey(pid))) || 0; } catch { return 0; } }
function markSeen(pid, id) { try { if (id > seenAct(pid)) localStorage.setItem(seenKey(pid), String(id)); } catch {} }
function teamCard(p) {
  const fresh = p.last_act && p.last_act > seenAct(p.id) && p.last_kind;
  const left = (p.total || 0) - (p.done || 0), pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const st = p.archived_at ? { k: 'arch', txt: 'Archivado' } : !p.total ? { k: 'idle', txt: 'Tablero vacío' } : !left ? { k: 'ok', txt: '¡Todo hecho!' }
    : p.late ? { k: 'warn', txt: `${p.late} atrasada${p.late === 1 ? '' : 's'}` } : p.mine ? { k: 'soon', txt: `${p.mine} para ti` } : { k: 'go', txt: `En marcha · ${left} pendiente${left === 1 ? '' : 's'}` };
  const sub = [p.mine && st.k !== 'soon' && `${p.mine} para ti`, p.next_due && `plazo ${relDay(p.next_due).toLowerCase()}`, `${(p.members || []).length} miembro${(p.members || []).length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return `<article class="pj-card tm-card glass" style="--c:${p.color || '#4a72cf'}">
    <a class="pj-main" href="#equipo/${p.id}">
      <span class="pj-ic">${esc(p.icon || '👥')}</span>
      <span class="pj-text"><span class="pj-name">${esc(p.name)}</span>${stateLine(st)}<span class="pj-sub">${sub}</span></span>
      ${projRing({ done: p.done || 0, total: p.total || 0, pct })}
    </a>
    ${fresh ? `<a class="tm-new" href="#equipo/${p.id}/actividad"><i></i><span><b${nameStyle((p.members || []).find(m => m.id === p.last_kind.user))}>${esc(dispName((p.members || []).find(m => m.id === p.last_kind.user)))}</b> ${actText({ members: p.members || [] }, { ...p.last_kind, user_id: p.last_kind.user, detail: p.last_kind.detail || {} })}</span></a>` : ''}
    <div class="tm-foot">${avStack(p.members || [], 5)}${streakTag(teamStreak(p.done_days))}${chatUnread(p.id, p.last_msg) ? `<a class="tm-chat-new" href="#equipo/${p.id}/chat">💬 Mensajes nuevos</a>` : ''}<span class="tm-upd">${p.updated_at ? 'Actividad ' + agoShort(p.updated_at) : ''}</span></div>
  </article>`;
}
function meCard(compact) {
  const p = SOC.profile, inc = (SOC.friends && SOC.friends.incoming.length) || 0, nf = (SOC.friends && SOC.friends.list.length) || 0;
  return `<div class="soc-me glass ${compact ? 'compact' : ''}">
    <button class="soc-av" data-sact="avatar" aria-label="Cambiar tu avatar">${avatar(p, 'lg')}<span class="soc-av-ed" aria-hidden="true">✎</span></button>
    <div class="soc-me-t"><b${nameStyle(p)}>${esc(dispName(p))}</b><span>@${esc(p.username)}</span>
      <button class="soc-code" data-sact="copy-code" aria-label="Copiar mi ID de amigo ${esc(p.friend_code)}">ID ${esc(p.friend_code)} ${I.copy}</button></div>
    ${compact ? `<a class="btn soc-friends-btn" href="#amigos">${inc ? `<span class="soc-dot">${inc}</span>` : ''}<span>Amigos${nf ? ' · ' + nf : ''}</span></a>` : `<button class="btn small" data-sact="edit-profile">Editar</button>`}
  </div>`;
}
function viewSharedProjects() {
  const gate = socGate();
  if (gate) return gate;
  if (SOC.teams === null) { refreshShared(); }
  const all = SOC.teams || [], ui = state.settings.ui;
  const list = all.filter(p => !!p.archived_at === !!ui.teamsArchived);
  const nArch = all.filter(p => p.archived_at).length;
  const inc = (SOC.friends && SOC.friends.incoming.length) || 0;
  return `${meCard(true)}
    ${inc ? `<a class="soc-req-banner glass" href="#amigos"><span class="soc-dot">${inc}</span><span class="grow">${inc === 1 ? 'Tienes 1 solicitud de amistad' : `Tienes ${inc} solicitudes de amistad`}</span>${I.right}</a>` : ''}
    ${nArch ? `<div class="pj-bar"><div class="segmented compact" role="tablist">
      <button role="tab" class="${!ui.teamsArchived ? 'on' : ''}" data-sact="teams-arch" data-v="">Activos · ${all.length - nArch}</button>
      <button role="tab" class="${ui.teamsArchived ? 'on' : ''}" data-sact="teams-arch" data-v="1">Archivados · ${nArch}</button></div></div>` : ''}
    ${SOC.teams === null ? `<div class="soc-loading glass"><span class="spin"></span>Cargando tus proyectos compartidos…</div>`
      : list.length ? `<div class="pj-grid">${list.map(teamCard).join('')}</div>`
      : ui.teamsArchived ? emptyBox('No hay proyectos compartidos archivados.')
      : `<div class="empty pj-empty tm-empty"><b>Tu primer proyecto en equipo</b>Un tablero compartido con tus amigos: columnas con tarjetas, quién hace cada cosa, objetivos y un calendario común.
        <div class="tm-how"><span>1. Añade a tus amigos por su nick o ID</span><span>2. Crea el proyecto y elige quién entra</span><span>3. Repartid las tarjetas y moved cada una cuando avance</span></div>
        <button class="btn primary" data-sact="team-new">${I.plus}<span>Crear proyecto con amigos</span></button></div>`}
    ${SOC.errors.teams ? `<p class="hint warn-text">${esc(SOC.errors.teams)}</p>` : ''}
    ${list.length && typeof pushActive === 'function' && !pushActive() && CFG.vapidPublicKey ? `<a class="soc-push glass" href="#ajustes/cuenta">🔔<span class="grow">Activa los avisos para enterarte cuando te asignen una tarjeta, te comenten o te pidan amistad.</span>${I.right}</a>` : ''}`;
}
function refreshShared() {
  if (!socOn()) return;
  const key = () => [SOC.backend, SOC.profileLoaded, SOC.profile, SOC.teams, SOC.friends, SOC.errors.teams];
  const job = (SOC.profileLoaded ? Promise.resolve(SOC.profile) : loadProfile())
    .then(p => p ? Promise.all([loadTeams(), loadFriends()]) : null).then(() => socBadge());
  return socFetch(job, key);
}

/* ---------- Amigos ---------- */
function friendRow(f, kind) {
  const u = f.user;
  const acts = kind === 'in' ? `<button class="btn small primary" data-sact="fr-accept" data-id="${f.id}">Aceptar</button><button class="btn small" data-sact="fr-reject" data-id="${f.id}">Rechazar</button>`
    : kind === 'out' ? `<button class="btn small ghost" data-sact="fr-cancel" data-id="${f.id}">Cancelar</button>`
    : `<button class="icon-btn" data-sact="fr-menu" data-id="${f.id}" aria-label="Opciones de ${esc(dispName(u))}">${I.more}</button>`;
  if (kind === 'friend') {
    const n = teamsWith(u.id).length;
    return `<li class="fr-row"><button class="fr-open" data-sact="fr-open" data-id="${f.id}">${avatar(u)}<span class="fr-t"><b${nameStyle(u)}>${esc(dispName(u))}</b><span>@${esc(u.username)}${n ? ` · ${n} proyecto${n === 1 ? '' : 's'} juntos` : ''}</span></span></button><span class="fr-a">${acts}</span></li>`;
  }
  return `<li class="fr-row">${avatar(u)}<span class="fr-t"><b${nameStyle(u)}>${esc(dispName(u))}</b><span>@${esc(u.username)}${kind === 'in' ? ' · quiere ser tu amigo' : kind === 'out' ? ' · esperando respuesta' : ''}</span></span><span class="fr-a">${acts}</span></li>`;
}
const teamsWith = uid => (SOC.teams || []).filter(p => !p.archived_at && (p.members || []).some(m => m.id === uid));
function friendSheet(f) {
  const u = f.user, shared = teamsWith(u.id), since = f.responded_at || f.created_at;
  openModal('', `<div class="fr-sheet">
      ${avatar(u, 'xl')}
      <b class="fr-sheet-n">${esc(dispName(u))}</b>
      <span class="muted">@${esc(u.username)}${u.friend_code ? ' · ' + esc(u.friend_code) : ''}</span>
      ${since ? `<span class="muted small">Amigos desde ${esc(fmtShortDate(String(since).slice(0, 10)))}</span>` : ''}
    </div>
    <div class="section"><div class="section-head"><h2>Proyectos juntos${shared.length ? ' · ' + shared.length : ''}</h2></div>
      ${shared.length ? `<div class="sheet-list">${shared.map(p => {
        const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
        return `<button type="button" class="sheet-item" data-modal="go" data-pid="${p.id}"><span class="fr-pj-ic" style="--c:${p.color || '#4a72cf'}">${esc(p.icon || '👥')}</span><span class="grow">${esc(p.name)}<span class="muted small"> · ${pct}% hecho</span></span>${I.right}</button>`;
      }).join('')}</div>` : `<p class="hint">Aún no compartís ningún proyecto.</p>`}
    </div>
    <button type="button" class="btn wide primary" data-modal="newteam">${I.plus}<span>Nuevo proyecto con ${esc(dispName(u))}</span></button>
    <div class="sheet-list">
      <button type="button" class="sheet-item" data-modal="copy">${I.copy}<span>Copiar su ID</span></button>
      <button type="button" class="sheet-item danger" data-modal="del">${I.trash}<span>Eliminar de amigos</span></button>
    </div>`, {
    actions: {
      go: el => { modal.close(); location.hash = `#equipo/${el.dataset.pid}`; },
      newteam: () => { modal.close(); setTimeout(() => teamSheet(null, [u.id]), 220); },
      copy: () => copyText(u.friend_code || '@' + u.username, 'Copiado'),
      del: () => { if (confirm(`¿Eliminar a ${dispName(u)} de tus amigos? Seguiréis en los proyectos que ya compartís.`)) { modal.close(); friendAction(() => rest(`friendships?id=eq.${f.id}`, { method: 'DELETE' }), 'Amigo eliminado'); } },
    },
  });
}
function foundCard() {
  const r = SOC.found;
  if (!r) return '';
  if (r.loading) return `<div class="fr-found glass"><span class="spin"></span>Buscando…</div>`;
  if (r.error) return `<div class="fr-found glass muted">${esc(r.error)}</div>`;
  if (!r.user) return `<div class="fr-found glass muted">No hay nadie con «${esc(r.q)}». Revisa el nick o pide su ID de amigo (está en su pantalla de Amigos).</div>`;
  const u = r.user, rel = u.relation;
  const act = rel === 'me' ? '<span class="muted small">Eres tú</span>'
    : rel === 'friend' ? '<span class="tag">✓ Ya sois amigos</span>'
    : rel === 'sent' ? '<span class="tag">Solicitud enviada</span>'
    : rel === 'received' ? `<button class="btn small primary" data-sact="fr-add" data-id="${u.id}">Aceptar</button>`
    : `<button class="btn small primary" data-sact="fr-add" data-id="${u.id}">${I.plus}<span>Añadir</span></button>`;
  return `<div class="fr-found glass">${avatar(u, 'md')}<span class="fr-t"><b${nameStyle(u)}>${esc(dispName(u))}</b><span>@${esc(u.username)} · ${esc(u.friend_code)}</span></span>${act}</div>`;
}
const PENDING_FRIEND = 'boldup.pendingFriend';
/* Código QR con tu enlace de amigo: la librería se carga solo cuando hace falta */
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'vendor/qrcode.js?v=1'; sc.onload = ok; sc.onerror = () => ko(new Error('No se pudo cargar el QR: revisa la conexión')); document.head.appendChild(sc); });
}
const friendLink = p => `${location.origin}${location.pathname}#amigos/${p.friend_code}`;
function qrSheet() {
  const p = SOC.profile; if (!p) return;
  loadQrLib().then(() => {
    const q = qrcode(0, 'Q'); q.addData(friendLink(p)); q.make();
    openModal('Tu código QR', `<div class="qr-box">
      <div class="qr-card">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}<span class="qr-av">${avatar(p, 'md')}</span></div>
      <b>@${esc(p.username)}</b><span class="soc-code-big">${esc(p.friend_code)}</span>
      <p class="hint">Que tu amigo lo escanee con la cámara del móvil: se abrirá Boldup con tu perfil listo para añadirte.</p>
    </div>
    ${'BarcodeDetector' in window ? `<button type="button" class="btn wide" data-modal="scan">${I.search}<span>Escanear el QR de un amigo</span></button>` : ''}`, {
      actions: { scan: () => { modal.close(); setTimeout(scanSheet, 220); } },
    });
  }, e => toast(e.message));
}
/* Escanear con la cámara (donde el navegador sabe leer QR; si no, la cámara del móvil abre el enlace igual) */
let scanStop = null;
async function scanSheet() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { toast('Usa la cámara del móvil para escanear el QR de tu amigo'); return; }
  openModal('Escanear QR', `<div class="qr-scan"><video playsinline muted></video><span class="qr-frame"></span></div><p class="hint">Apunta al código QR de tu amigo.</p>`, {});
  const video = $('#modal .qr-scan video');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch (e) { modal.close(); toast('Sin permiso para la cámara'); return; }
  video.srcObject = stream; await video.play().catch(() => {});
  const det = new BarcodeDetector({ formats: ['qr_code'] });
  let on = true;
  scanStop = () => { on = false; stream.getTracks().forEach(t => t.stop()); scanStop = null; };
  const done = code => { scanStop && scanStop(); modal.close(); location.hash = '#amigos'; setTimeout(() => findFriend(code), 300); };
  const tick = async () => {
    if (!on) return;
    if (!modal.open) { scanStop && scanStop(); return; }
    try { const r = await det.detect(video); const raw = r[0] && r[0].rawValue || ''; const m = raw.match(/BU-[A-Z0-9]{6}/i); if (m) return done(m[0].toUpperCase()); } catch {}
    setTimeout(tick, 250);
  };
  tick();
}
function viewFriends(code) {
  const back = backLink('#proyectos', 'Proyectos');
  if (code) {
    code = decodeURIComponent(code);
    try { localStorage.setItem(PENDING_FRIEND, code); } catch {}
  }
  const gate = socGate();
  if (!gate) {
    let pend = ''; try { pend = localStorage.getItem(PENDING_FRIEND) || ''; } catch {}
    if (pend && (!SOC.found || SOC.found.q !== pend)) { try { localStorage.removeItem(PENDING_FRIEND); } catch {} setTimeout(() => findFriend(pend), 0); }
  }
  if (gate) return `<div class="page page-narrow page-friends">${pageHead({ eyebrow: back, title: 'Amigos' })}${gate}</div>`;
  if (!SOC.friends) refreshShared();
  const F = SOC.friends || { list: [], incoming: [], outgoing: [] };
  return `<div class="page page-narrow page-friends">
    ${pageHead({ eyebrow: back, title: 'Amigos' })}
    ${meCard(false)}
    <div class="soc-share-row"><button class="btn soc-share" data-sact="share-code">${I.copy}<span>Compartir mi ID</span></button><button class="btn soc-share" data-sact="my-qr"><span class="qr-ic" aria-hidden="true">▦</span><span>Mi código QR</span></button></div>
    <div class="section">
      <div class="section-head"><h2>Añadir un amigo</h2></div>
      <form class="fr-search glass" data-sform="find">
        ${I.search}<input name="q" placeholder="Nick o ID (BU-…)" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Nick o ID de amigo" value="${esc((SOC.found && SOC.found.q) || '')}">
        <button class="btn small primary" type="submit">Buscar</button>
      </form>
      ${foundCard()}
    </div>
    ${F.incoming.length ? `<div class="section"><div class="section-head"><h2>Solicitudes · ${F.incoming.length}</h2></div><ul class="fr-list glass">${F.incoming.map(f => friendRow(f, 'in')).join('')}</ul></div>` : ''}
    <div class="section"><div class="section-head"><h2>Tus amigos${F.list.length ? ' · ' + F.list.length : ''}</h2></div>
      ${F.list.length ? `<ul class="fr-list glass">${F.list.map(f => friendRow(f, 'friend')).join('')}</ul>` : emptyBox('Aún no tienes amigos en Boldup. Búscalos por su nick o comparte tu ID para que te añadan.')}</div>
    ${F.outgoing.length ? `<div class="section"><div class="section-head"><h2>Enviadas · ${F.outgoing.length}</h2></div><ul class="fr-list glass">${F.outgoing.map(f => friendRow(f, 'out')).join('')}</ul></div>` : ''}
    <p class="hint">Solo tus amigos pueden entrar en tus proyectos compartidos. Nadie ve tus tareas personales: solo lo que pongáis en los proyectos de equipo.</p>
  </div>`;
}
async function findFriend(q) {
  q = q.trim();
  if (!q) return;
  SOC.found = { q, loading: true }; socRefresh();
  try { const r = await rpc('find_user', { q }); SOC.found = { q, user: r[0] || null }; }
  catch (e) { SOC.found = { q, error: niceErr(e) }; }
  socRefresh();
}
async function friendAction(fn, msg) {
  try { await fn(); if (msg) toast(msg); haptic(); }
  catch (e) { toast(niceErr(e)); }
  await loadFriends().catch(() => {});
  socBadge(); socRefresh();
}
function profileSheet() {
  const p = SOC.profile;
  openModal('Tu perfil', `
    <div class="field">Nombre visible<input type="text" name="display" value="${esc(p.display_name || '')}" maxlength="40" placeholder="${esc(p.username)}"></div>
    <div class="field">Avatar${avatarGrid(p)}</div>
    <div class="field">Color${colorField('color', p.color || userColor(p))}</div>
    <div class="sheet-list"><button type="button" class="sheet-item" data-modal="nick">${I.gear}<span>Cambiar nick (@${esc(p.username)})</span></button></div>`, {
    onSave: d => {
      const body = { display_name: d.display.trim() || null, color: readColor(d, 'color') };
      if (d.avatar !== '@photo') { body.avatar = d.avatar || null; if (p.photo) { body.photo = null; dropPhotoFile(p.photo); } }
      if (body.color && !/^#[0-9a-f]{6}$/i.test(body.color)) body.color = null;
      saveProfile(body).then(() => toast('Perfil guardado'), e => toast(niceErr(e)));
    },
    actions: { nick: () => { modal.close(); setTimeout(() => openNickDialog({ change: true }), 250); } },
  });
}

/* ---------- Un proyecto compartido ---------- */
const TEAM_TABS = [['tablero', 'Tablero'], ['chat', 'Chat'], ['objetivos', 'Objetivos'], ['calendario', 'Calendario'], ['actividad', 'Actividad']];
const REACTS = ['🎉', '👏', '🔥', '❤️', '💪', '😂'];
const PRIO = [[0, 'Normal'], [1, 'Importante'], [2, 'Urgente']];
const snapOf = pid => SOC.snaps[pid] || null;
const memberOf = (S, id) => S && id ? S.members.find(m => m.id === id) || null : null;
const colOf = (S, id) => S.columns.find(c => c.id === id) || null;
const doneCol = S => S.columns.find(c => c.is_done) || null;
const firstCol = S => S.columns.find(c => !c.is_done) || S.columns[0] || null;
const isMine = t => t.assignee && t.assignee === socUid();
const lateTask = t => !t.done_at && t.due && t.due < todayStr();
function dueChip(t) {
  if (!t.due) return '';
  const n = daysUntil(t.due), k = t.done_at ? '' : n < 0 ? 'late' : n <= 2 ? 'soon' : '';
  return `<span class="tb-due ${k}">${I.cal}${esc(relDay(t.due))}</span>`;
}
function tbCard(S, t) {
  const who = memberOf(S, t.assignee), g = t.goal_id && S.goals.find(x => x.id === t.goal_id);
  const cl = Array.isArray(t.checklist) ? t.checklist : [], clDone = cl.filter(x => x.done).length;
  return `<div class="tb-card ${t.done_at ? 'done' : ''} ${isMine(t) ? 'mine' : ''} prio-${t.priority || 0}" data-tid="${t.id}" tabindex="0" role="button" aria-label="${esc(t.title)}">
    <button class="tb-check ${t.done_at ? 'on' : ''}" data-sact="t-done" data-id="${t.id}" aria-label="${t.done_at ? 'Marcar como pendiente' : 'Completar'} ${esc(t.title)}">${I.check}</button>
    <div class="tb-body">
      <div class="tb-title">${t.priority ? `<span class="tb-prio">${t.priority === 2 ? 'Urgente' : 'Importante'}</span>` : ''}${esc(t.title)}</div>
      ${(t.due || g || t.comments || t.notes || cl.length) ? `<div class="tb-meta">${dueChip(t)}${cl.length ? `<span class="tb-cl ${clDone === cl.length ? 'all' : ''}">☑ ${clDone}/${cl.length}</span>` : ''}${g ? `<span class="tb-goal">◎ ${esc(g.title)}</span>` : ''}${t.notes ? '<span class="tb-ic" title="Tiene notas">≡</span>' : ''}${t.comments ? `<span class="tb-ic">💬 ${t.comments}</span>` : ''}</div>` : ''}
    </div>
    ${who ? avatar(who, 'sm') : ''}
  </div>`;
}
function boardFilter(S, pid) {
  const f = SOC.filter[pid] || 'all';
  const pass = t => f === 'all' || (f === 'mine' ? isMine(t) : f === 'none' ? !t.assignee : t.assignee === f);
  return { f, pass };
}
function viewBoard(S, pid) {
  const { f, pass } = boardFilter(S, pid);
  const chips = [['all', 'Todas'], ['mine', 'Mías'], ['none', 'Sin asignar'], ...S.members.filter(m => m.id !== socUid()).map(m => [m.id, dispName(m)])];
  return `<div class="tb-filters chips-row" role="tablist">${chips.map(([v, l]) => `<button class="chip-btn ${f === v ? 'on' : ''}" data-sact="t-filter" data-v="${v}">${esc(l)}</button>`).join('')}</div>
  <div class="tb-board" data-pid="${pid}">
    ${S.columns.map(c => {
      const ts = S.tasks.filter(t => t.column_id === c.id).sort((a, b) => a.position - b.position), shown = ts.filter(pass);
      return `<section class="tb-col ${c.is_done ? 'is-done' : ''}" data-col="${c.id}">
        <header class="tb-col-h"><span class="tb-col-n">${c.is_done ? '✓ ' : ''}${esc(c.name)}</span><span class="tb-count">${ts.length}</span>
          <button class="icon-btn tb-col-menu" data-sact="col-menu" data-id="${c.id}" aria-label="Opciones de la lista ${esc(c.name)}">${I.more}</button></header>
        <div class="tb-list" data-col="${c.id}">${shown.map(t => tbCard(S, t)).join('')}${!shown.length ? `<div class="tb-empty">${ts.length ? 'Nada con este filtro' : c.is_done ? 'Arrastra aquí lo terminado' : 'Sin tarjetas'}</div>` : ''}</div>
        <form class="tb-add" data-sform="add-card" data-col="${c.id}"><input name="title" placeholder="+ Añadir tarjeta" aria-label="Añadir tarjeta a ${esc(c.name)}" maxlength="200" enterkeyhint="done"></form>
      </section>`;
    }).join('')}
    <section class="tb-col tb-newcol"><form data-sform="add-col"><input name="name" placeholder="+ Nueva lista" maxlength="40" aria-label="Nueva lista"></form></section>
  </div>
  <p class="hint">${matchMedia('(pointer: coarse)').matches ? 'Mantén pulsada una tarjeta para moverla a otra lista.' : 'Arrastra las tarjetas entre listas. Toca una para ver o cambiar sus detalles.'}</p>`;
}
function goalStats(S, g) {
  const ts = S.tasks.filter(t => t.goal_id === g.id), done = ts.filter(t => t.done_at).length;
  return { total: ts.length, done, pct: g.done_at ? 100 : ts.length ? Math.round(done / ts.length * 100) : 0 };
}
function viewTeamGoals(S) {
  const goals = S.goals.slice().sort((a, b) => (!!a.done_at - !!b.done_at) || ((a.due || '9') .localeCompare(b.due || '9')));
  return `<div class="section"><div class="section-head"><h2>Objetivos del proyecto</h2><button class="btn small" data-sact="goal-new">${I.plus}<span>Objetivo</span></button></div>
    ${goals.length ? `<ul class="tm-goals glass">${goals.map(g => {
      const s = goalStats(S, g), n = g.due && !g.done_at ? daysUntil(g.due) : null;
      return `<li class="tm-goal ${g.done_at ? 'done' : ''}">
        <button class="tb-check ${g.done_at ? 'on' : ''}" data-sact="goal-done" data-id="${g.id}" aria-label="${g.done_at ? 'Reabrir' : 'Marcar conseguido'} ${esc(g.title)}">${I.check}</button>
        <button class="tm-goal-b" data-sact="goal-edit" data-id="${g.id}"><b>${esc(g.title)}</b>
          <span class="small muted">${[s.total ? `${s.done} de ${s.total} tarjetas` : 'Sin tarjetas aún', n !== null && (n < 0 ? `<span class="warn-text">venció hace ${-n} d</span>` : n === 0 ? 'vence hoy' : `quedan ${n} días`)].filter(Boolean).join(' · ')}</span>
          ${progressBar(s.pct)}</button>
      </li>`;
    }).join('')}</ul>` : emptyBox('Los objetivos son las metas del equipo (por ejemplo, «Lanzar la web el 1 de marzo»). Luego, en cada tarjeta, elige a qué objetivo ayuda y verás el progreso aquí.')}
  </div>`;
}
function viewTeamCalendar(S, pid) {
  const today = todayStr(), cur = SOC.calMonth[pid] || today.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const first = `${cur}-01`, start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = {};
  S.tasks.forEach(t => { if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t); });
  S.goals.forEach(g => { if (g.due) (byDay[g.due] = byDay[g.due] || []).push({ goal: true, ...g }); });
  const mName = cap(dtf('es-ES', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)));
  const weeks = [];
  for (let i = 0; i < 6; i++) { const w = days.slice(i * 7, i * 7 + 7); if (i < 5 || w.some(d => d.startsWith(cur))) weeks.push(w); }
  /* Cronología: lo que tiene fechas en las próximas 4 semanas, con su barra de inicio a plazo */
  const from = addDays(startOfWeek(today), 0), span = 28, to = addDays(from, span - 1);
  const rows = S.tasks.filter(t => t.due && t.due >= from && (t.start_date || t.due) <= to)
    .sort((a, b) => (a.start_date || a.due).localeCompare(b.start_date || b.due) || a.due.localeCompare(b.due));
  return `<div class="section">
    <div class="tm-cal-head"><button class="icon-btn round" data-sact="cal-nav" data-n="-1" aria-label="Mes anterior">${I.left}</button><h2>${esc(mName)}</h2><button class="icon-btn round" data-sact="cal-nav" data-n="1" aria-label="Mes siguiente">${I.right}</button>${cur !== today.slice(0, 7) ? `<button class="btn small" data-sact="cal-nav" data-n="0">Hoy</button>` : ''}</div>
    <div class="tm-cal glass">
      <div class="tm-cal-dow">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span>${d}</span>`).join('')}</div>
      ${weeks.map(w => `<div class="tm-cal-w">${w.map(d => {
        const items = byDay[d] || [], out = !d.startsWith(cur);
        return `<button class="tm-day ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${items.length ? 'has' : ''}" data-sact="cal-day" data-date="${d}" aria-label="${esc(fmtLongDate(d))}${items.length ? `, ${items.length} cosas` : ''}">
          <span class="tm-dn">${Number(d.slice(8))}</span>
          <span class="tm-items">${items.slice(0, 3).map(t => t.goal ? `<i class="tm-it goal">◎ ${esc(t.title)}</i>` : `<i class="tm-it ${t.done_at ? 'done' : ''}" style="--c:${userColor(memberOf(S, t.assignee)) }">${esc(t.title)}</i>`).join('')}${items.length > 3 ? `<i class="tm-more">+${items.length - 3}</i>` : ''}</span>
          <span class="tm-dots">${items.slice(0, 4).map(t => `<i style="--c:${t.goal ? 'var(--orange)' : userColor(memberOf(S, t.assignee))}"></i>`).join('')}</span>
        </button>`;
      }).join('')}</div>`).join('')}
    </div>
  </div>
  <div class="section">
    <div class="section-head"><h2>Cronología · 4 semanas</h2></div>
    ${rows.length ? `<div class="tm-gantt glass" style="--n:${span}">
      <div class="tg-scale">${Array.from({ length: span }, (_, i) => { const d = addDays(from, i); return `<span class="${d === today ? 'today' : ''} ${dow(d) === 1 ? 'mon' : ''}">${dow(d) === 1 || i === 0 ? Number(d.slice(8)) : ''}</span>`; }).join('')}</div>
      ${rows.map(t => {
        const s = Math.max(0, daysBetween(from, t.start_date || t.due)), e = Math.min(span - 1, daysBetween(from, t.due));
        const who = memberOf(S, t.assignee);
        return `<div class="tg-row"><button class="tg-name" data-sact="t-open" data-id="${t.id}">${who ? avatar(who, 'xs') : ''}<span>${esc(t.title)}</span></button>
          <div class="tg-track"><span class="tg-bar ${t.done_at ? 'done' : ''} ${lateTask(t) ? 'late' : ''}" style="grid-column:${s + 1} / ${e + 2};--c:${userColor(who)}"></span>${daysBetween(from, today) >= 0 && daysBetween(from, today) < span ? `<span class="tg-now" style="grid-column:${daysBetween(from, today) + 1}"></span>` : ''}</div></div>`;
      }).join('')}
    </div>` : emptyBox('Pon fecha de inicio y plazo a las tarjetas y aquí verás quién hace qué y cuándo, como una línea de tiempo.')}
  </div>`;
}
const ACT_TXT = {
  project_created: a => `creó el proyecto`,
  project_renamed: a => `cambió el nombre a «${esc(a.title)}»`,
  project_archived: () => 'archivó el proyecto', project_restored: () => 'recuperó el proyecto',
  task_created: a => `añadió «${esc(a.title)}»`,
  task_done: a => `completó «${esc(a.title)}» 🎉`,
  task_reopened: a => `reabrió «${esc(a.title)}»`,
  task_moved: a => `movió «${esc(a.title)}» a ${esc((a.detail && a.detail.column) || 'otra lista')}`,
  task_deleted: a => `borró «${esc(a.title)}»`,
  task_due: a => `puso plazo a «${esc(a.title)}»${a.detail && a.detail.due ? ": " + esc(relDay(a.detail.due).toLowerCase()) : ""}`,
  goal_created: a => `creó el objetivo «${esc(a.title)}»`,
  goal_done: a => `consiguió el objetivo «${esc(a.title)}» 🏁`,
  goal_deleted: a => `borró el objetivo «${esc(a.title)}»`,
  comment: a => `comentó en «${esc(a.title)}»: <span class="muted">${esc(a.detail && a.detail.body)}</span>`,
};
function actText(S, a) {
  if (a.kind === 'task_assigned') { const to = memberOf(S, a.detail && a.detail.to); return to ? `asignó «${esc(a.title)}» a ${to.id === a.user_id ? 'sí mismo' : esc(dispName(to))}` : `dejó «${esc(a.title)}» sin asignar`; }
  if (/^member_/.test(a.kind)) {
    const u = memberOf(S, a.detail && a.detail.user) || { username: 'alguien' };
    return a.kind === 'member_added' ? `añadió a ${esc(dispName(u))}` : a.kind === 'member_left' ? 'salió del proyecto' : `quitó a ${esc(dispName(u))}`;
  }
  return (ACT_TXT[a.kind] || (() => esc(a.kind)))(a);
}
function viewTeamActivity(S) {
  const owner = S.project.owner === socUid();
  return `<div class="section"><div class="section-head"><h2>Equipo · ${S.members.length}</h2><button class="btn small" data-sact="invite">${I.plus}<span>Invitar</span></button></div>
    <ul class="fr-list glass">${S.members.map(m => {
      const open = S.tasks.filter(t => t.assignee === m.id && !t.done_at).length, done = S.tasks.filter(t => t.assignee === m.id && t.done_at).length;
      return `<li class="fr-row">${avatar(m)}<span class="fr-t"><b${nameStyle(m)}>${esc(dispName(m))}${m.id === socUid() ? ' (tú)' : ''}</b><span>@${esc(m.username)} · ${open} pendiente${open === 1 ? '' : 's'} · ${done} hecha${done === 1 ? '' : 's'}${m.role === 'owner' ? ' · creador' : ''}</span></span>
        <span class="fr-a">${m.id !== socUid() ? `<button class="btn small ghost" data-sact="t-filter-go" data-v="${m.id}">Ver sus tarjetas</button>${owner ? `<button class="icon-btn" data-sact="member-remove" data-id="${m.id}" aria-label="Quitar a ${esc(dispName(m))}">${I.close}</button>` : ''}` : ''}</span></li>`;
    }).join('')}</ul></div>
    ${streakCard(S)}
    <div class="section"><div class="section-head"><h2>Actividad</h2></div>
    ${S.activity.length ? `<ul class="tm-feed glass">${S.activity.map(a => {
      const who = memberOf(S, a.user_id) || { username: 'alguien', id: a.user_id };
      return `<li data-aid="${a.id}">${avatar(who, 'sm')}<span class="tm-feed-t"><b>${esc(a.user_id === socUid() ? 'Tú' : dispName(who))}</b> ${actText(S, a)}<span class="tm-when">${agoShort(a.created_at)}</span>${reactBar(S, a)}</span></li>`;
    }).join('')}</ul>` : emptyBox('Aquí verás lo que va haciendo cada uno.')}
    </div>`;
}
function streakCard(S) {
  const st = teamStreak(S.done_days);
  const msg = st.cur >= 2 ? (st.today ? `¡${st.cur} días seguidos! Mañana, a por el ${st.cur + 1}.` : `Lleváis ${st.cur} días seguidos: terminad algo hoy para no perder la racha.`)
    : st.cur === 1 ? (st.today ? 'Hoy ya habéis terminado algo. Repetid mañana y empezáis racha.' : 'Ayer terminasteis algo: si hoy también, ya es racha.')
    : 'Terminad al menos una tarjeta al día, entre todos, para empezar una racha.';
  return `<div class="section"><div class="tm-streak-card glass">
    <div class="tm-streak-n"><span class="tm-streak-fire ${st.cur ? 'on' : ''}">🔥</span><b>${st.cur}</b><span>${st.cur === 1 ? 'día' : 'días'}</span></div>
    <div class="tm-streak-t"><b>Racha del equipo</b><span>${msg}</span>
      <span class="tm-streak-days" aria-label="Últimos 14 días">${st.last14.map(x => `<i class="${x.on ? 'on' : ''} ${x.d === todayStr() ? 'today' : ''}" title="${esc(fmtShortDate(x.d))}"></i>`).join('')}</span>
      ${st.best > st.cur ? `<span class="muted small">Mejor racha: ${st.best} días</span>` : ''}</div>
  </div></div>`;
}
function reactBar(S, a) {
  const rs = (S.reactions || []).filter(r => r.a === a.id), me = socUid();
  const counts = REACTS.map(e => ({ e, n: rs.filter(r => r.e === e).length, mine: rs.some(r => r.e === e && r.u === me), who: rs.filter(r => r.e === e).map(r => dispName(memberOf(S, r.u))).join(', ') })).filter(x => x.n);
  const celebrate = /^(task_done|goal_done|goal_created|project_created|member_added)$/.test(a.kind) || counts.length;
  if (!celebrate) return '';
  return `<span class="tm-reacts">${counts.map(x => `<button class="tm-react ${x.mine ? 'mine' : ''}" data-sact="react" data-aid="${a.id}" data-e="${x.e}" title="${esc(x.who)}" aria-label="${x.e} ${x.n}${x.mine ? ', quitar la tuya' : ''}">${x.e}<b>${x.n}</b></button>`).join('')}<span class="tm-react-add"><button class="tm-react plus" data-sact="react-pick" aria-label="Reaccionar">＋</button><span class="tm-react-pick">${REACTS.map(e => `<button data-sact="react" data-aid="${a.id}" data-e="${e}" aria-label="Reaccionar con ${e}">${e}</button>`).join('')}</span></span></span>`;
}
function toggleReact(pid, aid, e) {
  const S = snapOf(pid); if (!S) return;
  const me = socUid(), mine = (S.reactions || []).some(r => r.a === aid && r.u === me && r.e === e);
  haptic(8);
  mutate(pid, S2 => { S2.reactions = mine ? S2.reactions.filter(r => !(r.a === aid && r.u === me && r.e === e)) : [...(S2.reactions || []), { a: aid, u: me, e }]; },
    () => mine ? rest(`team_reactions?activity_id=eq.${aid}&user_id=eq.${me}&emoji=eq.${encodeURIComponent(e)}`, { method: 'DELETE' })
      : rest('team_reactions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { activity_id: aid, project_id: pid, emoji: e } })).catch(() => {});
}
/* ---------- Chat del equipo ---------- */
function viewTeamChat(S, pid) {
  const msgs = S.messages || [], me = socUid();
  if (msgs.length) markChatSeen(pid, msgs[msgs.length - 1].created_at);
  let prevDay = '', prevUser = '', prevT = 0;
  const rows = msgs.map(m => {
    const day = localDay(m.created_at), t = Date.parse(m.created_at), mine = m.user_id === me, who = memberOf(S, m.user_id) || { username: 'alguien', id: m.user_id };
    const sep = day !== prevDay ? `<li class="tm-chat-day"><span>${esc(relDay(day))}</span></li>` : '';
    const cont = day === prevDay && prevUser === m.user_id && t - prevT < 5 * 60000;
    prevDay = day; prevUser = m.user_id; prevT = t;
    const hm = new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${sep}<li class="tm-msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}">${mine ? '' : cont ? '<span class="tm-msg-sp"></span>' : avatar(who, 'sm')}
      <div class="tm-bubble" ${mine ? 'data-sact="msg-sel"' : ''}>${!mine && !cont ? `<b${nameStyle(who)}>${esc(dispName(who))}</b>` : ''}<span class="tm-msg-t">${esc(m.body)}</span><span class="tm-msg-h">${hm}</span>${mine ? `<button class="tm-msg-del" data-sact="chat-del" data-id="${m.id}" aria-label="Borrar mensaje">${I.close}</button>` : ''}</div></li>`;
  }).join('');
  return `<div class="section tm-chat glass">
    <ul class="tm-chat-list">${rows || `<li class="tm-chat-empty">Aquí podéis hablar del proyecto sin salir de Boldup.<br><span class="muted small">Solo lo ven los miembros. Los mensajes tardan unos segundos en llegar a los demás.</span></li>`}</ul>
    <form class="tm-chat-form" data-sform="chat"><input id="tm-chat-in" name="body" placeholder="Escribe al equipo…" maxlength="1000" autocomplete="off" enterkeyhint="send" aria-label="Mensaje para el equipo"><button class="btn primary small" type="submit" aria-label="Enviar">Enviar</button></form>
  </div>`;
}
function viewTeam(pid, sub) {
  const back = backLink('#proyectos', 'Con amigos');
  const gate = socGate();
  if (gate) return `<div class="page">${pageHead({ eyebrow: back, title: 'Proyecto compartido' })}${gate}</div>`;
  const S = snapOf(pid);
  if (S === null || S === undefined) {
    teamPoll(pid);
    return `<div class="page">${pageHead({ eyebrow: back, title: 'Cargando…' })}${SOC.errors['team:' + pid] ? socNotice('Sin conexión', esc(SOC.errors['team:' + pid]), `<button class="btn" data-sact="soc-retry">Reintentar</button>`) : `<div class="soc-loading glass"><span class="spin"></span>Abriendo el tablero…</div>`}</div>`;
  }
  if (!S) return `<div class="page">${pageHead({ eyebrow: back, title: 'No encontrado' })}${emptyBox('Este proyecto ya no existe o ya no eres miembro.')}</div>`;
  const p = S.project, tab = TEAM_TABS.some(([v]) => v === sub) ? sub : 'tablero';
  if (S.activity[0]) markSeen(pid, S.activity[0].id);
  const total = S.tasks.length, done = S.tasks.filter(t => t.done_at).length, left = total - done;
  const mine = S.tasks.filter(t => isMine(t) && !t.done_at), late = S.tasks.filter(lateTask).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const nextMine = mine.slice().sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
  const body = tab === 'objetivos' ? viewTeamGoals(S) : tab === 'calendario' ? viewTeamCalendar(S, pid) : tab === 'actividad' ? viewTeamActivity(S) : tab === 'chat' ? viewTeamChat(S, pid) : viewBoard(S, pid);
  const lastOther = (S.messages || []).filter(m => m.user_id !== socUid()).map(m => m.created_at).pop();
  const unread = tab !== 'chat' && chatUnread(pid, lastOther), st = teamStreak(S.done_days);
  return `<div class="page page-team ${tab === 'tablero' ? 'is-board' : ''} ${tab === 'chat' ? 'is-chat' : ''}" style="--c:${p.color || '#4a72cf'}">
    ${pageHead({ eyebrow: back, title: `${p.icon ? `<span class="h1-emoji">${esc(p.icon)}</span> ` : ''}${esc(p.name)}`, actions: `<button class="btn tm-invite" data-sact="invite" aria-label="Invitar">${avStack(S.members, 3, 'xs')}<span>${I.plus}</span></button><button class="icon-btn pj-more" data-sact="team-menu" aria-label="Más opciones">${I.more}</button>` })}
    <section class="pj-hero glass tm-hero">
      <div class="pj-hero-main">
        ${projRing({ done, total, pct }, 'lg')}
        <div class="pj-hero-text">
          <div class="pj-hero-t">${!total ? 'Tablero vacío' : !left ? '¡Todo hecho!' : `Quedan ${left} tarjeta${left === 1 ? '' : 's'}`}</div>
          ${stateLine(late ? { k: 'warn', txt: `${late} atrasada${late === 1 ? '' : 's'}` } : mine.length ? { k: 'soon', txt: `${mine.length} para ti` } : { k: total ? 'go' : 'idle', txt: total ? 'En marcha' : 'Añadid la primera tarjeta' })}
          ${st.cur >= 1 ? `<button class="tm-hero-streak" data-sact="team-tab" data-v="actividad">🔥 Racha de ${st.cur} día${st.cur === 1 ? '' : 's'}${st.today ? '' : ' · ¡terminad algo hoy!'}</button>` : ''}
          ${nextMine ? `<button class="tm-next" data-sact="t-open" data-id="${nextMine.id}">Lo tuyo ahora: <b>${esc(nextMine.title)}</b>${nextMine.due ? ` · ${esc(relDay(nextMine.due).toLowerCase())}` : ''}</button>` : `<div class="pj-hero-l">${S.members.length} miembro${S.members.length === 1 ? '' : 's'} · ${S.goals.length} objetivo${S.goals.length === 1 ? '' : 's'}</div>`}
        </div>
      </div>
      ${p.description ? `<div class="pj-notes">${esc(p.description)}</div>` : ''}
    </section>
    <div class="segmented pj-tabs tm-tabs" role="tablist">${TEAM_TABS.map(([v, l]) => `<button role="tab" class="${tab === v ? 'on' : ''}" data-sact="team-tab" data-v="${v}">${l}${v === 'objetivos' && S.goals.length ? ' · ' + S.goals.length : ''}${v === 'chat' && unread ? '<i class="tm-tab-dot" aria-label="mensajes nuevos"></i>' : ''}</button>`).join('')}</div>
    ${body}
  </div>`;
}

/* ---------- Cambios en el tablero (se ven al momento y se guardan detrás) ---------- */
const curPid = () => { const r = parseHash(); return r.name === 'equipo' ? r.id : null; };
async function mutate(pid, local, remote, okMsg) {
  const S = snapOf(pid);
  if (S && local) local(S);
  socRefresh();
  try { const r = await remote(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(niceErr(e)); throw e; }
  finally { await loadTeam(pid).catch(() => {}); socRefresh(); }
}
function patchTask(pid, tid, ch, msg) {
  return mutate(pid, S => { const t = S.tasks.find(x => x.id === tid); if (t) Object.assign(t, ch); },
    () => rest(`team_tasks?id=eq.${tid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: ch }), msg).catch(() => {});
}
function setTaskDone(pid, tid, on) {
  const S = snapOf(pid), t = S && S.tasks.find(x => x.id === tid);
  if (!t) return;
  const dc = doneCol(S), fc = firstCol(S), cur = colOf(S, t.column_id);
  const ch = { done_at: on ? new Date().toISOString() : null };
  if (on && dc && t.column_id !== dc.id) { ch.column_id = dc.id; ch.position = maxPos(S, dc.id) + 1; }
  if (!on && cur && cur.is_done && fc) { ch.column_id = fc.id; ch.position = maxPos(S, fc.id) + 1; }
  haptic(on ? 12 : 6);
  patchTask(pid, tid, ch);
  if (on) toast('¡Tarjeta completada!', { action: 'Deshacer', onAction: () => patchTask(pid, tid, { done_at: null, column_id: t.column_id, position: t.position }) });
}
const maxPos = (S, col) => S.tasks.filter(t => t.column_id === col).reduce((m, t) => Math.max(m, t.position || 0), 0);
function addCard(pid, col, title, extra = {}) {
  const S = snapOf(pid); if (!S || !title.trim()) return;
  const row = { id: newId(), project_id: pid, column_id: col, title: title.trim().slice(0, 200), position: maxPos(S, col) + 1, ...extra };
  if (SOC.filter[pid] === 'mine' && !('assignee' in extra)) row.assignee = socUid();
  return mutate(pid, S2 => S2.tasks.push({ ...row, comments: 0, priority: 0, created_by: socUid(), created_at: new Date().toISOString(), done_at: colOf(S2, col) && colOf(S2, col).is_done ? new Date().toISOString() : null }),
    () => rest('team_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row })).catch(() => {});
}
function cardSheet(pid, tid) {
  const S = snapOf(pid), t = S && S.tasks.find(x => x.id === tid);
  if (!t) return;
  const by = memberOf(S, t.created_by);
  const radio = (name, v, cur, label, extra = '') => `<label class="chip-radio ${extra}"><input type="radio" name="${name}" value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'checked' : ''}><span>${label}</span></label>`;
  openModal('Tarjeta', `
    <div class="field"><textarea name="title" rows="2" maxlength="200" class="tb-title-in" aria-label="Título" required>${esc(t.title)}</textarea></div>
    <div class="field">Lista<div class="chips-row wrap">${S.columns.map(c => radio('column', c.id, t.column_id, (c.is_done ? '✓ ' : '') + esc(c.name))).join('')}</div></div>
    <div class="field">¿Quién la hace?<div class="chips-row wrap">${radio('assignee', '', t.assignee, 'Nadie aún')}${S.members.map(m => radio('assignee', m.id, t.assignee, `${avatar(m, 'xs')} ${esc(m.id === socUid() ? 'Yo' : dispName(m))}`, 'with-av')).join('')}</div></div>
    <div class="row"><label class="field">Empieza<input type="date" name="start_date" value="${esc(t.start_date || '')}"></label><label class="field">Plazo<input type="date" name="due" value="${esc(t.due || '')}"></label></div>
    <div class="field">Prioridad<div class="chips-row">${PRIO.map(([v, l]) => radio('priority', v, t.priority || 0, l)).join('')}</div></div>
    ${S.goals.length ? `<div class="field">Ayuda al objetivo<div class="chips-row wrap">${radio('goal', '', t.goal_id, 'Ninguno')}${S.goals.map(g => radio('goal', g.id, t.goal_id, '◎ ' + esc(g.title))).join('')}</div></div>` : ''}
    <div class="field">Notas<textarea name="notes" rows="3" maxlength="5000" placeholder="Detalles, enlaces, lo que haga falta saber…">${esc(t.notes || '')}</textarea></div>
    <div class="field">Pasos<div class="tb-cl-list" id="tb-cl">${checklistHTML(t)}</div>
      <div class="tb-cbox"><input type="text" id="tb-clin" placeholder="Añadir un paso…" maxlength="200" data-enter="cl-add" aria-label="Nuevo paso"><button type="button" class="btn small" data-modal="cl-add">Añadir</button></div></div>
    <div class="field">Comentarios<div class="tb-comments" id="tb-comments"><div class="muted small">Cargando…</div></div>
      <div class="tb-cbox"><input type="text" id="tb-cin" placeholder="Escribe un comentario…" maxlength="2000" data-enter="comment" aria-label="Comentario"><button type="button" class="btn small" data-modal="comment">Enviar</button></div></div>
    <p class="hint">Creada ${by ? `por ${esc(dispName(by))} ` : ''}${agoShort(t.created_at)}${t.updated_at && t.updated_by ? ` · último cambio de ${esc(dispName(memberOf(S, t.updated_by)))} ${agoShort(t.updated_at)}` : ''}</p>`, {
    onSave: d => {
      const ch = {};
      const title = d.title.trim(); if (!title) { toast('Ponle un título'); return false; }
      if (title !== t.title) ch.title = title;
      if ((d.notes || '') !== (t.notes || '')) ch.notes = d.notes.trim() || null;
      if (d.column !== t.column_id) { ch.column_id = d.column; ch.position = maxPos(S, d.column) + 1; }
      if ((d.assignee || null) !== (t.assignee || null)) ch.assignee = d.assignee || null;
      if ((d.start_date || null) !== (t.start_date || null)) ch.start_date = d.start_date || null;
      if ((d.due || null) !== (t.due || null)) ch.due = d.due || null;
      if (ch.start_date !== undefined || ch.due !== undefined) {
        const s = ch.start_date !== undefined ? ch.start_date : t.start_date, e = ch.due !== undefined ? ch.due : t.due;
        if (s && e && s > e) { toast('El inicio no puede ser después del plazo'); return false; }
      }
      if (Number(d.priority || 0) !== (t.priority || 0)) ch.priority = Number(d.priority || 0);
      if ('goal' in d && (d.goal || null) !== (t.goal_id || null)) ch.goal_id = d.goal || null;
      if (Object.keys(ch).length) patchTask(pid, tid, ch);
    },
    onDelete: () => {
      if (t.comments && !confirm('¿Borrar esta tarjeta y sus comentarios?')) return false;
      const copy = { ...t }; delete copy.comments;
      ['created_at', 'updated_at', 'updated_by', 'created_by'].forEach(k => delete copy[k]);
      mutate(pid, S2 => { S2.tasks = S2.tasks.filter(x => x.id !== tid); }, () => rest(`team_tasks?id=eq.${tid}`, { method: 'DELETE' })).then(() => {
        toast('Tarjeta borrada', { action: 'Deshacer', onAction: () => mutate(pid, S3 => S3.tasks.push({ ...copy, comments: 0 }), () => rest('team_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: copy })).catch(() => {}) });
      }, () => {});
    },
    deleteLabel: 'Borrar tarjeta',
    actions: {
      comment: () => postComment(pid, tid),
      'cl-add': () => { const inp = $('#tb-clin'), v = inp.value.trim(); if (!v) return; inp.value = ''; setChecklist(pid, tid, l => [...l, { id: newId().slice(0, 8), text: v.slice(0, 200), done: false }]); inp.focus(); },
      'cl-del': el => setChecklist(pid, tid, l => l.filter(x => x.id !== el.dataset.cl)),
    },
  });
  modalForm.addEventListener('change', clToggle);
  function clToggle(e) {
    if (!e.target.matches('input[data-cl]')) return;
    if (!modal.open) { modalForm.removeEventListener('change', clToggle); return; }
    const id = e.target.dataset.cl, on = e.target.checked;
    setChecklist(pid, tid, l => l.map(x => x.id === id ? { ...x, done: on } : x));
  }
  modal.addEventListener('close', () => modalForm.removeEventListener('change', clToggle), { once: true });
  loadComments(pid, tid);
}
function checklistHTML(t) {
  const l = Array.isArray(t.checklist) ? t.checklist : [];
  if (!l.length) return '<div class="muted small">Divide la tarjeta en pasos pequeños: se ve el avance en el tablero.</div>';
  const d = l.filter(x => x.done).length;
  return `<div class="tb-cl-bar">${progressBar(Math.round(d / l.length * 100))}<span class="small muted">${d}/${l.length}</span></div>` + l.map(x => `<label class="tb-cl-row ${x.done ? 'done' : ''}"><input type="checkbox" class="check" data-cl="${esc(x.id)}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}</span><button type="button" class="tb-c-del" data-modal="cl-del" data-cl="${esc(x.id)}" aria-label="Quitar paso">${I.close}</button></label>`).join('');
}
function setChecklist(pid, tid, fn) {
  const S = snapOf(pid), t = S && S.tasks.find(x => x.id === tid); if (!t) return;
  const next = fn(Array.isArray(t.checklist) ? t.checklist : []).slice(0, 50);
  t.checklist = next;
  const box = $('#tb-cl'); if (box) box.innerHTML = checklistHTML(t);
  haptic(6);
  rest(`team_tasks?id=eq.${tid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { checklist: next } }).then(() => socRefresh(), e => toast(niceErr(e)));
}
async function loadComments(pid, tid) {
  const box = $('#tb-comments'); if (!box) return;
  try {
    const rows = await rest(`team_comments?select=*&task_id=eq.${tid}&order=created_at.asc`);
    const S = snapOf(pid), b = $('#tb-comments'); if (!b) return;
    b.innerHTML = rows.length ? rows.map(c => { const u = memberOf(S, c.user_id) || { username: 'alguien', id: c.user_id }; return `<div class="tb-c">${avatar(u, 'xs')}<div><b>${esc(c.user_id === socUid() ? 'Tú' : dispName(u))}</b> <span class="muted small">${agoShort(c.created_at)}</span>${c.user_id === socUid() ? `<button type="button" class="tb-c-del" data-modal="cdel" data-cid="${c.id}" aria-label="Borrar comentario">${I.close}</button>` : ''}<div class="tb-c-t">${esc(c.body)}</div></div></div>`; }).join('')
      : '<div class="muted small">Aún no hay comentarios. Pregunta, avisa o anima al equipo.</div>';
    if (modalOpts && modalOpts.actions) modalOpts.actions.cdel = el => rest(`team_comments?id=eq.${el.dataset.cid}`, { method: 'DELETE' }).then(() => { const t = S.tasks.find(x => x.id === tid); if (t) t.comments = Math.max(0, (t.comments || 1) - 1); loadComments(pid, tid); }, e => toast(niceErr(e)));
  } catch (e) { const b = $('#tb-comments'); if (b) b.innerHTML = `<div class="muted small">${esc(niceErr(e))}</div>`; }
}
async function postComment(pid, tid) {
  const inp = $('#tb-cin'); if (!inp) return;
  const body = inp.value.trim(); if (!body) return;
  inp.value = ''; inp.disabled = true;
  try {
    await rest('team_comments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { task_id: tid, project_id: pid, user_id: socUid(), body } });
    const t = snapOf(pid).tasks.find(x => x.id === tid); if (t) t.comments = (t.comments || 0) + 1;
    haptic(); loadComments(pid, tid);
  } catch (e) { toast(niceErr(e)); inp.value = body; }
  inp.disabled = false; inp.focus();
}
function goalSheet(pid, g0) {
  const g = g0 || {};
  openModal(g.id ? 'Objetivo' : 'Nuevo objetivo', `
    <div class="field"><input type="text" name="title" value="${esc(g.title || '')}" placeholder="Ej.: Tener la web publicada" maxlength="140" required aria-label="Objetivo"></div>
    <div class="field">Fecha meta<input type="date" name="due" value="${esc(g.due || '')}"></div>
    <div class="field">Notas<textarea name="notes" rows="3" maxlength="2000" placeholder="Qué significa «conseguido»">${esc(g.notes || '')}</textarea></div>`, {
    onSave: d => {
      const body = { title: d.title.trim(), due: d.due || null, notes: d.notes.trim() || null };
      if (!body.title) return false;
      if (g.id) mutate(pid, S => Object.assign(S.goals.find(x => x.id === g.id) || {}, body), () => rest(`team_goals?id=eq.${g.id}`, { method: 'PATCH', body })).catch(() => {});
      else { const S = snapOf(pid), row = { id: newId(), project_id: pid, position: (S.goals.length + 1), ...body }; mutate(pid, S2 => S2.goals.push(row), () => rest('team_goals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row })).catch(() => {}); }
    },
    onDelete: g.id ? () => { mutate(pid, S => { S.goals = S.goals.filter(x => x.id !== g.id); S.tasks.forEach(t => { if (t.goal_id === g.id) t.goal_id = null; }); }, () => rest(`team_goals?id=eq.${g.id}`, { method: 'DELETE' })).catch(() => {}); } : null,
    deleteLabel: 'Borrar objetivo',
  });
}
function colMenu(pid, cid) {
  const S = snapOf(pid), c = colOf(S, cid); if (!c) return;
  const i = S.columns.indexOf(c), n = S.tasks.filter(t => t.column_id === cid).length;
  const swap = j => { const o = S.columns[j]; if (!o) return; const a = c.position, b = o.position === a ? a + (j > i ? 1 : -1) : o.position;
    mutate(pid, S2 => { colOf(S2, cid).position = b; colOf(S2, o.id).position = a; S2.columns.sort((x, y) => x.position - y.position); },
      () => Promise.all([rest(`team_columns?id=eq.${cid}`, { method: 'PATCH', body: { position: b } }), rest(`team_columns?id=eq.${o.id}`, { method: 'PATCH', body: { position: a } })])).catch(() => {}); };
  actionSheet(c.name, [
    ['Renombrar', I.gear, () => openModal('Renombrar lista', `<div class="field"><input type="text" name="name" value="${esc(c.name)}" maxlength="40" required aria-label="Nombre"></div>`, { onSave: d => { const name = d.name.trim(); if (name) mutate(pid, S2 => { colOf(S2, cid).name = name; }, () => rest(`team_columns?id=eq.${cid}`, { method: 'PATCH', body: { name } })).catch(() => {}); } })],
    [c.is_done ? 'Ya no es la lista de «hecho»' : 'Usar como lista de «hecho»', I.check, () => mutate(pid, S2 => { colOf(S2, cid).is_done = !c.is_done; }, () => rest(`team_columns?id=eq.${cid}`, { method: 'PATCH', body: { is_done: !c.is_done } }), c.is_done ? null : 'Lo que llegue aquí contará como hecho').catch(() => {})],
    ...(i > 0 ? [['Mover a la izquierda', I.left, () => swap(i - 1)]] : []),
    ...(i < S.columns.length - 1 ? [['Mover a la derecha', I.right, () => swap(i + 1)]] : []),
    ['Borrar lista', I.trash, () => {
      if (S.columns.length <= 1) { toast('El tablero necesita al menos una lista'); return; }
      const dest = S.columns.find(x => x.id !== cid && !x.is_done) || S.columns.find(x => x.id !== cid);
      if (n && !confirm(`Las ${n} tarjetas de «${c.name}» pasarán a «${dest.name}». ¿Borrar la lista?`)) return;
      mutate(pid, S2 => { S2.tasks.forEach(t => { if (t.column_id === cid) t.column_id = dest.id; }); S2.columns = S2.columns.filter(x => x.id !== cid); },
        async () => { if (n) await rest(`team_tasks?column_id=eq.${cid}`, { method: 'PATCH', body: { column_id: dest.id } }); await rest(`team_columns?id=eq.${cid}`, { method: 'DELETE' }); }).catch(() => {});
    }],
  ]);
}
function teamMenu(pid) {
  const S = snapOf(pid); if (!S) return;
  const p = S.project, owner = p.owner === socUid();
  actionSheet(`${p.icon || ''} ${p.name}`.trim(), [
    ['Editar proyecto', I.gear, () => teamSheet(S)],
    ['Invitar amigos', I.plus, () => inviteSheet(pid)],
    [p.archived_at ? 'Recuperar de archivados' : 'Archivar proyecto', I.archive, () => mutate(pid, S2 => { S2.project.archived_at = p.archived_at ? null : new Date().toISOString(); },
      () => rest(`team_projects?id=eq.${pid}`, { method: 'PATCH', body: { archived_at: p.archived_at ? null : new Date().toISOString() } }), p.archived_at ? 'Proyecto recuperado' : 'Proyecto archivado para todos').then(() => { SOC.teams = null; }, () => {})],
    ['Salir del proyecto', I.left, () => {
      if (!confirm(S.members.length === 1 ? 'Eres el único miembro: si sales, el proyecto se borrará. ¿Salir?' : `¿Salir de «${p.name}»? Tus tarjetas quedarán sin asignar.${owner ? ' El proyecto pasará al miembro más antiguo.' : ''}`)) return;
      rpc('remove_team_member', { pid, target: null }).then(() => { delete SOC.snaps[pid]; SOC.teams = null; toast('Has salido del proyecto'); location.hash = '#proyectos'; }, e => toast(niceErr(e)));
    }],
    ...(owner ? [['Borrar proyecto para todos', I.trash, () => {
      if (!confirm(`¿Borrar «${p.name}» y todas sus tarjetas para todo el equipo? No se puede deshacer.`)) return;
      rest(`team_projects?id=eq.${pid}`, { method: 'DELETE' }).then(() => { delete SOC.snaps[pid]; SOC.teams = null; socSaveCache(); toast('Proyecto borrado'); location.hash = '#proyectos'; }, e => toast(niceErr(e)));
    }]] : []),
  ]);
}
/* Plantillas para no empezar con el tablero vacío */
const TEAM_TPLS = [
  { k: '', n: 'Vacío', i: '🚀' },
  { k: 'viaje', n: 'Viaje', i: '✈️', goals: ['Todo reservado'], cards: ['Elegir fechas', 'Reservar vuelos', 'Reservar alojamiento', 'Hacer presupuesto común', 'Lista de qué ver', 'Seguro de viaje', 'Hacer la maleta'] },
  { k: 'clase', n: 'Trabajo de clase', i: '📚', goals: ['Entregar el trabajo'], cards: ['Leer el enunciado juntos', 'Repartir apartados', 'Buscar fuentes', 'Primer borrador', 'Revisar y unir', 'Preparar la presentación'] },
  { k: 'evento', n: 'Evento o fiesta', i: '🎉', goals: ['Día del evento'], cards: ['Fecha y lugar', 'Lista de invitados', 'Enviar invitaciones', 'Comida y bebida', 'Música', 'Decoración'] },
  { k: 'casa', n: 'Mudanza o piso', i: '🏠', goals: ['Mudanza hecha'], cards: ['Conseguir cajas', 'Dar de alta luz e internet', 'Empaquetar cocina', 'Empaquetar ropa', 'Contratar furgoneta', 'Limpieza final'] },
  { k: 'negocio', n: 'Proyecto o negocio', i: '💼', goals: ['Primera versión lista'], cards: ['Definir la idea en una frase', 'Investigar competencia', 'Nombre y logo', 'Primer prototipo', 'Enseñarlo a 5 personas', 'Decidir siguientes pasos'] },
];
const TEAM_ICONS = ['🚀', '🎯', '🏠', '✈️', '🎉', '💼', '📚', '🎨', '🏋️', '🎵', '🌱', '💡'];
function teamSheet(S, pre = []) {
  const p = (S && S.project) || {};
  const friends = (SOC.friends && SOC.friends.list) || [];
  openModal(p.id ? 'Editar proyecto' : 'Proyecto con amigos', `
    <div class="field"><input type="text" name="name" value="${esc(p.name || '')}" placeholder="Ej.: Viaje a Japón, TFG, Mudanza…" maxlength="80" required aria-label="Nombre del proyecto"></div>
    <div class="field">Icono<div class="chips-row wrap">${TEAM_ICONS.map((e, i) => `<label class="chip-radio"><input type="radio" name="icon" value="${e}" ${(p.icon || TEAM_ICONS[0]) === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></div>
    <div class="field">Color${colorField('color', p.color || COLORS[0])}</div>
    <div class="field">De qué va<textarea name="description" rows="2" maxlength="2000" placeholder="La meta del equipo en una frase">${esc(p.description || '')}</textarea></div>
    ${p.id ? '' : `<div class="field">Empezar con<div class="chips-row wrap">${TEAM_TPLS.map((t, i) => `<label class="chip-radio"><input type="radio" name="tpl" value="${t.k}" data-icon="${t.i}" ${i === 0 ? 'checked' : ''}><span>${t.i} ${esc(t.n)}</span></label>`).join('')}</div><span class="hint">Las plantillas añaden unas tarjetas de ejemplo que podéis cambiar.</span></div>`}
    ${p.id ? '' : `<div class="field">¿Con quién?${friends.length ? `<div class="chips-row wrap">${friends.map(f => `<label class="chip-radio with-av"><input type="checkbox" name="member" value="${f.user.id}" ${pre.includes(f.user.id) ? 'checked' : ''}><span>${avatar(f.user, 'xs')} ${esc(dispName(f.user))}</span></label>`).join('')}</div>`
      : `<p class="hint">Aún no tienes amigos añadidos. Puedes crear el proyecto ahora e invitarles después desde <a href="#amigos">Amigos</a>.</p>`}</div>`}`, {
    saveLabel: p.id ? 'Guardar' : 'Crear',
    onSave: (d, fd) => {
      const name = d.name.trim(); if (!name) return false;
      const color = readColor(d, 'color'), body = { name, icon: d.icon || null, color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : null, description: d.description.trim() || null };
      if (p.id) { mutate(p.id, S2 => Object.assign(S2.project, body), () => rest(`team_projects?id=eq.${p.id}`, { method: 'PATCH', body })).then(() => { SOC.teams = null; }, () => {}); return; }
      const btn = $('button[type=submit]', modalForm); if (btn) btn.disabled = true;
      rpc('create_team_project', { p_name: body.name, p_icon: body.icon, p_color: body.color, p_description: body.description, p_members: fd.getAll('member') })
        .then(async pid => {
          const tpl = TEAM_TPLS.find(t => t.k === d.tpl);
          if (tpl && tpl.cards) {
            try {
              const snap = await rpc('team_snapshot', { pid }), col = snap && snap.columns.find(c => !c.is_done);
              if (col) await rest('team_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: tpl.cards.map((title, i) => ({ id: newId(), project_id: pid, column_id: col.id, title, position: i + 1 })) });
              if (tpl.goals) await rest('team_goals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: tpl.goals.map((title, i) => ({ id: newId(), project_id: pid, title, position: i + 1 })) });
            } catch (e) { /* el proyecto ya está creado: las tarjetas de ejemplo son un extra */ }
          }
          modal.close(); SOC.teams = null; haptic(14); location.hash = `#equipo/${pid}`;
          toast(tpl && tpl.cards ? '¡Proyecto creado! Repartid las tarjetas.' : '¡Proyecto creado! Añadid la primera tarjeta.');
        },
          e => { toast(niceErr(e)); if (btn) btn.disabled = false; });
      return false;
    },
  });
}
function inviteSheet(pid) {
  const S = snapOf(pid); if (!S) return;
  const inside = new Set(S.members.map(m => m.id));
  const go = () => {
    const friends = ((SOC.friends && SOC.friends.list) || []).filter(f => !inside.has(f.user.id));
    openModal('Invitar amigos', `
      ${friends.length ? `<ul class="fr-list">${friends.map(f => `<li class="fr-row">${avatar(f.user)}<span class="fr-t"><b${nameStyle(f.user)}>${esc(dispName(f.user))}</b><span>@${esc(f.user.username)}</span></span><span class="fr-a"><button type="button" class="btn small primary" data-modal="add" data-uid="${f.user.id}">Añadir</button></span></li>`).join('')}</ul>`
        : `<p class="hint">${(SOC.friends && SOC.friends.list.length) ? 'Todos tus amigos ya están en este proyecto.' : 'Primero añade amigos por su nick o ID.'}</p>`}
      <div class="sheet-list"><button type="button" class="sheet-item" data-modal="friends">${I.plus}<span>Buscar y añadir amigos</span></button></div>
      <p class="hint">Solo puedes invitar a tus amigos. Al añadirles verán el tablero al momento.</p>`, {
      actions: {
        add: el => { el.disabled = true; rpc('add_team_member', { pid, target: el.dataset.uid }).then(() => { inside.add(el.dataset.uid); el.textContent = '✓ Dentro'; haptic(); loadTeam(pid).then(socRefresh); SOC.teams = null; }, e => { el.disabled = false; toast(niceErr(e)); }); },
        friends: () => { modal.close(); location.hash = '#amigos'; },
      },
    });
  };
  if (!SOC.friends) loadFriends().then(go, () => go()); else go();
}
function calDaySheet(pid, d) {
  const S = snapOf(pid);
  const items = S.tasks.filter(t => t.due === d), goals = S.goals.filter(g => g.due === d);
  openModal(esc(fmtLongDate(d)), `
    ${goals.map(g => `<div class="tm-dayrow goal">◎ <b>${esc(g.title)}</b> <span class="muted small">objetivo</span></div>`).join('')}
    ${items.length ? `<div class="sheet-list">${items.map(t => { const who = memberOf(S, t.assignee); return `<button type="button" class="sheet-item" data-modal="open" data-id="${t.id}">${who ? avatar(who, 'xs') : '<span class="av xs none">?</span>'}<span class="${t.done_at ? 'muted' : ''}">${t.done_at ? '✓ ' : ''}${esc(t.title)}</span></button>`; }).join('')}</div>` : (goals.length ? '' : '<p class="hint">Nada con plazo este día.</p>')}
    <div class="tb-cbox"><input type="text" id="tb-dayin" placeholder="Nueva tarjeta con plazo este día" maxlength="200" data-enter="add" aria-label="Nueva tarjeta"><button type="button" class="btn small primary" data-modal="add">Añadir</button></div>`, {
    actions: {
      open: el => { modal.close(); setTimeout(() => cardSheet(pid, el.dataset.id), 220); },
      add: () => { const v = $('#tb-dayin').value.trim(); if (!v) return; const fc = firstCol(S); if (!fc) return; addCard(pid, fc.id, v, { due: d }); modal.close(); },
    },
  });
}

/* ---------- Arrastrar tarjetas (ratón y dedo) ---------- */
const tbDrag = { on: false };
function dragStart(e, card) {
  const r = card.getBoundingClientRect();
  Object.assign(tbDrag, { on: true, card, tid: card.dataset.tid, pid: curPid(), dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY });
  const ghost = card.cloneNode(true);
  ghost.classList.add('tb-ghost'); ghost.style.width = r.width + 'px';
  document.body.appendChild(ghost);
  tbDrag.ghost = ghost;
  const ph = document.createElement('div'); ph.className = 'tb-ph'; ph.style.height = r.height + 'px';
  card.after(ph); tbDrag.ph = ph;
  card.classList.add('dragging');
  document.body.classList.add('tb-dragging');
  haptic(10);
  dragMove(e);
  tbDrag.raf = requestAnimationFrame(autoScroll);
}
function dragMove(e) {
  tbDrag.x = e.clientX; tbDrag.y = e.clientY;
  tbDrag.ghost.style.transform = `translate(${e.clientX - tbDrag.dx}px, ${e.clientY - tbDrag.dy}px) rotate(2deg)`;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.tb-col:not(.tb-newcol)');
  if (!col) return;
  const list = $('.tb-list', col);
  const cards = $$('.tb-card:not(.dragging)', list);
  const after = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  const empty = $('.tb-empty', list); if (empty) empty.remove();
  if (after) { if (tbDrag.ph.nextSibling !== after) list.insertBefore(tbDrag.ph, after); }
  else if (list.lastElementChild !== tbDrag.ph) list.appendChild(tbDrag.ph);
}
function autoScroll() {
  if (!tbDrag.on) return;
  const board = $('.tb-board');
  if (board) {
    const r = board.getBoundingClientRect(), edge = 50;
    if (tbDrag.x > r.right - edge) board.scrollLeft += 12; else if (tbDrag.x < r.left + edge) board.scrollLeft -= 12;
  }
  if (tbDrag.y > innerHeight - 90) scrollBy(0, 10); else if (tbDrag.y < 70) scrollBy(0, -10);
  tbDrag.raf = requestAnimationFrame(autoScroll);
}
function dragEnd(cancel) {
  cancelAnimationFrame(tbDrag.raf);
  const { pid, tid, ph, card, ghost } = tbDrag;
  tbDrag.on = false;
  document.body.classList.remove('tb-dragging');
  if (typeof suppressClickUntil !== 'undefined') suppressClickUntil = Date.now() + 350;
  ghost.remove();
  const list = ph.parentElement, col = list && list.dataset.col;
  const S = snapOf(pid), t = S && S.tasks.find(x => x.id === tid);
  if (cancel || !col || !t) { ph.remove(); card.classList.remove('dragging'); socRefresh(); return; }
  const prev = ph.previousElementSibling && ph.previousElementSibling.closest('.tb-card:not(.dragging)') ? ph.previousElementSibling : null;
  let next = ph.nextElementSibling; while (next && (!next.matches('.tb-card') || next.classList.contains('dragging'))) next = next.nextElementSibling;
  const pp = prev && S.tasks.find(x => x.id === prev.dataset.tid), np = next && S.tasks.find(x => x.id === next.dataset.tid);
  const pos = pp && np ? (pp.position + np.position) / 2 : pp ? pp.position + 1 : np ? np.position - 1 : 1;
  ph.remove(); card.classList.remove('dragging');
  if (col === t.column_id && Math.abs(pos - t.position) < 1e-9) { socRefresh(); return; }
  const c = colOf(S, col), was = colOf(S, t.column_id);
  const ch = { column_id: col, position: pos };
  if (c && c.is_done && !t.done_at) ch.done_at = new Date().toISOString();
  if (c && !c.is_done && was && was.is_done && t.done_at) ch.done_at = null;
  if (ch.done_at) toast('¡Tarjeta completada!');
  patchTask(pid, tid, ch);
}
{
  let pend = null;
  const clear = () => { if (pend) { clearTimeout(pend.timer); pend = null; } };
  document.addEventListener('pointerdown', e => {
    if (tbDrag.on || e.button > 0) return;
    const card = e.target.closest('.tb-board .tb-card');
    if (!card || e.target.closest('button, input, a')) return;
    pend = { card, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', id: e.pointerId };
    if (pend.touch) pend.timer = setTimeout(() => { if (pend) { const p = pend; pend = null; dragStart({ clientX: p.x, clientY: p.y }, p.card); } }, 380);
  });
  document.addEventListener('pointermove', e => {
    if (tbDrag.on) { dragMove(e); return; }
    if (!pend) return;
    const d = Math.hypot(e.clientX - pend.x, e.clientY - pend.y);
    if (pend.touch) { if (d > 8) clear(); }
    else if (d > 5) { const p = pend; pend = null; dragStart(e, p.card); }
  });
  document.addEventListener('pointerup', () => { clear(); if (tbDrag.on) dragEnd(false); });
  document.addEventListener('pointercancel', () => { clear(); if (tbDrag.on) dragEnd(true); });
  /* Mientras arrastras con el dedo la página no se desplaza */
  document.addEventListener('touchmove', e => { if (tbDrag.on && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (tbDrag.on || (pend && pend.touch)) e.preventDefault(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tbDrag.on) dragEnd(true); });
}

/* ---------- Hoy: lo que te toca en tus proyectos compartidos ---------- */
function teamTodaySection(d) {
  if (d !== todayStr() || !SOC.profile) return '';
  const soon = addDays(d, 7);
  const list = (SOC.myTasks || []).filter(t => !t.due || t.due <= soon).slice(0, 5);
  const teams = (SOC.teams || []).filter(p => !p.archived_at)
    .sort((a, b) => ((b.last_act > seenAct(b.id)) - (a.last_act > seenAct(a.id))) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (!list.length && !teams.length) return '';
  const strip = teams.length ? `<div class="tm-strip">${teams.slice(0, 8).map(p => {
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0, fresh = p.last_act && p.last_act > seenAct(p.id) && p.last_kind;
    const who = fresh && (p.members || []).find(m => m.id === p.last_kind.user);
    const line = fresh ? `<b${nameStyle(who)}>${esc(dispName(who))}</b> ${actText({ members: p.members || [] }, { ...p.last_kind, user_id: p.last_kind.user, detail: p.last_kind.detail || {} })}`
      : p.late ? `<span class="warn-text">${p.late} atrasada${p.late === 1 ? '' : 's'}</span>` : p.mine ? `${p.mine} para ti` : p.total && p.done === p.total ? '¡Todo hecho!' : `${pct}% hecho`;
    return `<a class="tm-mini glass ${fresh ? 'fresh' : ''}" href="#equipo/${p.id}" style="--c:${p.color || '#4a72cf'}">
      <span class="tm-mini-top"><span class="tm-mini-ic">${esc(p.icon || '👥')}</span>${streakTag(teamStreak(p.done_days))}${chatUnread(p.id, p.last_msg) ? '<span class="tm-mini-chat" title="Mensajes nuevos">💬</span>' : ''}${avStack(p.members || [], 3, 'xs')}</span>
      <span class="tm-mini-n">${esc(p.name)}</span>
      <span class="tm-mini-bar"><i style="width:${pct}%"></i></span>
      <span class="tm-mini-l">${line}</span>
    </a>`;
  }).join('')}</div>` : '';
  return `<div class="section"><div class="section-head"><h2>Con tus amigos${list.length ? ' · ' + list.length : ''}</h2><a class="btn small ghost" href="#proyectos" data-sact="go-shared">Ver proyectos</a></div>
    ${strip}
    ${list.length ? `<ul class="tasks glass tm-today">${list.map(t => `<li class="tm-today-row" style="--c:${t.color || '#4a72cf'}">
      <button class="tb-check" data-sact="my-done" data-id="${t.id}" data-pid="${t.project_id}" aria-label="Completar ${esc(t.title)}">${I.check}</button>
      <a class="tm-today-b" href="#equipo/${t.project_id}"><span>${esc(t.title)}</span><span class="small muted">${esc(t.icon || '👥')} ${esc(t.project)}${t.due ? ` · <span class="${t.due < d ? 'warn-text' : ''}">${esc(relDay(t.due).toLowerCase())}</span>` : ''}</span></a>
    </li>`).join('')}</ul>` : (teams.length ? '<p class="hint">Nada asignado a ti para esta semana en los proyectos con amigos.</p>' : '')}</div>`;
}

/* ---------- Clics, formularios y refresco ---------- */
function copyText(txt, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(msg), () => toast(txt));
}
document.addEventListener('click', e => {
  const card = e.target.closest('.tb-board .tb-card');
  if (card && !e.target.closest('[data-sact]')) {
    if (typeof suppressClickUntil !== 'undefined' && Date.now() < suppressClickUntil) return;
    cardSheet(curPid(), card.dataset.tid); return;
  }
  const el = e.target.closest('[data-sact]');
  if (!el || el.closest('#modal')) return;
  const pid = curPid(), id = el.dataset.id;
  switch (el.dataset.sact) {
    case 'nick': openNickDialog({ initial: nickSuggestions((getSession().user && getSession().user.email || '').split('@')[0])[0] }); return;
    case 'soc-retry': SOC.backend = null; SOC.errors = {}; SOC.profileLoaded = false; socRefresh(); refreshShared(); if (pid) teamPoll(pid, true); return;
    case 'shared-tab': state.settings.ui.projectsShared = el.dataset.v === '1'; save(); softSwap(); if (state.settings.ui.projectsShared) refreshShared(); return;
    case 'go-shared': state.settings.ui.projectsShared = true; save(); return;
    case 'teams-arch': state.settings.ui.teamsArchived = !!el.dataset.v; save(); softSwap(); return;
    case 'team-new': if (!SOC.friends) loadFriends().then(() => teamSheet(null), () => teamSheet(null)); else teamSheet(null); return;
    case 'copy-code': copyText(SOC.profile.friend_code, `ID copiado: ${SOC.profile.friend_code}`); return;
    case 'share-code': {
      const p = SOC.profile, url = `${location.origin}${location.pathname}#amigos/${p.friend_code}`;
      const txt = `Añádeme en Boldup para hacer proyectos juntos: mi nick es @${p.username} (ID ${p.friend_code}).`;
      if (navigator.share) navigator.share({ title: 'Boldup', text: txt, url }).catch(() => {});
      else copyText(`${txt} ${url}`, 'Copiado: pégalo en un mensaje');
      return;
    }
    case 'edit-profile': profileSheet(); return;
    case 'avatar': avatarSheet(); return;
    case 'pf-photo': pickPhoto(); return;
    case 'pf-nophoto': if (confirm('¿Quitar tu foto de perfil?')) removePhoto(); return;
    case 'pf-nick': openNickDialog({ change: true }); return;
    case 'pf-set': { const k = el.dataset.k, v = el.dataset.v || null; if (!['color', 'name_color', 'av_style'].includes(k)) return; haptic(6); saveProfile({ [k]: v }).catch(err => toast(niceErr(err))); return; }
    case 'react': toggleReact(pid, Number(el.dataset.aid), el.dataset.e); return;
    case 'react-pick': { const w = el.closest('.tm-react-add'), open = !w.classList.contains('open'); $$('.tm-react-add.open').forEach(x => x.classList.remove('open')); w.classList.toggle('open', open); return; }
    case 'chat-del': {
      if (!confirm('¿Borrar este mensaje para todos?')) return;
      mutate(pid, S => { S.messages = (S.messages || []).filter(m => m.id !== id); }, () => rest(`team_messages?id=eq.${id}`, { method: 'DELETE' })).catch(() => {});
      return;
    }
    case 'msg-sel': if (!e.target.closest('.tm-msg-del')) { const li = el.closest('.tm-msg'), on = !li.classList.contains('sel'); $$('.tm-msg.sel').forEach(x => x.classList.toggle('sel', false)); li.classList.toggle('sel', on); } return;
    case 'my-qr': qrSheet(); return;
    case 'scan-qr': scanSheet(); return;
    case 'fr-open': { const f = SOC.friends && SOC.friends.list.find(x => x.id === id); if (f) friendSheet(f); return; }
    case 'fr-add': friendAction(() => rpc('send_friend_request', { target: id }).then(r => { SOC.found = SOC.found && SOC.found.user ? { ...SOC.found, user: { ...SOC.found.user, relation: r } } : null; }), '¡Solicitud enviada!'); return;
    case 'fr-accept': friendAction(() => rpc('respond_friend_request', { request_id: id, accept: true }), '¡Ahora sois amigos!'); return;
    case 'fr-reject': friendAction(() => rpc('respond_friend_request', { request_id: id, accept: false }), 'Solicitud rechazada'); return;
    case 'fr-cancel': friendAction(() => rest(`friendships?id=eq.${id}`, { method: 'DELETE' }), 'Solicitud cancelada'); return;
    case 'fr-menu': {
      const f = SOC.friends.list.find(x => x.id === id); if (!f) return;
      actionSheet(dispName(f.user), [
        ['Copiar su ID', I.copy, () => copyText(f.user.friend_code || '@' + f.user.username, 'Copiado')],
        ['Eliminar de amigos', I.trash, () => { if (confirm(`¿Eliminar a ${dispName(f.user)} de tus amigos? Seguiréis en los proyectos que ya compartís.`)) friendAction(() => rest(`friendships?id=eq.${id}`, { method: 'DELETE' }), 'Amigo eliminado'); }],
      ], `@${esc(f.user.username)}`);
      return;
    }
    case 'team-tab': location.hash = `#equipo/${pid}/${el.dataset.v}`; return;
    case 'team-menu': teamMenu(pid); return;
    case 'invite': inviteSheet(pid); return;
    case 't-filter': SOC.filter[pid] = el.dataset.v; socRefresh(); return;
    case 't-filter-go': SOC.filter[pid] = el.dataset.v; location.hash = `#equipo/${pid}/tablero`; return;
    case 't-done': { const t = snapOf(pid).tasks.find(x => x.id === id); if (t) setTaskDone(pid, id, !t.done_at); return; }
    case 't-open': cardSheet(pid, id); return;
    case 'col-menu': colMenu(pid, id); return;
    case 'goal-new': goalSheet(pid); return;
    case 'goal-edit': goalSheet(pid, snapOf(pid).goals.find(g => g.id === id)); return;
    case 'goal-done': { const g = snapOf(pid).goals.find(x => x.id === id); if (!g) return; const v = g.done_at ? null : new Date().toISOString(); haptic(); mutate(pid, S => { S.goals.find(x => x.id === id).done_at = v; }, () => rest(`team_goals?id=eq.${id}`, { method: 'PATCH', body: { done_at: v } }), v ? '¡Objetivo conseguido! 🏁' : null).catch(() => {}); return; }
    case 'cal-nav': { const n = Number(el.dataset.n), cur = SOC.calMonth[pid] || todayStr().slice(0, 7); const [y, m] = cur.split('-').map(Number); const dt = new Date(y, m - 1 + n, 1); SOC.calMonth[pid] = n === 0 ? todayStr().slice(0, 7) : `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; socRefresh(); return; }
    case 'cal-day': calDaySheet(pid, el.dataset.date); return;
    case 'member-remove': { const S = snapOf(pid), m = memberOf(S, id); if (!m || !confirm(`¿Quitar a ${dispName(m)} del proyecto? Sus tarjetas quedarán sin asignar.`)) return; mutate(pid, S2 => { S2.members = S2.members.filter(x => x.id !== id); }, () => rpc('remove_team_member', { pid, target: id }), 'Miembro quitado').catch(() => {}); return; }
    case 'my-done': {
      const tpid = el.dataset.pid; el.classList.add('on'); haptic(12);
      const row = el.closest('li'); if (row) row.classList.add('leaving');
      (async () => {
        try {
          if (!snapOf(tpid)) await loadTeam(tpid);
          const S = snapOf(tpid), dc = S && doneCol(S);
          await rest(`team_tasks?id=eq.${id}`, { method: 'PATCH', body: dc ? { done_at: new Date().toISOString(), column_id: dc.id, position: maxPos(S, dc.id) + 1 } : { done_at: new Date().toISOString() } });
          SOC.myTasks = (SOC.myTasks || []).filter(t => t.id !== id); toast('¡Hecho! Tu equipo lo verá al momento');
        } catch (err) { toast(niceErr(err)); }
        loadTeam(tpid).catch(() => {}); socRefresh();
      })();
      return;
    }
  }
});
document.addEventListener('keydown', e => {
  const card = e.target.closest && e.target.closest('.tb-card');
  if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); cardSheet(curPid(), card.dataset.tid); }
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.tm-react-add')) $$('.tm-react-add.open').forEach(x => x.classList.remove('open')); }, true);
document.addEventListener('submit', e => {
  const f = e.target, k = f.dataset.sform;
  if (!k) return;
  e.preventDefault(); e.stopPropagation();
  const pid = curPid();
  if (k === 'find') { findFriend(f.elements.q.value); f.elements.q.blur(); return; }
  if (k === 'chat') {
    const inp = f.elements.body, body = inp.value.trim(); if (!body || !pid) return;
    inp.value = '';
    const msg = { id: newId(), project_id: pid, user_id: socUid(), body, created_at: new Date().toISOString() };
    markChatSeen(pid, msg.created_at);
    mutate(pid, S => { S.messages = [...(S.messages || []), msg]; }, () => rest('team_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { id: msg.id, project_id: pid, body } }))
      .catch(() => { inp.value = body; });
    return;
  }
  if (k === 'add-card') {
    const inp = f.elements.title, v = inp.value.trim(); if (!v) return;
    inp.value = ''; addCard(pid, f.dataset.col, v);
    /* Sigues escribiendo la siguiente tarjeta en la misma lista */
    setTimeout(() => { const n = $(`.tb-add[data-col="${f.dataset.col}"] input`); if (n) n.focus(); }, 30);
    return;
  }
  if (k === 'add-col') {
    const name = f.elements.name.value.trim(); if (!name) return;
    const S = snapOf(pid), dc = doneCol(S);
    /* La lista nueva va antes de «Hecho» */
    const pos = dc ? (S.columns.filter(c => c !== dc).reduce((m, c) => Math.max(m, c.position), 0) + dc.position) / 2 : S.columns.reduce((m, c) => Math.max(m, c.position), 0) + 1;
    const row = { id: newId(), project_id: pid, name: name.slice(0, 40), position: pos };
    f.elements.name.value = ''; f.elements.name.blur();
    mutate(pid, S2 => { S2.columns.push({ ...row, is_done: false }); S2.columns.sort((a, b) => a.position - b.position); }, () => rest('team_columns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row })).catch(() => {});
  }
}, true);

/* Refresco: el tablero abierto cada 10 s; la lista y los amigos cada 30 s; al volver a la app, ya */
let teamTimer = 0;
function teamPoll(pid, now) {
  if (!socOn() || SOC.backend === false) return;
  const go = () => socFetch(loadTeam(pid) || Promise.resolve(), () => [snapOf(pid), SOC.errors['team:' + pid]]);
  if (!SOC.profileLoaded) { (loadProfile() || Promise.resolve()).then(() => { if (SOC.profile) go(); else socRefresh(); }, () => socRefresh()); return; }
  if (now || !SOC.loading.has('team:' + pid)) go();
}
function socTick(force) {
  if (!socOn() || document.visibilityState !== 'visible') return;
  const r = parseHash();
  if (r.name === 'equipo' && r.id) teamPoll(r.id);
  else if ((r.name === 'proyectos' && state.settings.ui.projectsShared) || r.name === 'amigos') { if (force || Date.now() - (socTick.list || 0) > 25000) { socTick.list = Date.now(); refreshShared(); } }
  else if (force || Date.now() - (socTick.bg || 0) > 120000) { socTick.bg = Date.now(); if (SOC.profile) { loadFriends().then(socBadge).catch(() => {}); Promise.all([loadMyTasks(), loadTeams()]).then(() => { if (r.name === 'hoy') socFetch(Promise.resolve(), () => 0); }).catch(() => {}); } }
}
clearInterval(teamTimer);
teamTimer = setInterval(() => socTick(false), 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => socTick(true), 600); });
window.addEventListener('hashchange', () => setTimeout(() => socTick(true), 50));
socLoadCache();
/* Al elegir plantilla se elige también su icono */
document.addEventListener('change', e => {
  if (!e.target.matches('#modal input[name="tpl"]')) return;
  const ic = e.target.dataset.icon, r = ic && $(`#modal input[name="icon"][value="${ic}"]`);
  if (r) r.checked = true;
  const n = $('#modal input[name="name"]');
  if (n && !n.value.trim() && e.target.value) { const t = TEAM_TPLS.find(x => x.k === e.target.value); if (t) n.placeholder = t.n; }
});
