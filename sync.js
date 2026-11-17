/* P Organizer — cuenta, sincronización entre dispositivos y avisos push (Supabase, sin librerías). */
'use strict';

const CFG = window.PO_CONFIG || {};
const SESSION_KEY = 'organizador.session';
const syncInfo = { status: 'off', lastSync: null, error: '', notice: '', needPassword: false };
let syncTimer = null, pushing = false;

const cloudReady = () => !!(CFG.supabaseUrl && CFG.supabaseKey);
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; } }
function setSession(s) { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {} }
function sessionFrom(d) {
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000, user: d.user ? { id: d.user.id, email: d.user.email } : null };
}

async function sb(path, opts = {}) {
  const headers = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.auth !== false) {
    const tok = await accessToken();
    if (!tok) throw new Error('Sesión caducada: vuelve a entrar');
    headers.Authorization = 'Bearer ' + tok;
  }
  const res = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  /* Token caducado antes de tiempo (reloj del dispositivo adelantado): se renueva y se repite una vez */
  if (res.status === 401 && opts.auth !== false && !opts.retried) {
    const s = getSession();
    if (s) { s.expires_at = 0; setSession(s); return sb(path, { ...opts, retried: true }); }
  }
  const txt = await res.text();
  const data = txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : null;
  if (!res.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('Error ' + res.status));
  return data;
}
/* v46: una sola renovación a la vez. Antes dos peticiones podían renovar la sesión a la vez;
   la segunda fallaba («token ya usado») y la app cerraba la sesión sin avisar: dejaba de sincronizar. */
let refreshing = null;
async function accessToken() {
  const s = getSession();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60000) return s.access_token;
  if (!refreshing) refreshing = refreshSession(s).finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshSession(s) {
  try {
    const d = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } });
    const ns = sessionFrom(d); if (!ns.user) ns.user = s.user;
    setSession(ns);
    return ns.access_token;
  } catch (e) {
    /* Otra pestaña ya la renovó */
    const now = getSession();
    if (now && now.refresh_token !== s.refresh_token) return now.access_token;
    /* Sin internet: la sesión sigue, se reintenta luego */
    if (isNetErr(e)) throw e;
    if (/invalid|not found|revoked|already used/i.test(e.message)) {
      try { localStorage.setItem(LOST_KEY, (s.user && s.user.email) || '1'); } catch {}
      setSession(null);
    }
    return null;
  }
}

/* ---------- Entrar con email y contraseña ---------- */
const AUTH_ERRORS = [
  [/invalid login credentials/i, 'Email o contraseña incorrectos'],
  [/email not confirmed/i, 'Primero confirma tu email: abre el enlace que te he enviado'],
  [/already registered|already been registered|already exists/i, 'Ya hay una cuenta con ese email: pulsa «Entrar»'],
  [/password should be|at least \d+ characters|weak password/i, 'La contraseña debe tener al menos 6 caracteres'],
  [/rate limit|too many|security purposes/i, 'Demasiados intentos seguidos. Espera unos minutos'],
  [/unable to validate email|invalid format/i, 'Ese email no parece válido'],
];
const authError = e => { const m = (AUTH_ERRORS.find(([re]) => re.test(e.message)) || [])[1]; return m ? new Error(m) : e; };

