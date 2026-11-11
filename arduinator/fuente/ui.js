/* ═══════════════════════════════════════════════════════════════════════════
   INTERFAZ · escena del invernadero, sentidos, organismo y puente
   ═══════════════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const sim = window.ORGANISMO || new Invernadero();      // en la placa madre, el organismo vive en la Raspberry Pi
const puente = new PuenteOrganico();
puente.onStatus = t => { $('audioStatus').textContent = t; };
let speed = 60, playing = true, organic = false, nsActivity = 0;

// cuarenta y ocho horas de historia previa, para que los sentidos tengan memoria
(function warm() {
  if (sim.remote) return;
  sim.t -= 48 * 3600;
  for (let k = 0; k < 288; k++) sim.advance(600);
  sim.log.length = 0; sim.events.length = 0;
  sim.emit('proc', 'Despierto con 48 horas de memoria del invernadero. Escucho sin filtrar mientras todo esté en su zona.');
})();

/* ─────────── definición de los sentidos ─────────── */
const SENS_IN = [
  { k: 'Tin', n: 'Temperatura del aire', m: 'SHT31', u: '°C', d: 1, z: VIABLE.Tin },
  { k: 'RHin', n: 'Humedad del aire', m: 'SHT31', u: '%', d: 0, z: VIABLE.RHin },
  { k: 'CO2', n: 'Dióxido de carbono', m: 'SCD30 · NDIR', u: 'ppm', d: 0, z: VIABLE.CO2 },
  { k: 'PAR', n: 'Luz fotosintética', m: 'cuántico PAR', u: 'µmol/m²·s', d: 0 },
  { k: 'theta', n: 'Agua del suelo', m: 'capacitivo v2.0', u: '% vol', d: 1, z: VIABLE.theta },
  { k: 'Tsoil', n: 'Temperatura del suelo', m: 'DS18B20', u: '°C', d: 1 },
  { k: 'EC', n: 'Conductividad', m: 'sonda EC · K=1', u: 'mS/cm', d: 2, z: VIABLE.EC },
  { k: 'pH', n: 'pH de la solución', m: 'electrodo de vidrio', u: '', d: 2, z: VIABLE.pH },
  { k: 'mv', n: 'Potencial de la hoja', m: 'electrodo Ag/AgCl', u: 'mV', d: 1 },
];
const SENS_OUT = [
  { k: 'Tout', n: 'Temperatura exterior', m: 'SHT31 en abrigo', u: '°C', d: 1 },
  { k: 'RHout', n: 'Humedad exterior', m: 'SHT31 en abrigo', u: '%', d: 0 },
  { k: 'rad', n: 'Radiación solar', m: 'piranómetro', u: 'W/m²', d: 0 },
  { k: 'wind', n: 'Viento', m: 'anemómetro de cazoletas', u: 'm/s', d: 1 },
  { k: 'rain', n: 'Lluvia', m: 'pluviómetro de balancín', u: 'mm/h', d: 1 },
  { k: 'P', n: 'Presión', m: 'BMP280', u: 'hPa', d: 1 },
  { k: 'bat', n: 'Batería', m: 'panel 120 W · 40 Ah', u: '%', d: 0 },
];
function buildSensors(list, host) {
  for (const s of list) {
    const el = document.createElement('div'); el.className = 'sensor'; el.id = 'sn-' + s.k;
    el.innerHTML = `<div class="name"><span>${s.n}</span><span class="led"></span></div><div class="model">${s.m}</div><div class="val"><span>—</span><small>${s.u}</small></div><canvas width="380" height="68"></canvas><span class="tag" hidden></span>`;
    host.appendChild(el);
    s.el = el; s.valEl = el.querySelector('.val span'); s.led = el.querySelector('.led'); s.cv = el.querySelector('canvas'); s.tag = el.querySelector('.tag');
  }
}
buildSensors(SENS_IN, $('sensIn')); buildSensors(SENS_OUT, $('sensOut'));

const ZONES = [
  { k: 'Tin', n: 'Temperatura', r: [-5, 40], u: '°C', d: 1 },
  { k: 'RHin', n: 'Humedad aire', r: [20, 100], u: '%', d: 0 },
  { k: 'theta', n: 'Agua del suelo', r: [10, 50], u: '%', d: 1 },
  { k: 'EC', n: 'Nutrientes', r: [0, 5], u: 'mS', d: 2 },
  { k: 'CO2', n: 'CO₂', r: [150, 1500], u: 'ppm', d: 0 },
  { k: 'pH', n: 'pH', r: [4.5, 8], u: '', d: 2 },
  { k: 'tankW', n: 'Reserva de agua', r: [0, 100], u: '%', d: 0 },
];
for (const z of ZONES) {
  const v = VIABLE[z.k], w = z.r[1] - z.r[0];
  const el = document.createElement('div'); el.className = 'zone';
  el.innerHTML = `<span>${z.n}</span><div class="bar"><div class="band" style="left:${(v.lo - z.r[0]) / w * 100}%;width:${(Math.min(v.hi, z.r[1]) - v.lo) / w * 100}%"></div><div class="mark"></div></div><span class="v">—</span>`;
  $('zones').appendChild(el); z.mark = el.querySelector('.mark'); z.v = el.querySelector('.v');
}

const ACTS = [
  { k: 'vent', n: 'Ventanas cenitales', f: v => v > 0.02 ? `abiertas ${Math.round(v * 100)} %` : 'cerradas', lvl: v => v },
  { k: 'shade', n: 'Malla de sombra', f: v => v ? 'extendida' : 'recogida' },
  { k: 'heat', n: 'Calefactor 6 kW', f: v => v ? 'encendido' : 'apagado' },
  { k: 'fan', n: 'Ventilador', f: v => v ? 'girando' : 'detenido' },
  { k: 'pump', n: 'Riego por goteo', f: v => v ? '780 L/h' : 'cerrado' },
  { k: 'fert', n: 'Fertirriego A+B', f: v => v ? 'dosificando' : 'en espera' },
  { k: 'acid', n: 'Corrector de pH', f: v => v ? 'dosificando' : 'en espera' },
  { k: 'mist', n: 'Nebulización', f: v => v ? 'activa' : 'en espera' },
  { k: 'led', n: 'Luz suplementaria', f: v => v ? '190 µmol' : 'apagada' },
];
for (const a of ACTS) {
  const el = document.createElement('div'); el.className = 'act';
  el.innerHTML = `<span class="an">${a.n}</span><span class="as">—</span><div class="ab"><i></i></div>`;
  $('acts').appendChild(el); a.el = el; a.s = el.querySelector('.as'); a.bar = el.querySelector('.ab i');
}

/* ─────────── controles ─────────── */
$('playBtn').onclick = () => { playing = !playing; if (sim.remote) sim.send({ cmd: 'pausa', valor: !playing }); $('playBtn').textContent = playing ? 'Pausar' : 'Reanudar'; $('playBtn').setAttribute('aria-pressed', playing); };
$('speedSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
  speed = +b.dataset.s; if (sim.remote) sim.send({ cmd: 'velocidad', valor: speed }); $('speedSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  setOrganic(false);
});
function setOrganic(on) {
  if (sim.remote && organic !== on) sim.send({ cmd: 'organica', valor: on });
  organic = on; sim.organic = on;
  $('organicBtn').setAttribute('aria-pressed', on);
  if (on) { $('speedSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); if (!sim.remote) sim.emit('proc', 'Deriva orgánica: el tiempo se demora en el alba y el ocaso, y el clima propone sus propios episodios según la estación.'); }
}
$('organicBtn').onclick = () => setOrganic(!organic);
function organicSpeed(dt) {
  const e = sim.sun().elev;
  let target = Math.abs(e) < 0.11 ? 70 : e > 0 ? 540 : 1500;
  if (sim.forcing && sim.forcing.total - sim.forcing.left < 3 * 3600) target = 120;     // que el episodio se vea llegar
  if (sim.vigilia > 0.4) target = Math.min(target, 240);
  speed = Math.exp(Math.log(speed) + (Math.log(target) - Math.log(speed)) * Math.min(1, dt * 0.5));
}
$('seasonSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
  const hr = sim.hour, d = +b.dataset.d;
  if (sim.remote) { sim.send({ cmd: 'estacion', dia: d, nombre: b.textContent.toLowerCase() }); return; }
  sim.forcing = null;
  sim.t = ((d - 2) * 24 + hr) * 3600;
  sim.hist = {};
  for (let k = 0; k < 288; k++) sim.advance(600);
  sim.events.length = 0;
  sim.emit('in', `El tiempo salta a ${b.textContent.toLowerCase()}. Llevo dos días adaptándome a este clima.`);
});
document.querySelectorAll('.pbtn').forEach(b => b.onclick = () => sim.force(b.dataset.f));
$('listen').onclick = async () => {
  if (!puente.on) {
    try { await puente.start(); $('listen').textContent = 'Silenciar'; $('listen').setAttribute('aria-pressed', 'true'); }
    catch (e) { $('listen').textContent = 'El audio no pudo iniciar'; }
  } else { puente.stop(); $('listen').textContent = 'Escuchar el invernadero'; $('listen').setAttribute('aria-pressed', 'false'); }
};
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  document.querySelectorAll('.mode').forEach(x => x.setAttribute('aria-pressed', x === b));
  puente.setMode(b.dataset.m);
});
$('vol').oninput = e => puente.setVolume(+e.target.value);
$('midiBtn').onclick = async () => {
  try { const names = await puente.enableMidi(); $('midiStatus').textContent = 'La sinfonía sale también por ' + names[0] + ' (canal 1 violín, 2 armonía, 3 bajo, 4 arpa, 10 timbal).'; }
  catch (e) { $('midiStatus').textContent = 'MIDI no disponible aquí: ' + (e.message || 'el visor no da permiso') + '. Abre la página en Chrome de escritorio con un sintetizador conectado.'; }
};

