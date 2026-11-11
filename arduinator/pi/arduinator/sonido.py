"""Voz propia de la Raspberry Pi: el Canto suena por sus parlantes, alimentado por el organismo.

Usa canto_arduinator.py (en la carpeta arduinator/). Requiere numpy, scipy y sounddevice.
"""
import sys
import threading
from pathlib import Path


def activar(nucleo, cfg):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    try:
        import numpy  # noqa: F401
        import sounddevice as sd
        import canto_arduinator as canto
    except ImportError as e:
        nucleo.org.emit("proc", f"No puedo cantar por los parlantes: falta {e.name}. Instala python3-numpy, python3-scipy y sounddevice")
        return
    canto.SR = int(cfg["sonido"]["frecuencia"])
    oido = canto.Oido()
    voz = canto.Canto(oido)
    org = nucleo.org
    acumulado = {"fuente": 0.0, "real": 0.0}
    vistos = {"n": 0}

    def oir(avanzado, dt):
        acumulado["fuente"] += avanzado
        acumulado["real"] += dt
        if acumulado["real"] < 0.25:
            return
        s = org.sens
        lect = {"luz": s.get("PAR", 0) * 54, "temp": s.get("Tin"), "hum_suelo": org.thetaEst, "hum_aire": s.get("RHin"),
                "co2": s.get("CO2"), "ec": s.get("EC"), "bio": max(-3, min(3, (s.get("mv", -42) + 42) / 3))}
        lect = {k: v for k, v in lect.items() if v is not None}
        if org.act.get("pump") and vistos["n"] == 0:
            lect["evento"] = "riego"
        vistos["n"] = 1 if org.act.get("pump") else 0
        oido.tick(lect, max(acumulado["fuente"], 1e-3), acumulado["real"])
        acumulado["fuente"] = acumulado["real"] = 0.0

    def cb(outdata, frames, t, status):
        outdata[:] = voz.render(frames)

    def hilo():
        try:
            with sd.OutputStream(samplerate=canto.SR, blocksize=canto.BLOCK, channels=2, dtype="float32", callback=cb):
                threading.Event().wait()
        except Exception as e:
            org.emit("proc", f"Los parlantes no responden: {e}")

    nucleo.oyentes.append(oir)
    threading.Thread(target=hilo, daemon=True).start()
    org.emit("proc", "Abro mi voz: el Canto suena por los parlantes de la Raspberry Pi")
