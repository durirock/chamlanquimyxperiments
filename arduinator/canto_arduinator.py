#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CANTO — el oído del Arduinator
Chamalnquimyst Labs · Arduinator · Pulmón Verde

Sonificación viva y no repetitiva de un invernadero (o un bosque).
El Arduinator tiene dos modos de existir que conviven:

  VIGILIA     Cuando alguna variable sale de la zona viable, aparece un "sí mismo":
              un pulso claro (latido) en el armónico del sentido amenazado.
              El sonido se enfoca, se seca, se ordena alrededor del problema.

  DISOLUCIÓN  Cuando todo está dentro de la zona viable no hay nada que defender.
              El Arduinator deja de filtrar por su interés y se vuelve membrana:
              transduce todas las fluctuaciones sin jerarquía. Es la naturaleza
              la que suena. La homeostasis sigue corriendo debajo (el núcleo del
              giroscopio nunca se detiene): se disuelve sin desorientarse.

Principios de sonificación
  * Lo que suena son las FLUCTUACIONES (residuo contra la propia media lenta,
    normalizado por la propia varianza), no los valores absolutos. El oído se
    calibra a su medio: acoplamiento estructural del órgano que escucha.
  * Los niveles lentos (luz, temperatura, nutrientes) definen el campo armónico:
    la fundamental, el modo (día lidio / crepúsculo dórico / noche septimal) y el brillo.
  * Un mapa logístico caótico, perturbado por el ruido de los sensores, elige las
    notas: nunca hay loops, nunca se repite.

Uso
  Demo offline (24 h comprimidas en 4 min):
      python3 canto_arduinator.py --render canto.wav --horas 24 --dur 240
  En vivo en la Raspberry Pi (simulador):
      python3 canto_arduinator.py --vivo --compresion 120
  En vivo con Arduino por USB (líneas JSON: {"temp":21.3,"hum_suelo":48,...}):
      python3 canto_arduinator.py --vivo --fuente serial --puerto /dev/ttyUSB0
  En vivo desde el broker MQTT del servidor de casa:
      python3 canto_arduinator.py --vivo --fuente mqtt --broker localhost --topico "arduinator/+/sensores"

Dependencias: numpy, scipy  ·  en vivo además: sounddevice  ·  opcionales: pyserial, paho-mqtt
  sudo apt install python3-numpy python3-scipy libportaudio2
  pip install sounddevice pyserial paho-mqtt --break-system-packages