/* ─────────── rasgos que escucha el puente ─────────── */
let mvMean = -40, mvVar = 9, co2Prev = sim.inn.CO2, dCO2 = 0, thPrev = sim.thetaEst, dTheta = 0;
function features(simDt) {
  const s = sim.sens, sun = sim.sun();
  mvMean += (s.mv - mvMean) * 0.01; mvVar += ((s.mv - mvMean) ** 2 - mvVar) * 0.01;
  if (simDt > 0) { const d = (sim.inn.CO2 - co2Prev) / (simDt / 3600); dCO2 += (d - dCO2) * Math.min(1, simDt / 600); co2Prev = sim.inn.CO2;
    const dt2 = (sim.thetaEst - thPrev) / (simDt / 3600); dTheta += (dt2 - dTheta) * Math.min(1, simDt / 600); thPrev = sim.thetaEst; }
  const c = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  return {
    light: c(s.PAR, 0, 1400), elev: sun.elev, season: sim.season(), doy: sim.doy,
    Tin_n: c(s.Tin, 2, 35), Tin: s.Tin, Tout: s.Tout, theta_n: c(sim.thetaEst, 15, 45), EC_n: c(s.EC, 0, 4),
    CO2_n: c(s.CO2, 250, 950), dCO2, RH_n: s.RHin / 100, wind_n: c(s.wind, 0, 20), rain_n: c(s.rain, 0, 12),
    bio: Math.max(-3, Math.min(3, (s.mv - mvMean) / Math.sqrt(Math.max(mvVar, 0.5)))),
    stress: sim.plant.stress, vig: sim.vigilia, alerta: sim.alerta, acts: { ...sim.act },
    activity: nsActivity, dTheta, wet: sim.inn.wet,
  };
}

/* ─────────── escena ─────────── */
const cv = $('scene'), cx = cv.getContext('2d');
const W = 1000, H = 562.5, G = 470;
const rand = mulberry(7);
const STARS = Array.from({ length: 90 }, () => [rand() * W, rand() * 330, rand() * 1.4 + 0.3, rand() * 6]);
const CLOUDS = Array.from({ length: 9 }, (_, i) => ({ x: rand() * 1200 - 100, y: 40 + rand() * 150, s: 0.6 + rand() * 0.9, seed: rand() * 10, order: i }));
const DROPS = Array.from({ length: 160 }, () => [rand() * W, rand() * G, rand()]);
const MOTES = Array.from({ length: 40 }, () => ({ x: 200 + rand() * 600, y: 250 + rand() * 200, p: rand() * 6.28 }));
const PLANTS = [[262, 0], [346, 1], [458, 2], [542, 3], [652, 4], [736, 5]];
let fanA = 0, cupA = 0, frameT = 0, pulseR = 0, steamT = 0;
const BIRDS = Array.from({ length: 7 }, (_, k) => ({ x: rand() * 1000, y: 70 + rand() * 120, v: 30 + rand() * 30, ph: rand() * 6, dir: rand() < 0.5 ? 1 : -1 }));
const BEES = Array.from({ length: 4 }, (_, k) => ({ p: PLANTS[k % 6][0], ph: rand() * 6, r: 14 + rand() * 18 }));
const MOTHS = Array.from({ length: 4 }, () => ({ ph: rand() * 6, r: 10 + rand() * 18 }));
const GRASS = Array.from({ length: 90 }, (_, k) => { const left = k < 40; return [left ? rand() * 165 : 835 + rand() * 165, 446 + rand() * 22, 6 + rand() * 9, rand() * 6]; });

const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function skyCols(e, cloud) {
  const night = [[6, 10, 22], [18, 26, 44]], dusk = [[34, 40, 78], [222, 136, 92]], day = [[72, 138, 196], [186, 214, 230]], grey = [[118, 128, 138], [176, 182, 186]];
  let top, bot;
  if (e < -0.18) [top, bot] = night;
  else if (e < 0.02) { const k = (e + 0.18) / 0.2; top = mix(night[0], dusk[0], k); bot = mix(night[1], dusk[1], k); }
  else if (e < 0.3) { const k = (e - 0.02) / 0.28; top = mix(dusk[0], day[0], k); bot = mix(dusk[1], day[1], k); }
  else [top, bot] = day;
  const dl = Math.max(0, Math.min(1, (e + 0.1) / 0.4));
  const g = cloud * 0.75 * dl;
  return [mix(top, grey[0], g), mix(bot, grey[1], g)];
}

