"""Memoria del organismo: lo que aprende sobrevive a los reinicios de la Raspberry Pi."""
import json
import sqlite3
import threading
import time

APRENDIZAJE = ("irrOn", "irrOff", "kET", "irrigations", "frostSaves")


class Memoria:
    def __init__(self, ruta):
        self.db = sqlite3.connect(ruta, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS registro (ts REAL PRIMARY KEY, datos TEXT);
                CREATE TABLE IF NOT EXISTS bitacora (ts REAL, tipo TEXT, texto TEXT);
                CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT);
            """)
            self.db.commit()

    def restaurar(self, org):
        with self.lock:
            fila = self.db.execute("SELECT valor FROM estado WHERE clave='aprendizaje'").fetchone()
            if fila:
                guardado = json.loads(fila[0])
                for k in APRENDIZAJE:
                    if k in guardado:
                        org.learn[k] = guardado[k]
                org.thetaEst = guardado.get("thetaEst", org.thetaEst)
            desde = time.time() - 48 * 3600
            for (datos,) in self.db.execute("SELECT datos FROM registro WHERE ts > ? ORDER BY ts", (desde,)):
                row = json.loads(datos)
                for k, arr in org.hist.items():
                    if k in row:
                        arr.append(row[k])
            for k in org.hist:
                org.hist[k] = org.hist[k][-288:]
            filas = self.db.execute("SELECT ts, tipo, texto FROM bitacora ORDER BY ts DESC LIMIT 40").fetchall()
        for ts, tipo, texto in reversed(filas):
            org.logId += 1
            org.log.append(dict(kind=tipo, text=texto, t=org.medio.t - (time.time() - ts), id=org.logId))
        if fila:
            org.emit("proc", f"Recuerdo lo aprendido: inicio de riego en {org.learn['irrOn']:.1f} %, "
                             f"{org.learn['irrigations']} riegos y {len(org.hist['Tin'])} registros de las últimas 48 h")

    def registrar(self, t, row, learn, thetaEst):
        estado = {k: learn[k] for k in APRENDIZAJE}
        estado["thetaEst"] = thetaEst
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO registro VALUES (?, ?)", (time.time(), json.dumps(row)))
            self.db.execute("INSERT OR REPLACE INTO estado VALUES ('aprendizaje', ?)", (json.dumps(estado),))
            self.db.execute("DELETE FROM registro WHERE ts < ?", (time.time() - 90 * 86400,))
            self.db.commit()

    def bitacora(self, item):
        with self.lock:
            self.db.execute("INSERT INTO bitacora VALUES (?, ?, ?)", (time.time(), item["kind"], item["text"]))
            self.db.commit()

    def exportar_csv(self, desde):
        with self.lock:
            filas = self.db.execute("SELECT ts, datos FROM registro WHERE ts > ? ORDER BY ts", (desde,)).fetchall()
        if not filas:
            return "ts\n"
        claves = sorted(json.loads(filas[0][1]).keys())
        out = ["fecha," + ",".join(claves)]
        for ts, d in filas:
            row = json.loads(d)
            out.append(time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) + "," + ",".join(str(round(row.get(k, 0), 3)) for k in claves))
        return "\n".join(out) + "\n"
