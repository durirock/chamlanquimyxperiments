# Killer Pendiente · web (celular y PC)

Usa los mismos datos de Firebase que kpmovil (`config.js`, `firestore.rules` y `vendor/` vienen de ahí, sin cambios).
Reglas de Pv, niveles, extensiones, cierre "en mi vida", objetivos semanales y recompensas: idénticas a kp828.py.

## Publicar
1. Copia esta carpeta al repo (por ejemplo `chamlanquimyxperiments/kp/`) y súbela a GitHub Pages.
2. Si el dominio es nuevo, agrégalo en Firebase → Authentication → Settings → Authorized domains.
3. Ábrela en Chrome y elige "Instalar app" / "Agregar a pantalla de inicio".

## Ventana flotante
- PC (Chrome / Edge): al iniciar el timer se abre una ventana siempre encima, con "listo", "me distraje"
  y todas las preguntas de cierre dentro de ella.
- Android (Chrome): el timer flota sobre cualquier app. Si no aparece, revisa
  Ajustes de Android → Apps → Chrome → Pantalla en pantalla = permitido.
  Al terminar llega una notificación (acepta el permiso la primera vez).
- iPhone (Safari): flota como video; mismas notas.
- Botón ⧉ en el timer para abrirla a mano. Se desactiva en Ser → Ajustes.

## Captura rápida
`llamar al dentista !A 15m 40pv #semanal #grande` — si falta Pv o duración se abre el formulario (KP exige ambos).