function drawScene(dtReal) {
  const sc = cv.width / W;
  cx.setTransform(sc, 0, 0, sc, 0, 0);
  frameT += dtReal;
  const o = sim.out, i = sim.inn, p = sim.plant, a = sim.act, s = sim.sens;
  const sun = sim.sun(), e = sun.elev;
  const daylight = Math.max(0, Math.min(1, (e + 0.08) / 0.35));
  // cielo
  const [top, bot] = skyCols(e, o.cloud);
  let gr = cx.createLinearGradient(0, 0, 0, G);
  gr.addColorStop(0, rgb(top)); gr.addColorStop(1, rgb(bot));
  cx.fillStyle = gr; cx.fillRect(0, 0, W, H);
  // estrellas y luna
  const starA = Math.max(0, Math.min(1, (-e - 0.1) / 0.15)) * (1 - o.cloud);
  if (starA > 0.01) for (const st of STARS) { cx.fillStyle = `rgba(230,235,255,${starA * (0.5 + 0.5 * Math.sin(frameT * 1.3 + st[3]))})`; cx.fillRect(st[0], st[1], st[2], st[2]); }
  const hr = sim.hour;
  const sunX = 60 + 880 * ((hr - 5.6) / 14), sunY = G - 40 - 340 * Math.sin(Math.max(-0.2, e)) / Math.sin(1.25);
  if (e > -0.12) {
    const rg = cx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
    rg.addColorStop(0, `rgba(255,244,214,${0.95 * (1 - o.cloud * 0.7)})`); rg.addColorStop(0.25, `rgba(255,214,150,${0.35 * (1 - o.cloud * 0.8)})`); rg.addColorStop(1, 'rgba(255,200,120,0)');
    cx.fillStyle = rg; cx.beginPath(); cx.arc(sunX, sunY, 70, 0, 7); cx.fill();
  } else {
    const mh = (hr + 12) % 24, mx = 60 + 880 * ((mh - 5.6) / 14), my = 90 + 120 * Math.abs((mh - 12.6) / 7);
    if (mx > 40 && mx < 960) { cx.fillStyle = `rgba(232,236,240,${0.85 * (1 - o.cloud * 0.8)})`; cx.beginPath(); cx.arc(mx, my, 13, 0, 7); cx.fill(); cx.fillStyle = rgb(top); cx.beginPath(); cx.arc(mx + 6, my - 3, 12, 0, 7); cx.fill(); }
  }
  // volcán y lago al fondo
  const farC = mix([46, 58, 72], [104, 124, 140], daylight);
  cx.fillStyle = rgb(farC, 0.95);
  cx.beginPath(); cx.moveTo(470, 395); cx.lineTo(610, 214); cx.quadraticCurveTo(622, 204, 636, 214); cx.lineTo(800, 395); cx.closePath(); cx.fill();
  cx.fillStyle = rgb(mix([150, 158, 170], [240, 244, 247], daylight), 0.92);
  cx.beginPath(); cx.moveTo(574, 262); cx.lineTo(610, 214); cx.quadraticCurveTo(622, 204, 636, 214); cx.lineTo(676, 262); cx.lineTo(660, 256); cx.lineTo(645, 268); cx.lineTo(626, 254); cx.lineTo(608, 266); cx.lineTo(592, 255); cx.closePath(); cx.fill();
  {
    const snowy = { invierno: 1, 'otoño': 0.5, primavera: 0.65, verano: 0.15 }[sim.season()];
    cx.fillStyle = rgb(mix([150, 158, 170], [240, 244, 247], daylight), 0.85 * snowy);
    cx.beginPath(); cx.moveTo(556, 286); cx.lineTo(574, 262); cx.lineTo(676, 262); cx.lineTo(694, 286); cx.lineTo(670, 280); cx.lineTo(652, 294); cx.lineTo(630, 282); cx.lineTo(610, 296); cx.lineTo(590, 284); cx.closePath(); cx.fill();
    const glow = Math.exp(-Math.pow((e - 0.05) / 0.08, 2)) * (1 - o.cloud * 0.8);
    if (glow > 0.02) {   // arrebol: la nieve se tiñe en el alba y el ocaso
      cx.fillStyle = `rgba(255,140,160,${0.5 * glow})`;
      cx.beginPath(); cx.moveTo(556, 286); cx.lineTo(610, 214); cx.quadraticCurveTo(622, 204, 636, 214); cx.lineTo(694, 286); cx.closePath(); cx.fill();
    }
  }
  cx.fillStyle = rgb(mix([40, 52, 62], [92, 116, 112], daylight)); cx.fillRect(0, 392, W, 12);
  cx.fillStyle = rgb(mix([22, 34, 48], [96, 138, 160], daylight), 0.95); cx.fillRect(0, 404, W, 40);
  cx.strokeStyle = `rgba(230,240,250,${0.12 + 0.25 * daylight})`; cx.lineWidth = 1;
  for (let k = 0; k < 34; k++) { const x = (k * 97 + frameT * (6 + o.wind * 3) * (k % 2 ? 1 : -0.6)) % 1040 - 20, y = 409 + (k * 13) % 32, l = 6 + (k % 5) * 3; cx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(frameT * 1.5 + k)); cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + l, y); cx.stroke(); }
  cx.globalAlpha = 1;
  // nubes
  const nC = Math.round(o.cloud * CLOUDS.length + 0.4);
  for (const c of CLOUDS) {
    c.x += (0.8 + o.wind * 0.35) * dtReal * Math.min(30, speed / 60 + 0.3);
    if (c.x > 1150) c.x = -180;
    if (c.order >= nC) continue;
    const shade = mix([60, 66, 80], o.rain > 0.5 ? [150, 156, 162] : [236, 240, 244], daylight);
    cx.fillStyle = rgb(shade, 0.55 + 0.35 * o.cloud);
    for (let k = 0; k < 5; k++) { cx.beginPath(); cx.ellipse(c.x + k * 34 * c.s, c.y + Math.sin(c.seed + k) * 8, 46 * c.s, 22 * c.s, 0, 0, 7); cx.fill(); }
  }
  // aves: bandadas de día, más al alba
  if (daylight > 0.25 && o.rain < 1.5) {
    const n = Math.round(BIRDS.length * Math.min(1, 0.4 + Math.exp(-Math.pow((e - 0.1) / 0.15, 2))));
    cx.strokeStyle = rgb(mix([30, 34, 40], [40, 44, 48], daylight), 0.85); cx.lineWidth = 1.4;
    for (let k = 0; k < n; k++) {
      const b = BIRDS[k]; b.x += b.dir * b.v * dtReal; b.ph += dtReal * 9; if (b.x > 1060) b.x = -60; if (b.x < -60) b.x = 1060;
      const f = Math.sin(b.ph) * 4, y = b.y + Math.sin(b.ph * 0.13) * 6;
      cx.beginPath(); cx.moveTo(b.x - 6, y - f); cx.quadraticCurveTo(b.x - 2, y - 1, b.x, y); cx.quadraticCurveTo(b.x + 2, y - 1, b.x + 6, y - f); cx.stroke();
    }
  }
  // suelo exterior
  const season = sim.season();
  const grass = { primavera: [70, 104, 52], verano: [104, 112, 58], 'otoño': [92, 88, 50], invierno: [56, 80, 54] }[season];
  cx.fillStyle = rgb(mix(mix([20, 28, 20], grass, daylight), [220, 230, 236], o.T < 0.5 ? Math.min(0.55, (0.5 - o.T) * 0.2) : 0));
  cx.fillRect(0, 444, W, H - 444);
  cx.fillStyle = rgb(mix([18, 16, 12], [74, 58, 42], daylight)); cx.fillRect(0, G, W, H - G);
  // sombras de nubes que cruzan el campo
  if (daylight > 0.3) for (const c of CLOUDS) { if (c.order >= nC) continue; cx.fillStyle = `rgba(10,14,8,${0.12 * daylight})`; cx.beginPath(); cx.ellipse((c.x + 80) % 1100, 458, 120 * c.s, 8, 0, 0, 7); cx.fill(); }
  // árboles nativos: el follaje cambia con la estación y se mece con el viento
  for (const [tx0, th0, sd] of [[22, 150, 1.1], [990, 190, 2.3]]) {
    const sw = Math.sin(frameT * (0.8 + o.wind * 0.08) + sd) * o.wind * 0.6;
    cx.strokeStyle = rgb(mix([24, 20, 16], [76, 58, 42], daylight)); cx.lineWidth = 7;
    cx.beginPath(); cx.moveTo(tx0, 470); cx.quadraticCurveTo(tx0 + sw * 0.3, 470 - th0 * 0.5, tx0 + sw, 470 - th0 * 0.75); cx.stroke();
    const fol = { primavera: [96, 140, 70], verano: [70, 112, 56], 'otoño': [196, 120, 52], invierno: [60, 84, 58] }[sim.season()];
    const dens = sim.season() === 'invierno' ? 0.55 : 1;
    for (let j = 0; j < 9; j++) {
      const a = j / 9 * Math.PI * 2 + sd, r = 26 + (j % 3) * 10;
      cx.fillStyle = rgb(mix([14, 22, 14], mix(fol, [255, 255, 255], 0.06 * (j % 3)), 0.25 + 0.75 * daylight), 0.82 * dens);
      cx.beginPath(); cx.arc(tx0 + sw * 1.3 + Math.cos(a) * r * 0.9, 470 - th0 * 0.8 + Math.sin(a) * r * 0.6, 22 + (j % 4) * 4, 0, 7); cx.fill();
    }
  }
  // pasto que se mece
  cx.strokeStyle = rgb(mix([18, 26, 16], mix(grass, [140, 160, 90], 0.3), daylight)); cx.lineWidth = 1.2;
  cx.beginPath();
  for (const g of GRASS) { const bend = Math.sin(frameT * (1.4 + o.wind * 0.2) + g[3]) * (1 + o.wind * 0.45); cx.moveTo(g[0], g[1]); cx.quadraticCurveTo(g[0] + bend * 0.4, g[1] - g[2] * 0.6, g[0] + bend, g[1] - g[2]); }
  cx.stroke();
  // neblina del alba sobre el lago
  const fog = Math.exp(-Math.pow((e + 0.02) / 0.14, 2)) * Math.max(0, (o.RH - 82) / 18);
  if (fog > 0.02) for (let k = 0; k < 5; k++) { const fx = ((frameT * (4 + k) + k * 230) % 1300) - 200; const fg = cx.createRadialGradient(fx, 420, 10, fx, 420, 220); fg.addColorStop(0, `rgba(220,228,232,${0.35 * fog})`); fg.addColorStop(1, 'rgba(220,228,232,0)'); cx.fillStyle = fg; cx.fillRect(fx - 220, 360, 440, 110); }
  // estación meteorológica
  cx.strokeStyle = '#8a9088'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(70, G); cx.lineTo(70, 290); cx.stroke();
  cupA += dtReal * (o.wind * 1.4) * Math.min(4, 1 + speed / 600);
  cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(70, 290); cx.lineTo(70, 280); cx.stroke();
  for (let k = 0; k < 3; k++) { const ang = cupA + k * 2.094, x = 70 + Math.cos(ang) * 16, y = 280 + Math.sin(ang) * 4; cx.beginPath(); cx.moveTo(70, 280); cx.lineTo(x, y); cx.stroke(); cx.fillStyle = '#c9cec6'; cx.beginPath(); cx.arc(x, y, 3.5, 0, 7); cx.fill(); }
  cx.fillStyle = '#e8ebe4'; for (let k = 0; k < 4; k++) cx.fillRect(58, 318 + k * 6, 24, 4);
  cx.fillStyle = '#9aa196'; cx.fillRect(86, 380, 14, 26); cx.fillRect(84, 378, 18, 4);
  // panel solar
  cx.strokeStyle = '#7d847a'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(130, G); cx.lineTo(130, 368); cx.stroke();
  cx.save(); cx.translate(130, 362); cx.rotate(-0.55);
  cx.fillStyle = '#1d2b44'; cx.fillRect(-34, -14, 68, 28);
  cx.strokeStyle = '#4b5d7c'; cx.lineWidth = 1; for (let k = 1; k < 4; k++) { cx.beginPath(); cx.moveTo(-34 + k * 17, -14); cx.lineTo(-34 + k * 17, 14); cx.stroke(); }
  cx.beginPath(); cx.moveTo(-34, 0); cx.lineTo(34, 0); cx.stroke();
  if (sim.energy.pv > 10) { cx.fillStyle = `rgba(255,240,200,${0.25 * sim.energy.pv / 120})`; cx.fillRect(-34, -14, 68, 28); }
  cx.restore();
  // estanque de agua lluvia
  const tx = 868, ty = 372, tw = 92, th = 98;
  cx.fillStyle = '#2b3530'; cx.fillRect(tx, ty, tw, th);
  cx.fillStyle = rgb(mix([24, 60, 76], [80, 160, 186], daylight * 0.8 + 0.2), 0.95);
  const lv = th * Math.max(0, i.tankW) / 100; cx.fillRect(tx + 4, ty + th - lv, tw - 8, lv - 2);
  cx.strokeStyle = '#5c6a63'; cx.lineWidth = 2; cx.strokeRect(tx, ty, tw, th);
  cx.beginPath(); cx.moveTo(812, 320); cx.lineTo(905, 320); cx.lineTo(905, ty); cx.stroke();
  // agua: del canalón al estanque cuando llueve, del estanque al goteo cuando riega
  cx.save(); cx.setLineDash([5, 7]); cx.lineWidth = 2.5;
  if (o.rain > 0.2) { cx.strokeStyle = 'rgba(150,205,230,0.85)'; cx.lineDashOffset = -frameT * 60; cx.beginPath(); cx.moveTo(812, 320); cx.lineTo(905, 320); cx.lineTo(905, 372); cx.stroke(); }
  cx.strokeStyle = sim.act.pump ? 'rgba(130,200,232,0.9)' : 'rgba(90,100,96,0.5)'; cx.setLineDash(sim.act.pump ? [5, 7] : []); cx.lineDashOffset = frameT * 50;
  cx.beginPath(); cx.moveTo(872, 464); cx.lineTo(778, 464); cx.lineTo(770, 441); cx.lineTo(236, 441); cx.stroke();
  cx.restore();
  // invernadero: arco de 660 × 280 en corte transversal
  const cxA = 500, rx = 330, ry = 280;
  cx.save();
  cx.beginPath(); cx.ellipse(cxA, G, rx, ry, 0, Math.PI, 2 * Math.PI); cx.closePath();
  cx.clip();
  const warm = Math.max(-1, Math.min(1, (i.T - 18) / 14));
  const airC = warm > 0 ? mix([200, 210, 196], [236, 200, 160], warm) : mix([200, 210, 196], [168, 190, 214], -warm);
  cx.fillStyle = rgb(mix([24, 30, 30], airC, daylight), 0.42 + 0.2 * i.wet);
  cx.fillRect(0, 0, W, G);
  // rayos de sol entrando por el film
  if (e > 0.08 && o.cloud < 0.7) {
    const rays = (1 - o.cloud) * Math.min(1, (e - 0.08) / 0.3) * (a.shade ? 0.4 : 1);
    for (let k = 0; k < 6; k++) {
      const x0 = 220 + k * 105 + Math.sin(frameT * 0.2 + k) * 8, dx = (500 - sunX) * 0.35;
      const rgR = cx.createLinearGradient(x0, 200, x0 + dx, 460); rgR.addColorStop(0, `rgba(255,246,220,${0.13 * rays})`); rgR.addColorStop(1, 'rgba(255,246,220,0)');
      cx.fillStyle = rgR; cx.beginPath(); cx.moveTo(x0 - 14, 200); cx.lineTo(x0 + 14, 200); cx.lineTo(x0 + dx + 40, 462); cx.lineTo(x0 + dx - 10, 462); cx.closePath(); cx.fill();
    }
  }
  // malla de sombra
  if (a.shade) { cx.fillStyle = 'rgba(20,24,18,0.42)'; cx.fillRect(170, 228, 660, 8); cx.fillStyle = 'rgba(10,12,9,0.22)'; cx.fillRect(170, 236, 660, 234); }
  else { cx.fillStyle = '#3a3f35'; cx.fillRect(176, 226, 10, 10); }
  // alambre de tutorado y luces LED
  cx.strokeStyle = 'rgba(80,84,78,0.8)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(200, 242); cx.lineTo(800, 242); cx.stroke();
  for (const bx of [305, 500, 695]) { cx.fillStyle = '#2a2d28'; cx.fillRect(bx - 50, 248, 100, 5); }
  // camas y suelo
  const soil = mix([136, 106, 74], [58, 40, 28], Math.max(0, Math.min(1, (i.theta - 18) / 26)));
  for (const [x0, x1] of [[230, 380], [425, 575], [620, 770]]) {
    cx.fillStyle = '#5b4632'; cx.fillRect(x0, 438, x1 - x0, G - 438);
    cx.fillStyle = rgb(mix([30, 22, 16], soil, 0.35 + 0.65 * daylight)); cx.fillRect(x0 + 4, 440, x1 - x0 - 8, 20);
    cx.strokeStyle = '#151513'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(x0 + 6, 441); cx.lineTo(x1 - 6, 441); cx.stroke();
  }
  // sombras de las plantas: giran con el sol
  if (daylight > 0.2) { const sdx = -(sunX - 500) * 0.12; cx.fillStyle = `rgba(20,14,8,${0.28 * daylight * (1 - o.cloud * 0.8)})`; for (const [px] of PLANTS) { cx.beginPath(); cx.ellipse(px + sdx, 446, 26 + Math.abs(sdx) * 0.6, 4, 0, 0, 7); cx.fill(); } }
  // plantas de tomate
  const sway = Math.sin(frameT * (1 + a.fan * 2 + a.vent)) * (0.6 + a.fan * 2 + a.vent * 3);
  for (const [px, idx] of PLANTS) drawPlant(px, idx, p, daylight, sway);
  // abejorros polinizando de día
  if (daylight > 0.45 && i.T > 12 && p.bio > 0.3) for (const b of BEES) {
    b.ph += dtReal * (2.2 + Math.sin(frameT + b.r));
    const top = 440 - (60 + 168 * p.bio);
    const x = b.p + Math.sin(b.ph * 1.3) * b.r + Math.sin(b.ph * 4.1) * 3, y = top + 40 + Math.cos(b.ph) * 22 + Math.sin(b.ph * 5) * 2;
    cx.fillStyle = 'rgba(240,240,255,0.55)'; cx.beginPath(); cx.ellipse(x - 1, y - 3, 3, 1.6, Math.sin(frameT * 60) * 0.6, 0, 7); cx.fill();
    cx.fillStyle = '#e8b53a'; cx.beginPath(); cx.ellipse(x, y, 3.6, 2.4, 0, 0, 7); cx.fill();
    cx.fillStyle = '#1b1712'; cx.fillRect(x - 0.6, y - 2.2, 1.4, 4.4);
  }
  // vapor que sube del suelo después de regar en días tibios
  steamT = a.pump ? 1 : Math.max(0, steamT - dtReal * 0.05 * Math.min(10, speed / 60));
  if (steamT > 0.05 && i.T > 17) for (let k = 0; k < 24; k++) { const ph = (frameT * 0.25 + k / 24) % 1, x = 250 + (k * 71) % 520 + Math.sin(frameT + k) * 6; cx.fillStyle = `rgba(235,240,240,${0.12 * steamT * (1 - ph)})`; cx.beginPath(); cx.arc(x, 438 - ph * 90, 4 + ph * 10, 0, 7); cx.fill(); }
  // goteo
  if (a.pump) for (const [x0] of [[230], [425], [620]]) for (let k = 0; k < 6; k++) {
    const x = x0 + 18 + k * 24, ph = (frameT * 1.6 + k * 0.37) % 1;
    cx.fillStyle = 'rgba(140,200,230,0.9)'; cx.beginPath(); cx.arc(x, 442 + ph * 14, 1.8, 0, 7); cx.fill();
  }
  // calefactor
  cx.fillStyle = '#3c3a36'; cx.fillRect(190, 402, 30, 58); cx.fillStyle = '#25231f'; for (let k = 0; k < 5; k++) cx.fillRect(194, 408 + k * 10, 22, 4);
  // ventilador
  fanA += dtReal * (a.fan ? 18 : 0);
  cx.save(); cx.translate(232, 286); cx.strokeStyle = '#6a7066'; cx.lineWidth = 2; cx.beginPath(); cx.arc(0, 0, 17, 0, 7); cx.stroke();
  cx.fillStyle = '#8a9086'; for (let k = 0; k < 3; k++) { cx.rotate(2.094); cx.save(); cx.rotate(fanA); cx.beginPath(); cx.ellipse(8, 0, 8, 3.4, 0.3, 0, 7); cx.fill(); cx.restore(); }
  cx.restore();
  // niebla
  if (a.mist) for (let k = 0; k < 40; k++) { const x = 230 + (k * 53 + frameT * 30) % 540, y = 268 + ((k * 31 + frameT * 22) % 90); cx.fillStyle = 'rgba(230,240,245,0.22)'; cx.beginPath(); cx.arc(x, y, 3 + (k % 3), 0, 7); cx.fill(); }
  // bidones de nutrientes y ácido
  const jug = (x, c, lvl) => { cx.fillStyle = '#2f342e'; cx.fillRect(x, 420, 22, 40); cx.fillStyle = c; cx.fillRect(x + 2, 460 - 38 * lvl / 100, 18, 38 * lvl / 100); cx.strokeStyle = '#5b6157'; cx.strokeRect(x, 420, 22, 40); };
  jug(784, 'rgba(206,150,74,0.85)', i.tankN); jug(808, 'rgba(160,190,90,0.8)', 70);
  // gotas de condensación en el film
  if (i.wet > 0.15) { cx.fillStyle = `rgba(220,235,240,${0.35 * i.wet})`; for (let k = 0; k < 70; k++) { const ang = Math.PI + (k / 70) * Math.PI, x = cxA + Math.cos(ang) * (rx - 4), y = G + Math.sin(ang) * (ry - 4); cx.beginPath(); cx.arc(x, y + (k % 3) * 2, 1.4, 0, 7); cx.fill(); } }
  cx.restore();
  // estructura del arco y ventana cenital
  cx.strokeStyle = '#b9c0b4'; cx.lineWidth = 4;
  const vA0 = Math.PI * 1.62, vA1 = Math.PI * 1.74;
  cx.beginPath(); cx.ellipse(cxA, G, rx, ry, 0, Math.PI, vA0); cx.stroke();
  cx.beginPath(); cx.ellipse(cxA, G, rx, ry, 0, vA1, 2 * Math.PI); cx.stroke();
  const hx = cxA + Math.cos(vA0) * rx, hy = G + Math.sin(vA0) * ry, ex = cxA + Math.cos(vA1) * rx, ey = G + Math.sin(vA1) * ry;
  const flapLen = Math.hypot(ex - hx, ey - hy), base = Math.atan2(ey - hy, ex - hx), open = a.vent * 0.7;
  cx.strokeStyle = '#d9ded5'; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(hx, hy); cx.lineTo(hx + Math.cos(base - open) * flapLen, hy + Math.sin(base - open) * flapLen); cx.stroke();
  cx.strokeStyle = 'rgba(200,210,205,0.35)'; cx.lineWidth = 1.2;
  for (const f of [0.82, 0.64]) { cx.beginPath(); cx.ellipse(cxA, G, rx * f, ry * (0.62 + f * 0.38), 0, Math.PI, 2 * Math.PI); cx.stroke(); }
  // escarcha sobre el arco
  if (o.T < 0.5) { cx.strokeStyle = `rgba(235,242,248,${Math.min(0.7, (0.5 - o.T) * 0.25)})`; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(cxA, G, rx + 2, ry + 2, 0, Math.PI, 2 * Math.PI); cx.stroke(); }
  // lluvia
  if (o.rain > 0.1) {
    const n = Math.min(160, o.rain * 14), slant = o.wind * 0.9;
    cx.strokeStyle = 'rgba(200,215,230,0.45)'; cx.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const d = DROPS[k]; d[1] += dtReal * (380 + d[2] * 120); d[0] += dtReal * slant * 12;
      if (d[1] > G) { d[1] = -10; d[0] = rand() * W; }
      const inside = ((d[0] - cxA) / rx) ** 2 + ((d[1] - G) / ry) ** 2 < 1;
      if (inside) continue;
      cx.beginPath(); cx.moveTo(d[0], d[1]); cx.lineTo(d[0] + slant * 0.5, d[1] + 9); cx.stroke();
    }
  }
  // Arduinator: caja estanca sobre poste, antena LoRa, cables a los sentidos
  const bx = 742, by = 318;
  cx.strokeStyle = '#5d625a'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(bx + 26, G); cx.lineTo(bx + 26, by + 64); cx.stroke();
  cx.strokeStyle = 'rgba(120,128,116,0.6)'; cx.lineWidth = 1;
  const wires = [[500, 300], [420, 372], [604, 252], [470, 452], [664, 452], [548, 360]];
  for (const [wx, wy] of wires) { cx.beginPath(); cx.moveTo(bx + 4, by + 40); cx.quadraticCurveTo((bx + wx) / 2, Math.max(by, wy) + 30, wx, wy); cx.stroke(); }
  // impulsos: aferentes (sentidos → caja) y eferentes (caja → efectores)
  const bez = (x0, y0, x1, y1, x2, y2, t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2];
  const affIdx = [0, 2, 3, 4, 5, 6];
  wires.forEach(([wx, wy], j) => {
    const r = AFF[affIdx[j]].rate, n = Math.min(4, Math.ceil(r / 7));
    for (let q = 0; q < n; q++) {
      const t = 1 - ((nsT * (0.35 + r * 0.03) + q / n + j * 0.17) % 1);
      const [x, y] = bez(bx + 4, by + 40, (bx + wx) / 2, Math.max(by, wy) + 30, wx, wy, t);
      cx.fillStyle = 'rgba(140,215,236,0.9)'; cx.beginPath(); cx.arc(x, y, 1.9, 0, 7); cx.fill();
    }
  });
  const effT = [['heat', 205, 430], ['vent', hx, hy], ['pump', 700, 441], ['fan', 232, 286], ['led', 500, 252], ['mist', 500, 268], ['fert', 795, 422], ['shade', 520, 232]];
  for (const [k, ex2, ey2] of effT) {
    const on = k === 'vent' ? a.vent > 0.02 : a[k]; if (!on) continue;
    cx.strokeStyle = 'rgba(211,139,82,0.28)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(bx + 26, by + 50); cx.quadraticCurveTo((bx + ex2) / 2, Math.min(by, ey2) - 30, ex2, ey2); cx.stroke();
    for (let q = 0; q < 3; q++) { const t = (nsT * 0.8 + q / 3) % 1; const [x, y] = bez(bx + 26, by + 50, (bx + ex2) / 2, Math.min(by, ey2) - 30, ex2, ey2, t); cx.fillStyle = 'rgba(244,176,120,0.95)'; cx.beginPath(); cx.arc(x, y, 2.1, 0, 7); cx.fill(); }
  }
  cx.fillStyle = '#23272a'; cx.fillRect(bx, by, 52, 64); cx.strokeStyle = '#6f7a80'; cx.lineWidth = 1.5; cx.strokeRect(bx, by, 52, 64);
  cx.strokeStyle = '#9aa3a8'; cx.beginPath(); cx.moveTo(bx + 44, by); cx.lineTo(bx + 44, by - 30); cx.stroke();
  // sensores
  cx.fillStyle = '#e4e7e0'; for (let k = 0; k < 5; k++) cx.fillRect(492, 286 + k * 5, 16, 3);                 // abrigo T/HR
  cx.fillStyle = '#4a4f48'; cx.fillRect(412, 364, 18, 14);                                                     // CO₂
  cx.fillStyle = '#dde2da'; cx.beginPath(); cx.arc(604, 250, 5, Math.PI, 0); cx.fill(); cx.fillRect(598, 250, 12, 3); // PAR
  cx.fillStyle = '#9aa098'; cx.fillRect(466, 436, 6, 20); cx.fillRect(660, 436, 6, 20);                        // sondas de suelo
  // velo nocturno
  const veil = 0.62 * (1 - daylight);
  if (veil > 0.01) { cx.fillStyle = `rgba(6,12,32,${veil})`; cx.fillRect(0, 0, W, H); }
  // emisiones: calor, LED, pantalla, latidos
  if (a.heat) { const rg = cx.createRadialGradient(205, 430, 6, 205, 430, 120); rg.addColorStop(0, 'rgba(255,140,60,0.55)'); rg.addColorStop(1, 'rgba(255,120,40,0)'); cx.fillStyle = rg; cx.fillRect(80, 300, 260, 180); cx.fillStyle = 'rgba(255,120,50,0.9)'; for (let k = 0; k < 5; k++) cx.fillRect(194, 408 + k * 10, 22, 4); }
  if (a.led) for (const lx of [305, 500, 695]) { const lg = cx.createLinearGradient(0, 252, 0, 440); lg.addColorStop(0, 'rgba(206,120,255,0.38)'); lg.addColorStop(1, 'rgba(206,120,255,0)'); cx.fillStyle = lg; cx.beginPath(); cx.moveTo(lx - 50, 252); cx.lineTo(lx + 50, 252); cx.lineTo(lx + 78, 440); cx.lineTo(lx - 78, 440); cx.fill(); cx.fillStyle = '#e2b6ff'; cx.fillRect(lx - 50, 248, 100, 5); }
  cx.fillStyle = '#0d1a14'; cx.fillRect(bx + 6, by + 8, 40, 22);
  cx.fillStyle = '#9fd8b0'; cx.font = '7px JetBrains Mono, monospace';
  cx.fillText(`${s.Tin.toFixed(1)}°`, bx + 9, by + 17); cx.fillText(`${sim.thetaEst.toFixed(0)}%`, bx + 28, by + 17);
  cx.fillText(sim.vigilia > 0.3 ? 'VIGIL' : 'SUELTO', bx + 9, by + 26);
  const blink = (sim.samples % 2) === 0;
  cx.fillStyle = blink ? '#7fe08a' : '#2b4a30'; cx.beginPath(); cx.arc(bx + 10, by + 42, 2.4, 0, 7); cx.fill();
  cx.fillStyle = sim.vigilia > 0.2 ? (Math.sin(frameT * 8) > 0 ? '#ff7a55' : '#5a2a1e') : '#3a2f22'; cx.beginPath(); cx.arc(bx + 20, by + 42, 2.4, 0, 7); cx.fill();
  cx.fillStyle = (frameT * 0.5 % 1) < 0.08 ? '#7ac8ff' : '#1d2f3c'; cx.beginPath(); cx.arc(bx + 30, by + 42, 2.4, 0, 7); cx.fill();
  if (daylight < 0.2 && i.T > 7) for (const m of MOTHS) { m.ph += dtReal * (3 + Math.sin(frameT * 3 + m.r)); const x = bx + 26 + Math.cos(m.ph) * m.r + Math.sin(m.ph * 3.3) * 4, y = by + 19 + Math.sin(m.ph * 1.4) * m.r * 0.6; cx.fillStyle = 'rgba(220,214,190,0.8)'; cx.beginPath(); cx.ellipse(x, y, 2.2, 1.2 + Math.abs(Math.sin(frameT * 40 + m.r)), 0, 0, 7); cx.fill(); }
  if (sim.vigilia > 0.12) {
    pulseR = (pulseR + dtReal * 90) % 160;
    cx.strokeStyle = `rgba(228,108,82,${0.7 * sim.vigilia * (1 - pulseR / 160)})`; cx.lineWidth = 2; cx.beginPath(); cx.arc(bx + 26, by + 32, 20 + pulseR, 0, 7); cx.stroke();
  } else {
    // disolución: motas que viajan entre las plantas y la caja, sin centro
    for (const m of MOTES) {
      m.p += dtReal * 0.4; m.x += Math.cos(m.p * 0.7) * 0.25; m.y += Math.sin(m.p) * 0.18;
      cx.fillStyle = `rgba(214,236,200,${0.18 + 0.12 * Math.sin(m.p * 2)})`; cx.beginPath(); cx.arc(m.x, m.y, 1.6, 0, 7); cx.fill();
    }
  }
  // etiquetas de los sentidos
  if (cv.clientWidth > 620) {
    cx.font = '10px JetBrains Mono, monospace'; cx.textBaseline = 'middle';
    const tag = (x, y, t, al = 'left') => { cx.textAlign = al; const w = cx.measureText(t).width; const x0 = al === 'left' ? x : x - w; cx.fillStyle = 'rgba(14,16,12,0.72)'; cx.fillRect(x0 - 4, y - 8, w + 8, 16); cx.fillStyle = '#d7dccb'; cx.fillText(t, x, y); };
    tag(514, 290, `T/HR ${s.Tin.toFixed(1)}° ${s.RHin.toFixed(0)}%`);
    tag(406, 371, `CO₂ ${s.CO2}`, 'right');
    tag(614, 236, `PAR ${s.PAR}`);
    tag(458, 492, `θ ${sim.thetaEst.toFixed(1)}%`, 'right');
    tag(672, 492, `EC ${s.EC.toFixed(2)} · pH ${s.pH.toFixed(2)}`);
    tag(556, 362, `hoja ${s.mv.toFixed(1)} mV`);
    tag(88, 270, `${s.wind.toFixed(1)} m/s · ${s.Tout.toFixed(1)}°`);
    tag(914, 360, `estanque ${Math.round(i.tankW)}%`, 'center');
    tag(bx + 26, by - 40, 'ARDUINATOR', 'center');
    cx.textAlign = 'left';
  }
}

