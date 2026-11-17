/* P Organizer — apuntar tareas hablando («dentista mañana a las 10»).
   Usa el dictado del navegador (gratis, sin cuentas). El texto entendido se escribe en la casilla
   y debajo salen las etiquetas de fecha y hora: nada se guarda hasta que pulsas + o Guardar. */
'use strict';

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceOK = !!SpeechRec;
I.mic = svg('<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>', 'stroke-width="2.1"');

/* Botón de micrófono; no aparece si el navegador no sabe dictar */
const micBtn = (cls = '') => voiceOK ? `<button type="button" class="icon-btn round mic-btn ${cls}" aria-label="Dictar la tarea" title="Dictar">${I.mic}</button>` : '';

/* Limpia lo que devuelve el dictado: «Recuérdame que…», «10:00 a. m.», el punto final */
function cleanVoice(s) {
  return String(s || '')
    .replace(/\b([ap])\.\s?m\./gi, (m0, x) => x.toLowerCase() + 'm')
    .replace(/^\s*(?:recu[eé]rdame(?:\s+que)?|ap[uú]nta(?:me)?|a[nñ]ade|anota(?:me)?|nueva tarea|tarea)[\s,:]+/i, '')
    .replace(/[.。]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let voiceRec = null;
function stopDictation() { if (voiceRec) try { voiceRec.stop(); } catch (_) { /* ya parado */ } }

/* Escucha y va escribiendo en la casilla. Al terminar deja la casilla lista para revisar y guardar. */
function startDictation(input, btn) {
  if (!voiceOK || !input) return;
  if (voiceRec) { const same = voiceRec._input === input; stopDictation(); if (same) return; }
  const rec = new SpeechRec();
  rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec._input = input;
  const base = input.value.trim(), ph = input.placeholder;
  let heard = '', failed = false;
  const put = text => {
    input.value = (base ? base + ' ' : '') + text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  rec.onresult = e => {
    if (!input.isConnected) { stopDictation(); return; }
    heard = Array.from(e.results).map(r => r[0].transcript).join(' ');
    put(heard);
  };
  rec.onerror = e => {
    failed = true;
    const msg = {
      'not-allowed': 'Para dictar, deja que la app use el micrófono (en los ajustes del navegador).',
      'service-not-allowed': 'Aquí no se puede dictar. Usa el micrófono del teclado: funciona igual.',
      'no-speech': 'No te he oído. Pulsa el micrófono y prueba otra vez.',
      'audio-capture': 'No encuentro el micrófono.',
      network: 'Para dictar hace falta conexión a internet.',
    }[e.error];
    if (msg) toast(msg);
  };
  rec.onend = () => {
    if (voiceRec === rec) voiceRec = null;
    btn && btn.classList.remove('listening');
    input.placeholder = ph;
    if (heard) { put(cleanVoice(heard)); input.dataset.voiced = '1'; }
    else if (!failed) toast('No te he oído. Pulsa el micrófono y prueba otra vez.');
  };
  try { rec.start(); } catch (_) { toast('No se ha podido empezar a dictar.'); return; }
  voiceRec = rec;
  btn && btn.classList.add('listening');
  input.placeholder = 'Te escucho…';
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) { /* sin vibración */ }
}

/* Pulsar un micrófono: dicta en la casilla de su formulario */
document.addEventListener('click', e => {
  const b = e.target.closest('.mic-btn');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const box = b.closest('.mic-in, form');
  startDictation(box && box.querySelector('input[name=title]'), b);
}, true);

/* Tras guardar algo dictado: aviso con «Deshacer», que la borra del todo (sin papelera) */
function voiceSavedToast(t, found) {
  toast('Añadida' + (found && found.length ? ' · ' + found.join(' · ') : ': ' + t.title), {
    action: 'Deshacer',
    onAction: () => {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      state.events = state.events.filter(ev => ev.taskId !== t.id);
      save(); rerender(); toast('Quitada');
    },
  });
}

/* Si se cierra la hoja mientras escucha, deja de escuchar */
const voiceModal = document.getElementById('modal');
if (voiceModal) voiceModal.addEventListener('close', () => { if (voiceRec && (!voiceModal.open || !voiceRec._input.isConnected)) stopDictation(); });
