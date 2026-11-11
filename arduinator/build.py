"""Arma las dos páginas desde los mismos módulos de fuente/:
  index.html         simulador autónomo (todo ocurre en el navegador)
  pi/web/index.html  panel de la placa madre (el organismo vive en la Raspberry Pi)
Uso: python3 build.py
"""
from pathlib import Path

R = Path(__file__).resolve().parent
F = R / "fuente"
HEAD = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
tpl = (F / "plantilla.html").read_text()
src = {k: (F / f).read_text() for k, f in [("SIM", "sim.js"), ("AUDIO", "audio.js"), ("ORQ", "orquesta.js"), ("UI", "ui.js")]}


def armar(t, tras_sim=""):
    t = HEAD + t.replace("/*SIM*/", src["SIM"] + tras_sim)
    for k in ("AUDIO", "ORQ", "UI"):
        t = t.replace(f"/*{k}*/", src[k])
    return t


(R / "index.html").write_text(armar(tpl))

pi = tpl
for a, b in [
    ('<div class="clock">', '<div class="clock">\n      <span class="chip" id="conexion" data-s="off">Conectando con la Raspberry Pi…</span>'),
    ('      <section class="card">\n        <header><h2>Bitácora</h2>',
     '      <section class="card">\n        <header><h2>Nodos Arduino</h2><a class="iconbtn" id="csvLink" href="/api/historial.csv?horas=48" hidden>Descargar historial</a></header>\n'
     '        <div class="nodos" id="nodos"></div>\n      </section>\n\n      <section class="card">\n        <header><h2>Bitácora</h2>'),
]:
    assert a in pi, a[:40]
    pi = pi.replace(a, b, 1)
remoto = (R / "pi/web/remote.js").read_text()
(R / "pi/web/index.html").write_text(armar(pi, "\n</script>\n<script>\n" + remoto))
print("index.html y pi/web/index.html listos")
