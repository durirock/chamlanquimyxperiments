"""El organismo: percibe, compara con su zona viable, decide, actúa y aprende.

Es el mismo para el medio simulado y para el invernadero real: solo cambia de dónde
vienen las lecturas y adónde van las determinaciones.
"""
import math
import time

from .zona import VIABLE, EFECTORES, clamp, lerp, sol, estacion

NOMBRES = {"vent": "ventanas cenitales", "heat": "calefactor", "shade": "malla de sombra", "pump": "riego por goteo",
           "fert": "fertirriego", "acid": "corrector de pH", "led": "luz suplementaria", "mist": "nebulización",
           "fan": "ventilador"}
HIST_KEYS = ["Tin", "RHin", "CO2", "PAR", "theta", "Tsoil", "EC", "pH", "mv", "Tout", "RHout", "rad", "wind", "rain", "P", "bat"]
HIST_LEN = 288                       # 48 h a un registro cada 10 min


class Organismo:
    def __init__(self, medio, cfg, memoria=None):
        self.medio = medio
        self.cfg = cfg
        self.memoria = memoria
        self.act = {k: 0 for k in EFECTORES}
        medio.act = self.act
        self.learn = dict(irrOn=30.0, irrOff=38.0, kET=0.00055, lastMin=99, lastMax=0, irrigations=0, frostRisk=0,
                          frostSaves=0, prevTheta=None, prevT=None, stuck=0, thF=None, win=None, warnedTonight=False,
                          savedTonight=False, prevElev=None, pulseStart=0, lastPulseEnd=-1e9)
        self.sens = medio.sens
        self.sensDoubt = False
        self.thetaEst = 34.0
        self.vigilia = 0.0
        self.vigTarget = 0.0
        self.alerta = None
        self.devs = {}
        self.log = []
        self.logId = 0
        self.events = []
        self.hist = {k: [] for k in HIST_KEYS + ["vig"]}
        self.ctrlClock = 0.0
        self.ctrlCount = 0
        self.sampleClock = 0.0
        self.histClock = 0.0
        self.samples = 0
        self.lastDay = None
        self.lastAct = {}
        self.manual = {}                     # efectores forzados a mano: {k: (valor, hasta_t)}
        if memoria:
            memoria.restaurar(self)
        medio.emit = self.emit

    # ─────────── voz del organismo ───────────
    def emit(self, kind, text, tag=None):
        self.logId += 1
        item = dict(kind=kind, text=text, t=self.medio.t, id=self.logId)
        self.log.append(item)
        if len(self.log) > 160:
            self.log.pop(0)
        if tag:
            self.events.append(tag)
        if self.memoria:
            self.memoria.bitacora(item)

    @property
    def hour(self):
        return (self.medio.t / 3600) % 24

    # ─────────── ciclo vital ───────────
    def tick(self, dt):
        """Avanza dt segundos del medio."""
        m = self.medio
        self.sampleClock += dt
        if self.sampleClock >= 5:
            self.sampleClock = 0
            if m.sample():
                self.samples += 1
                if not self.sensDoubt and "theta" in self.sens and not m.simulado:
                    self.thetaEst = self.sens["theta"]        # entre decisiones, la estimación sigue al sensor sano
        self.ctrlClock += dt
        if self.ctrlClock >= 60:
            self.ctrlClock -= 60
            if self.sens:
                self.control()
                m.aplicar(self.act)
        tau = 180 if self.vigTarget > self.vigilia else 1800
        self.vigilia += (1 - math.exp(-dt / tau)) * (self.vigTarget - self.vigilia)
        if self.vigilia < 0.04 and self.vigTarget < 0.02:
            self.alerta = None
        self.histClock += dt
        if self.histClock >= 600:
            self.histClock = 0
            self.record()
        day = int(m.t // 86400)
        if day != self.lastDay:
            if self.lastDay is not None:
                self.emit("proc", f"Nuevo día · {estacion(m.t)} · ayer {m.dliYesterday:.1f} mol/m² de luz, "
                                  f"{self.learn['irrigations']} riegos acumulados", "dia")
            self.lastDay = day

    def record(self):
        row = {}
        for k in HIST_KEYS:
            v = self.thetaEst if k == "theta" else self.sens.get(k)
            if v is None:
                v = self.hist[k][-1] if self.hist[k] else 0
            self.hist[k].append(v)
            row[k] = v
            if len(self.hist[k]) > HIST_LEN:
                self.hist[k].pop(0)
        self.hist["vig"].append(self.vigilia)
        if len(self.hist["vig"]) > HIST_LEN:
            self.hist["vig"].pop(0)
        row["vig"] = self.vigilia
        self.events.append("__hist__")
        if self.memoria:
            self.memoria.registrar(self.medio.t, row, self.learn, self.thetaEst)

    # ─────────── el organismo decide (cada 60 s) ───────────
    def control(self):
        self.ctrlCount += 1
        m, s, a, L = self.medio, self.sens, self.act, self.learn
        i, p = m.inn, m.plant
        prev = dict(a)
        day = s.get("rad", m.solarIn / 0.72) > 25
        hr = self.hour
        theta_s = s.get("theta", self.thetaEst)
        VPD = s.get("VPD", 0)
        # ¿confío en mi sensor de suelo? Si la lectura no cambia mientras la planta transpira, o el nodo calla, miente.
        if L["prevTheta"] is None:
            L["prevTheta"] = theta_s
        dTh = theta_s - L["prevTheta"]
        expected = -p["ET"] * 0.85 / 60 + (13 / 60 if a["pump"] else 0)
        L["stuck"] = L["stuck"] + 1 if (abs(dTh) < 1e-9 and abs(expected) > 0.004) else 0
        silent = m.edad("theta") > 180
        if not self.sensDoubt and (L["stuck"] > 25 or silent):
            self.sensDoubt = True
            self.emit("proc", "El sensor de suelo " + ("dejó de responder" if silent else "no cambia mientras la planta transpira")
                      + ": dejo de creerle y estimo con mi modelo de evapotranspiración", "duda")
        if self.sensDoubt and not silent and abs(dTh) > 1e-6 and getattr(m, "sensFault", 0) <= 0:
            self.sensDoubt = False
            self.thetaEst = theta_s
            self.emit("proc", "El sensor de suelo vuelve a responder; recalibro la estimación contra su lectura", "confia")
        L["prevTheta"] = theta_s
        flow = 13 / 60 if (a["pump"] and i["tankW"] > 1) else 0
        etEst = L["kET"] * m.solarIn + 0.04 * VPD
        self.thetaEst += -etEst * 0.85 * 60 / 3600 + flow
        if not self.sensDoubt:
            L["thF"] = theta_s if L["thF"] is None else L["thF"] + (theta_s - L["thF"]) * 0.12
            if not a["pump"] and day and m.solarIn > 120:
                if not L["win"]:
                    L["win"] = dict(th=L["thF"], n=0, pred=0, sol=0)
                w = L["win"]
                w["n"] += 1
                w["pred"] += L["kET"] * m.solarIn + 0.04 * VPD
                w["sol"] += m.solarIn
                if w["n"] >= 90:
                    obs = max(0, (w["th"] - L["thF"]) / 1.5 / 0.85)
                    pred, solm = w["pred"] / w["n"], w["sol"] / w["n"]
                    kOld = L["kET"]
                    L["kET"] = clamp(kOld + clamp(0.25 * (obs - pred) / solm, -0.15 * kOld, 0.15 * kOld), 0.0002, 0.0012)
                    if abs(L["kET"] - kOld) / kOld > 0.05:
                        self.emit("proc", f"Recalibro mi modelo de transpiración: la planta evapora {obs:.2f} mm/h, "
                                          f"yo esperaba {pred:.2f}", "calibra")
                    L["win"] = None
            else:
                L["win"] = None
                if a["pump"]:
                    L["thF"] = theta_s
            self.thetaEst = theta_s
        theta = self.thetaEst
        Tin, RHin, Tout = s.get("Tin", i["T"]), s.get("RHin", 70), s.get("Tout", m.out["T"])
        EC, pH, CO2 = s.get("EC", 2.0), s.get("pH", 6.4), s.get("CO2", 420)
        rad, wind, rain = s.get("rad", 0), s.get("wind", 0), s.get("rain", 0)
        # riesgo de helada
        clearDry = s.get("RHout", 80) < 70 or m.out["cloud"] < 0.3
        falling = Tout - (L["prevT"] if L["prevT"] is not None else Tout)
        L["prevT"] = Tout
        evening = hr > 17 or hr < 8
        frostRisk = (hr > 17 or hr < 9.5) if L["frostRisk"] else (evening and clearDry and Tout < 5 and falling <= 0.02)
        if frostRisk and not L["frostRisk"] and not L["warnedTonight"]:
            self.emit("proc", f"Huelo helada: cielo despejado, {Tout:.1f} °C afuera y bajando. Me preparo antes de que llegue", "presiente")
            L["warnedTonight"] = True
        if 10 < hr < 11:
            L["warnedTonight"] = False
            L["savedTonight"] = False
        L["frostRisk"] = 1 if frostRisk else 0
        # temperatura
        lo, hi = (15 if day else (12 if frostRisk else 11)), (26 if day else 20)
        vent = 0.0
        if Tin > hi:
            vent = clamp((Tin - hi) / 6 + 0.12)
        if RHin > 92 and Tin > lo + 1.5:
            vent = max(vent, 0.18)
        if day and CO2 < 330 and Tin > lo + 2:
            vent = max(vent, 0.12)
        if wind > 14:
            vent = min(vent, 0.25)
        if rain > 4:
            vent = min(vent, 0.15)
        a["vent"] = lerp(a["vent"], vent, 0.5)
        if a["vent"] < 0.015:
            a["vent"] = 0
        if Tin < lo - 1:
            a["heat"] = 1
        elif Tin > lo + (2.5 if frostRisk else 1.5):
            a["heat"] = 0
        if rad > 620 and Tin > hi + 2:
            a["shade"] = 1
        elif Tin < hi - 1 or rad < 380:
            a["shade"] = 0
        if Tin > 29 and RHin < 60 and i["tankW"] > 10:
            a["mist"] = 1
        elif Tin < 27 or RHin > 75:
            a["mist"] = 0
        a["fan"] = 1 if (a["mist"] or RHin > 88 or (a["fan"] and RHin > 82)) else 0
        # riego con umbrales aprendidos y límites de seguridad
        leach = EC > 3.4
        off = 43 if leach else L["irrOff"]
        maxPulse = self.cfg["seguridad"]["pulso_max_min"] * 60
        minGap = self.cfg["seguridad"]["pausa_min_min"] * 60
        if not a["pump"] and i["tankW"] > 2 and theta < L["irrOn"] and (day or theta < L["irrOn"] - 3) \
                and m.t - L["lastPulseEnd"] > minGap:
            a["pump"] = 1
            L["pulseStart"] = m.t
            L["lastMin"] = theta
            L["irrigations"] += 1
        elif a["pump"] and (theta >= off or i["tankW"] <= 1 or m.t - L["pulseStart"] > maxPulse):
            a["pump"] = 0
            L["lastPulseEnd"] = m.t
            if i["tankW"] <= 1:
                self.emit("proc", "No queda agua en el estanque: detengo el riego y espero la lluvia", "sinagua")
            elif m.t - L["pulseStart"] > maxPulse:
                self.emit("proc", f"El pulso de riego llegó a su límite de {maxPulse / 60:.0f} min sin que el suelo responda. "
                                  "Reviso la bomba o el sensor", "limite")
        if a["pump"]:
            L["lastMax"] = max(L["lastMax"], theta)
        a["fert"] = 1 if (a["pump"] and (EC < 2.1 or (a["fert"] and EC < 2.5)) and not leach) else 0
        if pH > 6.8:
            a["acid"] = 1
        elif pH < 6.2:
            a["acid"] = 0
        if prev["pump"] and not a["pump"]:
            note = ""
            if L["lastMax"] > 43.5:
                L["irrOff"] = max(34, L["irrOff"] - 0.6)
                note = f"el suelo drenó; acorto el pulso (corte en {L['irrOff']:.1f} %)"
            elif L["lastMin"] < 26:
                L["irrOn"] = min(34, L["irrOn"] + 0.8)
                note = f"la planta alcanzó a sufrir; riego antes (inicio en {L['irrOn']:.1f} %)"
            elif L["lastMin"] > 28.5:
                L["irrOn"] = max(27.5, L["irrOn"] - 0.4)
                note = f"la planta tolera más; espero un poco más (inicio en {L['irrOn']:.1f} %)"
            if note:
                self.emit("proc", "Aprendo de este riego: " + note, "aprende")
            L["lastMax"] = 0
        ledOk = 6 < hr < 21 and m.dli < 13 and m.dliYesterday < 15 and m.energy["bat"] > 25
        PAR = s.get("PAR", 0)
        a["led"] = 1 if (ledOk and (PAR < 140 or (a["led"] and PAR < 380))) else 0
        # efectores forzados a mano desde la red (con vencimiento)
        for k, (v, hasta) in list(self.manual.items()):
            if m.t > hasta:
                del self.manual[k]
                self.emit("proc", f"Termina el control manual de {NOMBRES[k]}; vuelvo a decidir yo", "manual:fin")
            else:
                a[k] = v
        # efectores que no existen en el hardware quedan apagados
        for k in EFECTORES:
            if not m.tiene_efector(k):
                a[k] = 0
        # narración
        for k in EFECTORES:
            was = prev["vent"] > 0.04 if k == "vent" else bool(prev[k])
            now = a["vent"] > 0.04 if k == "vent" else bool(a[k])
            if was == now:
                continue
            quiet = k in ("heat", "fan", "vent") and m.t - self.lastAct.get(k, -1e9) < 2400
            self.lastAct[k] = m.t
            tag = f"{k}:{'on' if now else 'off'}"
            if quiet:
                self.events.append(tag)
                continue
            why = {
                "vent": f"T {Tin:.1f} °C · HR {RHin:.0f} %" if now else "el aire volvió a su zona",
                "heat": f"T {Tin:.1f} °C bajo {lo} °C" if now else f"T {Tin:.1f} °C",
                "shade": f"radiación {rad:.0f} W/m²" if now else "",
                "pump": f"suelo {theta:.1f} % bajo {L['irrOn']:.1f} %" if now else f"suelo {theta:.1f} %",
                "fert": f"EC {EC:.2f} mS/cm" if now else "", "acid": f"pH {pH:.2f}" if now else "",
                "led": f"luz del día {m.dli:.1f} mol/m²" if now else "", "mist": "aire seco y caliente" if now else "", "fan": "",
            }[k]
            self.emit("out", f"{'Abro' if now else 'Cierro'} {NOMBRES[k]}{' · ' + why if why else ''}", tag)
        if L["frostRisk"] and m.out["T"] < 0.5 and Tin > 4 and not L["savedTonight"]:
            L["frostSaves"] += 1
            L["savedTonight"] = True
            self.emit("proc", f"Afuera {m.out['T']:.1f} °C, adentro {Tin:.1f} °C: la helada no entra", "salva")
        el = sol(m.t)
        if L["prevElev"] is not None:
            if L["prevElev"] < 0 <= el:
                self.emit("in", "Amanece: la luz vuelve a la hoja y la fotosíntesis despierta", "amanecer")
            if L["prevElev"] >= 0 > el:
                self.emit("in", "Anochece: la planta deja de fotosintetizar y empieza a respirar", "anochecer")
        L["prevElev"] = el
        # conciencia: ¿hay viabilidad en juego?
        v = dict(Tin=Tin, RHin=RHin, theta=theta, EC=EC, CO2=CO2, pH=pH, tankW=i["tankW"])
        worst, dev = None, 0.0
        for k, z in VIABLE.items():
            if k != "theta" and k != "tankW" and (k not in s or m.edad(k) > 300):
                self.devs[k] = 0
                continue
            w = z["hi"] - z["lo"]
            d = (z["lo"] - v[k]) / w if v[k] < z["lo"] else (v[k] - z["hi"]) / w if v[k] > z["hi"] else 0
            self.devs[k] = d
            if d > dev:
                dev, worst = d, k
        if L["frostRisk"] and m.out["T"] < 2:
            dev = max(dev, 0.06 + 0.04 * (2 - m.out["T"]))
            worst = worst or "Tin"
        if self.sensDoubt:
            dev = max(dev, 0.08)
            worst = worst or "theta"
        self.vigTarget = clamp(dev * 4)
        if self.vigTarget > 0.05:
            self.alerta = worst

    # ─────────── lo que ve la red ───────────
    def snapshot(self):
        m = self.medio
        r = lambda d, n=3: {k: (round(v, n) if isinstance(v, float) else v) for k, v in d.items()}
        L = self.learn
        return dict(
            t=round(m.t, 1), sens=r(self.sens), act=r(self.act), inn=r(m.inn), out=r(m.out), plant=r(m.plant),
            energy=r(m.energy), learn=dict(irrOn=round(L["irrOn"], 2), irrOff=round(L["irrOff"], 2), kET=L["kET"],
                                           irrigations=L["irrigations"], frostSaves=L["frostSaves"], frostRisk=L["frostRisk"],
                                           waterUsed=round(m.litros)),
            vigilia=round(self.vigilia, 4), alerta=self.alerta, devs=r(self.devs, 4), thetaEst=round(self.thetaEst, 2),
            sensDoubt=self.sensDoubt, dli=round(m.dli, 2), dliYesterday=round(m.dliYesterday, 2),
            ctrlClock=round(self.ctrlClock, 1), ctrlCount=self.ctrlCount, samples=self.samples,
            forcing=({k: m.forcing[k] for k in ("name", "left", "total", "auto")} if getattr(m, "forcing", None) else None),
            faltantes=sorted(m.faltantes), estimados=sorted(m.estimados), manual=sorted(self.manual),
        )