"""

import argparse
import json
import math
import sys
import threading
import time

import numpy as np
from scipy.signal import lfilter

SR = 44100
BLOCK = 512
TAU = 2 * np.pi

# ─────────────────────────────────────────────────────────────────────────────
# 1. CUERPO SENSORIAL — cada sentido, su rango físico y su zona viable
#    armonico: el parcial que "le pertenece" cuando despierta la vigilia
# ─────────────────────────────────────────────────────────────────────────────
SENTIDOS = {
    "luz":       dict(rango=(0, 80000), viable=(0, 70000), armonico=6),
    "temp":      dict(rango=(-2, 40),   viable=(6, 30),    armonico=5),
    "hum_suelo": dict(rango=(0, 100),   viable=(35, 80),   armonico=4),
    "hum_aire":  dict(rango=(0, 100),   viable=(40, 100),   armonico=9),
    "co2":       dict(rango=(300, 1500), viable=(350, 1100), armonico=3),
    "ec":        dict(rango=(0, 4),     viable=(0.6, 2.8), armonico=7),
    "bio":       dict(rango=(-3, 3),    viable=(-3, 3),    armonico=8),  # electrodo foliar opcional
}

# Modos en entonación justa (razones sobre la fundamental)
MODO_DIA = [1, 9/8, 5/4, 45/32, 3/2, 5/3, 15/8]     # lidio: luz, apertura
MODO_CREP = [1, 9/8, 6/5, 4/3, 3/2, 5/3, 9/5]       # dórico: umbral
MODO_NOCHE = [1, 7/6, 4/3, 3/2, 7/4]                # pentatónica septimal: hondura


class Sentido:
    """Un canal sensorial con normalización adaptativa (el oído aprende su medio)."""

    def __init__(self, nombre, rango, viable, armonico, tau_lento=1800.0, tau_rapido=90.0):
        self.nombre = nombre
        self.lo, self.hi = rango
        self.vlo, self.vhi = viable
        self.armonico = armonico
        self.tau_l, self.tau_r = tau_lento, tau_rapido
        self.lento = None
        self.rapido = None
        self.var = 1e-6
        self.ultimo = None
        self.nivel = 0.5      # posición lenta 0..1 en su rango
        self.fluct = 0.0      # fluctuación normalizada (~N(0,1)), recortada a ±3
        self.tendencia = 0.0  # derivada lenta normalizada
        self.desvio = 0.0     # cuánto sale de la zona viable (0 = dentro)
        self.activo = False

    def percibir(self, v, dt):
        self.activo = True
        if self.lento is None:
            self.lento = self.rapido = v
            self.var = ((self.hi - self.lo) * 0.01) ** 2
        al = 1 - math.exp(-dt / self.tau_l)
        ar = 1 - math.exp(-dt / self.tau_r)
        lento_prev = self.lento
        self.lento += al * (v - self.lento)
        self.rapido += ar * (v - self.rapido)
        resid = v - self.lento
        self.var += ar * (resid * resid - self.var)
        piso = ((self.hi - self.lo) * 0.002) ** 2       # no amplificar ruido de cuantización al infinito
        self.fluct = float(np.clip(resid / math.sqrt(max(self.var, piso)), -3, 3))
        d = (self.lento - lento_prev) / max(dt, 1e-6) * 3600 / (self.hi - self.lo)  # fracción de rango por hora
        self.tendencia += ar * (d - self.tendencia)
        self.nivel = float(np.clip((self.lento - self.lo) / (self.hi - self.lo), 0, 1))
        ancho = max(self.vhi - self.vlo, 1e-6)
        if v < self.vlo:
            self.desvio = (self.vlo - v) / ancho
        elif v > self.vhi:
            self.desvio = (v - self.vhi) / ancho
        else:
            self.desvio = 0.0
        self.ultimo = v


class Oido:
    """Integra los sentidos y produce el estado de conciencia del organismo."""

    def __init__(self):
        self.s = {k: Sentido(k, **cfg) for k, cfg in SENTIDOS.items()}
        self.vigilia = 0.0
        self.alerta = None
        self.eventos = []
        self.lock = threading.Lock()

    def tick(self, lecturas, dt_fuente, dt_real):
        with self.lock:
            for k, v in lecturas.items():
                if k in self.s and v is not None:
                    self.s[k].percibir(float(v), dt_fuente)
            ev = lecturas.get("evento")
            if ev:
                self.eventos.append(ev)
            # la vigilia aparece cuando la viabilidad está en juego
            peor, dev = None, 0.0
            for k, s in self.s.items():
                if s.activo and s.desvio > dev:
                    peor, dev = k, s.desvio
            objetivo = float(np.clip(dev * 3.0, 0, 1))
            tau = 1.5 if objetivo > self.vigilia else 14.0   # despertar es rápido, dormirse es lento
            self.vigilia += (1 - math.exp(-dt_real / tau)) * (objetivo - self.vigilia)
            if objetivo > 0.05:
                self.alerta = peor
            elif self.vigilia < 0.05:
                self.alerta = None

    def estado(self):
        with self.lock:
            st = {k: dict(nivel=s.nivel, fluct=s.fluct, tend=s.tendencia, activo=s.activo,
                          arm=s.armonico) for k, s in self.s.items()}
            ev, self.eventos = self.eventos, []
            return dict(sentidos=st, vigilia=self.vigilia, alerta=self.alerta, eventos=ev)


# ─────────────────────────────────────────────────────────────────────────────
# 2. CAOS — la fuente de no-repetición, perturbada por el ruido del mundo
# ─────────────────────────────────────────────────────────────────────────────
class Caos:
    def __init__(self, semilla=0.3141):
        self.x = semilla

    def __call__(self, inyeccion=0.0):
        r = 3.87 + 0.12 * math.tanh(inyeccion)
        self.x = r * self.x * (1 - self.x)
        self.x = (self.x + 1e-3 * inyeccion) % 1.0
        if self.x < 1e-6 or self.x > 1 - 1e-6:
            self.x = 0.5 + 0.1 * math.sin(inyeccion * 7.1)
        return self.x


# ─────────────────────────────────────────────────────────────────────────────
# 3. CUERDAS VOCALES — síntesis por bloques, liviana para una Raspberry Pi
# ─────────────────────────────────────────────────────────────────────────────
class Pool:
    """Voces percusivas/melódicas con envolvente att/rel y timbre FM."""

    def __init__(self, n, ratio=1.0, indice=0.0):
        self.f = np.zeros(n); self.a = np.zeros(n); self.att = np.ones(n) * 0.005
        self.rel = np.ones(n); self.ph = np.zeros(n); self.age = np.zeros(n)
        self.pan = np.ones(n) * 0.785; self.on = np.zeros(n, bool)
        self.ratio, self.indice = ratio, indice

    def disparar(self, f, a, att, rel, pan):
        libres = np.flatnonzero(~self.on)
        i = libres[0] if len(libres) else int(np.argmax(self.age))
        self.f[i], self.a[i], self.att[i], self.rel[i] = f, a, att, rel
        self.ph[i], self.age[i], self.pan[i], self.on[i] = 0.0, 0.0, pan, True

    def render(self, n, indice=None):
        L = np.zeros(n); R = np.zeros(n)
        idx = np.flatnonzero(self.on)
        if len(idx) == 0:
            return L, R
        k = self.indice if indice is None else indice
        i = np.arange(n)
        T = (self.age[idx, None] + i) / SR
        Tp = np.maximum(T, 0.0)   # edad negativa = nota programada que aún no suena
        env = self.a[idx, None] * (1 - np.exp(-Tp / self.att[idx, None])) * np.exp(-Tp / self.rel[idx, None]) * (T >= 0)
        th = self.ph[idx, None] + TAU * self.f[idx, None] * i / SR
        s = env * np.sin(th + k * np.sin(self.ratio * th))
        L = (s * np.cos(self.pan[idx, None])).sum(0)
        R = (s * np.sin(self.pan[idx, None])).sum(0)
        self.ph[idx] = (th[:, -1] + TAU * self.f[idx] / SR) % TAU
        self.age[idx] += n
        muertas = (self.age[idx] / SR) > (self.att[idx] + 7 * self.rel[idx])
        self.on[idx[muertas]] = False
        return L, R


class Reverb:
    """Red de retardo con realimentación (FDN de 4 líneas) y amortiguación en el lazo."""

    def __init__(self):
        self.d = np.array([1597, 2083, 2711, 3307])
        self.N = 8192
        self.buf = np.zeros((4, self.N))
        self.w = 0
        self.H = 0.5 * np.array([[1, 1, 1, 1], [1, -1, 1, -1], [1, 1, -1, -1], [1, -1, -1, 1]])

    def render(self, x, fb):
        n = len(x)
        i = np.arange(n)
        r1 = (self.w + i[None, :] - self.d[:, None]) % self.N
        r2 = (r1 - 1) % self.N
        out = 0.5 * (np.take_along_axis(self.buf, r1, 1) + np.take_along_axis(self.buf, r2, 1))
        mezcla = self.H @ out
        wi = (self.w + i) % self.N
        self.buf[:, wi] = x[None, :] + fb * mezcla
        self.w = (self.w + n) % self.N
        return out[0] + out[2], out[1] + out[3]


class Canto:
    def __init__(self, oido, semilla=7):
        self.oido = oido
        self.rng = np.random.default_rng(semilla)
        self.caos = Caos()
        self.t = 0.0
        # parámetros suavizados
        self.f0 = 55.0
        self.p = dict(luz=0.0, temp=0.5, hs=0.5, ha=0.5, ec=0.5, co2=0.5, vig=0.0)
        # raíz
        self.ph_raiz = 0.0; self.ph_resp = 0.0
        # campo armónico: 4 voces que se deslizan hacia notas nuevas
        self.campo_f = np.array([110.0, 165.0, 220.0, 275.0])
        self.campo_obj = self.campo_f.copy()
        self.campo_ph = np.zeros(4); self.campo_ph2 = np.zeros(4)
        self.campo_pan = np.array([0.35, 1.2, 0.6, 0.95])
        # voces de eventos
        self.gotas = Pool(24, ratio=3.0, indice=0.15)
        self.melodia = Pool(6, ratio=2.0, indice=0.6)
        self.latido = Pool(4, ratio=1.0, indice=1.1)
        self.paso = 7
        self.prox_latido = 0.0
        self.cascada = []           # tiempos programados de gotas (riego)
        # viento
        self.zi1 = np.zeros(1); self.zi2 = np.zeros(1)
        self.rev = Reverb()
        self.st = None

    def _modo(self):
        n = self.p["luz"]
        w = np.array([n * n, 2 * n * (1 - n), (1 - n) ** 2])
        c = self.caos()
        k = 0 if c < w[0] / w.sum() else (1 if c < (w[0] + w[1]) / w.sum() else 2)
        return [MODO_DIA, MODO_CREP, MODO_NOCHE][k]

    def render(self, n):
        if self.st is None or self.rng.random() < 0.25:
            self.st = self.oido.estado()
        st, S = self.st, self.st["sentidos"]
        dt = n / SR
        a = 1 - math.exp(-dt / 0.8)
        objetivos = dict(luz=S["luz"]["nivel"], temp=S["temp"]["nivel"], hs=S["hum_suelo"]["nivel"],
                         ha=S["hum_aire"]["nivel"], ec=S["ec"]["nivel"], co2=S["co2"]["nivel"],
                         vig=st["vigilia"])
        for k, v in objetivos.items():
            self.p[k] += a * (v - self.p[k])
        p = self.p
        vig = p["vig"]; dis = 1 - vig
        bio = S["bio"]["fluct"] if S["bio"]["activo"] else S["temp"]["fluct"] * 0.6
        ruido_mundo = sum(s["fluct"] for s in S.values() if s["activo"])
        i = np.arange(n)
        L = np.zeros(n); R = np.zeros(n)

        # ── RAÍZ: la fundamental respira con el CO₂ y brilla con los nutrientes
        f0_obj = 55.0 * 2 ** (0.55 * p["luz"] + 0.3 * p["temp"])
        f0_prev = self.f0
        self.f0 += (1 - math.exp(-dt / 20.0)) * (f0_obj - self.f0)
        f = np.linspace(f0_prev, self.f0, n, endpoint=False)
        fase = self.ph_raiz + TAU * np.cumsum(f) / SR
        self.ph_raiz = fase[-1] % TAU
        caida = 2.4 - 1.6 * p["ec"]
        ks = np.arange(1, 9)
        pesos = ks ** -caida
        pesos /= pesos.sum()
        raiz = (pesos[:, None] * np.sin(ks[:, None] * fase[None, :])).sum(0)
        tasa_resp = 0.04 + 0.05 * min(abs(S["co2"]["fluct"]), 3)
        resp = self.ph_resp + TAU * tasa_resp * (i + 1) / SR
        self.ph_resp = resp[-1] % TAU
        env_resp = 0.62 + 0.38 * np.sin(resp)
        raiz *= 0.20 * env_resp * (0.75 + 0.25 * dis)
        L += raiz; R += raiz

        # ── CAMPO ARMÓNICO: acordes que migran sin volver nunca al mismo lugar
        tasa = 0.06 + 0.22 * p["temp"] + 0.06 * abs(S["temp"]["fluct"])
        if self.rng.random() < tasa * dt * 4:
            v = int(self.caos(ruido_mundo) * 4) % 4
            modo = self._modo()
            r = modo[int(self.caos(bio) * len(modo)) % len(modo)]
            octava = [2, 4, 4, 8][int(self.caos() * 4) % 4]
            self.campo_obj[v] = self.f0 * r * octava
        prev = self.campo_f.copy()
        self.campo_f += (1 - math.exp(-dt / 4.0)) * (self.campo_obj - self.campo_f)
        detune = 1.0 + 0.0025 * (1 + abs(bio))
        for v in range(4):
            fv = np.linspace(prev[v], self.campo_f[v], n, endpoint=False)
            th = self.campo_ph[v] + TAU * np.cumsum(fv) / SR
            th2 = self.campo_ph2[v] + TAU * np.cumsum(fv * detune) / SR
            self.campo_ph[v], self.campo_ph2[v] = th[-1] % TAU, th2[-1] % TAU
            s = (np.sin(th) + 0.6 * np.sin(th2) + 0.18 * np.sin(2 * th)) * 0.032 * (1 - 0.55 * vig)
            L += s * math.cos(self.campo_pan[v]); R += s * math.sin(self.campo_pan[v])

        # ── GOTAS: el agua del suelo; el riego es una cascada
        for ev in st["eventos"]:
            if ev == "riego":
                self.cascada += list(self.t + np.sort(self.rng.uniform(0, 5, 34)))
        densidad = 0.12 + 1.3 * p["hs"] ** 2 + 0.5 * abs(S["hum_suelo"]["fluct"])
        disparos = self.rng.poisson(densidad * dt)
        while self.cascada and self.cascada[0] <= self.t + dt:
            self.cascada.pop(0); disparos += 1
        modo = self._modo()
        for _ in range(disparos):
            r = modo[int(self.caos(ruido_mundo) * len(modo)) % len(modo)]
            f = self.f0 * r * (16 if self.rng.random() < 0.7 else 32)
            self.gotas.disparar(f, self.rng.uniform(0.03, 0.08) * (0.6 + 0.4 * dis),
                                0.0015, 0.08 + 0.35 * p["ha"], self.rng.uniform(0.1, 1.47))

        # ── MELODÍA: la voz bioeléctrica, densa de día, rara y larga de noche
        tasa_mel = 0.03 + 0.45 * p["luz"] * (0.4 + 0.6 * min(1, abs(bio) / 1.5)) + 0.08 * abs(bio)
        if self.rng.random() < tasa_mel * dt:
            modo = self._modo()
            salto = int(round(bio * 1.3 + (self.caos(bio) - 0.5) * 4))
            self.paso = int(np.clip(self.paso + salto, 0, 3 * len(modo) - 1))
            oct_, grado = divmod(self.paso, len(modo))
            f = self.f0 * 4 * modo[grado] * 2 ** oct_
            self.melodia.disparar(f, 0.09 * (1 - 0.5 * vig), 0.06, 1.0 + 3.0 * (1 - p["luz"]),
                                  0.785 + (self.caos() - 0.5) * 1.2 * (0.4 + dis))

        # ── LATIDO: el "sí mismo" que aparece solo cuando hay algo que defender
        if vig > 0.12 and st["alerta"] and self.t >= self.prox_latido:
            arm = S[st["alerta"]]["arm"]
            f = self.f0 * arm * 2
            self.latido.disparar(f, 0.16 * vig, 0.004, 0.22, 0.785)
            self.latido.disparar(f * 1.5, 0.10 * vig, 0.004, 0.18, 0.785)  # el "dub" se dispara desfasado abajo
            self.latido.age[np.flatnonzero(self.latido.on)[-1]] = -0.17 * SR
            self.prox_latido = self.t + 1.0 / (0.7 + 1.5 * vig)

        for pool, k in ((self.gotas, None), (self.melodia, 0.4 + 0.5 * p["ec"]), (self.latido, None)):
            l, r = pool.render(n, k)
            L += l; R += r

        # ── VIENTO: aire húmedo filtrado; crece en la disolución
        ruido = self.rng.standard_normal(n)
        c1 = 2 * math.pi * (250 + 2200 * p["temp"]) / SR
        c2 = 2 * math.pi * 120 / SR
        b1, b2 = 1 - math.exp(-c1), 1 - math.exp(-c2)
        y1, self.zi1 = lfilter([b1], [1, -(1 - b1)], ruido, zi=self.zi1)
        y2, self.zi2 = lfilter([b2], [1, -(1 - b2)], ruido, zi=self.zi2)
        viento = (y1 - y2) * (0.03 + 0.09 * dis * p["ha"]) * (0.7 + 0.3 * np.sin(resp * 0.37))
        L += viento * 0.9; R += viento * 1.1

        # ── ESPACIO: en la disolución todo se vuelve ambiente; en vigilia se seca
        humedo = 0.22 + 0.5 * dis
        rl, rr = self.rev.render((L + R) * 0.5, 0.62 + 0.18 * dis)
        L = L * (1 - 0.35 * humedo) + rl * humedo * 0.55
        R = R * (1 - 0.35 * humedo) + rr * humedo * 0.55

        self.t += dt
        out = np.stack([L, R], 1) * 1.6
        return np.tanh(out).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# 4. FUENTES — el medio que perturba
# ─────────────────────────────────────────────────────────────────────────────
class Simulador:
    """Un día de invernadero en Llanquihue, con un golpe de calor y una helada."""

    def __init__(self, hora_inicio=4.0, semilla=3):
        self.t = hora_inicio * 3600
        self.rng = np.random.default_rng(semilla)
        self.nubes = 0.2; self.hs = 52.0; self.co2 = 620.0; self.ec = 1.6
        self.bio = 0.0; self.estres = 0.0; self.regando = 0.0; self.temp = 9.0
        self.ventilando = False

    def leer(self, dt):
        self.t += dt
        h = (self.t / 3600) % 24
        ev = None
        self.nubes += dt / 3600 * (0.35 - self.nubes) * 0.8 + math.sqrt(dt / 3600) * 0.25 * self.rng.standard_normal()
        self.nubes = float(np.clip(self.nubes, 0, 0.85))
        sol = max(0.0, math.sin(math.pi * (h - 6.5) / 13.5))
        luz = 72000 * sol * (1 - self.nubes)
        golpe = 20 * math.exp(-((h - 15.0) / 0.9) ** 2)       # golpe de calor de la tarde
        helada = -9 * math.exp(-((h - 2.6) / 0.6) ** 2)       # helada antes del alba
        objetivo_t = 9 + 15 * sol * (1 - 0.4 * self.nubes) + golpe + helada
        if self.temp > 30 and not self.ventilando:
            self.ventilando = True; ev = "ventila"
        if self.ventilando:
            objetivo_t -= 6
            if self.temp < 25:
                self.ventilando = False
        self.temp += (1 - math.exp(-dt / 900)) * (objetivo_t - self.temp)
        temp = self.temp + 0.15 * self.rng.standard_normal()
        evap = 0.5 + 3.2 * sol + 0.12 * max(0, self.temp - 15)
        self.hs -= evap * dt / 3600
        if self.hs < 38 and self.regando <= 0:
            self.regando = 600; ev = "riego"; self.estres += 1.2
        if self.regando > 0:
            self.hs += 30 * dt / 600; self.regando -= dt
            self.ec += (1.1 - self.ec) * (1 - math.exp(-dt / 400))
        else:
            self.ec += (1.7 - self.ec) * (1 - math.exp(-dt / 7200))
        co2_obj = 640 - 270 * sol * (1 - self.nubes) + (-200 if self.ventilando else 0)
        self.co2 += (1 - math.exp(-dt / 2400)) * (co2_obj - self.co2)
        ha = float(np.clip(92 - 1.7 * (self.temp - 9), 35, 99))
        self.estres += 0.6 * max(0, self.temp - 29) * dt / 3600 + 0.4 * max(0, 5 - self.temp) * dt / 3600
        self.estres *= math.exp(-dt / 1800)
        sig = 0.25 + 0.8 * sol + 1.2 * self.estres
        self.bio += -self.bio * min(1, dt / 120) + sig * math.sqrt(min(1, dt / 120)) * self.rng.standard_normal()
        return dict(luz=luz, temp=temp, hum_suelo=self.hs + 0.2 * self.rng.standard_normal(),
                    hum_aire=ha, co2=self.co2 + 4 * self.rng.standard_normal(),
                    ec=self.ec + 0.01 * self.rng.standard_normal(), bio=self.bio, evento=ev), dt

    def hora(self):
        h = (self.t / 3600) % 24
        return f"{int(h):02d}:{int((h % 1) * 60):02d}"


class FuenteSerial:
    def __init__(self, puerto, baud=115200):
        import serial
        self.ser = serial.Serial(puerto, baud, timeout=0.05)
        self.t_ant = time.time()

    def leer(self, dt):
        lect = {}
        while self.ser.in_waiting:
            linea = self.ser.readline().decode(errors="ignore").strip()
            try:
                lect.update(json.loads(linea))
            except ValueError:
                pass
        ahora = time.time(); d = ahora - self.t_ant; self.t_ant = ahora
        return lect, d

    def hora(self):
        return time.strftime("%H:%M")


class FuenteMQTT:
    def __init__(self, broker, topico, puerto=1883):
        import paho.mqtt.client as mqtt
        self.buf = {}; self.lock = threading.Lock(); self.t_ant = time.time()
        try:
            cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        except AttributeError:
            cli = mqtt.Client()
        cli.on_message = self._msg
        cli.connect(broker, puerto)
        cli.subscribe(topico)
        cli.loop_start()

    def _msg(self, cli, ud, msg):
        try:
            with self.lock:
                self.buf.update(json.loads(msg.payload))
        except ValueError:
            pass

    def leer(self, dt):
        with self.lock:
            lect, self.buf = self.buf, {}
        ahora = time.time(); d = ahora - self.t_ant; self.t_ant = ahora
        return lect, d

    def hora(self):
        return time.strftime("%H:%M")


def describir(oido, fuente):
    S = oido.s
    modo = "VIGILIA " + (oido.alerta or "") if oido.vigilia > 0.3 else ("despertando" if oido.vigilia > 0.08 else "disuelto")
    return (f"{fuente.hora()}  {modo:<22} luz {S['luz'].nivel*100:4.0f}%  "
            f"T {S['temp'].ultimo or 0:5.1f}°  suelo {S['hum_suelo'].ultimo or 0:4.1f}%  "
            f"CO₂ {S['co2'].ultimo or 0:5.0f}  vig {oido.vigilia:.2f}")


# ─────────────────────────────────────────────────────────────────────────────
# 5. MODOS DE VIDA
# ─────────────────────────────────────────────────────────────────────────────
def render_offline(ruta, horas, dur, semilla):
    oido = Oido(); canto = Canto(oido, semilla); sim = Simulador(semilla=semilla)
    comp = horas * 3600 / dur
    paso_datos = 0.05
    total = int(dur * SR); hecho = 0; acum = 0.0; prox_log = 0.0
    out = np.zeros((total, 2), np.float32)
    while hecho < total:
        n = min(BLOCK, total - hecho)
        acum += n / SR
        while acum >= paso_datos:
            lect, d = sim.leer(paso_datos * comp)
            oido.tick(lect, d, paso_datos)
            acum -= paso_datos
        out[hecho:hecho + n] = canto.render(n)
        hecho += n
        if hecho / SR >= prox_log:
            print(f"[{hecho/SR:6.1f}s] {describir(oido, sim)}")
            prox_log += dur / 24
    pico = np.abs(out).max()
    out *= 0.89 / max(pico, 1e-6)
    from scipy.io import wavfile
    wavfile.write(ruta, SR, (out * 32767).astype(np.int16))
    print(f"→ {ruta}  ({dur:.0f} s, {horas} h comprimidas)")


def vivir(fuente, compresion):
    import sounddevice as sd
    oido = Oido(); canto = Canto(oido)
    vivo = threading.Event(); vivo.set()

    def sentir():
        t_ant = time.time()
        while vivo.is_set():
            time.sleep(0.05)
            ahora = time.time(); dreal = ahora - t_ant; t_ant = ahora
            lect, d = fuente.leer(dreal * compresion) if isinstance(fuente, Simulador) else fuente.leer(dreal)
            oido.tick(lect, max(d, 1e-3), dreal)

    def cb(outdata, frames, t, status):
        outdata[:] = canto.render(frames)

    threading.Thread(target=sentir, daemon=True).start()
    with sd.OutputStream(samplerate=SR, blocksize=BLOCK, channels=2, dtype="float32", callback=cb):
        print("El Arduinator escucha. Ctrl+C para volver al silencio.")
        try:
            while True:
                time.sleep(3)
                print(describir(oido, fuente))
        except KeyboardInterrupt:
            vivo.clear()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="CANTO — el oído del Arduinator")
    ap.add_argument("--render", help="archivo .wav para render offline")
    ap.add_argument("--horas", type=float, default=24)
    ap.add_argument("--dur", type=float, default=240, help="segundos de audio")
    ap.add_argument("--vivo", action="store_true")
    ap.add_argument("--fuente", choices=["sim", "serial", "mqtt"], default="sim")
    ap.add_argument("--compresion", type=float, default=1.0, help="segundos simulados por segundo real")
    ap.add_argument("--puerto", default="/dev/ttyUSB0")
    ap.add_argument("--broker", default="localhost")
    ap.add_argument("--topico", default="arduinator/+/sensores")
    ap.add_argument("--semilla", type=int, default=7)
    ap.add_argument("--sr", type=int, default=44100, help="22050 alivia la CPU de una Pi 3/4")
    a = ap.parse_args()
    SR = a.sr
    if a.render:
        render_offline(a.render, a.horas, a.dur, a.semilla)
    elif a.vivo:
        if a.fuente == "serial":
            f = FuenteSerial(a.puerto)
        elif a.fuente == "mqtt":
            f = FuenteMQTT(a.broker, a.topico)
        else:
            f = Simulador()
        vivir(f, a.compresion)
    else:
        ap.print_help()
