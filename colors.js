/* Boldup — colores con sentido: cada tarea u objetivo toma el color de su tema según lo que dices
   («dentista» → Salud, «informe» → Trabajo), y los colores se pueden nombrar («las tareas verdes»). */
'use strict';

/* Temas: nombre (es también la etiqueta), color y palabras que lo delatan (sin tildes, al principio de palabra) */
const CONTEXTS = [
  { name: 'Salud', color: '#ff2d55', words: ['dentista', 'medic', 'doctor', 'doctora', 'hospital', 'urgencias', 'farmacia', 'pastilla', 'analisis', 'fisio', 'psicolog', 'terapia', 'salud', 'vacuna', 'oculista', 'ginecolog', 'dermatolog', 'pediatra', 'enfermer', 'receta', 'revision medica', 'ambulatorio', 'centro de salud', 'dormir', 'dieta', 'nutricion', 'comer bien', 'comer sano', 'alimentacion', 'vida sana', 'saludable', 'estres', 'ansiedad'] },
  { name: 'Deporte', color: '#30b0c7', words: ['gimnasio', 'gym', 'correr', 'carrera', 'entrenar', 'entreno', 'yoga', 'pilates', 'nadar', 'natacion', 'piscina', 'futbol', 'padel', 'tenis', 'bici', 'ciclismo', 'caminar', 'andar', 'deporte', 'km', 'kilometros', 'crossfit', 'partido', 'maraton', 'estirar', 'abdominales', 'pesas', 'ejercicio', 'baloncesto', 'escalar', 'senderismo', 'cuerpo', 'en forma', 'forma fisica', 'adelgazar', 'peso', 'musculo'] },
  { name: 'Trabajo', color: '#ff9500', words: ['trabajo', 'curro', 'informe', 'reunion', 'cliente', 'jefe', 'jefa', 'oficina', 'email', 'correo', 'mail', 'presentacion', 'entrega', 'propuesta', 'excel', 'contrato', 'entrevista', 'proveedor', 'ventas', 'factura a', 'presupuesto para', 'llamada con', 'equipo', 'linkedin', 'cv', 'curriculum', 'web', 'codigo', 'programar', 'deploy', 'publicar'] },
  { name: 'Estudio', color: '#5856d6', words: ['estudi', 'examen', 'apuntes', 'repasar', 'repaso', 'deberes', 'clase', 'universidad', 'uni', 'tema', 'curso', 'tfg', 'tfm', 'asignatura', 'ejercicios', 'practicas', 'oposicion', 'temario', 'idioma', 'ingles', 'aprender', 'tutoria', 'matricula', 'selectividad', 'trabajo de clase', 'resumen de'] },
  { name: 'Casa', color: '#a2845e', words: ['limpiar', 'limpieza', 'lavadora', 'lavavajillas', 'compra', 'comprar', 'super', 'mercadona', 'cocinar', 'casa', 'piso', 'ordenar', 'basura', 'plancha', 'fregar', 'barrer', 'aspirar', 'reparar', 'arreglar', 'fontanero', 'mudanza', 'plantas', 'regar', 'ropa', 'tender', 'nevera', 'cocina', 'bano', 'habitacion'] },
  { name: 'Dinero', color: '#0f766e', words: ['pagar', 'pago', 'factura', 'banco', 'ahorr', 'dinero', 'presupuesto', 'hacienda', 'impuesto', 'renta', 'alquiler', 'transferencia', 'seguro', 'recibo', 'inversion', 'invertir', 'gastos', 'nomina', 'hipoteca', 'tarjeta', 'bizum', 'cuenta', 'cobrar', 'deuda'] },
  { name: 'Personal', color: '#34c759', words: ['mama', 'papa', 'madre', 'padre', 'familia', 'abuel', 'herman', 'tio', 'tia', 'prim', 'cumple', 'amigo', 'amiga', 'novia', 'novio', 'pareja', 'regalo', 'llamar a', 'visitar', 'hijo', 'hija', 'boda', 'aniversario', 'diario', 'meditar', 'pensar'] },
  { name: 'Ocio', color: '#af52de', words: ['cine', 'pelicula', 'serie', 'concierto', 'viaje', 'viajar', 'vacaciones', 'vuelo', 'avion', 'hotel', 'quedar', 'fiesta', 'cena con', 'jugar', 'juego', 'leer', 'libro', 'museo', 'escapada', 'playa', 'teatro', 'musica', 'guitarra', 'piano', 'dibujar', 'pintar', 'foto', 'festival', 'excursion', 'restaurante', 'cervezas', 'tapas'] },
];

