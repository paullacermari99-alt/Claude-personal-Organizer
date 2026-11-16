# P Organizer

Planificador personal para no procrastinar: tu **día**, tus **proyectos** y tus **objetivos**, en el móvil y en el ordenador.

Es una web instalable (PWA): sin servidor, sin dependencias y funciona sin conexión.

## Qué incluye

- **Hoy** (pantalla de inicio): hasta 3 prioridades con su primer paso, horario del día, tareas, vencidas y diarias pendientes (plegables). Empieza, completa, deshaz y reprograma desde la lista.
- **Semana**: vistas de día, 3 días y semana; eventos sueltos y horarios que se repiten; bloques de tiempo para tareas (arrastrar o editar fecha y hora) con aviso de solapes. El plazo de una tarea es distinto del tiempo reservado: mover el bloque no cambia el plazo. Panel con tareas sin hora, plazos cercanos y bandeja. Revisión semanal en 3 pasos.
- **Tareas**: Bandeja, Próximas, Vencidas y Hechas, con búsqueda y filtros. Notas, subtareas, prioridad, etiquetas, duración estimada, plazo, proyecto u objetivo. Solo el título es obligatorio.
- **Diarias acumulables**: cada día programado crea una tarea aunque no abras la app; las pendientes se agrupan bajo un contador y «Completar una» marca la más antigua. Se pueden pausar.
- **Objetivos**: corto, medio y largo plazo, con plazo, estado (vencido / cumplido), progreso automático o manual y siguiente tarea.
- **Proyectos**: tarjetas o lista, favoritos, orden, archivo; dentro, Resumen / Objetivos / Tareas. Icono, color y vista por defecto propios.
- **Colores y etiquetas**: un bloque usa su color, si no el de su etiqueta, si no el de su proyecto.
- **Enfoque**: desde cualquier tarea, con primer paso y temporizador opcional de 5, 15 o 25 min.
- **Ajustes**: recordatorios (bloques, plazos, resumen de diarias, horas de silencio), zona horaria, primer día de la semana, etiquetas y copia de seguridad.

Los datos se guardan en el navegador de cada dispositivo. Para pasarlos de uno a otro, usa Exportar/Importar en Ajustes.

## Publicarla gratis con GitHub Pages

1. En GitHub: **Settings → Pages**.
2. En *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
3. En un par de minutos estará en `https://<tu-usuario>.github.io/Claude-personal-Organizer/`.
4. Ábrela en el móvil e instálala: iPhone (Safari → Compartir → «Añadir a pantalla de inicio»), Android (Chrome → ⋮ → «Instalar aplicación»).

## Probar en local

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

Al cambiar archivos, sube el número de `CACHE` en `sw.js` para que los dispositivos instalados reciban la nueva versión.

Al cambiar archivos, sube también el número `?v=` de los CSS/JS en `index.html` y en `sw.js` (y `CACHE` en `sw.js`). Orden de carga: `core.js` (datos), `calendar.js`, `gestures.js`, `app.js`.

Gestos en el móvil: desliza una tarea a la derecha para completarla y a la izquierda para pasarla a mañana; arrastra una hoja hacia abajo para cerrarla.
