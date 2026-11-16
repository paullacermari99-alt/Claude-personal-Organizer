# P Organizer

Planificador personal para no procrastinar: tu **día**, tus **proyectos** y tus **objetivos**, en el móvil y en el ordenador.

Es una web instalable (PWA): sin servidor, sin dependencias y funciona sin conexión.

## Qué incluye

- **Semana**: calendario de 7 días con tus tareas y bloques. Arrastra tareas entre días o a una hora para reservarles tiempo; arrastra bloques para moverlos o su borde para cambiar la duración. En el móvil, mantén pulsado para arrastrar.
- **Hoy**: las 3 tareas importantes, lista de tareas, bloques de tiempo (con marca «AHORA»), tareas atrasadas y pendientes sin fecha, y un temporizador de enfoque (pomodoro).
- **Proyectos**: con estado, color, notas, objetivo al que contribuyen y progreso según sus tareas.
- **Objetivos**: con «para qué», fecha límite, área, proyectos vinculados y progreso.
- **Ajustes**: duración del enfoque, exportar/importar copia de seguridad (JSON).

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

Al cambiar archivos, sube también el número `?v=` de los CSS/JS en `index.html` y en `sw.js`.

Gestos en el móvil: desliza una tarea a la derecha para completarla y a la izquierda para pasarla a mañana; arrastra una hoja hacia abajo para cerrarla.