/* El tema más probable del texto, o null */
function contextOf(text) {
  const n = ' ' + norm(text).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null, score = 0;
  for (const c of CONTEXTS) {
    let s = 0;
    for (const w of c.words) if (n.includes(' ' + w)) s += w.includes(' ') ? 2 : 1;
    if (s > score) { best = c; score = s; }
  }
  return best;
}
/* La etiqueta del tema (la tuya si ya existe con ese nombre; si no, se crea con su color) */
function contextTag(ctx, create = true) {
  let tg = state.tags.find(x => norm(x.name) === norm(ctx.name));
  if (!tg && create) { tg = { id: uid(), name: ctx.name, color: ctx.color }; state.tags.push(tg); }
  return tg;
}
const contextColor = ctx => { const tg = contextTag(ctx, false); return tg ? tg.color : ctx.color; };

/* ---------- Nombres de colores ---------- */
function hexHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16), r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}
/* rojo, rosa, naranja, amarillo, verde, turquesa, azul, morado, marron, gris */
function colorFamily(hex) {
  const c = hexHsl(hex);
  if (!c) return null;
  if (c.s < .2 || c.l < .1) return 'gris';
  const h = c.h;
  if (h >= 15 && h < 50 && (c.s < .45 || c.l < .3)) return 'marron';
  if (h < 15 || h >= 340) return 'rojo';
  if (h < 50) return 'naranja';
  if (h < 68) return 'amarillo';
  if (h < 178) return 'verde';
  if (h < 196) return 'turquesa';
  if (h < 236) return 'azul';
  if (h < 300) return 'morado';
  return 'rosa';
}
const COLOR_NAMES = { rojo: 'rojo', rosa: 'rosa', naranja: 'naranja', amarillo: 'amarillo', verde: 'verde', turquesa: 'turquesa', azul: 'azul', morado: 'morado', marron: 'marrón', gris: 'gris' };
const COLOR_WORD_RE = /\b(roj[oa]s?|rosas?|rosad[oa]s?|rosita|naranjas?|amarill[oa]s?|verdes?|turquesas?|celestes?|cian|azul(?:es)?|morad[oa]s?|lilas?|violetas?|purpuras?|marron(?:es)?|grises|gris)\b/;
function familyOfWord(w) {
  w = norm(w);
  if (/^roj/.test(w)) return 'rojo';
  if (/^ros/.test(w)) return 'rosa';
  if (/^naranj/.test(w)) return 'naranja';
  if (/^amarill/.test(w)) return 'amarillo';
  if (/^verde/.test(w)) return 'verde';
  if (/^(turquesa|celeste|cian)/.test(w)) return 'turquesa';
  if (/^azul/.test(w)) return 'azul';
  if (/^(morad|lila|violeta|purpura)/.test(w)) return 'morado';
  if (/^marron/.test(w)) return 'marron';
  if (/^gris/.test(w)) return 'gris';
  return null;
}
/* El color con el que se ve una tarea: su primera etiqueta; si no, su proyecto; si no, su objetivo */
function taskColor(t) {
  const tg = (t.tags || []).map(id => tag(id)).find(Boolean);
  if (tg) return tg.color;
  const p = t.projectId && project(t.projectId);
  if (p) return p.color;
  const g = t.goalId && goal(t.goalId);
  return g ? g.color : null;
}
/* Un color de la paleta de esa familia (para pintar un objetivo o una etiqueta nueva) */
const paletteColor = fam => COLORS.find(c => colorFamily(c) === fam) || { rojo: '#ff3b30', rosa: '#ff6fae', naranja: '#ff9500', amarillo: '#ffcc00', verde: '#34c759', turquesa: '#30b0c7', azul: '#007aff', morado: '#af52de', marron: '#a2845e', gris: '#8e8e93' }[fam];

