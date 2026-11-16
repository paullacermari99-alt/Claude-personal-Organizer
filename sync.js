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
  const txt = await res.text();
  const data = txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : null;
  if (!res.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('Error ' + res.status));
  return data;
}
async function accessToken() {
  const s = getSession();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60000) return s.access_token;
  try {
    const d = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } });
    const ns = sessionFrom(d); if (!ns.user) ns.user = s.user;
    setSession(ns);
    return ns.access_token;
  } catch (e) { if (/invalid|not found|revoked/i.test(e.message)) setSession(null); return null; }
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
  await firstSync();
}
/* Devuelve true si ya ha entrado; false si tiene que confirmar el email primero */
async function signUp(email, password) {
  let d;
  try { d = await sb('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } }); }
  catch (e) { throw authError(e); }
  const u = d && (d.user || d);
  if (u && Array.isArray(u.identities) && !u.identities.length) throw new Error('Ya tienes una cuenta con ese email. Pulsa «Entrar» o, si no recuerdas la contraseña, «¿Olvidaste la contraseña?»');
  if (d && d.access_token) { setSession(sessionFrom(d)); syncInfo.notice = ''; await firstSync(); return true; }
  syncInfo.notice = `Te he enviado un email a <b>${esc(email)}</b>. Abre el enlace para confirmar tu cuenta y vuelve aquí.`;
  return false;
}
async function sendPasswordReset(email) {
  try { await sb('/auth/v1/recover', { method: 'POST', auth: false, body: { email } }); }
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
  const h = location.hash.slice(1);
  if (/error_description=/.test(h)) {
    const q = new URLSearchParams(h);
    syncInfo.notice = /expired|invalid/i.test(q.get('error_description') || '') ? 'El enlace del email ha caducado. Pide otro.' : esc(q.get('error_description'));
    history.replaceState(null, '', location.pathname + '#ajustes');
    return false;
  }
  if (!/access_token=/.test(h)) return false;
  const q = new URLSearchParams(h);
  setSession(sessionFrom({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: q.get('expires_in') }));
  if (q.get('type') === 'recovery') syncInfo.needPassword = true;
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
  syncInfo.status = 'off';
}

/* ---------- Sincronización: el documento más reciente gana ---------- */
async function pullRemote() {
  const rows = await sb('/rest/v1/organizer_state?select=data,updated_at');
  return rows && rows[0] ? rows[0].data : null;
}
async function pushRemote() {
  const s = getSession();
  if (!s || !s.user || pushing) return;
  pushing = true;
  try {
    await sb('/rest/v1/organizer_state?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: s.user.id, data: state, updated_at: new Date().toISOString() } });
    syncInfo.lastSync = Date.now(); syncInfo.status = 'ok'; syncInfo.error = '';
  } finally { pushing = false; }
}
function applyRemote(remote) {
  state = migrate(remote);
  generateRoutines();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  if (!(typeof modal !== 'undefined' && modal.open)) rerender();
}
async function syncNow(manual) {
  if (!cloudReady() || !getSession()) return;
  syncInfo.status = 'syncing';
  try {
    await fetchUser();
    const remote = await pullRemote();
    const local = state.updatedAt || 0, rem = (remote && remote.updatedAt) || 0;
    if (remote && rem > local) applyRemote(remote);
    else if (!remote || local > rem) await pushRemote();
    syncInfo.status = 'ok'; syncInfo.lastSync = Date.now(); syncInfo.error = '';
    if (manual) toast('Sincronizado');
  } catch (e) {
    syncInfo.status = 'error'; syncInfo.error = e.message;
    if (manual) toast('No se pudo sincronizar: ' + e.message);
  }
  refreshSyncUI();
}
/* Al entrar por primera vez en un dispositivo: elegir qué datos se quedan */
async function firstSync() {
  await fetchUser();
  const remote = await pullRemote();
  if (remote && (remote.tasks || []).length) {
    const useCloud = confirm(`En tu cuenta ya hay datos (${remote.tasks.length} tareas, ${(remote.projects || []).length} proyectos).\n\nAceptar: usar los de la cuenta en este dispositivo.\nCancelar: subir los de este dispositivo y reemplazar los de la cuenta.`);
    if (useCloud) { applyRemote(remote); syncInfo.status = 'ok'; syncInfo.lastSync = Date.now(); return; }
  }
  state.updatedAt = Date.now();
  await pushRemote();
}
/* Llamado por save(): sube los cambios al poco tiempo */
function scheduleSync() {
  if (!cloudReady() || !getSession()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushRemote().catch(e => { syncInfo.status = 'error'; syncInfo.error = e.message; }).finally(refreshSyncUI), 1500);
}
function refreshSyncUI() { const el = document.querySelector('[data-live="sync"]'); if (el && typeof refreshLive === 'function') refreshLive(); }

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
