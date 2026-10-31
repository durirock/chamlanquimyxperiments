"""Constantes del organismo: zona viable, astronomía y psicrometría."""
import math

LAT = math.radians(-41.3)          # Llanquihue; se sobrescribe desde la configuración
MEDIODIA_SOLAR = 12.6              # hora local del mediodía solar (UTC-3)

# Zona viable: fuera de ella despierta la vigilia
VIABLE = {
    "Tin":   {"lo": 8,   "hi": 30.5, "label": "temperatura del aire"},
    "RHin":  {"lo": 35,  "hi": 99,   "label": "humedad del aire"},
    "theta": {"lo": 24,  "hi": 45,   "label": "agua del suelo"},
    "EC":    {"lo": 1.0, "hi": 3.8,  "label": "nutrientes"},
    "CO2":   {"lo": 250, "hi": 1300, "label": "CO₂"},
    "pH":    {"lo": 5.5, "hi": 7.0,  "label": "pH"},
    "tankW": {"lo": 8,   "hi": 101,  "label": "reserva de agua"},
}

EFECTORES = ["vent", "shade", "heat", "pump", "fert", "acid", "led", "mist", "fan"]


def clamp(x, a=0.0, b=1.0):
    return min(b, max(a, x))


def lerp(a, b, k):
    return a + (b - a) * k


def es(T):
    """Presión de vapor de saturación (kPa)."""
    return 0.6108 * math.exp(17.27 * T / (T + 237.3))


def sol(t):
    """Elevación solar (rad) para t = segundos desde el 1 de enero, hora local."""
    d = (t / 86400) % 365
    h = (t / 3600) % 24
    decl = -math.radians(23.44) * math.cos(2 * math.pi * (d + 10) / 365)
    H = math.radians((h - MEDIODIA_SOLAR) * 15)
    s = math.sin(LAT) * math.sin(decl) + math.cos(LAT) * math.cos(decl) * math.cos(H)
    return math.asin(max(-1.0, min(1.0, s)))


def estacion(t):
    d = (t / 86400) % 365
    if d >= 355 or d < 79:
        return "verano"
    if d < 172:
        return "otoño"
    if d < 265:
        return "invierno"
    return "primavera"


def radiacion_despejada(t):
    e = sol(t)
    return 1050 * math.sin(e) ** 1.2 if e > 0 else 0.0
