# Arduinator

Organismo pseudoautopoiético de Chamalnquimyst Labs: un nodo de sensores y efectores acoplado a un invernadero en Llanquihue que regula su medio, aprende de la planta y hace audible al territorio.

## Contenido

- `pi/` — **el programa de la placa madre**: la Raspberry Pi 4 conectada a los Arduinos, con panel web en la red local. Empieza por [pi/README.md](pi/README.md).
- `index.html` — simulador autónomo en el navegador (clima estacional, física del invernadero, sistema nervioso, modo puente con orquesta orgánica).
- `samples/` — bancos de muestras orquestales que usan el simulador y el panel.
- `canto_arduinator.py` — motor de sonificación en Python (lo usa la Pi para cantar por sus parlantes).
- `fuente/` — módulos de la interfaz (`sim.js`, `audio.js`, `orquesta.js`, `ui.js`) y la plantilla; `build.py` arma las dos páginas.

## Probar el simulador

Las muestras se cargan con `fetch`, así que la página debe servirse por HTTP:

```
cd arduinator
python3 -m http.server 8000
```

y abrir http://localhost:8000. También funciona en GitHub Pages.

## Créditos

Muestras: FluidR3 SoundFont © Frank Wen, licencia MIT (vía `soundfont-for-samplers`).