async function signIn(email, password) {
  try {
    const d = await sb('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    setSession(sessionFrom(d));
  } catch (e) { throw authError(e); }
  syncInfo.notice = '';
  try { localStorage.removeItem(LOST_KEY); } catch {}
  await firstSync();
}
/* Los enlaces del email vuelven siempre a esta misma app (carpeta incluida), no a la raíz del dominio */
const APP_URL = location.origin + location.pathname.replace(/[^/]*$/, '');
const backHere = () => '?redirect_to=' + encodeURIComponent(APP_URL);
/* Devuelve true si ya ha entrado; false si tiene que confirmar el email primero */
async function signUp(email, password) {
  let d;
  try { d = await sb('/auth/v1/signup' + backHere(), { method: 'POST', auth: false, body: { email, password } }); }
  catch (e) { throw authError(e); }
  const u = d && (d.user || d);
  if (u && Array.isArray(u.identities) && !u.identities.length) throw new Error('Ya tienes una cuenta con ese email. Pulsa «Entrar» o, si no recuerdas la contraseña, «¿Olvidaste la contraseña?»');
  if (d && d.access_token) { setSession(sessionFrom(d)); syncInfo.notice = ''; await firstSync(); return true; }
  syncInfo.notice = `Te he enviado un email a <b>${esc(email)}</b>. Abre el enlace para confirmar tu cuenta y vuelve aquí.`;
  return false;
}
async function sendPasswordReset(email) {
  try { await sb('/auth/v1/recover' + backHere(), { method: 'POST', auth: false, body: { email } }); }
  catch (e) { throw authError(e); }
  syncInfo.notice = `Si hay una cuenta con <b>${esc(email)}</b>, te llegará un email con un enlace para poner una contraseña nueva.`;
}
async function setNewPassword(password) {
  try { await sb('/auth/v1/user', { method: 'PUT', body: { password } }); }
  catch (e) { throw authError(e); }
  syncInfo.needPassword = false;
}
/* Los enlaces del email (confirmar cuenta o cambiar contraseña) traen la sesión en la dirección */
function captureAuthRedirect() {
  /* Algunos enlaces traen el error en la parte ?…, no en #… */
  const h = location.hash.slice(1) || location.search.slice(1);
  if (/error_description=/.test(h)) {
    const q = new URLSearchParams(h);
    syncInfo.notice = /expired|invalid/i.test(q.get('error_description') || '') ? 'El enlace del email ha caducado. Pide otro.' : esc(q.get('error_description'));
    history.replaceState(null, '', location.pathname + '#ajustes');
    syncInfo.fromEmail = true;
    return false;
  }
  if (!/access_token=/.test(h)) return false;
  const q = new URLSearchParams(h);
  setSession(sessionFrom({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: q.get('expires_in') }));
  if (q.get('type') === 'recovery') syncInfo.needPassword = true;
  if (q.get('type') === 'signup') syncInfo.notice = '¡Cuenta confirmada! Ya estás dentro.';
  syncInfo.fromEmail = true;
  history.replaceState(null, '', location.pathname + '#ajustes');
  return true;
}
async function fetchUser() {
  const s = getSession();
  if (!s || s.user) return;
  const u = await sb('/auth/v1/user');
  s.user = { id: u.id, email: u.email }; setSession(s);
}
async function signOut() {
  try { await sb('/auth/v1/logout', { method: 'POST' }); } catch {}
  await unsubscribePush().catch(() => {});
  setSession(null);
  try { localStorage.removeItem(BASE_KEY); localStorage.removeItem(LOST_KEY); } catch {}
  syncInfo.status = 'off'; syncInfo.pending = false;
}

/* ---------- Sincronización (v46): se mezcla, nunca se pisa ----------
   Antes ganaba el documento entero más reciente y cada dispositivo subía lo suyo sin mirar la
   cuenta: si el ordenador guardaba cualquier cosa, borraba lo que acababas de crear en el móvil.
   Ahora, en cada sincronización: se bajan los datos de la cuenta, se mezclan elemento a elemento
   con los de este dispositivo (comparando con la última versión que ambos conocían) y se sube el
   resultado solo si nadie ha escrito entre medias; si alguien escribió, se repite. Lo que creas
   en un dispositivo nunca se pierde: si un lado borra algo que el otro cambió, se queda el cambio. */
const BASE_KEY = 'organizador.syncBase';
const LOST_KEY = 'organizador.sessionLost';
const LAST_KEY = 'organizador.lastSync';
let syncRunning = null, syncAgain = false, retryTimer = null, failCount = 0;
syncInfo.pending = false; syncInfo.offline = false;
try { syncInfo.lastSync = Number(localStorage.getItem(LAST_KEY)) || null; } catch { /* sin almacenamiento */ }

function loadBase(u) { try { const b = JSON.parse(localStorage.getItem(BASE_KEY)); return b && b.uid === u ? b.data : null; } catch { return null; } }
function saveBase(u, data) {
  try { localStorage.setItem(BASE_KEY, JSON.stringify({ uid: u, data })); }
  catch { try { localStorage.removeItem(BASE_KEY); } catch { /* sin base se mezcla sumando, sin perder nada */ } }
}
const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/* Quita los datos internos de la sincronización para comparar contenido */
const strip = s => { if (!s) return s; const o = { ...s }; delete o.updatedAt; delete o.syncRev; return o; };
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same(a[k], b[k])) return false;
  return true;
}
const hasIds = a => Array.isArray(a) && a.every(x => isObj(x) && x.id != null);
/* b = última versión común (o undefined), l = este dispositivo, r = la cuenta.
   localWins solo decide cuando los dos cambiaron el mismo dato de forma distinta. */
