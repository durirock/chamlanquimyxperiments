# Killer Pendiente · web (celular y PC)

Usa los mismos datos de Firebase que kpmovil (`config.js`, `firestore.rules` y `vendor/` vienen de ahí, sin cambios).
Reglas de Pv, niveles, extensiones, cierre "en mi vida", objetivos semanales y recompensas: idénticas a kp828.py.

## Dónde está
https://chamalnquimyst.com/kpweb/ — mismo dominio que kpmovil, así que Firebase ya lo acepta.
Ábrela en Chrome y elige "Instalar app" / "Agregar a pantalla de inicio".

## Bitácoras (personal, cósmica y Gran Bitácora)
Usan tres colecciones nuevas: `bitacora`, `bitacora_cosmica` y `gran_bitacora`, con el mismo formato que
history.json, cosmic_history.json y gran_history.json de KP. Para que funcionen hay que publicar las reglas
de `firestore.rules` de esta carpeta (Firebase → Firestore → Reglas → pegar → Publicar). Sin eso, todo lo
demás funciona y la bitácora avisa "No se pudo guardar".
Para que el PC las vea, kp_nube.py debe sincronizar esas tres colecciones con sus archivos.

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
