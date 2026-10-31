"""Configuración: valores por defecto, sobrescritos por un archivo TOML."""
import copy
import math

try:
    import tomllib
except ImportError:                       # Python < 3.11
    tomllib = None

DEFECTO = {
    "general": {"modo": "simulado", "nombre": "LLQ-01", "latitud": -41.3, "descripcion": "invernadero túnel de 30 m² con tomates"},
    "red": {"host": "0.0.0.0", "puerto": 8080, "token": ""},
    "arduinos": {"autodetectar": True, "puertos": [], "baudios": 115200, "ttl_ordenes_s": 180},
    "invernadero": {"estanque_litros": 5000, "estanque_pct": 70, "fertilizante_pct": 60, "caudal_riego_lh": 780, "biomasa_inicial": 0.4},
    "seguridad": {"pulso_max_min": 25, "pausa_min_min": 30},
    "memoria": {"ruta": "arduinator.db"},
    "sonido": {"activo": False, "frecuencia": 22050},
}


def cargar(ruta=None):
    cfg = copy.deepcopy(DEFECTO)
    if ruta:
        if tomllib is None:
            raise SystemExit("Leer la configuración requiere Python 3.11 o superior (tomllib)")
        with open(ruta, "rb") as f:
            datos = tomllib.load(f)
        for seccion, valores in datos.items():
            cfg.setdefault(seccion, {}).update(valores)
    from . import zona
    zona.LAT = math.radians(cfg["general"]["latitud"])
    return cfg
