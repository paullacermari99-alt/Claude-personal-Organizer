/* P Organizer — conexión con Supabase (sincronización y avisos con la app cerrada).
   La URL y la clave «anon/publishable» son públicas por diseño: la seguridad la dan las reglas RLS de supabase/schema.sql.
   Si están vacías, la app funciona igual, solo en este dispositivo. */
window.PO_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  vapidPublicKey: '',
};