/* Etiquetas de vista previa («📅 Mañana», «● Salud»…): la del tema lleva su punto de color */
function foundChips(found) {
  return found.map(x => {
    if (String(x).startsWith('● ')) {
      const name = String(x).slice(2), ctx = CONTEXTS.find(c => c.name === name);
      return `<span class="tag dot" style="--c:${ctx ? contextColor(ctx) : 'var(--accent)'}">${esc(name)}</span>`;
    }
    return `<span class="tag">${esc(x)}</span>`;
  }).join('');
}

/* ---------- Resumir un deseo en un título corto ----------
   «quiero mejorar mi cuerpo y comer bien» → «Deporte y vida sana». Sin inteligencia artificial: reconoce
   temas habituales por sus palabras. Si no reconoce nada devuelve null y se queda tu frase. */
const TOPICS = [
  ['deporte', ['cuerpo', 'forma fisica', 'en forma', 'deporte', 'ejercicio', 'gimnasio', 'gym', 'correr', 'entrenar', 'musculo', 'adelgazar', 'perder peso', 'bajar de peso', 'kilos', 'fuerte', 'flexib']],
  ['vida sana', ['comer bien', 'comer sano', 'comer mejor', 'alimentacion', 'dieta', 'nutricion', 'comida sana', 'vida sana', 'saludable', 'beber agua', 'dejar de fumar', 'alcohol', 'azucar']],
  ['descanso', ['dormir', 'descansar', 'sueno', 'acostarme', 'madrugar']],
  ['salud mental', ['estres', 'ansiedad', 'meditar', 'mente', 'tranquil', 'calma', 'feliz', 'autoestima', 'emocion']],
  ['finanzas', ['ahorrar', 'ahorro', 'dinero', 'gastar menos', 'gastos', 'deudas', 'invertir', 'presupuesto', 'ganar mas']],
  ['estudios', ['estudiar', 'aprobar', 'examen', 'notas', 'carrera universitaria', 'oposicion']],
  ['idiomas', ['ingles', 'idioma', 'frances', 'aleman', 'italiano', 'chino']],
  ['aprendizaje', ['aprender', 'curso', 'formarme', 'habilidad']],
  ['trabajo', ['trabajo', 'carrera profesional', 'ascenso', 'empleo', 'curro', 'negocio', 'emprender', 'clientes']],
  ['relaciones', ['familia', 'amigos', 'pareja', 'relaciones', 'gente', 'social']],
  ['lectura', ['leer', 'libros', 'lectura']],
  ['orden en casa', ['ordenar', 'orden', 'limpiar', 'casa', 'piso']],
  ['productividad', ['procrastinar', 'productiv', 'organizar', 'organizarme', 'disciplina', 'constancia', 'habitos', 'concentr', 'movil', 'redes sociales']],
  ['creatividad', ['dibujar', 'pintar', 'escribir', 'musica', 'tocar', 'guitarra', 'piano', 'crear']],
];
const WISH = /^(?:quiero|quisiera|me gustaria|necesito|tengo que|deberia|debo|mi objetivo es|me propongo|voy a|intentar|empezar a|mejorar)\b/;
function summarize(text) {
  const n = ' ' + norm(text).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (!WISH.test(n.trim()) && n.trim().split(' ').length < 8) return null;
  const hits = TOPICS.filter(([, ws]) => ws.some(w => n.includes(' ' + w))).map(([t]) => t);
  if (!hits.length) return null;
  /* Con un solo tema, solo si la frase es vaga («mejorar…», «cuidarme…»); si es concreta, se queda tal cual */
  if (hits.length === 1 && !/ (?:mejorar|cambiar|cuidar|cuidarme|ser mas|estar mas|estar mejor|sentirme|llevar una|tener mas|tener una|empezar a|mi vida|en general) /.test(n)) return null;
  const list = hits.slice(0, 3).map(x => x.toLowerCase());
  const s = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1];
  return cap(s);
}
