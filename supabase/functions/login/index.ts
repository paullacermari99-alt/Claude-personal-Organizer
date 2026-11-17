// Boldup — entrar con el nick en vez del email.
// Busca el email de ese nick con la clave del servidor (nunca se lo devuelve a nadie) y pide la sesión
// a Supabase Auth con la contraseña: así el email no se filtra y Auth aplica sus límites de intentos.
// "Verify JWT" debe estar desactivado (se usa antes de tener sesión).

const URL_ = Deno.env.get('SUPABASE_URL')!;
function candidateKeys(): string[] {
  const out: string[] = [];
  try {
    const all = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    for (const v of Object.values(all)) if (typeof v === 'string') out.push(v);
  } catch (_) { /* sin claves nuevas */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) out.push(legacy);
  return out;
}
function publicKey(): string {
  try {
    const all = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const k = all.default || Object.values(all)[0];
    if (k) return k as string;
  } catch (_) { /* clave antigua */ }
  return Deno.env.get('SUPABASE_ANON_KEY') || '';
}
const authHeaders = (k: string): Record<string, string> => ({ apikey: k, ...(k.startsWith('eyJ') ? { Authorization: `Bearer ${k}` } : {}) });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const WRONG = { error_description: 'Invalid login credentials' };

async function emailOf(nick: string): Promise<string | null> {
  for (const k of candidateKeys()) {
    const r = await fetch(`${URL_}/rest/v1/profiles?select=id&username=eq.${encodeURIComponent(nick)}`, { headers: authHeaders(k) });
    if (!r.ok) continue;
    const rows = await r.json();
    if (!rows[0]) return null;
    const u = await fetch(`${URL_}/auth/v1/admin/users/${rows[0].id}`, { headers: authHeaders(k) });
    if (!u.ok) continue;
    return (await u.json()).email || null;
  }
  return null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let nick = '', password = '';
  try { const b = await req.json(); nick = String(b.nick || '').trim().toLowerCase().replace(/^@/, ''); password = String(b.password || ''); }
  catch (_) { return json(WRONG, 400); }
  if (!/^[a-z0-9][a-z0-9_.]{2,19}$/.test(nick) || password.length < 6) return json(WRONG, 400);
  const email = await emailOf(nick);
  // Misma respuesta si el nick no existe: no se puede averiguar quién tiene cuenta
  if (!email) { await new Promise(r => setTimeout(r, 400)); return json(WRONG, 400); }
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publicKey(), 'Content-Type': 'application/json', 'X-Forwarded-For': req.headers.get('x-forwarded-for') || '' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    // «Email not confirmed» sí se cuenta: solo lo ve quien sabe la contraseña
    return json(/not confirmed/i.test(JSON.stringify(body)) ? { error_description: 'Email not confirmed' } : WRONG, r.status === 429 ? 429 : 400);
  }
  return json(body);
});
