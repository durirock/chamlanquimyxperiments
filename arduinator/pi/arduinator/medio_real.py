"""Medio real: los Arduinos conectados por USB a la Raspberry Pi.

Protocolo (115200 baudios, una línea JSON por mensaje):
  Arduino → Pi   {"nodo":"interior","hola":1,"version":"1.0","efectores":["heat","pump",...]}
                 {"nodo":"interior","Tin":21.3,"RHin":66.2,"theta":34.1,...}
                 {"nodo":"interior","ok":{"heat":1,"pump":0}}
  Pi → Arduino   {"act":{"heat":1,"pump":0,"vent":0.35},"ttl":180}
Si un Arduino deja de recibir órdenes durante ttl segundos, vuelve a sus reglas locales de seguridad.
"""
import glob
import json
import math
import threading
import time
from datetime import datetime

from .zona import clamp, es, sol, radiacion_despejada, EFECTORES

try:
    import serial
except ImportError:                      # sin pyserial no hay hardware, pero el resto sigue
    serial = None

# rangos físicos plausibles: una lectura fuera de ellos es una falla del sensor
RANGO = {"Tin": (-30, 70), "RHin": (0, 100), "CO2": (150, 10000), "PAR": (0, 3000), "theta": (0, 100), "Tsoil": (-20, 60),
         "EC": (0, 20), "pH": (0, 14), "mv": (-500, 500), "Tout": (-40, 60), "RHout": (0, 100), "rad": (0, 1600),
         "wind": (0, 80), "rain": (0, 300), "P": (850, 1100), "tankW": (0, 100), "tankN": (0, 100), "bat": (0, 100), "pv": (0, 2000),
         "lux": (0, 200000)}
SENSORES = [k for k in RANGO if k != "lux"]


def segundos_del_anio(ts=None):
    d = datetime.fromtimestamp(ts or time.time())
    return (d - datetime(d.year, 1, 1)).total_seconds()


class Nodo(threading.Thread):
    """Un Arduino en un puerto serie. Lee en su propio hilo."""

    def __init__(self, puerto, baud, medio):
        super().__init__(daemon=True)
        self.puerto, self.baud, self.medio = puerto, baud, medio
        self.nombre = None
        self.efectores = []
        self.version = ""
        self.ultimo = 0.0
        self.ultima_linea = ""
        self.vivo = True
        self.ser = None
        self.lock = threading.Lock()

    def run(self):
        try:
            self.ser = serial.Serial(self.puerto, self.baud, timeout=1)
            time.sleep(2)                        # el Arduino se reinicia al abrir el puerto
        except Exception as e:
            self.medio.aviso(f"No pude abrir {self.puerto}: {e}")
            self.vivo = False
            return
        while self.vivo:
            try:
                raw = self.ser.readline()
            except Exception as e:
                self.medio.aviso(f"Se desconectó {self.nombre or self.puerto}: {e}")
                self.vivo = False
                break
            if not raw:
                continue
            linea = raw.decode("utf-8", "ignore").strip()
            if not linea.startswith("{"):
                continue
            try:
                msg = json.loads(linea)
            except ValueError:
                continue
            self.ultimo = time.time()
            self.ultima_linea = linea[:160]
            if "nodo" in msg:
                if self.nombre is None:
                    self.medio.aviso(f"Se presenta el nodo «{msg['nodo']}» en {self.puerto}")
                self.nombre = msg["nodo"]
            if msg.get("hola"):
                self.efectores = [e for e in msg.get("efectores", []) if e in EFECTORES]
                self.version = msg.get("version", "")
            self.medio.recibir(self, msg)
        try:
            self.ser.close()
        except Exception:
            pass

    def enviar(self, obj):
        if not self.ser or not self.vivo:
            return
        try:
            with self.lock:
                self.ser.write((json.dumps(obj, separators=(",", ":")) + "\n").encode())
        except Exception as e:
            self.medio.aviso(f"No pude escribir a {self.nombre or self.puerto}: {e}")


