"""Servidor de la red local: cualquier PC del área ve al organismo en vivo.

  http://arduinator.local:8080        panel en vivo
  ws://…/ws                           flujo de estado (4 por segundo)
  /api/estado                         estado actual en JSON
  /api/historial.csv?horas=48         historial (modo real)
"""
import asyncio
import json
import time
from pathlib import Path

from aiohttp import web, WSMsgType

from .zona import VIABLE

BASE = Path(__file__).resolve().parent.parent          # carpeta pi/
WEB = BASE / "web"
MUESTRAS = BASE.parent / "samples"                    # las muestras de la orquesta, compartidas con el simulador


class Servidor:
    def __init__(self, nucleo, cfg):
        self.n = nucleo
        self.cfg = cfg
        self.clientes = set()
        self.ultimo_log = 0
        self.ultimo_nodos = 0
        self.app = web.Application()
        self.app.add_routes([
            web.get("/", self.inicio),
            web.get("/ws", self.ws),
            web.get("/api/estado", self.api_estado),
            web.get("/api/historial.csv", self.api_csv),
            web.static("/samples", MUESTRAS, show_index=False),
        ])

    async def inicio(self, req):
        return web.FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})

    async def api_estado(self, req):
        return web.json_response(self.estado(con_log=False))

    async def api_csv(self, req):
        mem = self.n.org.memoria
        if not mem:
            return web.Response(status=404, text="El historial se guarda solo en modo real\n")
        horas = float(req.query.get("horas", 48))
        return web.Response(text=mem.exportar_csv(time.time() - horas * 3600), content_type="text/csv",
                            headers={"Content-Disposition": "attachment; filename=arduinator.csv"})

    def estado(self, con_log=True):
        s = self.n.org.snapshot()
        s.update(tipo="estado", speed=round(self.n.speed, 2), paused=self.n.paused, organic=self.n.organic)
        return s

    def autorizado(self, req, msg):
        token = self.cfg["red"]["token"]
        return bool(token) and (msg.get("token") == token or req.query.get("token") == token)

    async def ws(self, req):
        ws = web.WebSocketResponse(heartbeat=20, compress=True)
        await ws.prepare(req)
        org = self.n.org
        hola = dict(tipo="hola", modo=self.n.modo, nombre=self.cfg["general"]["nombre"],
                    descripcion=self.cfg["general"]["descripcion"], latitud=self.cfg["general"]["latitud"],
                    viable=VIABLE, hist=org.hist, log=org.log[-80:], nodos=self.n.medio.nodos(),
                    puede_mandar=self.n.modo == "simulado" or bool(self.cfg["red"]["token"]))
        hola.update(estado=self.estado())
        await ws.send_str(json.dumps(hola, separators=(",", ":")))
        self.clientes.add(ws)
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    cmd = json.loads(msg.data)
                except ValueError:
                    continue
                ok = self.n.ordenar(cmd, self.autorizado(req, cmd))
                if not ok:
                    await ws.send_str(json.dumps({"tipo": "rechazo", "cmd": cmd.get("cmd"),
                                                  "motivo": "En el invernadero real esa orden necesita el token de la configuración"
                                                  if self.n.modo != "simulado" else "Orden desconocida"}))
        finally:
            self.clientes.discard(ws)
        return ws

    async def difundir(self):
        org = self.n.org
        while True:
            await asyncio.sleep(0.25)
            nuevos = [l for l in org.log if l["id"] > self.ultimo_log]
            if nuevos:
                self.ultimo_log = nuevos[-1]["id"]
            eventos = org.events[:]
            org.events.clear()
            if not self.clientes:
                continue
            msg = self.estado()
            msg["log"] = nuevos
            msg["eventos"] = [e for e in eventos if e != "__hist__"]
            if "__hist__" in eventos:
                msg["histRow"] = {k: v[-1] for k, v in org.hist.items() if v}
            if time.time() - self.ultimo_nodos > 2:
                self.ultimo_nodos = time.time()
                msg["nodos"] = self.n.medio.nodos()
            data = json.dumps(msg, separators=(",", ":"))
            for ws in list(self.clientes):
                try:
                    await ws.send_str(data)
                except Exception:
                    self.clientes.discard(ws)

    async def arrancar(self):
        runner = web.AppRunner(self.app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, self.cfg["red"]["host"], self.cfg["red"]["puerto"])
        await site.start()
        asyncio.create_task(self.difundir())
