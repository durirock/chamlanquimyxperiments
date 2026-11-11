/* ═══════════════════════════════════════════════════════════════════════════
   ARDUINATOR · modelo físico
   Invernadero túnel de 30 m² con tomates en Llanquihue (41,3° S).
   Tiempo de simulación: segundos desde el 1 de enero, hora local.
   ═══════════════════════════════════════════════════════════════════════════ */
const LAT = -41.3 * Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const es = T => 0.6108 * Math.exp(17.27 * T / (T + 237.3));   // presión de saturación, kPa

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* zona viable del organismo (fuera de ella despierta la vigilia) */
const VIABLE = {
  Tin:   { lo: 8,   hi: 30.5,   label: 'temperatura del aire' },
  RHin:  { lo: 35,  hi: 99,   label: 'humedad del aire' },
  theta: { lo: 24,  hi: 45,   label: 'agua del suelo' },
  EC:    { lo: 1.0, hi: 3.8,  label: 'nutrientes' },
  CO2:   { lo: 250, hi: 1300, label: 'CO₂' },
  pH:    { lo: 5.5, hi: 7.0,  label: 'pH' },
  tankW: { lo: 8,   hi: 101,  label: 'reserva de agua' },
};

class Invernadero {
  constructor(seed = 20261025) {
    this.rnd = mulberry(seed);
    this.t = (297 * 24 + 10.5) * 3600;    // 25 de octubre, 10:30
    this.out = { T: 11, RH: 78, rad: 0, wind: 4, rain: 0, cloud: 0.4, P: 1014, anomT: 0, anomP: 2, anomC: 0, gust: 0 };
    this.inn = { T: 15, e: 1.3, CO2: 520, theta: 34, Tsoil: 13, N: 6.8, pH: 6.3, tankW: 78, tankN: 64, wet: 0 };
    this.plant = { bio: 0.42, fruits: 0, ripe: 0, harvest: 0, frost: 0, mv: -42, mvOU: 0, stress: 0, fW: 1, fT: 1, fN: 1, P: 0, ET: 0 };
    this.act = { vent: 0, shade: 0, heat: 0, pump: 0, fert: 0, acid: 0, led: 0, mist: 0, fan: 0 };
    this.energy = { bat: 82, pv: 0, load: 0 };
    this.learn = { irrOn: 30, irrOff: 38, kET: 0.00055, lastMin: 99, lastMax: 0, irrigations: 0, frostRisk: 0,
                   frostSaves: 0, savedWater: 0, waterUsed: 0, pulseStart: 0, prevTheta: 34, prevT: 0, preheat: 0 };
    this.sens = {};           // lecturas (con ruido)
    this.sensFault = 0;       // horas restantes de falla del sensor de suelo
    this.sensDoubt = false;   // el organismo detectó que su sensor miente
    this.thetaEst = 34;
    this.forcing = null;      // evento climático impuesto
    this.vigilia = 0; this.alerta = null; this.devs = {};
    this.events = [];         // eventos para el puente sonoro y la bitácora
    this.log = [];
    this.dli = 0; this.dliDay = -1; this.dliYesterday = 14;
    this.ctrlClock = 0; this.sampleClock = 0;
    this.hist = {}; this.histClock = 0;
    this.lastDay = -1;
    this.sample();
  }

