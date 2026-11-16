/* P Organizer — cuenta, sincronización entre dispositivos y avisos push (Supabase, sin librerías). */
'use strict';

const CFG = window.PO_CONFIG || {};
const SESSION_KEY = 'organizador.session';
const syncInfo = { status: 'off', lastSync: null, error: '', pendingEmail: '' };
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

/* ---------- Entrar con un código de 6 dígitos (funciona también en la app instalada) ---------- */
async function sendLoginCode(email) {
  await sb('/auth/v1/otp', { method: 'POST', auth: false, body: { email, create_user: true } });
  syncInfo.pendingEmail = email;
}
async function verifyLoginCode(code) {
  const d = await sb('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email: syncInfo.pendingEmail, token: code.trim() } });
  setSession(sessionFrom(d));
  syncInfo.pendingEmail = '';
  await firstSync();
}
/* Enlace mágico: si el correo trae un enlace, los tokens llegan en la dirección */
function captureAuthRedirect() {
  if (!/access_token=/.test(location.hash)) return false;
  const q = new URLSearchParams(location.hash.slice(1));
  setSession(sessionFrom({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: q.get('expires_in') }));
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
