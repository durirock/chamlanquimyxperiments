"""Arduinator · placa madre (Raspberry Pi 4)

  python3 -m arduinator                       modo simulado, panel en http://<ip>:8080
  python3 -m arduinator --config arduinator.toml
  python3 -m arduinator --real                busca Arduinos en /dev/ttyACM* y /dev/ttyUSB*
"""
import argparse
import asyncio
import socket

from . import config
from .nucleo import Nucleo
from .servidor import Servidor


def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


async def principal(cfg):
    nucleo = Nucleo(cfg)
    if cfg["sonido"]["activo"]:
        from . import sonido
        sonido.activar(nucleo, cfg)
    srv = Servidor(nucleo, cfg)
    await srv.arrancar()
    p = cfg["red"]["puerto"]
    print(f"Arduinator «{cfg['general']['nombre']}» en modo {nucleo.modo}")
    print(f"  Panel en la red local:  http://{socket.gethostname()}.local:{p}   ·   http://{ip_local()}:{p}")
    await nucleo.vivir()


def main():
    ap = argparse.ArgumentParser(prog="arduinator", description="Placa madre del Arduinator")
    ap.add_argument("--config", help="archivo TOML de configuración")
    ap.add_argument("--real", action="store_true", help="usar los Arduinos conectados")
    ap.add_argument("--simulado", action="store_true", help="usar el invernadero simulado")
    ap.add_argument("--puerto", type=int, help="puerto HTTP del panel")
    a = ap.parse_args()
    cfg = config.cargar(a.config)
    if a.real:
        cfg["general"]["modo"] = "real"
    if a.simulado:
        cfg["general"]["modo"] = "simulado"
    if a.puerto:
        cfg["red"]["puerto"] = a.puerto
    try:
        asyncio.run(principal(cfg))
    except KeyboardInterrupt:
        print("\nEl Arduinator vuelve al silencio.")


if __name__ == "__main__":
    main()
