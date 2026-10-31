"""Medio simulado: el invernadero de Llanquihue y su clima, para probar sin hardware.

Es el mismo modelo físico del simulador web, portado a Python.
"""
import math
import random

from .zona import clamp, lerp, es, sol, estacion

EPISODIOS = {
    "helada":   dict(h=26, ramp=0.6, fall=5, dT=-11, cloud=-0.8, P=14, wind=-3, rain=0,
                     msg="Entra una masa de aire polar: el cielo se despeja, la presión sube y la temperatura cae en picada"),
    "calor":    dict(h=40, ramp=1.2, fall=6, dT=11, cloud=-0.6, P=6, wind=-1, rain=0,
                     msg="Ola de calor: aire caliente del norte y sol pleno"),
    "temporal": dict(h=20, ramp=0.5, fall=3, dT=-3, cloud=0.9, P=-24, wind=14, rain=11,
                     msg="Llega un sistema frontal: la presión cae, viento norte y lluvia intensa"),
}


class MedioSimulado:
    simulado = True

    def __init__(self, emit, t0=None, semilla=20261025):
        self.emit = emit
        self.rnd = random.Random(semilla)
        self.t = t0 if t0 is not None else (297 * 24 + 10.5) * 3600
        self.out = dict(T=11, RH=78, rad=0, wind=4, rain=0, cloud=0.4, P=1014, anomT=0, anomP=2, anomC=0, gust=0, rainOU=0)
        self.inn = dict(T=15, e=1.3, CO2=520, theta=34, Tsoil=13, N=6.8, pH=6.3, tankW=78, tankN=64, wet=0)
        self.plant = dict(bio=0.42, fruits=0, ripe=0, harvest=0, frost=0, mv=-42, mvOU=0, stress=0, fW=1, fT=1, fN=1, P=0, ET=0)
        self.energy = dict(bat=82, pv=0, load=0)
        self.act = None                      # lo asigna el organismo
        self.sens = {}
        self.sensFault = 0
        self.forcing = None
        self.organic = False
        self.autoCool = 0
        self.dli = 0
        self.dliDay = -1
        self.dliYesterday = 14
        self.solarIn = 0
        self.VPD = 0
        self.PAR = 0
        self.litros = 0
        self.faltantes = set()
        self.estimados = set()

    def gauss(self):
        return self.rnd.gauss(0, 1)

    @property
    def hour(self):
        return (self.t / 3600) % 24

    def EC(self):
        return self.inn["N"] / max(self.inn["theta"], 5) * 10

    # ─────────── perturbaciones ───────────
    def force(self, name):
        F = EPISODIOS.get(name)
        if F:
            self.forcing = dict(F, left=F["h"] * 3600, total=F["h"] * 3600, name=name, auto=False)
            self.emit("in", F["msg"], "evento:" + name)
        if name == "sequia":
            self.inn["tankW"] = 6
            self.emit("in", "El estanque de agua quedó casi vacío", "evento:sequia")
        if name == "falla":
            self.sensFault = 8
            self.emit("in", "El sensor de humedad de suelo empezó a entregar lecturas congeladas", "evento:falla")

    def auto_clima(self, dt):
        self.autoCool = max(0, self.autoCool - dt)
        if self.forcing or self.autoCool > 0:
            return
        se, hr, h = estacion(self.t), self.hour, dt / 3600
        P = {
            "helada": {"invierno": 0.3, "otoño": 0.15, "primavera": 0.09, "verano": 0}[se],
            "calor": {"invierno": 0, "otoño": 0.03, "primavera": 0.06, "verano": 0.2}[se],
            "temporal": {"invierno": 0.35, "otoño": 0.28, "primavera": 0.14, "verano": 0.05}[se],
        }
        ventana = {"helada": 15 < hr < 19, "calor": 8 < hr < 12, "temporal": True}
        for k in ("helada", "temporal", "calor"):
            if ventana[k] and self.rnd.random() < P[k] * h / (24 if k == "temporal" else 4):
                self.force(k)
                self.autoCool = (30 + 40 * self.rnd.random()) * 3600
                self.forcing["auto"] = True
                return

    # ─────────── clima exterior ───────────
    def weather(self, dt):
        o, h = self.out, dt / 3600
        d, hr = (self.t / 86400) % 365, self.hour
        yr = math.cos(2 * math.pi * (d - 18) / 365)
        sd = math.sqrt(h)
        g = self.gauss
        o["anomP"] += (-o["anomP"] / 40) * h + 2.0 * sd * g()
        o["anomT"] += (-o["anomT"] / 40) * h + 0.9 * sd * g()
        o["anomC"] += (-o["anomC"] / 16) * h + 0.16 * sd * g()
        o["gust"] += (-o["gust"] / 0.3) * h + 2.2 * sd * g()
        o["rainOU"] += (-o["rainOU"] / 0.7) * h + 0.9 * sd * g()
        f, fk = self.forcing, 0.0
        if f:
            el = f["total"] - f["left"]
            fk = min(1, el / (f["ramp"] * 3600), f["left"] / (f["fall"] * 3600))
            fk = fk * fk * (3 - 2 * fk)
            f["left"] -= dt
            if f["left"] <= 0:
                self.emit("in", "El episodio climático se disipa", "evento:fin")
                self.forcing = None
        fv = (lambda k: f[k] * fk) if f else (lambda k: 0)
        o["cloud"] = clamp(0.55 - 0.17 * yr - 0.022 * o["anomP"] + o["anomC"] + fv("cloud"), 0, 1)
        o["P"] = 1013 + o["anomP"] + fv("P")
        Tmean = 10.3 + 4.6 * yr + o["anomT"] + fv("dT")
        amp = (4.2 + 2.2 * yr) * (1 - 0.65 * o["cloud"])
        e = sol(self.t)
        ph = 2 * math.pi * (hr - 9.5) / 24
        o["T"] = Tmean + amp * math.sin(ph) * 0.85 + amp * 0.25 * math.sin(2 * ph - 0.6)
        if o["cloud"] < 0.35:
            extra = 4.5 * fk if (f and f["name"] == "helada") else 0
            o["T"] -= (extra + 1.6 * (0.35 - o["cloud"]) / 0.35) * clamp(-e / 0.22)
        clear = 1050 * math.sin(e) ** 1.2 if e > 0 else 0
        o["rad"] = clear * (1 - 0.78 * o["cloud"] ** 3.2)
        o["wind"] = max(0, 3.2 + 0.5 * max(0, -o["P"] + 1013) * 0.6 + 1.5 * o["gust"] + fv("wind") + 1.2 * math.sin(ph))
        rainBase = (o["cloud"] - 0.82) * 22 * (1 - 0.45 * yr) if o["cloud"] > 0.82 else 0
        o["rain"] = max(0, (rainBase + fv("rain")) * clamp(0.75 + 0.5 * o["rainOU"], 0.1, 1.8))
        spread = lerp(7, 0.6, o["cloud"]) * (0.25 if o["rain"] > 0.2 else 1)
        Td = min(o["T"], Tmean - 1.5 - 0.6 * spread + (1 if e < 0 else 0))
        o["RH"] = clamp(100 * es(Td) / es(o["T"]), 25, 100)
        if o["rain"] > 0:
            self.inn["tankW"] = min(100, self.inn["tankW"] + o["rain"] * 60 * 0.85 * h / 50)

    # ─────────── física interna ───────────
    def physics(self, dt):
        o, i, p, a, h = self.out, self.inn, self.plant, self.act, dt / 3600
        solarIn = o["rad"] * 0.72 * (1 - 0.55 * a["shade"])
        ventEff = a["vent"] * (0.75 + 0.07 * o["wind"]) + 0.035 + 0.006 * o["wind"] + 0.04 * a["fan"]
        night = o["rad"] < 5
        dT = (0.062 * solarIn - (2.3 + 9.5 * ventEff) * (i["T"] - o["T"]) + 36 * a["heat"]
              - (1.3 * (1 - o["cloud"]) if night else 0)
              - (6.0 * clamp(1 - i["e"] / es(i["T"])) if a["mist"] else 0)
              - 0.9 * p["ET"] + 0.55 * (i["Tsoil"] - i["T"]))
        i["T"] += dT * h
        i["Tsoil"] += (i["T"] - i["Tsoil"]) * 0.18 * h + ((12 - i["Tsoil"]) * 0.4 * h if a["pump"] else 0)
        LAI = 0.4 + 2.6 * p["bio"]
        LAIf = 1 - math.exp(-0.7 * LAI)
        PAR = solarIn * 2.05 + a["led"] * 190
        lightF = 1 - math.exp(-PAR / 380)
        sat = es(i["T"])
        VPD = max(0, sat - i["e"])
        T = i["T"]
        p["fW"] = clamp((i["theta"] - 17) / 10)
        p["fT"] = (clamp((T - 5) / 4) * 0.4 if T < 9 else 0.4 + 0.6 * (T - 9) / 10 if T < 19
                   else 1 if T <= 27 else clamp(1 - (T - 27) / 10))
        EC = self.EC()
        p["fN"] = clamp((EC - 0.5) / 1.1) * clamp(1 - (EC - 3.4) / 2.5)
        fC = i["CO2"] / (i["CO2"] + 280)
        p["P"] = lightF * p["fT"] * p["fW"] * p["fN"] * fC * 1.75
        gs = (0.08 + 0.92 * clamp(PAR / 250)) * (0.25 + 0.75 * p["fW"])
        p["ET"] = gs * LAIf * (0.00062 * solarIn + 0.16 * VPD + 0.012 * a["led"])
        eOut = o["RH"] / 100 * es(o["T"])
        i["e"] += (3.6 * p["ET"] + (1.8 * clamp(1 - i["e"] / sat) if a["mist"] else 0)
                   - (1.0 + 11 * ventEff) * (i["e"] - eOut)) * h
        if i["e"] > sat:
            i["wet"] = min(1, i["wet"] + (i["e"] - sat) * 4)
            i["e"] = sat
        else:
            i["wet"] = max(0, i["wet"] - (0.4 + VPD) * h)
        resp = (14 + 18 * LAI * 0.4) * 2 ** ((i["T"] - 15) / 10)
        photo = 190 * p["P"] * LAIf
        i["CO2"] = max(150, i["CO2"] + (resp - photo - (0.5 + 13 * ventEff) * (i["CO2"] - 421)) * h)
        pumping = a["pump"] and i["tankW"] > 1
        inflow = 13 if pumping else 0
        drain = 1.6 * (i["theta"] - 44) if i["theta"] > 44 else 0
        i["theta"] += (-p["ET"] * 0.85 + inflow - drain) * h
        if pumping:
            i["tankW"] = max(0, i["tankW"] - 15.6 * h)
            self.litros += 780 * h
        if a["mist"] and i["tankW"] > 1:
            i["tankW"] = max(0, i["tankW"] - 0.9 * h)
        uptake = 0.11 * p["P"] * LAIf + 0.004
        fertIn = 3.2 if (a["fert"] and pumping and i["tankN"] > 0.5) else 0
        i["N"] = max(0.2, i["N"] + (-uptake + fertIn + inflow * 0.012 - drain * i["N"] / max(i["theta"], 5)) * h)
        if fertIn:
            i["tankN"] = max(0, i["tankN"] - 1.6 * h)
        i["pH"] = clamp(i["pH"] + (0.0035 + 0.022 * uptake / 0.11 + (0.02 if fertIn else 0) - (0.75 if a["acid"] else 0)
                                   + ((6.9 - i["pH"]) * 0.01 if inflow else 0)) * h, 4.5, 8.2)
        p["bio"] += 0.009 * p["P"] * (1 - p["bio"]) * h * (0.6 + 0.4 * LAIf)
        if p["bio"] > 0.45 and p["fT"] > 0.5:
            p["fruits"] += 0.02 * p["P"] * h * p["bio"]
        if p["fruits"] > 0:
            r = p["fruits"] * 0.0045 * h * clamp((i["T"] - 10) / 12)
            p["fruits"] -= r
            p["ripe"] += r
        if p["ripe"] > 0.6:
            kg = p["ripe"] * 9
            p["harvest"] += kg
            p["ripe"] = 0
            self.emit("out", f"Cosecha: {kg:.1f} kg de tomates maduros", "cosecha")
        if i["T"] < 0.8:
            p["frost"] = min(1, p["frost"] + (1 - i["T"]) * 0.35 * h)
            p["bio"] = max(0.05, p["bio"] - 0.02 * (1 - i["T"]) * h)
        else:
            p["frost"] = max(0, p["frost"] - 0.01 * h)
        if i["T"] > 36:
            p["bio"] = max(0.05, p["bio"] - 0.004 * (i["T"] - 36) * h)
        p["stress"] = clamp(max(1 - p["fW"], (1 - p["fT"]) * (1 if PAR > 50 else 0.3), 1 - p["fN"], p["frost"],
                                VPD - 2.2 if VPD > 2.2 else 0))
        sig = 1.4 + 7 * p["stress"] + 2.5 * lightF
        p["mvOU"] += (-p["mvOU"] / 0.08) * h + sig * math.sqrt(h / 0.04) * self.gauss() * 0.35
        p["mv"] = -42 + 6 * lightF + p["mvOU"]
        en = self.energy
        en["pv"] = 120 * clamp(o["rad"] / 1000) * (0.95 - 0.3 * o["cloud"])
        en["load"] = 2.4 + (38 if pumping else 0) + (3 if a["vent"] > 0.02 else 0) + (6 if a["fert"] else 0) + (4 if a["acid"] else 0)
        en["bat"] = clamp(en["bat"] + (en["pv"] - en["load"]) * h / 4.8, 0, 100)
        self.PAR, self.VPD, self.solarIn = PAR, VPD, solarIn
        day = int(self.t // 86400)
        if day != self.dliDay:
            if self.dliDay >= 0:
                self.dliYesterday = self.dli
            self.dli = 0
            self.dliDay = day
        self.dli += PAR * dt / 1e6

    # ─────────── sentidos ───────────
    def sample(self):
        g, o, i, p, s = self.gauss, self.out, self.inn, self.plant, self.sens
        q = lambda x, r: round(x / r) * r
        RH = clamp(100 * i["e"] / es(i["T"]), 0, 100)
        s["Tin"] = q(i["T"] + 0.12 * g(), 0.01)
        s["RHin"] = q(RH + 0.9 * g(), 0.1)
        s["CO2"] = q(i["CO2"] + 9 * g(), 1)
        s["PAR"] = q(max(0, self.PAR * (1 + 0.02 * g())), 1)
        if self.sensFault > 0:
            s.setdefault("theta", i["theta"])
        else:
            s["theta"] = q(i["theta"] + 0.35 * g(), 0.1)
        s["Tsoil"] = q(i["Tsoil"] + 0.06 * g(), 0.06)
        s["EC"] = q(self.EC() * (1 + 0.012 * g()), 0.01)
        s["pH"] = q(i["pH"] + 0.03 * g(), 0.01)
        s["mv"] = q(p["mv"] + 0.4 * g(), 0.1)
        s["tankW"] = q(i["tankW"], 1)
        s["tankN"] = q(i["tankN"], 1)
        s["Tout"] = q(o["T"] + 0.15 * g(), 0.01)
        s["RHout"] = q(clamp(o["RH"] + 1.2 * g(), 0, 100), 0.1)
        s["rad"] = q(max(0, o["rad"] * (1 + 0.015 * g())), 1)
        s["wind"] = q(max(0, o["wind"] + 0.4 * g()), 0.1)
        s["rain"] = q(o["rain"], 0.2)
        s["P"] = q(o["P"] + 0.12 * g(), 0.1)
        s["bat"] = self.energy["bat"]
        s["pv"] = self.energy["pv"]
        s["VPD"] = self.VPD
        return True

    def step(self, dt):
        if self.organic:
            self.auto_clima(dt)
        self.weather(dt)
        self.physics(dt)
        self.t += dt
        if self.sensFault > 0:
            self.sensFault = max(0, self.sensFault - dt / 3600)

    def aplicar(self, act):
        """En el medio simulado los efectores actúan directamente sobre la física."""
        pass

    def edad(self, clave):
        return 0

    def tiene_efector(self, k):
        return True

    def nodos(self):
        return [dict(nombre="simulado", puerto="—", vivo=True, hace=0, ultima="modelo físico de Llanquihue",
                     efectores=["vent", "shade", "heat", "pump", "fert", "acid", "led", "mist", "fan"])]
