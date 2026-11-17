// Boldup — lee un calendario .ics (Google, Outlook, iCloud) para la app.
// Los navegadores no pueden leer Google Calendar directamente (CORS), así que pasa por aquí.
// Solo para usuarios con sesión iniciada y solo hacia servidores de calendarios conocidos.
// "Verify JWT" debe estar desactivado: la sesión se comprueba aquí dentro.

const URL_ = Deno.env.get('SUPABASE_URL')!;
function publicKey(): string {
  try {
    const all = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const k = all.default || Object.values(all)[0];
    if (k) return k as string;
  } catch (_) { /* clave antigua */ }
  return Deno.env.get('SUPABASE_ANON_KEY') || '';
}
const ALLOWED = [/(^|\.)google\.com$/, /(^|\.)googleusercontent\.com$/, /(^|\.)outlook\.(com|live\.com|office365\.com|office\.com)$/, /(^|\.)live\.com$/, /(^|\.)icloud\.com$/, /(^|\.)apple\.com$/, /(^|\.)fastmail\.com$/, /(^|\.)proton\.me$/, /(^|\.)yahoo\.com$/];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: string, status = 200, type = 'text/plain; charset=utf-8') => new Response(body, { status, headers: { ...cors, 'Content-Type': type } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply('Método no permitido', 405);
  const auth = req.headers.get('Authorization') || '';
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: publicKey(), Authorization: auth } });
  if (!who.ok) return reply('Inicia sesión en la app para leer calendarios', 401);

  let url: URL;
  try {
    const { url: raw } = await req.json();
    url = new URL(String(raw).trim().replace(/^webcal:\/\//i, 'https://'));
  } catch (_) { return reply('Dirección no válida', 400); }
  if (url.protocol !== 'https:') return reply('La dirección debe ser https', 400);
  if (!ALLOWED.some(re => re.test(url.hostname))) return reply('Solo se admiten calendarios de Google, Outlook, iCloud, Fastmail, Proton o Yahoo', 400);

  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'P-Organizer-Calendar/1.0' } });
  if (res.url && !ALLOWED.some(re => re.test(new URL(res.url).hostname))) return reply('El calendario redirige a otro sitio', 400);
  if (!res.ok) return reply(res.status === 404 ? 'No se encuentra ese calendario. ¿Has copiado la dirección secreta completa?' : `El calendario respondió ${res.status}`, 502);
  const text = await res.text();
  if (text.length > 8_000_000) return reply('El calendario es demasiado grande', 413);
  return reply(text, 200, 'text/calendar; charset=utf-8');
});