class MedioReal:
    simulado = False

    def __init__(self, emit, cfg):
        self.emit = emit
        self.cfg = cfg
        self.t = segundos_del_anio()
        self.sens = {}
        self.ultimo = {}                 # clave → hora de la última lectura válida
        self.act = None
        self.nodos_ = {}                 # puerto → Nodo
        self.lock = threading.Lock()
        self.avisos = []
        self.forcing = None
        self.organic = False
        self.sensFault = 0
        ic = cfg["invernadero"]
        self.inn = dict(T=15, e=1.3, CO2=420, theta=34, Tsoil=13, N=0, pH=6.3, tankW=ic["estanque_pct"], tankN=ic["fertilizante_pct"], wet=0)
        self.out = dict(T=10, RH=80, rad=0, wind=0, rain=0, cloud=0.5, P=1013)
        self.plant = dict(bio=ic["biomasa_inicial"], fruits=0, ripe=0, harvest=0, frost=0, mv=-42, stress=0, fW=1, fT=1, fN=1, P=0, ET=0)
        self.energy = dict(bat=100, pv=0, load=0)
        self.dli = 0
        self.dliDay = -1
        self.dliYesterday = 14
        self.solarIn = 0
        self.VPD = 0
        self.PAR = 0
        self.litros = 0
        self.faltantes = set(SENSORES)
        self.estimados = set()
        self.ultimo_envio = 0
        self.ultima_orden = None
        self.ultimo_escaneo = 0
        self.lecturas_imposibles = set()
        if serial is None:
            self.aviso("Falta pyserial: instala python3-serial para hablar con los Arduinos")

    # ─────────── descubrimiento de Arduinos ───────────
    def escanear(self):
        if serial is None:
            return
        puertos = set(self.cfg["arduinos"]["puertos"] or [])
        if self.cfg["arduinos"]["autodetectar"]:
            puertos |= set(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
        for p in sorted(puertos):
            n = self.nodos_.get(p)
            if n and n.vivo:
                continue
            n = Nodo(p, self.cfg["arduinos"]["baudios"], self)
            self.nodos_[p] = n
            n.start()

    def aviso(self, texto):
        with self.lock:
            self.avisos.append(texto)

    def recibir(self, nodo, msg):
        ahora = time.time()
        with self.lock:
            for k, v in msg.items():
                if k == "lux" and isinstance(v, (int, float)):
                    if nodo.nombre == "exterior":
                        if "rad" in msg:
                            continue
                        k, v = "rad", v / 120.0               # luz solar: 1 W/m² ≈ 120 lux
                    else:
                        if "PAR" in msg:
                            continue
                        k, v = "PAR", v * 0.0185              # luz solar: 1 lux ≈ 0,0185 µmol/m²·s
                if k not in RANGO or not isinstance(v, (int, float)) or isinstance(v, bool):
                    continue
                lo, hi = RANGO[k]
                if not (lo <= v <= hi) or math.isnan(v):
                    if k not in self.lecturas_imposibles:
                        self.lecturas_imposibles.add(k)
                        self.avisos.append(f"Lectura imposible de {k} en «{nodo.nombre}»: {v}. La descarto")
                    continue
                self.lecturas_imposibles.discard(k)
                self.sens[k] = float(v)
                self.ultimo[k] = ahora

    def edad(self, clave):
        u = self.ultimo.get(clave)
        return time.time() - u if u else 1e9

    def tiene_efector(self, k):
        return any(k in n.efectores for n in self.nodos_.values() if n.vivo)

    # ─────────── percibir ───────────
    def sample(self):
        with self.lock:
            avisos, self.avisos = self.avisos, []
        for a in avisos:
            self.emit("in", a, "nodo")
        fresco = {k for k in SENSORES if self.edad(k) < 120}
        self.faltantes = set(SENSORES) - fresco
        if not fresco:
            return False
        s, i, o, p = self.sens, self.inn, self.out, self.plant
        self.estimados = set()
        # el medio interior, desde los sentidos
        if "Tin" in s: i["T"] = s["Tin"]
        if "CO2" in s: i["CO2"] = s["CO2"]
        if "Tsoil" in s: i["Tsoil"] = s["Tsoil"]
        if "pH" in s: i["pH"] = s["pH"]
        if "theta" in s: i["theta"] = s["theta"]
        if "tankW" in s: i["tankW"] = s["tankW"]
        else: self.estimados.add("tankW")
        if "tankN" in s: i["tankN"] = s["tankN"]
        RH = s.get("RHin", 75)
        i["e"] = RH / 100 * es(i["T"])
        self.VPD = max(0, es(i["T"]) - i["e"])
        s["VPD"] = self.VPD
        i["wet"] = clamp(i["wet"] + (0.08 if RH > 97 else -0.04))
        # el medio exterior
        if "Tout" in s: o["T"] = s["Tout"]
        if "RHout" in s: o["RH"] = s["RHout"]
        if "wind" in s: o["wind"] = s["wind"]
        if "rain" in s: o["rain"] = s["rain"]
        if "P" in s: o["P"] = s["P"]
        clear = radiacion_despejada(self.t)
        if "rad" in s:
            o["rad"] = s["rad"]
        elif "PAR" in s:
            o["rad"] = s["PAR"] / 2.05 / 0.72
            self.estimados.add("rad")
        if clear > 60:
            o["cloud"] = clamp(((1 - o["rad"] / clear) / 0.78) ** (1 / 3.2))
        # luz que entra a la hoja
        if "PAR" in s:
            self.PAR = s["PAR"]
            self.solarIn = max(0, (s["PAR"] - (190 if self.act and self.act["led"] else 0)) / 2.05)
        else:
            self.solarIn = o["rad"] * 0.72 * (1 - 0.55 * (self.act["shade"] if self.act else 0))
            self.PAR = self.solarIn * 2.05
            self.estimados.add("PAR")
        # energía: con panel y batería medidos, o la red eléctrica
        if "bat" in s: self.energy["bat"] = s["bat"]
        if "pv" in s: self.energy["pv"] = s["pv"]
        # la hoja: con electrodo, su señal; sin él, la respuesta esperada a la luz
        if "mv" in s:
            p["mv"] = s["mv"]
        else:
            p["mv"] = -42 + 6 * (1 - math.exp(-self.PAR / 380))
            self.estimados.add("mv")
        if "EC" in s:
            i["N"] = s["EC"] * max(i["theta"], 5) / 10
        return True

    # ─────────── modelo de la planta, siguiendo al invernadero real ───────────
    def step(self, dt):
        self.t = segundos_del_anio()
        if time.time() - self.ultimo_escaneo > 10:
            self.ultimo_escaneo = time.time()
            self.escanear()
        i, p, h = self.inn, self.plant, dt / 3600
        T = i["T"]
        LAI = 0.4 + 2.6 * p["bio"]
        LAIf = 1 - math.exp(-0.7 * LAI)
        lightF = 1 - math.exp(-self.PAR / 380)
        p["fW"] = clamp((i["theta"] - 17) / 10)
        p["fT"] = (clamp((T - 5) / 4) * 0.4 if T < 9 else 0.4 + 0.6 * (T - 9) / 10 if T < 19
                   else 1 if T <= 27 else clamp(1 - (T - 27) / 10))
        EC = self.sens.get("EC", 2.0)
        p["fN"] = clamp((EC - 0.5) / 1.1) * clamp(1 - (EC - 3.4) / 2.5)
        p["P"] = lightF * p["fT"] * p["fW"] * p["fN"] * (i["CO2"] / (i["CO2"] + 280)) * 1.75
        gs = (0.08 + 0.92 * clamp(self.PAR / 250)) * (0.25 + 0.75 * p["fW"])
        p["ET"] = gs * LAIf * (0.00062 * self.solarIn + 0.16 * self.VPD)
        p["bio"] += 0.009 * p["P"] * (1 - p["bio"]) * h * (0.6 + 0.4 * LAIf)
        if T < 0.8:
            p["frost"] = min(1, p["frost"] + (1 - T) * 0.35 * h)
        else:
            p["frost"] = max(0, p["frost"] - 0.01 * h)
        p["stress"] = clamp(max(1 - p["fW"], (1 - p["fT"]) * (1 if self.PAR > 50 else 0.3), 1 - p["fN"], p["frost"],
                                self.VPD - 2.2 if self.VPD > 2.2 else 0))
        if self.act and self.act["pump"]:
            caudal = self.cfg["invernadero"]["caudal_riego_lh"]
            self.litros += caudal * h
            if "tankW" in self.estimados:
                i["tankW"] = max(0, i["tankW"] - caudal * h / self.cfg["invernadero"]["estanque_litros"] * 100)
        day = int(self.t // 86400)
        if day != self.dliDay:
            if self.dliDay >= 0:
                self.dliYesterday = self.dli
            self.dli = 0
            self.dliDay = day
        self.dli += self.PAR * dt / 1e6

    # ─────────── actuar ───────────
    def aplicar(self, act):
        ttl = self.cfg["arduinos"]["ttl_ordenes_s"]
        for n in list(self.nodos_.values()):
            if not n.vivo or not n.efectores:
                continue
            orden = {k: (round(act[k], 2) if k == "vent" else int(bool(act[k]))) for k in n.efectores}
            n.enviar({"act": orden, "ttl": ttl})
        self.ultimo_envio = time.time()

    def nodos(self):
        ahora = time.time()
        r = []
        for p, n in sorted(self.nodos_.items()):
            r.append(dict(nombre=n.nombre or "sin presentarse", puerto=p, vivo=n.vivo and (ahora - n.ultimo < 60),
                          hace=round(ahora - n.ultimo, 1) if n.ultimo else None, ultima=n.ultima_linea,
                          efectores=n.efectores, version=n.version))
        return r

    def force(self, name):
        return False
