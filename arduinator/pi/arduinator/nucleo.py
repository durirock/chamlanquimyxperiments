"""El núcleo: hace latir al organismo, en tiempo real o simulado."""
import asyncio
import math
import time

from .zona import sol
from .organismo import Organismo
from .medio_simulado import MedioSimulado
from .medio_real import MedioReal
from .memoria import Memoria


class Nucleo:
    def __init__(self, cfg):
        self.cfg = cfg
        self.modo = cfg["general"]["modo"]
        self.speed = 60.0 if self.modo == "simulado" else 1.0
        self.paused = False
        self.organic = False
        pend = []
        emit = lambda *a: pend.append(a)
        if self.modo == "simulado":
            self.medio = MedioSimulado(emit)
            memoria = None
        else:
            self.medio = MedioReal(emit, cfg)
            memoria = Memoria(cfg["memoria"]["ruta"])
        self.org = Organismo(self.medio, cfg, memoria)
        for a in pend:
            self.org.emit(*a)
        if self.modo == "simulado":
            self.calentar()
        else:
            self.org.emit("proc", "Despierto en el invernadero real. Busco a mis Arduinos en los puertos USB.")
            self.medio.escanear()
        self.oyentes = []                         # funciones que reciben cada paso (p. ej. el sonido)

    def calentar(self):
        """En simulado, vive 48 horas antes de abrir los ojos, para tener memoria."""
        m, o = self.medio, self.org
        m.t -= 48 * 3600
        for _ in range(288 * 30):
            m.step(20)
            o.tick(20)
        o.log.clear()
        o.events.clear()
        o.emit("proc", "Despierto con 48 horas de memoria del invernadero. Escucho sin filtrar mientras todo esté en su zona.")

    # ─────────── órdenes que llegan desde la red ───────────
    def ordenar(self, cmd, autorizado):
        tipo = cmd.get("cmd")
        sim = self.modo == "simulado"
        if tipo == "manual":
            if sim or autorizado:
                k, v, minutos = cmd.get("efector"), cmd.get("valor", 0), float(cmd.get("minutos", 10))
                if k in self.org.act:
                    self.org.manual[k] = (float(v), self.medio.t + minutos * 60)
                    self.org.emit("in", f"Alguien desde la red fuerza {k} a {v} durante {minutos:.0f} min", "manual")
                    return True
            return False
        if not sim:
            return False                           # en el invernadero real nadie acelera el tiempo ni inventa heladas
        if tipo == "velocidad":
            self.speed = max(1.0, min(21600.0, float(cmd.get("valor", 60))))
            self.organic = self.medio.organic = False
        elif tipo == "pausa":
            self.paused = bool(cmd.get("valor"))
        elif tipo == "organica":
            self.organic = self.medio.organic = bool(cmd.get("valor"))
            if self.organic:
                self.org.emit("proc", "Deriva orgánica: el tiempo se demora en el alba y el ocaso, y el clima propone sus propios episodios según la estación.")
        elif tipo == "perturbar":
            self.medio.force(cmd.get("nombre"))
        elif tipo == "estacion":
            d = int(cmd.get("dia", 288))
            hr = self.medio.hour
            self.medio.forcing = None
            self.medio.t = ((d - 2) * 24 + hr) * 3600
            for k in self.org.hist:
                self.org.hist[k] = []
            for _ in range(288 * 30):
                self.medio.step(20)
                self.org.tick(20)
            self.org.events.clear()
            self.org.emit("in", f"El tiempo salta a {cmd.get('nombre', 'otra estación')}. Llevo dos días adaptándome a este clima.")
        else:
            return False
        return True

    def velocidad_organica(self, dt):
        e = sol(self.medio.t)
        target = 70 if abs(e) < 0.11 else 540 if e > 0 else 1500
        f = self.medio.forcing
        if f and f["total"] - f["left"] < 3 * 3600:
            target = 120
        if self.org.vigilia > 0.4:
            target = min(target, 240)
        self.speed = math.exp(math.log(self.speed) + (math.log(target) - math.log(self.speed)) * min(1, dt * 0.5))

    # ─────────── latido ───────────
    async def vivir(self):
        prev = time.monotonic()
        while True:
            await asyncio.sleep(0.05 if self.modo == "simulado" else 0.5)
            ahora = time.monotonic()
            dt = min(1.0, ahora - prev)
            prev = ahora
            if self.modo == "simulado":
                if self.organic:
                    self.velocidad_organica(dt)
                if self.paused:
                    continue
                restante, n = self.speed * dt, 0
                while restante > 0 and n < 400:
                    d = min(20.0, restante)
                    self.medio.step(d)
                    self.org.tick(d)
                    restante -= d
                    n += 1
                avanzado = self.speed * dt - max(0, restante)
            else:
                self.medio.step(dt)
                self.org.tick(dt)
                avanzado = dt
            for f in self.oyentes:
                try:
                    f(avanzado, dt)
                except Exception as e:                  # el sonido nunca debe detener al organismo
                    print("oyente:", e)