  gauss() { let u = 0, v = 0; while (!u) u = this.rnd(); v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  get doy() { return (this.t / 86400) % 365; }
  get hour() { return (this.t / 3600) % 24; }

  sun() {
    const d = this.doy, h = this.hour;
    const decl = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (d + 10) / 365);
    const H = (h - 12.6) * 15 * Math.PI / 180;            // mediodía solar ~12:36 en Chile continental (UTC-3)
    const s = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT));
    return { elev: Math.asin(s), az, decl };
  }
  season() {
    const d = this.doy;
    if (d >= 355 || d < 79) return 'verano';
    if (d < 172) return 'otoño';
    if (d < 265) return 'invierno';
    return 'primavera';
  }

  emit(kind, text, tag) {
    this.logId = (this.logId || 0) + 1;
    this.log.push({ kind, text, t: this.t, id: this.logId });
    if (this.log.length > 160) this.log.shift();
    if (tag) this.events.push(tag);
  }

  force(name) {
    const F = {
      helada:   { h: 26, ramp: 0.6, fall: 5, dT: -11, cloud: -0.8, P: 14, wind: -3, rain: 0, msg: 'Entra una masa de aire polar: el cielo se despeja, la presión sube y la temperatura cae en picada' },
      calor:    { h: 40, ramp: 1.2, fall: 6, dT: 11, cloud: -0.6, P: 6, wind: -1, rain: 0, msg: 'Ola de calor: aire caliente del norte y sol pleno' },
      temporal: { h: 20, ramp: 0.5, fall: 3, dT: -3, cloud: 0.9, P: -24, wind: 14, rain: 11, msg: 'Llega un sistema frontal: la presión cae, viento norte y lluvia intensa' },
    }[name];
    if (F) { this.forcing = { ...F, left: F.h * 3600, total: F.h * 3600, name }; this.emit('in', F.msg, 'evento:' + name); }
    if (name === 'sequia') { this.inn.tankW = 6; this.emit('in', 'El estanque de agua quedó casi vacío', 'evento:sequia'); }
    if (name === 'falla') { this.sensFault = 8; this.emit('in', 'El sensor de humedad de suelo empezó a entregar lecturas congeladas', 'evento:falla'); }
  }

  /* ─────────────── clima exterior ─────────────── */
  weather(dt) {
    const o = this.out, h = dt / 3600, d = this.doy, hr = this.hour;
    const yr = Math.cos(2 * Math.PI * (d - 18) / 365);          // +1 a mediados de enero
    const sd = Math.sqrt(h);
    o.anomP += (-o.anomP / 40) * h + 2.0 * sd * this.gauss();
    o.anomT += (-o.anomT / 40) * h + 0.9 * sd * this.gauss();
    o.anomC += (-o.anomC / 16) * h + 0.16 * sd * this.gauss();
    o.gust += (-o.gust / 0.3) * h + 2.2 * sd * this.gauss();
    o.rainOU = (o.rainOU || 0) + (-(o.rainOU || 0) / 0.7) * h + 0.9 * sd * this.gauss();
    let f = this.forcing, fk = 0;
    if (f) {
      const el = f.total - f.left;
      fk = Math.min(1, el / (f.ramp * 3600), f.left / (f.fall * 3600));
      fk = fk * fk * (3 - 2 * fk);                                    // entrada y salida suaves, pero rápidas
      f.left -= dt;
      if (f.left <= 0) { this.emit('in', 'El episodio climático se disipa', 'evento:fin'); this.forcing = null; }
    }
    const seasonCloud = 0.55 - 0.17 * yr;
    o.cloud = clamp(seasonCloud - 0.022 * o.anomP + o.anomC + (f ? f.cloud * fk : 0), 0, 1);
    o.P = 1013 + o.anomP + (f ? f.P * fk : 0);
    const Tmean = 10.3 + 4.6 * yr + o.anomT + (f ? f.dT * fk : 0);
    const amp = (4.2 + 2.2 * yr) * (1 - 0.65 * o.cloud);
    const s = this.sun();
    // ciclo diario con mínimo al alba y máximo ~15:30
    const ph = 2 * Math.PI * (hr - 9.5) / 24;
    o.T = Tmean + amp * Math.sin(ph) * 0.85 + amp * 0.25 * Math.sin(2 * ph - 0.6);
    if (o.cloud < 0.35) o.T -= ((f && f.name === 'helada' ? 4.5 * fk : 0) + 1.6 * (0.35 - o.cloud) / 0.35) * clamp(-s.elev / 0.22);   // enfriamiento radiativo nocturno
    const clear = s.elev > 0 ? 1050 * Math.pow(Math.sin(s.elev), 1.2) : 0;
    o.rad = clear * (1 - 0.78 * Math.pow(o.cloud, 3.2));
    o.wind = Math.max(0, 3.2 + 0.5 * Math.max(0, -o.P + 1013) * 0.6 + 1.5 * o.gust + (f ? f.wind * fk : 0) + 1.2 * Math.sin(ph));
    const rainBase = o.cloud > 0.82 ? (o.cloud - 0.82) * 22 * (1 - 0.45 * yr) : 0;
    o.rain = Math.max(0, (rainBase + (f ? f.rain * fk : 0)) * clamp(0.75 + 0.5 * o.rainOU, 0.1, 1.8));
    const spread = lerp(7, 0.6, o.cloud) * (o.rain > 0.2 ? 0.25 : 1);
    const Td = Math.min(o.T, Tmean - 1.5 - 0.6 * spread + (s.elev < 0 ? 1 : 0));
    o.RH = clamp(100 * es(Td) / es(o.T), 25, 100);
    // agua de lluvia cosechada del techo (60 m²) hacia el estanque de 5000 L
    if (o.rain > 0) this.inn.tankW = Math.min(100, this.inn.tankW + o.rain * 60 * 0.85 * h / 50);
  }

  /* ─────────────── física interna ─────────────── */
  physics(dt) {
    const o = this.out, i = this.inn, p = this.plant, a = this.act, h = dt / 3600;
    const solarIn = o.rad * 0.72 * (1 - 0.55 * a.shade);
    const ventEff = a.vent * (0.75 + 0.07 * o.wind) + 0.035 + 0.006 * o.wind + 0.04 * a.fan;
    const night = o.rad < 5;
    // temperatura del aire
    const dT = 0.062 * solarIn
      - (2.3 + 9.5 * ventEff) * (i.T - o.T)
      + 36 * a.heat
      - (night ? 1.3 * (1 - o.cloud) : 0)
      - (a.mist ? 6.0 * clamp(1 - i.e / es(i.T)) : 0)
      - 0.9 * p.ET
      + 0.55 * (i.Tsoil - i.T);
    i.T += dT * h;
    i.Tsoil += (i.T - i.Tsoil) * 0.18 * h + (a.pump ? (12 - i.Tsoil) * 0.4 * h : 0);
    // planta: estomas, fotosíntesis, transpiración
    const LAI = 0.4 + 2.6 * p.bio;
    const LAIf = 1 - Math.exp(-0.7 * LAI);
    const PAR = solarIn * 2.05 + a.led * 190;                      // µmol m⁻² s⁻¹
    const lightF = 1 - Math.exp(-PAR / 380);
    const sat = es(i.T), VPD = Math.max(0, sat - i.e);
    p.fW = clamp((i.theta - 17) / 10);
    p.fT = i.T < 9 ? clamp((i.T - 5) / 4) * 0.4 : i.T < 19 ? 0.4 + 0.6 * (i.T - 9) / 10 : i.T <= 27 ? 1 : clamp(1 - (i.T - 27) / 10);
    const EC = this.EC();
    p.fN = clamp((EC - 0.5) / 1.1) * clamp(1 - (EC - 3.4) / 2.5);
    const fC = i.CO2 / (i.CO2 + 280);
    p.P = lightF * p.fT * p.fW * p.fN * fC * 1.75;                // 0..~1
    const gs = (0.08 + 0.92 * clamp(PAR / 250)) * (0.25 + 0.75 * p.fW);
    p.ET = gs * LAIf * (0.00062 * solarIn + 0.16 * VPD + 0.012 * a.led);   // mm/h
    // vapor de agua
    const eOut = o.RH / 100 * es(o.T);
    i.e += (3.6 * p.ET + (a.mist ? 1.8 * clamp(1 - i.e / sat) : 0)
            - (1.0 + 11 * ventEff) * (i.e - eOut)) * h;
    if (i.e > sat) { i.wet = Math.min(1, i.wet + (i.e - sat) * 4); i.e = sat; }
    else i.wet = Math.max(0, i.wet - (0.4 + VPD) * h);
    // CO₂
    const resp = (14 + 18 * LAI * 0.4) * Math.pow(2, (i.T - 15) / 10);
    const photo = 190 * p.P * LAIf;
    i.CO2 += (resp - photo - (0.5 + 13 * ventEff) * (i.CO2 - 421)) * h;
    i.CO2 = Math.max(150, i.CO2);
    // agua del suelo (VWC %, zona radicular 200 mm)
    const pumping = a.pump && i.tankW > 1;
    const inflow = pumping ? 13 : 0;                             // %/h ≈ 26 mm/h de goteo
    const drain = i.theta > 44 ? 1.6 * (i.theta - 44) : 0;
    i.theta += (-p.ET * 0.85 + inflow - drain) * h;      // sustrato de 120 mm
    if (pumping) { i.tankW = Math.max(0, i.tankW - 15.6 * h); this.learn.waterUsed += 780 * h; }   // 780 L/h sobre estanque de 5000 L
    if (a.mist && i.tankW > 1) i.tankW = Math.max(0, i.tankW - 0.9 * h);
    // nutrientes (masa relativa en solución) y pH
    const uptake = 0.11 * p.P * LAIf + 0.004;
    const fertIn = a.fert && pumping && i.tankN > 0.5 ? 3.2 : 0;
    i.N += (-uptake + fertIn + inflow * 0.012 - drain * i.N / Math.max(i.theta, 5)) * h;
    i.N = Math.max(0.2, i.N);
    if (fertIn) i.tankN = Math.max(0, i.tankN - 1.6 * h);
    i.pH += (0.0035 + 0.022 * uptake / 0.11 + (fertIn ? 0.02 : 0) - (a.acid ? 0.75 : 0) + (inflow ? (6.9 - i.pH) * 0.01 : 0)) * h;
    i.pH = clamp(i.pH, 4.5, 8.2);
    // crecimiento, fruta, daño
    const room = 1 - p.bio;
    p.bio += 0.009 * p.P * room * h * (0.6 + 0.4 * LAIf);
    if (p.bio > 0.45 && p.fT > 0.5) p.fruits += 0.02 * p.P * h * p.bio;
    if (p.fruits > 0) { const r = p.fruits * 0.0045 * h * clamp((i.T - 10) / 12); p.fruits -= r; p.ripe += r; }
    if (p.ripe > 0.6) { const kg = p.ripe * 9; p.harvest += kg; p.ripe = 0; this.emit('out', `Cosecha: ${kg.toFixed(1)} kg de tomates maduros`, 'cosecha'); }
    if (i.T < 0.8) { p.frost = Math.min(1, p.frost + (1 - i.T) * 0.35 * h); p.bio = Math.max(0.05, p.bio - 0.02 * (1 - i.T) * h); }
    else p.frost = Math.max(0, p.frost - 0.01 * h);
    if (i.T > 36) p.bio = Math.max(0.05, p.bio - 0.004 * (i.T - 36) * h);
    p.stress = clamp(Math.max(1 - p.fW, (1 - p.fT) * (PAR > 50 ? 1 : 0.3), 1 - p.fN, p.frost, VPD > 2.2 ? (VPD - 2.2) : 0));
    // potencial eléctrico foliar (mV): ruido con varianza que crece con el estrés y la luz cambiante
    const sig = 1.4 + 7 * p.stress + 2.5 * lightF;
    p.mvOU += (-p.mvOU / 0.08) * h + sig * Math.sqrt(h / 0.04) * this.gauss() * 0.35;
    p.mv = -42 + 6 * lightF + p.mvOU + (p.spike || 0);
    if (p.spike) { p.spike *= Math.exp(-h / 0.25); if (Math.abs(p.spike) < 0.3) p.spike = 0; }
    // energía: panel de 120 W y batería de 40 Ah
    this.energy.pv = 120 * clamp(o.rad / 1000) * (0.95 - 0.3 * o.cloud);
    this.energy.load = 2.4 + (pumping ? 38 : 0) + (a.vent > 0.02 ? 3 : 0) + (a.fert ? 6 : 0) + (a.acid ? 4 : 0);   // calefactor, ventilador y LED van a la red
    this.energy.bat = clamp(this.energy.bat + (this.energy.pv - this.energy.load) * h / 4.8, 0, 100);
    this._PAR = PAR; this._VPD = VPD; this._solarIn = solarIn;
    // luz diaria integrada
    const day = Math.floor(this.t / 86400);
    if (day !== this.dliDay) { if (this.dliDay >= 0) this.dliYesterday = this.dli; this.dli = 0; this.dliDay = day; }
    this.dli += PAR * dt / 1e6;
  }

  EC() { return this.inn.N / Math.max(this.inn.theta, 5) * 10; }

  /* ─────────────── sentidos (con ruido, cuantización y fallas) ─────────────── */
  sample() {
    const g = () => this.gauss(), o = this.out, i = this.inn, p = this.plant;
    const RH = clamp(100 * i.e / es(i.T), 0, 100);
    const thetaTrue = i.theta;
    const s = this.sens;
    const q = (x, r) => Math.round(x / r) * r;
    s.Tin = q(i.T + 0.12 * g(), 0.01);
    s.RHin = q(RH + 0.9 * g(), 0.1);
    s.CO2 = q(i.CO2 + 9 * g(), 1);
    s.PAR = q(Math.max(0, this._PAR * (1 + 0.02 * g())), 1);
    if (this.sensFault > 0) { s.theta = s.theta ?? thetaTrue; }
    else s.theta = q(thetaTrue + 0.35 * g(), 0.1);
    s.Tsoil = q(i.Tsoil + 0.06 * g(), 0.06);
    s.EC = q(this.EC() * (1 + 0.012 * g()), 0.01);
    s.pH = q(i.pH + 0.03 * g(), 0.01);
    s.mv = q(p.mv + 0.4 * g(), 0.1);
    s.wet = i.wet;
    s.tankW = q(i.tankW, 1); s.tankN = q(i.tankN, 1);
    s.Tout = q(o.T + 0.15 * g(), 0.01);
    s.RHout = q(clamp(o.RH + 1.2 * g(), 0, 100), 0.1);
    s.rad = q(Math.max(0, o.rad * (1 + 0.015 * g())), 1);
    s.wind = q(Math.max(0, o.wind + 0.4 * g()), 0.1);
    s.rain = q(o.rain, 0.2);
    s.P = q(o.P + 0.12 * g(), 0.1);
    s.bat = this.energy.bat; s.pv = this.energy.pv;
    s.VPD = this._VPD || 0;
  }

  /* ─────────────── el organismo decide (cada 60 s simulados) ─────────────── */
  control() {
    this.ctrlCount = (this.ctrlCount || 0) + 1;
    const s = this.sens, a = this.act, L = this.learn, i = this.inn;
    const prev = { ...a };
    const day = s.rad > 25;
    const hr = this.hour;
    // ¿confío en mi sensor de suelo? Si la lectura no cambia mientras la planta transpira, miente.
    const dTh = s.theta - L.prevTheta;
    const expected = -this.plant.ET * 0.85 / 60 + (a.pump ? 13 / 60 : 0);
    if (Math.abs(dTh) < 1e-9 && Math.abs(expected) > 0.004) L.stuck = (L.stuck || 0) + 1; else L.stuck = 0;
    if (!this.sensDoubt && L.stuck > 25) { this.sensDoubt = true; this.emit('proc', 'El sensor de suelo no cambia mientras la planta transpira: dejo de creerle y estimo con mi modelo de evapotranspiración', 'duda'); }
    if (this.sensDoubt && this.sensFault <= 0 && Math.abs(dTh) > 1e-6) { this.sensDoubt = false; this.thetaEst = s.theta; this.emit('proc', 'El sensor de suelo vuelve a responder; recalibro la estimación contra su lectura', 'confia'); }
    L.prevTheta = s.theta;
    // estimación propia del agua del suelo (modelo aprendido)
    const etEst = L.kET * this._solarIn + 0.04 * s.VPD;
    this.thetaEst += (-etEst * 0.85 * 60 / 3600 + (a.pump && i.tankW > 1 ? 13 / 60 : 0));
    if (!this.sensDoubt) {
      // aprende el coeficiente de evapotranspiración comparando lo predicho con lo medido
      // ventana de 90 min sin riego, sobre la lectura filtrada: compara la caída medida con la predicha
      L.thF = L.thF == null ? s.theta : L.thF + (s.theta - L.thF) * 0.12;
      if (!a.pump && day && this._solarIn > 120) {
        if (!L.win) L.win = { th: L.thF, n: 0, pred: 0, sol: 0 };
        L.win.n++; L.win.pred += L.kET * this._solarIn + 0.04 * s.VPD; L.win.sol += this._solarIn;
        if (L.win.n >= 90) {
          const obs = Math.max(0, (L.win.th - L.thF) / 1.5 / 0.85);  // mm/h observados
          const pred = L.win.pred / L.win.n, sol = L.win.sol / L.win.n;
          const kOld = L.kET;
          L.kET = clamp(L.kET + clamp(0.25 * (obs - pred) / sol, -0.15 * kOld, 0.15 * kOld), 0.0002, 0.0012);
          if (Math.abs(L.kET - kOld) / kOld > 0.05) this.emit('proc', `Recalibro mi modelo de transpiración: la planta evapora ${obs.toFixed(2)} mm/h, yo esperaba ${pred.toFixed(2)}`, 'calibra');
          L.win = null;
        }
      } else { L.win = null; if (a.pump) L.thF = s.theta; }
      this.thetaEst = s.theta;
    }
    const theta = this.thetaEst;
    // riesgo de helada: tarde despejada, aire seco y presión alta (aprendido de noches anteriores)
    const clearDry = s.RHout < 70 || this.out.cloud < 0.3;
    const falling = s.Tout - (L.prevT || s.Tout);
    L.prevT = s.Tout;
    const evening = hr > 17 || hr < 8;
    let frostRisk = L.frostRisk ? (hr > 17 || hr < 9.5) : (evening && clearDry && s.Tout < 5 && falling <= 0.02);
    if (frostRisk && !L.frostRisk && !L.warnedTonight) { this.emit('proc', `Huelo helada: cielo despejado, ${s.Tout.toFixed(1)} °C afuera y bajando. Me preparo antes de que llegue`, 'presiente'); L.warnedTonight = true; }
    if (hr > 10 && hr < 11) L.warnedTonight = false;
    L.frostRisk = frostRisk ? 1 : 0;
    // temperatura
    const lo = day ? 15 : (frostRisk ? 12 : 11), hi = day ? 26 : 20;
    let vent = 0;
    if (s.Tin > hi) vent = clamp((s.Tin - hi) / 6 + 0.12);
    if (s.RHin > 92 && s.Tin > lo + 1.5) vent = Math.max(vent, 0.18);
    if (day && s.CO2 < 330 && s.Tin > lo + 2) vent = Math.max(vent, 0.12);
    if (s.wind > 14) vent = Math.min(vent, 0.25);
    if (s.rain > 4) vent = Math.min(vent, 0.15);
    a.vent = lerp(a.vent, vent, 0.5);
    if (a.vent < 0.015) a.vent = 0;
    if (s.Tin < lo - 1) a.heat = 1; else if (s.Tin > lo + (frostRisk ? 2.5 : 1.5)) a.heat = 0;
    if (s.rad > 620 && s.Tin > hi + 2) a.shade = 1; else if (s.Tin < hi - 1 || s.rad < 380) a.shade = 0;
    if (s.Tin > 29 && s.RHin < 60 && i.tankW > 10) a.mist = 1; else if (s.Tin < 27 || s.RHin > 75) a.mist = 0;
    a.fan = (a.mist || s.RHin > 88 || (a.fan && s.RHin > 82)) ? 1 : 0;
    // riego con umbrales aprendidos
    const leach = s.EC > 3.4;
    const off = leach ? 43 : L.irrOff;
    if (!a.pump && i.tankW > 2 && (theta < L.irrOn && (day || theta < L.irrOn - 3))) {
      a.pump = 1; L.pulseStart = this.t; L.lastMin = theta; L.irrigations++;
    } else if (a.pump && (theta >= off || i.tankW <= 1)) {
      a.pump = 0;
      if (i.tankW <= 1) this.emit('proc', 'No queda agua en el estanque: detengo el riego y espero la lluvia', 'sinagua');
    }
    if (a.pump) L.lastMax = Math.max(L.lastMax, theta);
    a.fert = a.pump && (s.EC < 2.1 || (a.fert && s.EC < 2.5)) && !leach ? 1 : 0;
    if (s.pH > 6.8) a.acid = 1; else if (s.pH < 6.2) a.acid = 0;
    // aprendizaje del pulso: tras regar, mira si se pasó (drenaje) o si la planta sufrió antes de regar
    if (prev.pump && !a.pump) {
      let note = '';
      if (L.lastMax > 43.5) { L.irrOff = Math.max(34, L.irrOff - 0.6); note = `el suelo drenó; acorto el pulso (corte en ${L.irrOff.toFixed(1)} %)`; L.savedWater += 12; }
      else if (L.lastMin < 26) { L.irrOn = Math.min(34, L.irrOn + 0.8); note = `la planta alcanzó a sufrir; riego antes (inicio en ${L.irrOn.toFixed(1)} %)`; }
      else if (L.lastMin > 28.5) { L.irrOn = Math.max(27.5, L.irrOn - 0.4); note = `la planta tolera más; espero un poco más (inicio en ${L.irrOn.toFixed(1)} %)`; L.savedWater += 6; }
      if (note) this.emit('proc', 'Aprendo de este riego: ' + note, 'aprende');
      L.lastMax = 0;
    }
    // luz suplementaria en días cortos
    const dliTarget = 13;
    const ledOk = hr > 6 && hr < 21 && this.dli < dliTarget && this.dliYesterday < dliTarget + 2 && this.energy.bat > 25;
    a.led = ledOk && (s.PAR < 140 || (a.led && s.PAR < 380)) ? 1 : 0;
    // narración de las determinaciones
    const names = { vent: 'ventanas cenitales', heat: 'calefactor', shade: 'malla de sombra', pump: 'riego por goteo', fert: 'fertirriego', acid: 'corrector de pH', led: 'luz suplementaria', mist: 'nebulización', fan: 'ventilador' };
    for (const k of Object.keys(names)) {
      const was = k === 'vent' ? prev.vent > 0.04 : !!prev[k];
      const now = k === 'vent' ? a.vent > 0.04 : !!a[k];
      if (was !== now) {
        this._lastAct = this._lastAct || {};
        const quiet = (k === 'heat' || k === 'fan' || k === 'vent') && this.t - (this._lastAct[k] || -1e9) < 2400;
        this._lastAct[k] = this.t;
        if (quiet) { this.events.push(`${k}:${now ? 'on' : 'off'}`); continue; }
        const why = {
          vent: now ? `T ${s.Tin.toFixed(1)} °C · HR ${s.RHin.toFixed(0)} %` : 'el aire volvió a su zona',
          heat: now ? `T ${s.Tin.toFixed(1)} °C bajo ${lo} °C` : `T ${s.Tin.toFixed(1)} °C`,
          shade: now ? `radiación ${s.rad} W/m²` : '',
          pump: now ? `suelo ${theta.toFixed(1)} % bajo ${L.irrOn.toFixed(1)} %` : `suelo ${theta.toFixed(1)} %`,
          fert: now ? `EC ${s.EC.toFixed(2)} mS/cm` : '', acid: now ? `pH ${s.pH.toFixed(2)}` : '',
          led: now ? `luz del día ${this.dli.toFixed(1)} mol/m²` : '', mist: now ? `aire seco y caliente` : '', fan: '',
        }[k];
        this.emit('out', `${now ? 'Abro' : 'Cierro'} ${names[k]}${why ? ' · ' + why : ''}`, `${k}:${now ? 'on' : 'off'}`);
      }
    }
    // la helada evitada
    if (L.frostRisk && this.out.T < 0.5 && i.T > 4 && !L.savedTonight) { L.frostSaves++; L.savedTonight = true; this.emit('proc', `Afuera ${this.out.T.toFixed(1)} °C, adentro ${i.T.toFixed(1)} °C: la helada no entra`, 'salva'); }
    if (hr > 10 && hr < 11) L.savedTonight = false;
    // el sol cruza el horizonte
    const el = this.sun().elev;
    if (L.prevElev != null) {
      if (L.prevElev < 0 && el >= 0) this.emit('in', 'Amanece: la luz vuelve a la hoja y la fotosíntesis despierta', 'amanecer');
      if (L.prevElev >= 0 && el < 0) this.emit('in', 'Anochece: la planta deja de fotosintetizar y empieza a respirar', 'anochecer');
    }
    L.prevElev = el;
    // conciencia: ¿hay viabilidad en juego?
    const v = { Tin: s.Tin, RHin: s.RHin, theta, EC: s.EC, CO2: s.CO2, pH: s.pH, tankW: i.tankW };
    let worst = null, dev = 0;
    for (const k in VIABLE) {
      const z = VIABLE[k], w = z.hi - z.lo;
      const d = v[k] < z.lo ? (z.lo - v[k]) / w : v[k] > z.hi ? (v[k] - z.hi) / w : 0;
      this.devs[k] = d;
      if (d > dev) { dev = d; worst = k; }
    }
    if (L.frostRisk && this.out.T < 2) { dev = Math.max(dev, 0.06 + 0.04 * (2 - this.out.T)); worst = worst || 'Tin'; }
    if (this.sensDoubt) { dev = Math.max(dev, 0.08); worst = worst || 'theta'; }
    this._vigTarget = clamp(dev * 4);
    if (this._vigTarget > 0.05) this.alerta = worst;
  }

  /* deriva orgánica: el clima propone sus propios episodios según la estación */
  autoClimate(dt) {
    this.autoCool = Math.max(0, (this.autoCool || 0) - dt);
    if (this.forcing || this.autoCool > 0) return;
    const se = this.season(), hr = this.hour, h = dt / 3600;
    const P = {
      helada:   { invierno: 0.3, 'otoño': 0.15, primavera: 0.09, verano: 0 }[se],
      calor:    { invierno: 0, 'otoño': 0.03, primavera: 0.06, verano: 0.2 }[se],
      temporal: { invierno: 0.35, 'otoño': 0.28, primavera: 0.14, verano: 0.05 }[se],
    };
    const win = { helada: hr > 15 && hr < 19, calor: hr > 8 && hr < 12, temporal: true };
    for (const k of ['helada', 'temporal', 'calor']) {
      if (win[k] && this.rnd() < P[k] * h / (k === 'temporal' ? 24 : 4)) {     // P = probabilidad por día
        this.force(k); this.autoCool = (30 + 40 * this.rnd()) * 3600; this.forcing.auto = true; return;
      }
    }
  }

  step(dt) {
    if (this.organic) this.autoClimate(dt);
    this.weather(dt);
    this.physics(dt);
    this.t += dt;
    if (this.sensFault > 0) { this.sensFault -= dt / 3600; if (this.sensFault <= 0) this.sensFault = 0; }
    this.sampleClock += dt;
    if (this.sampleClock >= 5) { this.sampleClock = 0; this.sample(); this.samples = (this.samples || 0) + 1; }
    this.ctrlClock += dt;
    if (this.ctrlClock >= 60) { this.ctrlClock -= 60; this.control(); }
    // vigilia: despertar rápido, dormirse lento (en tiempo simulado)
    const tgt = this._vigTarget || 0;
    const tau = tgt > this.vigilia ? 180 : 1800;
    this.vigilia += (1 - Math.exp(-dt / tau)) * (tgt - this.vigilia);
    if (this.vigilia < 0.04 && tgt < 0.02) this.alerta = null;
    // historia cada 10 minutos simulados (48 h)
    this.histClock += dt;
    if (this.histClock >= 600) { this.histClock = 0; this.record(); }
    const day = Math.floor(this.t / 86400);
    if (day !== this.lastDay) { if (this.lastDay >= 0) this.emit('proc', `Nuevo día · ${this.season()} · ayer ${this.dliYesterday.toFixed(1)} mol/m² de luz, ${this.learn.irrigations} riegos acumulados`, 'dia'); this.lastDay = day; }
  }

  record() {
    const s = this.sens, keys = ['Tin', 'RHin', 'CO2', 'PAR', 'theta', 'Tsoil', 'EC', 'pH', 'mv', 'Tout', 'RHout', 'rad', 'wind', 'rain', 'P', 'bat'];
    for (const k of keys) {
      const arr = this.hist[k] || (this.hist[k] = []);
      arr.push(k === 'theta' ? this.thetaEst : s[k]);
      if (arr.length > 288) arr.shift();
    }
    const v = this.hist.vig || (this.hist.vig = []);
    v.push(this.vigilia); if (v.length > 288) v.shift();
  }

  advance(simSeconds) {
    let left = simSeconds, n = 0;
    while (left > 0 && n < 400) { const d = Math.min(20, left); this.step(d); left -= d; n++; }
  }
}

if (typeof module !== 'undefined') module.exports = { Invernadero, VIABLE, es };