function drawPlant(px, idx, p, daylight, sway) {
  const h = 60 + 168 * p.bio, droop = (1 - p.fW) * 0.9 + p.frost * 0.4;
  const leafBase = mix(mix([62, 128, 52], [176, 170, 70], 1 - p.fN), [110, 92, 70], p.frost);
  const leaf = mix([18, 30, 16], leafBase, 0.3 + 0.7 * daylight);
  cx.strokeStyle = 'rgba(200,200,190,0.35)'; cx.lineWidth = 0.8; cx.beginPath(); cx.moveTo(px, 242); cx.lineTo(px, 440); cx.stroke();
  const top = 440 - h;
  cx.strokeStyle = rgb(mix([30, 50, 26], [84, 120, 60], daylight)); cx.lineWidth = 3;
  cx.beginPath(); cx.moveTo(px, 440); cx.quadraticCurveTo(px + sway * 2, 440 - h / 2, px + sway * 3, top); cx.stroke();
  const nodes = Math.max(3, Math.round(h / 22));
  for (let k = 1; k <= nodes; k++) {
    const y = 440 - k * (h / (nodes + 0.5)), side = (k + idx) % 2 ? 1 : -1, len = 26 + 10 * Math.sin(k * 1.7 + idx);
    const sx = px + sway * 3 * (k / nodes);
    const ang = side > 0 ? -0.35 + droop : Math.PI + 0.35 - droop;
    cx.strokeStyle = rgb(leaf); cx.lineWidth = 1.6;
    const ex = sx + Math.cos(ang) * len, ey = y + Math.sin(ang) * len * (side > 0 ? 1 : 1);
    cx.beginPath(); cx.moveTo(sx, y); cx.quadraticCurveTo((sx + ex) / 2, y - 6 + droop * 10, ex, ey + droop * 12); cx.stroke();
    cx.fillStyle = rgb(leaf, 0.92);
    for (let j = 1; j <= 3; j++) {
      const t = j / 3.3, lx = sx + (ex - sx) * t, ly = y + (ey + droop * 12 - y) * t - 3 + droop * 6 * t;
      cx.beginPath(); cx.ellipse(lx, ly, 6.5, 3.4, ang + side * 0.6 + droop, 0, 7); cx.fill();
      cx.beginPath(); cx.ellipse(lx, ly + 5, 5.5, 3, ang - side * 0.5 + droop, 0, 7); cx.fill();
    }
  }
  // flores amarillas en los nudos altos
  if (p.bio > 0.28 && p.bio < 0.97 && p.frost < 0.3) {
    for (let k = 0; k < 3; k++) {
      const fy = 440 - h * (0.62 + 0.12 * k), fx = px + sway * 3 * (0.7 + 0.1 * k) + (k % 2 ? 8 : -7);
      cx.fillStyle = rgb(mix([40, 38, 12], [246, 212, 60], daylight));
      for (let j = 0; j < 5; j++) { const an = j * 1.2566 + frameT * 0.1; cx.beginPath(); cx.ellipse(fx + Math.cos(an) * 2.6, fy + Math.sin(an) * 2.6, 2.4, 1.1, an, 0, 7); cx.fill(); }
    }
  }
  // racimos: verdes, pintones y maduros
  const nF = Math.min(9, Math.round(p.fruits * 4 + (p.bio > 0.45 ? 2 : 0)));
  for (let k = 0; k < nF; k++) {
    const y = 420 - (k % 4) * 30 - 10, x = px + (k % 2 ? 9 : -9) + sway * 2;
    if (y < top + 14) continue;
    const ripe = Math.min(1, p.ripe * 2 + (k === 0 ? 0.3 : 0) + (sim.doy > 20 && sim.doy < 120 ? 0.4 : 0));
    cx.fillStyle = rgb(mix(mix([20, 28, 16], [92, 150, 60], daylight), mix([40, 20, 14], [210, 62, 40], daylight), ripe * (k % 3 === 0 ? 1 : 0.5)));
    cx.beginPath(); cx.arc(x, y, 5.2, 0, 7); cx.fill();
  }
}