function merge3(b, l, r, localWins) {
  if (same(l, r)) return l;
  if (b !== undefined && same(l, b)) return r;
  if (b !== undefined && same(r, b)) return l;
  if (l === undefined) return r;
  if (r === undefined) return l;
  if (isObj(l) && isObj(r)) {
    const bo = isObj(b) ? b : {}, out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = merge3(bo[k], l[k], r[k], localWins);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(l) && Array.isArray(r)) {
    if (hasIds(l) && hasIds(r)) return mergeList(hasIds(b) ? b : [], l, r, localWins);
    if (l.some(isObj) || r.some(isObj)) {
      /* Listas sin id (el registro de enfoque): se suman las entradas nuevas de cada lado */
      const key = x => JSON.stringify(x), mine = new Set(l.map(key)), old = new Set((Array.isArray(b) ? b : []).map(key));
      return [...l, ...r.filter(x => !mine.has(key(x)) && !old.has(key(x)))];
    }
  }
  return localWins ? l : r;
}
function mergeList(b, l, r, localWins) {
  const bm = new Map(b.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x])), lm = new Set(l.map(x => x.id));
  const out = [];
  for (const x of l) { const v = merge3(bm.get(x.id), x, rm.get(x.id), localWins); if (v !== undefined) out.push(v); }
  for (const x of r) {
    if (lm.has(x.id)) continue;
    const v = merge3(bm.get(x.id), undefined, x, localWins);
    if (v !== undefined) out.push(v);
  }
  return out;
}
/* Después de mezclar: la misma diaria o la misma etiqueta creadas a la vez en dos dispositivos */
function tidyMerged(s) {
  const swap = new Map();
  const daily = new Map();
  s.tasks = (s.tasks || []).filter(t => {
    if (!t.routineId || !t.routineDate) return true;
    const k = t.routineId + '|' + t.routineDate, keep = daily.get(k);
    if (!keep) { daily.set(k, t); return true; }
    if (t.done && !keep.done) Object.assign(keep, { done: true, doneAt: t.doneAt || keep.doneAt });
    swap.set(t.id, keep.id); return false;
  });
  const tags = new Map();
  s.tags = (s.tags || []).filter(tg => {
    const k = norm(tg.name).trim(), keep = tags.get(k);
    if (!keep) { tags.set(k, tg); return true; }
    swap.set(tg.id, keep.id); return false;
  });
  if (swap.size) {
    const fix = v => {
      if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string' && swap.has(x)) v[i] = swap.get(x); else fix(x); });
      else if (isObj(v)) for (const k of Object.keys(v)) { if (k === 'id') continue; const x = v[k]; if (typeof x === 'string' && swap.has(x)) v[k] = swap.get(x); else fix(x); }
    };
    fix(s);
    s.tasks.forEach(t => { if (Array.isArray(t.tags)) t.tags = [...new Set(t.tags)]; });
  }
  return s;
}
const hasContent = s => !!s && ['tasks', 'events', 'routines', 'habits', 'goals', 'projects', 'templates', 'focusLog'].some(k => (s[k] || []).length)
  || Object.keys((s && s.journal) || {}).length > 0;

