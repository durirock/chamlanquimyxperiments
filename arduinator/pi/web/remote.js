/* ═══════════════════════════════════════════════════════════════════════════
   ORGANISMO REMOTO · el panel no simula: escucha a la Raspberry Pi por WebSocket
   y presenta la misma interfaz que el simulador, para que todo el resto funcione igual.
   ═══════════════════════════════════════════════════════════════════════════ */
class OrganismoRemoto {
  constructor() {
    this.remote = true;
    this.sens = { Tin: 15, RHin: 70, CO2: 420, PAR: 0, theta: 34, Tsoil: 13, EC: 2, pH: 6.3, mv: -42, Tout: 10, RHout: 80, rad: 0, wind: 0, rain: 0, P: 1013, bat: 100, pv: 0, VPD: 0, tankW: 70 };
    this.act = { vent: 0, shade: 0, heat: 0, pump: 0, fert: 0, acid: 0, led: 0, mist: 0, fan: 0 };
    this.inn = { T: 15, theta: 34, Tsoil: 13, pH: 6.3, tankW: 70, tankN: 60, wet: 0, CO2: 420 };
    this.out = { T: 10, RH: 80, rad: 0, wind: 0, rain: 0, cloud: 0.5, P: 1013 };
    this.plant = { bio: 0.4, fruits: 0, ripe: 0, harvest: 0, frost: 0, mv: -42, stress: 0, fW: 1, fT: 1, fN: 1, P: 0, ET: 0 };
    this.energy = { bat: 100, pv: 0, load: 0 };
    this.learn = { irrOn: 30, irrOff: 38, kET: 0.00055, irrigations: 0, frostSaves: 0, frostRisk: 0, waterUsed: 0 };
    this.vigilia = 0; this.alerta = null; this.devs = {}; this.thetaEst = 34; this.sensDoubt = false;
    this.dli = 0; this.dliYesterday = 14; this.ctrlClock = 0; this.ctrlCount = 0; this.samples = 0;
    this.forcing = null; this.organic = false; this.speed = 1; this.paused = false;
    this.events = []; this.log = []; this.hist = {}; this.missing = new Set(); this.estimated = new Set();
    this.nodos = []; this.modo = '…'; this.conectado = false; this.puedeMandar = false;
    this._tBase = 0; this._tRecv = performance.now(); this._tPrevConsume = null; this._id = 0;
    this.listeners = [];
    this.conectar();
  }
  get t() { return this._tBase + (this.paused ? 0 : this.speed * (performance.now() - this._tRecv) / 1000 * (this.modo === 'real' ? 1 : 1)); }
  set t(v) { this._tBase = v; this._tRecv = performance.now(); }
  get doy() { return (this.t / 86400) % 365; }
  get hour() { return (this.t / 3600) % 24; }
  sun() { return Invernadero.prototype.sun.call(this); }
  season() { return Invernadero.prototype.season.call(this); }
  advance() {}
  emit(kind, text) { this.log.push({ kind, text, t: this.t, id: ++this._id }); }
  force(name) { this.send({ cmd: 'perturbar', nombre: name }); }
  consumeDt() { const t = this.t; const d = this._tPrevConsume == null ? 0 : Math.max(0, t - this._tPrevConsume); this._tPrevConsume = t; return d; }
  send(obj) {
    const tok = new URLSearchParams(location.search).get('token');
    if (tok) obj.token = tok;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  conectar() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws' + location.search;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.conectado = true; this.aviso(); };
    ws.onclose = () => { this.conectado = false; this.aviso(); setTimeout(() => this.conectar(), 2000); };
    ws.onerror = () => ws.close();
    ws.onmessage = ev => { try { this.recibir(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
  }
  aplicarEstado(m) {
    const keep = ['sens', 'act', 'inn', 'out', 'plant', 'energy', 'learn', 'devs'];
    for (const k of keep) if (m[k]) Object.assign(this[k], m[k]);
    for (const k of ['vigilia', 'alerta', 'thetaEst', 'sensDoubt', 'dli', 'dliYesterday', 'ctrlClock', 'ctrlCount', 'samples', 'forcing', 'organic', 'paused']) if (k in m) this[k] = m[k];
    if ('speed' in m) this.speed = m.speed;
    if ('t' in m) this.t = m.t;
    if (m.faltantes) this.missing = new Set(m.faltantes);
    if (m.estimados) this.estimated = new Set(m.estimados);
  }
  recibir(m) {
    if (m.tipo === 'hola') {
      this.modo = m.modo; this.puedeMandar = m.puede_mandar; this.nombre = m.nombre; this.descripcion = m.descripcion;
      this.hist = m.hist || {}; this.nodos = m.nodos || [];
      this.log = []; for (const l of m.log || []) this.log.push({ ...l, id: ++this._id });
      this.aplicarEstado(m.estado);
      this._tPrevConsume = null;
      this.aviso(true);
      return;
    }
    if (m.tipo === 'rechazo') { this.emit('in', m.motivo); return; }
    if (m.tipo !== 'estado') return;
    this.aplicarEstado(m);
    for (const l of m.log || []) { this.log.push({ ...l, id: ++this._id }); if (this.log.length > 200) this.log.shift(); }
    for (const e of m.eventos || []) this.events.push(e);
    if (m.hist) this.hist = m.hist;
    if (m.histRow) for (const [k, v] of Object.entries(m.histRow)) { const a = this.hist[k] || (this.hist[k] = []); a.push(v); if (a.length > 288) a.shift(); }
    if (m.nodos) { this.nodos = m.nodos; this.aviso(); }
  }
  aviso(hola) { for (const f of this.listeners) f(hola); }
}
window.ORGANISMO = new OrganismoRemoto();

/* ─────────── piezas del panel que solo existen en la placa madre ─────────── */
(function () {
  const O = window.ORGANISMO;
  const q = s => document.querySelector(s);
  function render(hola) {
    const st = q('#conexion');
    if (st) {
      st.textContent = O.conectado ? (O.modo === 'real' ? 'En vivo · invernadero real' : 'En vivo · modo simulado') : 'Reconectando con la Raspberry Pi…';
      st.dataset.s = O.conectado ? O.modo : 'off';
    }
    if (hola) {
      const sub = q('.brand .sub'); if (sub) sub.textContent = `Nodo ${O.nombre} · ${O.descripcion} · placa madre Raspberry Pi`;
      const real = O.modo === 'real';
      for (const sel of ['#speedSeg', '#seasonSeg', '#organicBtn', '#playBtn', '.perturb']) { const el = q(sel); if (el) el.hidden = real; }
      const csv = q('#csvLink'); if (csv) csv.hidden = !real;
    }
    const box = q('#nodos'); if (!box) return;
    box.innerHTML = '';
    if (!O.nodos.length) { box.innerHTML = '<p class="note">No hay Arduinos conectados. Conecta uno por USB: la placa madre lo encuentra sola en unos segundos.</p>'; return; }
    for (const n of O.nodos) {
      const d = document.createElement('div'); d.className = 'nodo' + (n.vivo ? ' vivo' : '');
      d.innerHTML = `<div class="nh"><span class="led ${n.vivo ? 'blink' : ''}"></span><b></b><span class="np"></span></div><div class="nl"></div><div class="ne"></div>`;
      d.querySelector('b').textContent = n.nombre;
      d.querySelector('.np').textContent = `${n.puerto}${n.version ? ' · v' + n.version : ''} · ${n.hace == null ? 'sin datos' : n.hace < 2 ? 'ahora' : 'hace ' + Math.round(n.hace) + ' s'}`;
      d.querySelector('.nl').textContent = n.ultima || '—';
      d.querySelector('.ne').textContent = n.efectores && n.efectores.length ? 'controla: ' + n.efectores.join(', ') : 'solo sensores';
      box.appendChild(d);
    }
  }
  O.listeners.push(render);
  document.addEventListener('DOMContentLoaded', () => render(true));
})();
