# Arduinator · placa madre (Raspberry Pi 4)

La Raspberry Pi es el sistema nervioso central. Los Arduinos son los sentidos y los músculos: leen los sensores, mueven los relés y le hablan a la Pi por USB. La Pi integra, decide, aprende, recuerda y publica todo en la red local, para que cualquier PC del área vea el procesamiento en vivo.

```
 sensores ─▶ Arduino interior ─┐                     ┌─▶ PC en la casa  (navegador)
                               ├─ USB ─▶ Raspberry Pi ┼─▶ notebook por wifi
 sensores ─▶ Arduino exterior ─┘   ◀── órdenes ──    └─▶ teléfono
 relés    ◀─ Arduino interior                          http://arduinator.local:8080
```

## Qué hace

- **Percibe**: encuentra sola los Arduinos en `/dev/ttyACM*` y `/dev/ttyUSB*`, lee una línea JSON cada 5 s y descarta lecturas imposibles.
- **Decide**: cada minuto compara con su zona viable y ordena ventanas, calefactor, riego, fertirriego, pH, ventilador, niebla, sombra y luz.
- **Aprende**: corre sus umbrales de riego según cómo responde la planta y recalibra su modelo de transpiración.
- **Recuerda**: guarda lo aprendido y el historial en SQLite, así un corte de luz no le borra la experiencia.
- **Se cuida**: limita la duración de cada riego, deja de creerle a un sensor que se congela o calla, y si la Pi se cae, cada Arduino vuelve a reglas locales de supervivencia.
- **Se muestra**: un servidor web en la red local con el mismo panel del simulador (escena, sistema nervioso, sentidos, bitácora, nodos Arduino y modo puente sonoro) alimentado en vivo por WebSocket. Todos los que abran el panel ven el mismo organismo al mismo tiempo.
- **Canta** (opcional): el Canto suena por los parlantes de la Pi.

## Probar sin hardware

```
cd arduinator/pi
pip install aiohttp pyserial
python3 -m arduinator            # modo simulado: el invernadero de Llanquihue corre en la Pi
```

Abre `http://localhost:8080`. En simulado se puede acelerar el tiempo, saltar de estación y provocar heladas desde el panel.

## Instalar en la Raspberry Pi

1. Raspberry Pi OS Bookworm con wifi configurado.
2. Copia la carpeta `arduinator` a la Pi (o clona el repositorio).
3. `cd arduinator/pi && sudo ./instalar.sh`
4. Edita `/etc/arduinator/arduinator.toml` (modo `real`, sensores, estanque) y reinicia: `sudo systemctl restart arduinator`.
5. Desde cualquier PC de la red: **http://arduinator.local:8080** (o la IP que muestra el instalador).

Registro en vivo: `journalctl -u arduinator -f` · Historial: `http://arduinator.local:8080/api/historial.csv?horas=48`

## Los Arduinos

El firmware está en `firmware/arduinator_nodo/`. Una sola línea elige el papel del nodo:

```
#define NODO_INTERIOR 1   // aire, suelo, nutrientes y relés
#define NODO_INTERIOR 0   // estación exterior: temperatura, humedad, presión, luz, viento, lluvia
```

Activa o desactiva cada sensor con sus `#define USA_...`. Bibliotecas (gestor de bibliotecas del IDE de Arduino): ArduinoJson 6, Adafruit SHT31, Adafruit BMP280, OneWire, DallasTemperature, SparkFun SCD30, BH1750, Servo.

Relés del nodo interior: calefactor D4, bomba D5, fertirriego D6, ácido D7, ventilador D8, niebla D10, luz D11, sombra D12; ventana cenital con servo en D9.

### Protocolo (115200 baudios, una línea JSON por mensaje)

| Dirección | Mensaje |
|---|---|
| Arduino → Pi | `{"nodo":"interior","hola":1,"version":"1.0","efectores":["heat","pump",...]}` al arrancar |
| Arduino → Pi | `{"nodo":"interior","Tin":21.3,"RHin":66.2,"theta":34.1,"lux":30000,...}` cada 5 s |
| Pi → Arduino | `{"act":{"heat":1,"pump":0,"vent":0.35},"ttl":180}` cada minuto |
| Arduino → Pi | `{"nodo":"interior","ok":{"heat":1,"pump":0,"vent":0.35}}` confirmación |

Claves de sensores: `Tin RHin CO2 PAR lux theta Tsoil EC pH mv Tout RHout rad wind rain P tankW tankN bat pv`. Cualquier dispositivo que hable este protocolo (un ESP32 por USB, otro microcontrolador) puede sumarse como nodo.

## Seguridad en la red

En modo real el panel es de solo lectura: nadie puede acelerar el tiempo ni inventar heladas. Si defines `token` en la configuración, quien abra `http://arduinator.local:8080/?token=...` puede forzar efectores a mano durante un tiempo limitado. El servidor no está pensado para exponerse a internet; para verlo fuera de casa, usa una VPN como Tailscale o WireGuard.

## Estructura

```
pi/
  arduinator/          núcleo en Python
    organismo.py       percibe, compara, decide, aprende (igual en real y simulado)
    medio_real.py      los Arduinos por USB
    medio_simulado.py  el invernadero de Llanquihue en software
    memoria.py         SQLite: aprendizaje e historial
    servidor.py        panel web y WebSocket en la red local
    sonido.py          el Canto por los parlantes
  web/index.html       el panel (se arma desde ../fuente con build.py)
  firmware/            sketch de los nodos Arduino
  instalar.sh          instalación como servicio
```