async function pullRow() {
  const rows = await sb('/rest/v1/organizer_state?select=data');
  if (!rows || !rows[0]) return { exists: false, data: null, rev: null };
  const d = rows[0].data;
  return { exists: true, data: d, rev: d && d.syncRev != null ? d.syncRev : null };
}
/* Escribe solo si la cuenta sigue como la leímos. false = otro dispositivo escribió entre medias */
async function writeRow(u, data, row) {
  const body = { data, updated_at: new Date().toISOString() };
  if (!row.exists) {
    try { await sb('/rest/v1/organizer_state', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: u, ...body } }); return true; }
    catch (e) { if (/duplicate|already exists|23505|409/i.test(e.message)) return false; throw e; }
  }
  const cond = row.rev == null ? 'data->>syncRev=is.null' : 'data->>syncRev=eq.' + encodeURIComponent(row.rev);
  const res = await sb(`/rest/v1/organizer_state?user_id=eq.${u}&${cond}&select=user_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body });
  return Array.isArray(res) && res.length > 0;
}
const modalOpen = () => typeof modal !== 'undefined' && modal.open;
function storeLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
/* Una vuelta completa. Devuelve false si hubo que dejarlo para luego (una ventana abierta) */
async function runSync() {
  if (modalOpen()) return false;
  await fetchUser();
  const u = getSession() && getSession().user && getSession().user.id;
  if (!u) throw new Error('Sesión caducada: vuelve a entrar');
  for (let i = 0; i < 4; i++) {
    const snap = clone(state);
    const row = await pullRow();
    const remote = row.data && !isOldEpoch(row.data) ? migrate(row.data) : null;
    const base = loadBase(u);
    let merged;
    if (!remote) merged = clone(snap);
    /* Dispositivo nuevo o vacío: toma la cuenta tal cual (sin duplicar las etiquetas de inicio) */
    else if (!base && !hasContent(snap)) merged = clone(remote);
    else merged = tidyMerged(clone(merge3(strip(base) || undefined, strip(snap), strip(remote), (snap.updatedAt || 0) >= (remote.updatedAt || 0))));
    merged.updatedAt = Math.max(snap.updatedAt || 0, (remote && remote.updatedAt) || 0);
    if (!remote || !same(strip(merged), strip(remote))) {
      merged.syncRev = (Number(row.rev) || 0) + 1;
      if (!(await writeRow(u, merged, row))) continue;
    } else merged.syncRev = row.rev;
    /* Mientras tanto se abrió una ventana: la cuenta ya está bien; esto se aplica al cerrarla */
    if (modalOpen()) return false;
    let next = merged;
    if (!same(state, snap)) {
      /* Cambiaste algo durante la sincronización: se conserva y se sube en la siguiente vuelta */
      next = tidyMerged(clone(merge3(strip(snap), strip(state), strip(merged), true)));
      next.updatedAt = Math.max(state.updatedAt || 0, merged.updatedAt);
      next.syncRev = merged.syncRev;
      syncAgain = true;
    }
    if (!same(strip(next), strip(state))) {
      state = migrate(next);
      if (generateRoutines()) syncAgain = true;
      storeLocal();
      const typing = document.activeElement && document.activeElement.matches('input:not([type=checkbox]):not([type=radio]), textarea');
      if (typeof rerender === 'function' && !typing) rerender();
    } else { state.syncRev = next.syncRev; storeLocal(); }
    saveBase(u, merged);
    return true;
  }
  throw new Error('Otro dispositivo estaba guardando a la vez');
}
const isNetErr = e => !navigator.onLine || e instanceof TypeError || /failed to fetch|networkerror|load failed|network|internet/i.test(String(e && e.message));
function retrySoon(ms) { clearTimeout(retryTimer); retryTimer = setTimeout(() => syncNow(), ms); }
function syncNow(manual) {
  if (!cloudReady() || !getSession()) { refreshSyncUI(); return Promise.resolve(); }
  if (syncRunning) { syncAgain = true; return syncRunning; }
  clearTimeout(syncTimer);
  /* Con una ventana abierta se espera a que se cierre (lo que editas no se toca) */
  if (modalOpen() && !manual) { retrySoon(2500); return Promise.resolve(); }
  syncInfo.status = 'syncing'; refreshSyncUI();
  syncRunning = (async () => {
    let done = true;
    try {
      let n = 0;
      do { syncAgain = false; done = await runSync(); } while (done && syncAgain && ++n < 5);
      syncInfo.error = ''; syncInfo.offline = false; failCount = 0;
      syncInfo.status = 'ok';
      if (done) {
        syncInfo.lastSync = Date.now(); syncInfo.pending = syncAgain;
        try { localStorage.setItem(LAST_KEY, String(syncInfo.lastSync)); } catch {}
        if (manual) toast('Todo sincronizado');
      } else retrySoon(2500);
    } catch (e) {
      syncInfo.status = 'error'; syncInfo.offline = isNetErr(e);
      syncInfo.error = syncInfo.offline ? 'Sin conexión' : e.message;
      failCount++;
      if (getSession()) retrySoon(Math.min(60000, 4000 * 2 ** Math.min(failCount, 4)));
      if (manual) toast(syncInfo.offline ? 'Sin conexión: se subirá cuando vuelva internet' : 'No se pudo sincronizar: ' + e.message);
    } finally { syncRunning = null; refreshSyncUI(); }
    if (syncAgain && syncInfo.status === 'ok') retrySoon(800);
  })();
  return syncRunning;
}
/* Al entrar en un dispositivo: se mezcla lo de aquí con lo de la cuenta (ya no hay que elegir ni se reemplaza nada) */
async function firstSync() {
  try { localStorage.removeItem(LOST_KEY); } catch {}
  await syncNow();
  if (typeof rerender === 'function' && !modalOpen()) rerender();
}
const pushRemote = () => syncNow();
/* Llamado por save(): sube los cambios al poco tiempo */
function scheduleSync() {
  syncInfo.pending = true;
  if (!cloudReady() || !getSession()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), 1200);
}
function refreshSyncUI() { if (document.querySelector('[data-live="sync"], [data-live="syncbar"], [data-live="acc"]') && typeof refreshLive === 'function') refreshLive(); }
/* Estado para mostrar: tono (ok, busy, warn, bad) y texto */
function syncState() {
  if (!cloudReady()) return null;
  if (!getSession()) {
    let lost = ''; try { lost = localStorage.getItem(LOST_KEY) || ''; } catch {}
    return lost ? { tone: 'bad', lost: true, text: 'Tu sesión se cerró: vuelve a entrar para sincronizar' }
      : { tone: 'warn', none: true, text: 'Este dispositivo no está conectado a tu cuenta' };
  }
  if (syncInfo.status === 'error') return syncInfo.offline ? { tone: 'warn', text: 'Sin conexión: tus cambios se subirán al volver internet' } : { tone: 'bad', text: 'No se pudo sincronizar: ' + syncInfo.error };
  if (syncInfo.status === 'syncing') return { tone: 'busy', text: 'Sincronizando…' };
  if (syncInfo.pending) return { tone: 'busy', text: 'Subiendo tus cambios…' };
  if (!syncInfo.lastSync) return { tone: 'busy', text: 'Conectando con tu cuenta…' };
  return { tone: 'ok', text: 'Todo sincronizado · ' + (typeof agoLabel === 'function' ? agoLabel(syncInfo.lastSync) : '') };
}
window.addEventListener('online', () => syncNow());
{ let lastFocus = 0; window.addEventListener('focus', () => { if (Date.now() - lastFocus > 10000) { lastFocus = Date.now(); syncNow(); } }); }

/* ---------- Avisos push con la app cerrada ---------- */
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function subscribePush() {
  if (!cloudReady() || !CFG.vapidPublicKey || !getSession() || !pushSupported()) return false;
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
  const j = sub.toJSON(), s = getSession();
  await sb('/rest/v1/push_subscriptions?on_conflict=endpoint', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: s.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
  state.settings.reminders.push = true; save();
  return true;
}
async function unsubscribePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await sb('/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(sub.endpoint), { method: 'DELETE' }); } catch {}
  await sub.unsubscribe();
  state.settings.reminders.push = false; save();
}
const pushActive = () => !!(state.settings.reminders.push && getSession() && CFG.vapidPublicKey);