/* ─────────── sparklines ─────────── */
function spark(s, z) {
  const c = s.cv, g = c.getContext('2d'), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  const arr = sim.hist[s.k]; if (!arr || arr.length < 2) return;
  let lo = Math.min(...arr), hi = Math.max(...arr);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const X = k => k / (288 - 1) * w, Y = v => h - 4 - (v - lo) / (hi - lo) * (h - 8);
  if (z) { const a = Math.max(lo, z.lo), b = Math.min(hi, z.hi); if (b > a) { g.fillStyle = 'rgba(147,196,111,0.10)'; g.fillRect(0, Y(b), w, Y(a) - Y(b)); } }
  g.strokeStyle = 'rgba(148,156,138,0.18)'; g.lineWidth = 1; g.beginPath(); for (let k = 1; k < 4; k++) { g.moveTo(w * k / 4, 0); g.lineTo(w * k / 4, h); } g.stroke();
  const off = 288 - arr.length;
  g.beginPath(); arr.forEach((v, k) => { const x = X(k + off), y = Y(v); k ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo(X(287), h); g.lineTo(X(off), h); g.closePath(); g.fillStyle = 'rgba(211,139,82,0.12)'; g.fill();
  g.beginPath(); arr.forEach((v, k) => { const x = X(k + off), y = Y(v); k ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.strokeStyle = '#d38b52'; g.lineWidth = 2; g.stroke();
  const lv = arr[arr.length - 1]; g.fillStyle = '#f0c49d'; g.beginPath(); g.arc(X(287), Y(lv), 3.5, 0, 7); g.fill();
}

/* ─────────── actualización de paneles ─────────── */
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dateStr() {
  const d = new Date(Date.UTC(2026, 0, 1) + Math.floor(sim.t / 86400) * 86400000);
  const h = sim.hour;
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}
let lastSamples = -1, lastLog = 0, lastSpark = 0;
function updatePanels(now) {
  const s = sim.sens, o = sim.out;
  $('when').textContent = dateStr() + (organic ? `  ·  ${speed < 100 ? Math.round(speed) + ' s' : Math.round(speed / 60) + ' min'}/s` : '');
  const f = sim.forcing, ep = $('episode');
  ep.hidden = !f;
  if (f) { const el = (f.total - f.left) / 3600; ep.textContent = `${({ helada: 'Helada', calor: 'Ola de calor', temporal: 'Temporal' })[f.name]} en curso · ${el.toFixed(1)} h de ${(f.total / 3600).toFixed(0)} h${f.auto ? ' · lo propuso el clima' : ''}`; }
  const sun = sim.sun();
  $('seasonChip').textContent = `${sim.season()} · sol ${(sun.elev * 180 / Math.PI).toFixed(0)}°`;
  const sky = o.rain > 2 ? 'lluvia intensa' : o.rain > 0.3 ? 'llovizna' : o.cloud > 0.75 ? 'cubierto' : o.cloud > 0.4 ? 'nubes parciales' : sun.elev > 0 ? 'despejado' : 'noche despejada';
  $('wx').innerHTML = `<b>${s.Tout.toFixed(1)} °C</b> afuera · ${sky} · viento ${s.wind.toFixed(0)} m/s · ${s.P.toFixed(0)} hPa`;
  const v = sim.vigilia, al = sim.alerta ? VIABLE[sim.alerta]?.label : null;
  const st = v > 0.35 ? 'vigilia' : v > 0.1 ? 'despierta' : 'disuelto';
  $('statePill').dataset.s = st;
  $('statePill').textContent = st === 'vigilia' ? `En vigilia · ${al || 'atento'}` : st === 'despierta' ? 'Despertando' : 'Disuelto · escucha sin filtrar';
  $('stateBig').textContent = st === 'vigilia' ? 'En vigilia' : st === 'despierta' ? 'Despertando' : 'Disuelto';
  let why;
  if (st === 'disuelto') why = 'Todo está dentro de la zona viable. Sin nada que defender, el Arduinator deja de seleccionar y transduce todo lo que siente.';
  else if (sim.sensDoubt) why = 'No confía en su sensor de suelo: sigue regando con su propio modelo de transpiración mientras la lectura vuelve.';
  else if (sim.learn.frostRisk && sim.out.T < 3) why = `Se prepara para la helada: afuera ${s.Tout.toFixed(1)} °C y el cielo despejado. Mantiene el calor adentro.`;
  else why = `La ${al || 'viabilidad'} salió de su zona. Aparece un punto de vista: todo se ordena alrededor de ese problema.`;
  $('stateWhy').textContent = why;
  $('vigMark').style.left = (v * 100).toFixed(1) + '%';
  const vals = { Tin: s.Tin, RHin: s.RHin, theta: sim.thetaEst, EC: s.EC, CO2: s.CO2, pH: s.pH, tankW: sim.inn.tankW };
  for (const z of ZONES) {
    const x = vals[z.k], pct = Math.max(0, Math.min(100, (x - z.r[0]) / (z.r[1] - z.r[0]) * 100));
    z.mark.style.left = pct + '%';
    const d = sim.devs[z.k] || 0;
    z.mark.style.background = d > 0.08 ? 'var(--crit)' : d > 0 ? 'var(--warn)' : 'var(--ok)';
    z.v.textContent = `${x.toFixed(z.d)} ${z.u}`;
  }
  const fresh = sim.samples !== lastSamples; lastSamples = sim.samples;
  for (const sn of [...SENS_IN, ...SENS_OUT]) {
    let val = s[sn.k];
    if (sn.k === 'theta') val = sim.sensDoubt ? sim.thetaEst : s.theta;
    const falta = sim.missing && sim.missing.has(sn.k) && !(sim.estimated && sim.estimated.has(sn.k));
    sn.valEl.textContent = falta ? '—' : (val ?? 0).toFixed(sn.d);
    sn.el.classList.toggle('off', !!falta);
    if (sim.remote && sn.k !== 'theta') { const est = sim.estimated && sim.estimated.has(sn.k); sn.tag.hidden = !(falta || est); sn.tag.textContent = falta ? 'sin sensor conectado' : 'estimado por el modelo'; }
    sn.led.classList.toggle('blink', fresh && !sn.led.classList.contains('blink'));
  }
  const th = SENS_IN.find(x => x.k === 'theta');
  th.el.classList.toggle('doubt', sim.sensDoubt);
  th.tag.hidden = !sim.sensDoubt; th.tag.textContent = `lectura congelada en ${s.theta.toFixed(1)} %; muestra el valor estimado`;
  if (now - lastSpark > 900) { lastSpark = now; for (const sn of [...SENS_IN, ...SENS_OUT]) spark(sn, sn.z); }
  for (const a of ACTS) {
    const val = sim.act[a.k];
    a.s.textContent = a.f(val);
    a.el.classList.toggle('on', a.k === 'vent' ? val > 0.02 : !!val);
    a.bar.style.width = ((a.lvl ? a.lvl(val) : val ? 1 : 0) * 100) + '%';
  }
  $('power').textContent = `panel ${sim.energy.pv.toFixed(0)} W · consumo ${sim.energy.load.toFixed(0)} W`;
  const L = sim.learn, P = sim.plant;
  const rows = [
    ['Inicio de riego', `${L.irrOn.toFixed(1)} % vol`],
    ['Corte de riego', `${L.irrOff.toFixed(1)} % vol`],
    ['Transpiración por radiación', `${(L.kET * 1000).toFixed(2)} mm/h por kW/m²`],
    ['Riegos realizados', `${L.irrigations}`],
    ['Agua aplicada', `${Math.round(L.waterUsed).toLocaleString('es-CL')} L`],
    ['Heladas que no entraron', `${L.frostSaves}`],
    ['Sensor de suelo', sim.sensDoubt ? 'en duda · estima' : 'confiable'],
    ['Biomasa de la planta', `${(P.bio * 100).toFixed(0)} %`],
    ['Estrés', `${(P.stress * 100).toFixed(0)} %`],
    ['Luz de hoy', `${sim.dli.toFixed(1)} mol/m²`],
    ['Cosecha acumulada', `${P.harvest.toFixed(1)} kg`],
  ];
  $('learn').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  // bitácora
  const fresh2 = sim.log.filter(l => l.id > lastLog);
  if (fresh2.length) {
    const box = $('log');
    for (const l of fresh2) {
      lastLog = l.id;
      const d = document.createElement('div'); d.className = l.kind;
      const h = (l.t / 3600) % 24;
      d.innerHTML = `<b>${l.kind === 'in' ? '▶' : l.kind === 'out' ? '◀' : '·'}</b><span>${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}</span><span></span>`;
      d.lastChild.textContent = l.text;
      box.prepend(d);
    }
    while (box.children.length > 80) box.lastChild.remove();
  }
  // mapeo del puente
  const map = puente.mapping(puente.F || features(0), s);
  $('mapping').innerHTML = map.map(([w, src, val]) => `<div><span class="who">${w}</span><span class="val">${val}</span><span class="src">${src}</span></div>`).join('');
  $('chord').textContent = puente.on && puente.mode === 'sinfonia' && puente.chordLabel ? puente.chordLabel : '';
}

/* ─────────── visualización del puente ─────────── */
const vz = $('viz'), vx = vz.getContext('2d');
const SEC_COL = { contrabajo: '#4f8796', cellos: '#6aa0ad', violas: '#8fb6a8', violines2: '#a9c49a', violin: '#e09a62', arpa: '#e6e2c8', pizz: '#7fc3d6', timbal: '#e46c52', esfera: '#b68de0', aliento: '#6db2c4', voz: '#e09a62', latido: '#e46c52', gota: '#9ed3e3' };
function drawViz() {
  const w = vz.width, h = vz.height;
  vx.fillStyle = '#0d0f0b'; vx.fillRect(0, 0, w, h);
  if (!puente.on) {
    vx.fillStyle = '#646b5d'; vx.font = `${Math.round(w / 48)}px Public Sans, sans-serif`; vx.textAlign = 'center';
    vx.fillText('Pulsa “Escuchar el invernadero” para abrir el puente', w / 2, h / 2);
    vx.textAlign = 'left'; return;
  }
  const now = puente.ctx.currentTime;
  if (puente.mode === 'esferas') {
    const cxp = w / 2, cyp = h / 2;
    vx.fillStyle = '#f2e6c8'; vx.beginPath(); vx.arc(cxp, cyp, 6, 0, 7); vx.fill();
    puente.planets.forEach((pl, k) => {
      const r = (k + 1.4) * h / 17;
      vx.strokeStyle = 'rgba(182,141,224,0.18)'; vx.lineWidth = 1; vx.beginPath(); vx.ellipse(cxp, cyp, r * 2.1, r, 0, 0, 7); vx.stroke();
      const x = cxp + Math.cos(pl.ph) * r * 2.1, y = cyp + Math.sin(pl.ph) * r;
      vx.fillStyle = `rgba(214,182,240,${0.55 + 0.45 * Math.sin(pl.ph) ** 2})`; vx.beginPath(); vx.arc(x, y, 3 + 7 * pl.val, 0, 7); vx.fill();
      vx.fillStyle = '#949c8a'; vx.font = `${Math.round(h / 26)}px JetBrains Mono, monospace`;
      vx.fillText(`${({ Tin: 'calor', theta: 'agua', CO2: 'aire', light: 'luz', RH: 'niebla', EC: 'tierra', bio: 'hoja' })[pl.k]} · ${pl.n}`, x + 10, y + 4);
    });
  } else {
    const span = 12, X = t => (t - (now - span)) / span * w * 0.92, Y = m => h - 10 - (m - 24) / 80 * (h - 30);
    vx.strokeStyle = 'rgba(148,156,138,0.10)'; vx.lineWidth = 1;
    for (let m = 24; m <= 100; m += 12) { vx.beginPath(); vx.moveTo(0, Y(m)); vx.lineTo(w, Y(m)); vx.stroke(); }
    vx.strokeStyle = 'rgba(211,139,82,0.35)'; vx.beginPath(); vx.moveTo(X(now), 0); vx.lineTo(X(now), h); vx.stroke();
    for (const n of puente.roll) {
      const x0 = X(n.t), x1 = X(n.t + n.dur); if (x1 < 0) continue;
      const age = Math.max(0, now - n.t);
      vx.fillStyle = SEC_COL[n.sec] || '#e0e4d4';
      vx.globalAlpha = Math.max(0.15, Math.min(1, 0.35 + 0.65 * n.vel)) * (n.t > now ? 0.5 : 1) * Math.max(0.2, 1 - age / 14);
      const hh = n.sec === 'aliento' ? 6 : n.sec === 'latido' ? 14 : 5;
      vx.fillRect(x0, Y(n.midi) - hh / 2, Math.max(3, x1 - x0), hh);
    }
    vx.globalAlpha = 1;
  }
  // forma de onda
  const buf = new Uint8Array(puente.analyser.fftSize); puente.analyser.getByteTimeDomainData(buf);
  vx.strokeStyle = 'rgba(224,228,212,0.35)'; vx.lineWidth = 1.2; vx.beginPath();
  for (let k = 0; k < buf.length; k += 4) { const x = k / buf.length * w, y = h * 0.86 + (buf[k] - 128) / 128 * h * 0.12; k ? vx.lineTo(x, y) : vx.moveTo(x, y); }
  vx.stroke();
}

/* ─────────── sistema nervioso: aferencias, integración, eferencias ─────────── */
const nsc = $('ns'), nx = nsc.getContext('2d');
const AFF = [
  { k: 'Tin', n: 'T aire', sc: 0.4, f: v => v.toFixed(1) + '°' }, { k: 'RHin', n: 'HR aire', sc: 1.5, f: v => v.toFixed(0) + '%' },
  { k: 'CO2', n: 'CO₂', sc: 12, f: v => v.toFixed(0) }, { k: 'PAR', n: 'luz PAR', sc: 35, f: v => v.toFixed(0) },
  { k: 'theta', n: 'agua suelo', sc: 0.25, f: v => v.toFixed(1) + '%' }, { k: 'EC', n: 'nutrientes', sc: 0.025, f: v => v.toFixed(2) },
  { k: 'mv', n: 'hoja mV', sc: 1.6, f: v => v.toFixed(1) }, { k: 'Tout', n: 'T exterior', sc: 0.4, f: v => v.toFixed(1) + '°' },
  { k: 'wind', n: 'viento', sc: 0.8, f: v => v.toFixed(1) },
];
const EFF = [
  { k: 'vent', n: 'ventanas' }, { k: 'heat', n: 'calefactor' }, { k: 'pump', n: 'riego' }, { k: 'fert', n: 'fertirriego' }, { k: 'acid', n: 'ácido pH' },
  { k: 'fan', n: 'ventilador' }, { k: 'mist', n: 'niebla' }, { k: 'shade', n: 'sombra' }, { k: 'led', n: 'luz LED' },
];
AFF.forEach(a => { a.sp = []; a.prev = null; a.rate = 1; a.d = 0; });
EFF.forEach(e => { e.sp = []; e.rate = 0; });
let nsT = 0, nsPulses = [], lastCtrl = -1, streamT = 0, streamRot = 0;
function affVal(k) { return k === 'theta' ? sim.thetaEst : sim.sens[k]; }
function nsStep(dt) {
  nsT += dt;
  let act = 0;
  for (const [i, a] of AFF.entries()) {
    const v = affVal(a.k);
    if (a.prev == null) a.prev = v;
    const d = Math.abs(v - a.prev) / Math.max(dt, 1e-3) / a.sc;       // cambio por segundo real, en unidades del sentido
    a.prev = v; a.d += (Math.min(1, d) - a.d) * Math.min(1, dt * 3);
    const dev = sim.devs[a.k] || 0;
    a.rate = Math.min(34, 1.2 + 16 * a.d + 40 * dev);                  // codificación por frecuencia, como un receptor real
    act += a.d;
    if (Math.random() < a.rate * dt) { a.sp.push(nsT); if (Math.random() < 0.45) nsPulses.push({ i, t0: nsT, dir: 1 }); }
    while (a.sp.length && a.sp[0] < nsT - 6) a.sp.shift();
  }
  nsActivity += (act / AFF.length - nsActivity) * Math.min(1, dt);
  for (const [i, e] of EFF.entries()) {
    const lv = e.k === 'vent' ? sim.act.vent : (sim.act[e.k] ? 1 : 0);
    e.rate = lv > 0.02 ? 3 + 18 * lv : 0.25;
    if (Math.random() < e.rate * dt) { e.sp.push(nsT); if (lv > 0.02 && Math.random() < 0.5) nsPulses.push({ i, t0: nsT, dir: -1 }); }
    while (e.sp.length && e.sp[0] < nsT - 6) e.sp.shift();
  }
  nsPulses = nsPulses.filter(p => nsT - p.t0 < 0.9);
  // etapas del ciclo de control
  const stage = Math.min(5, Math.floor((sim.ctrlClock / 60) * 6));
  document.querySelectorAll('#stages span').forEach(sp => sp.classList.toggle('on', +sp.dataset.k === stage));
  // corriente de procesamiento
  streamT += dt;
  if (sim.ctrlCount !== lastCtrl && streamT > 0.32) { lastCtrl = sim.ctrlCount; streamT = 0; pushStream(); }
}
function line(kind, who, text) {
  const d = document.createElement('div'); d.className = kind;
  d.innerHTML = `<b>${kind === 'a' ? '▶' : kind === 'e' ? '◀' : '·'}</b><span></span><span></span>`;
  d.children[1].textContent = who; d.children[2].textContent = text;
  const box = $('stream'); box.prepend(d); while (box.children.length > 14) box.lastChild.remove();
}
function pushStream() {
  const s = sim.sens, L = sim.learn;
  streamRot++;
  const aff = [
    ['SHT31', `T ${s.Tin.toFixed(2)} °C · HR ${s.RHin.toFixed(1)} %`], ['SCD30', `CO₂ ${s.CO2} ppm`], ['PAR', `${s.PAR} µmol/m²·s · ${sim.dli.toFixed(1)} mol hoy`],
    ['capacitivo', sim.sensDoubt ? `θ congelado ${s.theta.toFixed(1)} % · estimo ${sim.thetaEst.toFixed(1)} %` : `θ ${s.theta.toFixed(1)} % vol`], ['EC + pH', `${s.EC.toFixed(2)} mS/cm · pH ${s.pH.toFixed(2)}`],
    ['Ag/AgCl hoja', `${s.mv.toFixed(1)} mV`], ['estación', `${s.Tout.toFixed(1)} °C · ${s.wind.toFixed(1)} m/s · ${s.P.toFixed(1)} hPa`],
  ];
  const a1 = aff[streamRot % aff.length], a2 = aff[(streamRot + 3) % aff.length];
  line('a', a1[0], a1[1]); line('a', a2[0], a2[1]);
  const out = Object.keys(VIABLE).filter(k => (sim.devs[k] || 0) > 0);
  line('i', 'compara', out.length ? `${out.map(k => VIABLE[k].label).join(', ')} fuera de su zona · vigilia ${sim.vigilia.toFixed(2)}` : `${Object.keys(VIABLE).length} de ${Object.keys(VIABLE).length} variables en su zona · vigilia ${sim.vigilia.toFixed(2)}`);
  const et = sim.plant.ET * 0.85;
  if (streamRot % 2 === 0 && !sim.act.pump && et > 0.02) { const h = (sim.thetaEst - L.irrOn) / et; line('i', 'predice', h > 0 ? `riego en ~${h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h'} (θ ${sim.thetaEst.toFixed(1)} → ${L.irrOn.toFixed(1)} %)` : 'el suelo pide agua ahora'); }
  else if (streamRot % 2 === 1) line('i', 'predice', L.frostRisk ? `helada esta noche · afuera ${s.Tout.toFixed(1)} °C y bajando` : `transpiración ${et.toFixed(2)} %/h · CO₂ ${dCO2 > 0 ? '+' : ''}${Math.round(dCO2)} ppm/h`);
  const on = EFF.filter(e => e.k === 'vent' ? sim.act.vent > 0.02 : sim.act[e.k]);
  if (on.length) { const e = on[streamRot % on.length]; line('e', e.n, e.k === 'vent' ? `abiertas ${Math.round(sim.act.vent * 100)} %` : 'activo'); }
  else line('e', 'reposo', 'ningún efector necesario: el organismo escucha');
  if (streamRot % 5 === 0) line('i', 'aprende', `inicio de riego ${L.irrOn.toFixed(1)} % · transpiración ${(L.kET * 1000).toFixed(2)} mm/h por kW/m²`);
}
function drawNS() {
  const w = nsc.width, h = nsc.height, k = w / 1150;
  nx.setTransform(k, 0, 0, k, 0, 0);
  const H = 500;
  nx.fillStyle = '#0d0f0b'; nx.fillRect(0, 0, 1150, H);
  const rowY = i => 46 + i * 50, lx0 = 112, lx1 = 330, rx0 = 820, rx1 = 1038, cxn = 575, cyn = 250;
  nx.font = '13px JetBrains Mono, monospace'; nx.textBaseline = 'middle';
  // vías aferentes
  AFF.forEach((a, i) => {
    const y = rowY(i);
    nx.strokeStyle = `rgba(109,178,196,${0.12 + 0.25 * Math.min(1, a.rate / 20)})`; nx.lineWidth = 1.2;
    nx.beginPath(); nx.moveTo(lx1, y); nx.bezierCurveTo(440, y, 470, cyn, cxn - 78, cyn); nx.stroke();
    nx.fillStyle = '#949c8a'; nx.textAlign = 'left'; nx.fillText(a.n, 8, y - 8);
    nx.fillStyle = '#cfe6ec'; nx.fillText(a.f(affVal(a.k) ?? 0), 8, y + 9);
    nx.strokeStyle = 'rgba(148,156,138,0.15)'; nx.beginPath(); nx.moveTo(lx0, y); nx.lineTo(lx1, y); nx.stroke();
    nx.strokeStyle = (sim.devs[a.k] || 0) > 0 ? '#e46c52' : '#6db2c4'; nx.lineWidth = 1.6;
    nx.beginPath(); for (const t of a.sp) { const x = lx1 - (nsT - t) / 6 * (lx1 - lx0); nx.moveTo(x, y - 9); nx.lineTo(x, y + 9); } nx.stroke();
  });
  // vías eferentes
  EFF.forEach((e, i) => {
    const y = rowY(i), active = e.rate > 1;
    nx.strokeStyle = `rgba(211,139,82,${active ? 0.45 : 0.1})`; nx.lineWidth = 1.2;
    nx.beginPath(); nx.moveTo(cxn + 78, cyn); nx.bezierCurveTo(680, cyn, 710, y, rx0, y); nx.stroke();
    nx.strokeStyle = 'rgba(148,156,138,0.15)'; nx.beginPath(); nx.moveTo(rx0, y); nx.lineTo(rx1, y); nx.stroke();
    nx.strokeStyle = active ? '#d38b52' : '#4a4f44'; nx.lineWidth = 1.6;
    nx.beginPath(); for (const t of e.sp) { const x = rx0 + (nsT - t) / 6 * (rx1 - rx0); nx.moveTo(x, y - 9); nx.lineTo(x, y + 9); } nx.stroke();
    nx.fillStyle = active ? '#ecd2bd' : '#646b5d'; nx.textAlign = 'left'; nx.fillText(e.n, rx1 + 12, y);
  });
  // impulsos viajando
  for (const p of nsPulses) {
    const u = (nsT - p.t0) / 0.9, y = rowY(p.i);
    const P = p.dir > 0 ? [[lx1, y], [440, y], [470, cyn], [cxn - 78, cyn]] : [[cxn + 78, cyn], [680, cyn], [710, y], [rx0, y]];
    const b = (t, q) => (1 - t) ** 3 * q[0] + 3 * (1 - t) ** 2 * t * q[1] + 3 * (1 - t) * t * t * q[2] + t ** 3 * q[3];
    const x = b(u, P.map(q => q[0])), yy = b(u, P.map(q => q[1]));
    nx.fillStyle = p.dir > 0 ? 'rgba(160,220,236,0.95)' : 'rgba(240,180,130,0.95)';
    nx.beginPath(); nx.arc(x, yy, 3.2, 0, 7); nx.fill();
  }
  // núcleo de integración
  const v = sim.vigilia, ring = nsT * (0.4 + 2.5 * nsActivity + 2 * v);
  const col = v > 0.35 ? [228, 108, 82] : v > 0.1 ? [227, 181, 74] : [109, 178, 196];
  const rg = nx.createRadialGradient(cxn, cyn, 6, cxn, cyn, 120);
  rg.addColorStop(0, `rgba(${col},0.32)`); rg.addColorStop(1, `rgba(${col},0)`);
  nx.fillStyle = rg; nx.beginPath(); nx.arc(cxn, cyn, 120, 0, 7); nx.fill();
  const stage = Math.min(5, Math.floor((sim.ctrlClock / 60) * 6));
  for (let r = 0; r < 3; r++) {
    nx.strokeStyle = `rgba(${col},${0.25 + 0.2 * r})`; nx.lineWidth = 1.5;
    nx.beginPath(); nx.arc(cxn, cyn, 40 + r * 16, ring * (r % 2 ? -1 : 1) + r, ring * (r % 2 ? -1 : 1) + r + Math.PI * (1.2 + 0.3 * r)); nx.stroke();
  }
  nx.strokeStyle = '#d38b52'; nx.lineWidth = 4;
  nx.beginPath(); nx.arc(cxn, cyn, 90, -Math.PI / 2 + stage * Math.PI / 3, -Math.PI / 2 + (stage + 1) * Math.PI / 3 - 0.08); nx.stroke();
  nx.strokeStyle = 'rgba(211,139,82,0.18)'; nx.lineWidth = 4; nx.beginPath(); nx.arc(cxn, cyn, 90, 0, 7); nx.stroke();
  nx.fillStyle = `rgb(${col})`; nx.beginPath(); nx.arc(cxn, cyn, 22 + 4 * Math.sin(nsT * (2 + 6 * v)), 0, 7); nx.fill();
  nx.fillStyle = '#e0e4d4'; nx.textAlign = 'center'; nx.font = '15px Young Serif, Georgia, serif';
  nx.fillText(v > 0.35 ? 'vigilia' : v > 0.1 ? 'despertando' : 'disuelto', cxn, cyn + 128);
  nx.font = '12px JetBrains Mono, monospace'; nx.fillStyle = '#949c8a';
  nx.fillText(['percibe', 'compara', 'predice', 'decide', 'actúa', 'aprende'][stage], cxn, cyn + 148);
  nx.fillText('AFERENCIAS', 220, 16); nx.fillText('EFERENCIAS', 930, 16); nx.fillText('INTEGRACIÓN', cxn, 16);
  nx.textAlign = 'left';
}

/* ─────────── tamaño de los lienzos ─────────── */
function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [cv, vz, nsc]) { const w = c.clientWidth; if (w) { c.width = Math.round(w * dpr); c.height = Math.round(w * dpr * (c === cv ? 9 / 16 : c === nsc ? 1 / 2.3 : 1 / 2.4)); } }
  for (const sn of [...SENS_IN, ...SENS_OUT]) { const w = sn.cv.clientWidth; if (w) { sn.cv.width = Math.round(w * dpr); sn.cv.height = Math.round(34 * dpr); } }
  lastSpark = 0;
}
window.addEventListener('resize', fit);

/* ─────────── bucle de vida ─────────── */
let tPrev = performance.now(), uiT = 0, drawT = 0;
function loop(t) {
  const dt = Math.min(0.1, (t - tPrev) / 1000); tPrev = t;
  let simDt = 0;
  if (sim.remote) {
    simDt = sim.consumeDt(); speed = sim.speed;
    if (organic !== sim.organic) { organic = sim.organic; $('organicBtn').setAttribute('aria-pressed', organic); }
  } else {
    if (organic) organicSpeed(dt);
    if (playing) { simDt = speed * dt; sim.advance(simDt); }
  }
  const evs = sim.events.splice(0);
  const F = features(simDt);
  puente.F = F;
  if (puente.on) for (const e of evs) puente.queue.push(e);
  drawT += dt;
  nsStep(dt);
  if (drawT > 1 / 40) { drawScene(drawT); drawViz(); drawNS(); drawT = 0; }
  uiT += dt;
  if (uiT > 0.22) { updatePanels(t); uiT = 0; }
  requestAnimationFrame(loop);
}
fit(); updatePanels(performance.now()); drawScene(0.016); drawViz();
requestAnimationFrame(loop);
document.addEventListener('visibilitychange', () => { tPrev = performance.now(); });
