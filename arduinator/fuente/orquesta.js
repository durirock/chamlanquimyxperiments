/* ═══════════════════════════════════════════════════════════════════════════
   ORQUESTA ORGÁNICA
   Sin compases ni tempo fijo. Cada voz es una neurona que integra un flujo
   de datos y dispara cuando su potencial cruza el umbral (integra-y-dispara).
   La armonía cambia cuando se acumula tensión en el medio, no cuando se
   cumplen ocho tiempos. La crisis es una dominante suspendida; la vuelta a
   la zona viable es una cadencia.
   Muestras: FluidR3 SoundFont © Frank Wen, licencia MIT.
   ═══════════════════════════════════════════════════════════════════════════ */
class Banco {
  constructor(ctx) { this.ctx = ctx; this.inst = {}; this.pend = {}; }
  load(name) {
    if (this.inst[name]) return Promise.resolve();
    if (this.pend[name]) return this.pend[name];
    this.pend[name] = (async () => {
      const r = await fetch('samples/' + name + '.json');
      if (!r.ok) throw new Error('no pude cargar ' + name);
      const j = await r.json(), notes = {};
      const loops = !['orchestral_harp', 'pizzicato_strings', 'timpani', 'fx_3_crystal', 'synth_bass_1'].includes(name);
      await Promise.all(Object.entries(j).map(async ([m, b64]) => {
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const buf = await new Promise((ok, ko) => this.ctx.decodeAudioData(bin.buffer, ok, ko));
        notes[+m] = loops ? this.prepLoop(buf) : { buf, a: 0, b: 0 };
      }));
      this.inst[name] = { notes, keys: Object.keys(notes).map(Number).sort((a, b) => a - b) };
    })();
    return this.pend[name];
  }
  // hace un lazo sin costura: funde el final de la región con lo que precede a su inicio
  prepLoop(buf) {
    const sr = buf.sampleRate, n = buf.length;
    const a = Math.floor(0.6 * sr), b = n - Math.floor(0.2 * sr), F = Math.floor(0.35 * sr);
    if (b - a < 2 * F || a - F < 0) return { buf, a: 0, b: 0 };
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < F; i++) {
        const k = i / F;
        d[b - F + i] = d[b - F + i] * Math.cos(k * Math.PI / 2) + d[a - F + i] * Math.sin(k * Math.PI / 2);
      }
    }
    return { buf, a: a / sr, b: b / sr };
  }
  has(name) { return !!this.inst[name]; }
  play(name, midi, when, o = {}) {
    const I = this.inst[name]; if (!I) return null;
    const c = this.ctx;
    let key = I.keys[0]; for (const k of I.keys) if (Math.abs(k - midi) < Math.abs(key - midi)) key = k;
    const rec = I.notes[key];
    const src = c.createBufferSource(); src.buffer = rec.buf;
    src.playbackRate.value = Math.pow(2, (midi - key) / 12) * (o.detune ? Math.pow(2, o.detune / 1200) : 1);
    const dur = o.dur ?? 2, att = o.att ?? 0.02, rel = o.rel ?? 0.6, vel = o.vel ?? 0.6;
    if (o.loop !== false && rec.b > 0 && dur > rec.b - 0.3) { src.loop = true; src.loopStart = rec.a; src.loopEnd = rec.b; }
    const g = c.createGain(); g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cut ?? (1800 + 9000 * vel); lp.Q.value = 0.5;
    const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    src.connect(lp); lp.connect(g); g.connect(p); p.connect(o.dest);
    const peak = vel * (o.gain ?? 1);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + att);
    if (o.swell) g.gain.setTargetAtTime(peak * o.swell, when + att, dur * 0.35);
    const end = when + dur;
    g.gain.setTargetAtTime(0, end, rel / 3);
    src.start(when, 0); src.stop(end + rel * 2.5);
    src.onended = () => { try { p.disconnect(); } catch (e) {} };
    return {
      release: (t, r = rel) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, r / 3); try { src.stop(t + r * 2.5); } catch (e) {} },
      gain: g.gain, lp,
    };
  }
}

const ORQ_INST = ['string_ensemble_1', 'contrabass', 'cello', 'violin', 'viola', 'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'flute', 'oboe', 'clarinet', 'french_horn', 'pad_4_choir', 'timpani', 'fx_3_crystal'];
const SYN_INST = ['pad_7_halo', 'synth_bass_1', 'fx_4_atmosphere', 'fx_3_crystal', 'pad_4_choir'];

class Neurona {
  constructor(refr = 0.2) { this.v = Math.random() * 0.6; this.refr = refr; this.last = -9; this.isi = 2; }
  // integra la entrada; devuelve true si dispara
  step(now, dt, input, noise) {
    this.v += input * dt * (0.75 + 0.5 * noise);
    if (this.v >= 1 && now - this.last > this.refr) {
      this.isi = Math.min(8, now - this.last); this.last = now; this.v -= 1 + 0.15 * noise; if (this.v < 0) this.v = 0;
      return true;
    }
    return false;
  }
}

class PuenteOrganico extends Puente {
  constructor() {
    super();
    this.onStatus = () => {};
    this.N = {}; this.tension = 0; this.chord = null; this.chordStart = 0; this.held = [];
    this.lastTick = 0; this.crisis = false; this.cadence = 0;
  }
  async start() {
    await super.start();
    this.banco = this.banco || new Banco(this.ctx);
    if (this.banco.ctx !== this.ctx) this.banco = new Banco(this.ctx);
    this.loadFor(this.mode);
  }
  async loadFor(mode) {
    const need = mode === 'sinfonia' ? ORQ_INST : mode === 'synth' ? SYN_INST : [];
    if (!need.length) { this.onStatus(''); return; }
    let done = need.filter(n => this.banco.has(n)).length;
    if (done < need.length) this.onStatus(`Afinando ${mode === 'sinfonia' ? 'la orquesta' : 'los sintetizadores'}: ${done} de ${need.length} instrumentos`);
    const was = done;
    await Promise.all(need.map(n => this.banco.load(n).then(() => { done++; this.onStatus(done < need.length ? `Afinando ${mode === 'sinfonia' ? 'la orquesta' : 'los sintetizadores'}: ${done} de ${need.length} instrumentos` : ''); }).catch(() => { this.onStatus('No pude cargar algunos instrumentos; suenan los sintetizados.'); })));
    if (was < need.length && this.on && this.mode === mode) { this.tension = 2; this.chordStart = -99; }   // la orquesta llegó: entra con un acorde nuevo
  }
  setMode(m) {
    if (m === this.mode) return;
    super.setMode(m);
    if (this.on) this.loadFor(m);
  }

  /* ─────────── construcción ─────────── */
  buildMode() {
    if (this.mode !== 'sinfonia' && this.mode !== 'synth') return super.buildMode();
    const c = this.ctx, t = c.currentTime;
    const bus = c.createGain(); bus.gain.value = 1; bus.connect(this.inp);
    this.layer = { bus, items: [], stoppers: [] };
    this.wet.gain.setTargetAtTime(this.mode === 'synth' ? 0.55 : 0.5, t, 0.5);
    this.dry.gain.setTargetAtTime(0.8, t, 0.5);
    // bus de orquesta con dinámica general (la luz y la respiración del CO₂)
    const orq = c.createGain(); orq.gain.value = 0.8; orq.connect(bus); this.layer.orq = orq;
    // eco en ping-pong para el sintetizador (tiempo orgánico, no sincronizado)
    if (this.mode === 'synth') {
      const inD = c.createGain(), dL = c.createDelay(4), dR = c.createDelay(4), fb = c.createGain(), fl = c.createBiquadFilter(), mer = c.createChannelMerger(2), out = c.createGain();
      dL.delayTime.value = 0.43; dR.delayTime.value = 0.61; fb.gain.value = 0.42; fl.type = 'lowpass'; fl.frequency.value = 2600; out.gain.value = 0.55;
      inD.connect(dL); dL.connect(fl); fl.connect(dR); dR.connect(fb); fb.connect(dL);
      dL.connect(mer, 0, 0); dR.connect(mer, 0, 1); mer.connect(out); out.connect(bus);
      Object.assign(this.layer, { delayIn: inD, dL, dR, fb, fl });
      // superserra persistente: cuatro voces de cinco sierras, el filtro respira
      const pad = c.createGain(); pad.gain.value = 0; pad.gain.setTargetAtTime(0.5, t, 3); pad.connect(orq);
      const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.Q.value = 3; filt.connect(pad);
      const voices = [0, 1, 2, 3].map(k => {
        const g = c.createGain(); g.gain.value = 0.035; g.connect(filt);
        const oscs = [-14, -6, 0, 7, 15].map(d => { const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = d; o.frequency.value = 220; o.connect(g); o.start(t); return o; });
        return { g, oscs };
      });
      Object.assign(this.layer, { superPad: voices, superFilt: filt, superGain: pad });
      this.layer.stoppers.push(w => { pad.gain.setTargetAtTime(0, w, 0.6); voices.forEach(v => v.oscs.forEach(o => o.stop(w + 3))); });
    }
    this.layer.stoppers.push(w => { this.held.forEach(h => h && h.release(w, 2)); this.held = []; });
    this.N = {
      violin: new Neurona(0.22), cello: new Neurona(0.6), flute: new Neurona(0.35), clarinet: new Neurona(0.8), oboe: new Neurona(0.8),
      harp: new Neurona(0.15), pizz: new Neurona(0.08), crystal: new Neurona(0.25), heart: new Neurona(0.25), bass: new Neurona(0.4), arp: new Neurona(0.09),
    };
    this.tension = 0.6; this.chord = null; this.chordStart = t; this.lastTick = t; this.melo = 7; this.melo2 = 4;
  }

  tick() {
    if (!this.on || !this.layer || !this.F) return;
    if (this.mode !== 'sinfonia' && this.mode !== 'synth') return super.tick();
    const now = this.ctx.currentTime, dt = Math.min(0.3, now - this.lastTick); this.lastTick = now;
    this.tickOrganico(this.F, this.queue.splice(0), now, dt);
    const cut = now - 14; while (this.roll.length && this.roll[0].t + this.roll[0].dur < cut) this.roll.shift();
  }

  /* ─────────── armonía por tensión acumulada ─────────── */
  pickDegree(F) {
    const d = this.chord ? this.chord.deg : 0;
    if (this.cadence > 0) { this.cadence--; return this.cadence === 1 ? 4 : 0; }
    if (F.vig > 0.45) return this.caos(F.bio) < 0.65 ? 4 : (this.caos() < 0.5 ? 6 : 1);
    let opts = MARKOV[d] || [0, 3, 4, 5];
    // la luz inclina hacia los grados claros; la noche hacia los relativos menores
    const w = opts.map(g => 1 + (F.light > 0.4 ? ([0, 3].includes(g) ? 1.2 : 0) : ([5, 1, 2].includes(g) ? 1.2 : 0)) + (g === d ? -0.8 : 0));
    let r = this.caos(F.bio + F.theta_n) * w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < opts.length; k++) { r -= w[k]; if (r <= 0) return opts[k]; }
    return opts[0];
  }
  buildChord(H, deg, F) {
    const tone = k => { const dd = deg + 2 * k; return H.root + H.sc[dd % 7] + 12 * Math.floor(dd / 7); };
    const pcs = [tone(0), tone(1), tone(2)];
    if (F.vig > 0.4 || deg === 4 || F.light < 0.55 || [1, 5].includes(deg)) pcs.push(tone(3));     // séptima
    if (F.light > 0.35 && F.vig < 0.3) pcs.push(tone(4));                                            // novena
    const pool = (lo, hi, set) => { const r = []; for (const p of set) for (let o = -24; o <= 96; o += 12) { const m = 36 + p + o; if (m >= lo && m <= hi) r.push(m); } return r.sort((a, b) => a - b); };
    const prev = this.chord ? this.chord.upper : [60, 64, 67, 71];
    const pl = pool(55, 81, pcs);
    const used = new Set(), upper = [];
    for (const v of prev) {
      let best = null, bd = 99;
      for (const m of pl) if (!used.has(m) && Math.abs(m - v) < bd) { bd = Math.abs(m - v); best = m; }
      if (best == null) best = pl[0];
      used.add(best); upper.push(best);
    }
    // que estén todos los colores esenciales (3.ª y 7.ª)
    const prevBass = this.chord ? this.chord.bass : 43;
    const bassPool = pool(33, 52, [pcs[0]]);
    const bass = bassPool.reduce((b, m) => Math.abs(m - prevBass) < Math.abs(b - prevBass) ? m : b, bassPool[0]);
    return { deg, pcs, upper: upper.sort((a, b) => a - b), bass, H };
  }
  changeChord(F, now) {
    const H = this.harmony(F);
    const deg = this.pickDegree(F);
    const ch = this.buildChord(H, deg, F);
    const prev = this.held; this.held = [];
    const fade = 1.4 + 2.2 * (1 - F.light) + 0.8 * (1 - F.vig);
    prev.forEach(h => h && h.release(now + 0.25, fade));
    const B = this.banco, L = this.layer, dest = L.orq;
    const lvl = 0.45 + 0.4 * F.light + 0.25 * F.vig;
    const att = 0.6 + 2.4 * (1 - F.light) * (1 - F.vig);
    const long = 90;
    if (this.mode === 'sinfonia') {
      ch.upper.forEach((m, k) => this.held.push(B.play(F.vig > 0.45 ? 'tremolo_strings' : 'string_ensemble_1', m, now + 0.05 + k * 0.04, { dur: long, att, rel: fade, vel: 0.55 * lvl, gain: 2.4, pan: -0.5 + k * 0.33, dest })));
      this.held.push(B.play('contrabass', ch.bass, now + 0.02, { dur: long, att: att * 0.8, rel: fade, vel: 0.6 * lvl, gain: 2.6, pan: -0.25, dest, cut: 1800 }));
      this.held.push(B.play('cello', ch.bass + 12, now + 0.06, { dur: long, att: att * 0.9, rel: fade, vel: 0.45 * lvl, gain: 2.2, pan: -0.55, dest }));
      // coro: noche, disolución, o la planta en calma
      const choir = (1 - F.light) * (1 - F.vig) * 0.9 + (F.elev < 0.05 && F.elev > -0.1 ? 0.3 : 0);
      if (choir > 0.25) ch.upper.slice(0, 3).forEach((m, k) => this.held.push(B.play('pad_4_choir', m - (k === 0 ? 12 : 0), now + 0.3 + k * 0.2, { dur: long, att: att * 1.5, rel: fade * 1.3, vel: 0.5 * choir, gain: 2, pan: 0.6 - k * 0.6, dest })));
      // trompas en la llegada de acordes luminosos
      if (this.caos(F.bio) < 0.18 + 0.4 * F.light * (deg === 0 || deg === 3 ? 1 : 0.4)) {
        [ch.upper[0], ch.upper[1]].forEach((m, k) => this.held.push(B.play('french_horn', m - 12, now + 0.4 + k * 0.15, { dur: 4 + 6 * this.caos(), att: 1.2, rel: 2, vel: 0.5 + 0.3 * F.light, gain: 1.8, pan: 0.35, dest, swell: 1.25 })));
      }
    } else {
      ch.upper.forEach((m, k) => this.held.push(B.play('pad_7_halo', m, now + 0.05 + k * 0.05, { dur: long, att: att * 1.2, rel: fade, vel: 0.5 * lvl, gain: 2.2, pan: -0.6 + k * 0.4, dest })));
      const sp = L.superPad, tt = now + 0.05;
      ch.upper.forEach((m, k) => sp[k].oscs.forEach(o => o.frequency.setTargetAtTime(mtof(m - 12), tt, 0.35 + 0.8 * (1 - F.light))));
      if ((1 - F.light) * (1 - F.vig) > 0.5) this.held.push(B.play('pad_4_choir', ch.upper[1], now + 0.5, { dur: long, att: 3, rel: fade, vel: 0.35, gain: 1.6, pan: 0.2, dest }));
    }
    ch.upper.forEach((m, k) => this.mark(m, now, 6, k < 2 ? 'cellos' : 'violas', 0.5));
    this.mark(ch.bass, now, 6, 'contrabajo', 0.6);
    this.midiChord([ch.bass, ...ch.upper], now, 8);
    this.chord = ch; this.chordStart = now; this.tension = 0;
    this.chordLabel = `${KEY_NAMES[H.root]} ${H.modo} · ${DEG_NAMES[deg]}${ch.pcs.length > 3 ? (ch.pcs.length > 4 ? ' add9' : '7') : ''}`;
  }

  scaleNote(H, idx, base) { const o = Math.floor(idx / 7), d = ((idx % 7) + 7) % 7; return base + H.root + H.sc[d] + 12 * o; }
  nearestIn(m, set) { let b = set[0]; for (const x of set) if (Math.abs(x - m) < Math.abs(b - m)) b = x; return b; }
  chordTones(lo, hi) { const r = []; for (const p of this.chord.pcs) for (let o = -24; o <= 96; o += 12) { const m = 36 + p + o; if (m >= lo && m <= hi) r.push(m); } return r; }

  tickOrganico(F, ev, now, dt) {
    const L = this.layer, B = this.banco, dest = L.orq;
    const noise = () => this.caos(F.bio);
    if (!this.chord) this.changeChord(F, now + 0.1);
    // dinámica: la luz, la vigilia y la respiración del CO₂ (su período lo pone la planta)
    const breathHz = 0.03 + 0.07 * Math.min(1, Math.abs(F.dCO2) / 140);
    this.breathPh = (this.breathPh || 0) + 2 * Math.PI * breathHz * dt;
    L.orq.gain.setTargetAtTime((0.55 + 0.35 * F.light + 0.25 * F.vig) * (1 + 0.16 * Math.sin(this.breathPh)), now, 0.5);
    if (this.mode === 'synth') {
      L.superFilt.frequency.setTargetAtTime(380 + 2600 * F.light * (0.75 + 0.25 * Math.sin(this.breathPh)) + 1200 * F.vig, now, 0.6);
      L.superFilt.Q.value = 2 + 6 * F.vig;
      L.fb.gain.setTargetAtTime(0.25 + 0.4 * F.RH_n, now, 1);
      L.fl.frequency.setTargetAtTime(1200 + 3500 * F.light, now, 1);
    }
    // tensión del medio: cuánto se mueve el mundo
    const act = 0.03 + 0.22 * F.activity + 0.6 * F.vig + 0.35 * F.wind_n + 0.3 * F.rain_n;
    this.tension += act * dt;
    const dwell = now - this.chordStart;
    const minD = 4.5 - 2.5 * F.vig, maxD = 34 - 16 * F.light;
    // la crisis que pasa se resuelve con cadencia
    if (F.vig > 0.45) this.crisis = true;
    if (this.crisis && F.vig < 0.15) { this.crisis = false; this.cadence = 2; this.tension = 2; this.horns(F, now + 0.2, 1); }
    if ((this.tension > 1 && dwell > minD) || dwell > maxD) this.changeChord(F, now + 0.05);
    const H = this.chord.H;

    // ── eventos del organismo, cada uno con su gesto
    for (const e of ev) {
      if (e === 'pump:on') this.gliss(F, now + 0.1, 1);
      if (e === 'pump:off') this.gliss(F, now + 0.1, -1);
      if (e === 'fert:on' || e === 'acid:on') for (let k = 0; k < 6; k++) this.twinkle(F, now + 0.1 + k * 0.13);
      if (e === 'amanecer') { this.horns(F, now + 0.3, 1.2); this.cadence = 2; this.tension = 2; this.gliss(F, now + 1.2, 1); }
      if (e === 'anochecer') { this.tension = 2; for (let k = 0; k < 3; k++) B.play('pad_4_choir', this.chord.upper[k], now + 0.5 + k * 0.6, { dur: 9, att: 3, rel: 4, vel: 0.5, gain: 1.8, pan: k - 1, dest }); }
      if (e === 'evento:helada') { this.drumRoll(now, 3.5, 0.7); for (let k = 0; k < 8; k++) this.twinkle(F, now + 1 + k * 0.4); this.tension = 2; }
      if (e === 'evento:temporal') { this.drumRoll(now, 5, 0.9); this.tension = 2; }
      if (e === 'evento:calor') { this.tension = 2; [0, 1, 2].forEach(k => B.play('tremolo_strings', this.chord.upper[k] + 12, now + 0.2, { dur: 6, att: 1.5, rel: 2, vel: 0.5, gain: 2, pan: k - 1, dest })); }
      if (e === 'cosecha') { this.horns(F, now + 0.1, 1); this.gliss(F, now + 0.4, 1); }
      if (e === 'presiente') { B.play('pad_4_choir', this.chord.bass + 12, now + 0.2, { dur: 7, att: 2.5, rel: 3, vel: 0.5, gain: 2, dest }); this.drumRoll(now + 0.5, 2, 0.4); }
      if (e === 'heat:on' && this.mode === 'sinfonia') B.play('french_horn', this.chord.bass + 12, now + 0.1, { dur: 3, att: 0.8, rel: 1.5, vel: 0.35, gain: 1.6, dest });
      if (e === 'aprende' || e === 'calibra') this.twinkle(F, now + 0.1);
    }

    // ── neuronas: cada voz dispara cuando su flujo de datos acumula suficiente
    const absBio = Math.min(1, Math.abs(F.bio) / 1.6);
    const inp = {
      violin: 0.1 + 1.0 * F.light * (0.35 + 0.65 * absBio) + 0.35 * F.vig + 0.1 * absBio,
      cello: 0.03 + 0.28 * (1 - F.light) * (0.4 + absBio) + 0.1 * F.vig,
      flute: 0.02 + 0.55 * F.wind_n * (0.4 + F.light) + 0.08 * F.light,
      clarinet: 0.02 + 0.25 * (1 - F.light) * F.RH_n,
      oboe: 0.01 + 0.35 * F.stress * (0.3 + F.light),
      harp: 0.04 + 0.12 * F.theta_n + 1.2 * Math.min(1, Math.abs(F.dTheta) / 3),
      pizz: F.rain_n * 5,
      crystal: 0.015 + 1.4 * F.wet + 0.5 * Math.max(0, F.RH_n - 0.88) * 4,
      heart: F.vig > 0.18 ? (40 + 80 * F.vig) / 60 : 0,
      bass: 0.12 + 0.35 * F.Tin_n + 0.4 * F.vig,
      arp: 0.25 + 2.2 * F.light * (0.3 + absBio) + 0.6 * F.vig,
    };
    const fire = k => this.N[k].step(now, dt, inp[k], noise());
    const scale = this.chord;
    if (this.mode === 'sinfonia') {
      if (fire('violin')) {
        const n = this.N.violin, step = Math.round(F.bio * 1.3 + (this.caos() - 0.5) * 3.4);
        this.melo = Math.max(2, Math.min(17, this.melo + (step || (this.caos() < 0.5 ? 1 : -1))));
        let m = this.scaleNote(H, this.melo, 60);
        if (this.caos() < 0.55) m = this.nearestIn(m, this.chordTones(64, 93));
        const dur = Math.max(0.35, Math.min(5, n.isi * (0.9 + 0.5 * this.caos())));
        const vel = 0.3 + 0.45 * F.light + 0.2 * F.vig;
        B.play('violin', m, now + 0.05, { dur, att: 0.08 + 0.3 * (1 - F.vig) * this.caos(), rel: 0.6 + 0.8 * (1 - F.light), vel, gain: 2.1, pan: 0.25, dest });
        this.mark(m, now + 0.05, dur, 'violin', vel); this.midiNote(0, m, vel, now + 0.05, dur);
      }
      if (fire('cello')) {
        const n = this.N.cello;
        this.melo2 = Math.max(0, Math.min(10, this.melo2 + (this.melo > 10 ? -1 : 1) * (this.caos() < 0.6 ? 1 : 2)));     // movimiento contrario
        const m = this.nearestIn(this.scaleNote(H, this.melo2, 43), this.chordTones(43, 64).concat([this.scaleNote(H, this.melo2, 43)]));
        const dur = Math.max(1, Math.min(7, n.isi));
        B.play('cello', m, now + 0.05, { dur, att: 0.35, rel: 1.2, vel: 0.5, gain: 2.2, pan: -0.45, dest, swell: 1.15 });
        this.mark(m, now + 0.05, dur, 'cellos', 0.6);
      }
      if (fire('flute')) {                                                     // ráfagas de viento: motivos de 2 a 5 notas
        const k = 2 + Math.floor(this.caos() * 4), gap = 0.12 + 0.3 * (1 - F.wind_n) * this.caos();
        let i0 = 10 + Math.floor(this.caos() * 6);
        for (let j = 0; j < k; j++) {
          const m = this.scaleNote(H, i0 + j * (this.caos() < 0.7 ? 1 : 2) * (F.dCO2 < 0 ? 1 : -1), 60);
          B.play('flute', m, now + 0.05 + j * gap, { dur: gap * 1.4 + (j === k - 1 ? 0.8 : 0), att: 0.04, rel: 0.4, vel: 0.35 + 0.35 * F.wind_n, gain: 1.6, pan: 0.55, dest });
          this.mark(m, now + 0.05 + j * gap, gap * 1.4, 'arpa', 0.5);
        }
      }
      if (fire('clarinet')) { const m = this.nearestIn(this.scaleNote(H, 5 + Math.floor(this.caos() * 7), 48), this.chordTones(52, 76)); const d = 2 + 3 * this.caos(); B.play('clarinet', m, now + 0.05, { dur: d, att: 0.25, rel: 1, vel: 0.4, gain: 1.6, pan: -0.2, dest, swell: 0.85 }); this.mark(m, now, d, 'voz', 0.5); }
      if (fire('oboe')) { const m = this.scaleNote(H, 8 + Math.floor(this.caos() * 5), 60); const d = 1.5 + 2 * this.caos(); B.play('oboe', m, now + 0.05, { dur: d, att: 0.12, rel: 0.6, vel: 0.45, gain: 1.6, pan: 0.15, dest }); this.mark(m, now, d, 'violin', 0.5); }
      if (fire('harp')) { const ct = this.chordTones(55, 91); const m = ct[Math.floor(this.caos() * ct.length) % ct.length]; B.play('orchestral_harp', m, now + 0.03, { dur: 2.4, att: 0.004, rel: 1.2, vel: 0.45 + 0.3 * F.theta_n, gain: 1.8, pan: (this.caos() - 0.5) * 1.4, dest, loop: false }); this.mark(m, now, 1, 'arpa', 0.6); this.midiNote(3, m, 0.5, now, 0.6); }
      if (fire('pizz')) { const ct = this.chordTones(55, 84); const m = ct[Math.floor(this.caos() * ct.length) % ct.length]; B.play('pizzicato_strings', m, now + 0.02, { dur: 1.2, att: 0.003, rel: 0.4, vel: 0.35 + 0.4 * F.rain_n, gain: 1.8, pan: (this.caos() - 0.5) * 1.6, dest, loop: false }); this.mark(m, now, 0.4, 'pizz', 0.6); }
      if (fire('crystal')) this.twinkle(F, now + 0.03);
      if (fire('heart')) { const r = this.chord.bass; B.play('timpani', r + 7 <= 57 ? r + 7 : r - 5, now + 0.03, { dur: 1.6, att: 0.003, rel: 0.8, vel: 0.35 + 0.55 * F.vig, gain: 2.4, pan: -0.15, dest, loop: false }); B.play('timpani', r, now + 0.03 + 0.26 * (1.2 - F.vig * 0.5), { dur: 1.6, att: 0.003, rel: 0.8, vel: 0.25 + 0.45 * F.vig, gain: 2.4, pan: -0.15, dest, loop: false }); this.mark(r, now, 0.4, 'timbal', F.vig); this.midiNote(9, 47, F.vig, now, 0.3); }
      if (!B.has('violin') && this.N.violin.last === now) this.bowNote(60 + 12, now, 1, 0.5);   // si las muestras no llegan, una voz sintetizada
    } else {
      // ── sintetizador: arpegio disparado por la hoja, bajo por el calor, cristales por el rocío
      if (fire('arp')) {
        const ct = this.chordTones(60, 96); this.arpI = ((this.arpI || 0) + (F.bio >= 0 ? 1 : -1) * (1 + (this.caos() < 0.2 ? 1 : 0)) + ct.length * 4) % ct.length;
        const m = ct[this.arpI]; const isi = this.N.arp.isi;
        L.dL.delayTime.setTargetAtTime(Math.max(0.12, Math.min(1.6, isi * 0.75)), now, 0.4); L.dR.delayTime.setTargetAtTime(Math.max(0.18, Math.min(2.4, isi * 1.12)), now, 0.4);
        this.synthPluck(m, now + 0.02, 0.3 + 0.5 * F.light, (this.caos() - 0.5) * 1.2, 0.18 + 1.2 * F.RH_n);
        this.mark(m, now, 0.3, 'violin', 0.6);
      }
      if (fire('bass')) { B.play('synth_bass_1', this.chord.bass - 12 < 28 ? this.chord.bass : this.chord.bass - 12, now + 0.02, { dur: Math.min(3, this.N.bass.isi * 0.8), att: 0.005, rel: 0.4, vel: 0.5 + 0.3 * F.vig, gain: 2.2, dest, loop: false }); this.mark(this.chord.bass - 12, now, 0.6, 'contrabajo', 0.7); L.superGain.gain.setTargetAtTime(0.32, now, 0.02); L.superGain.gain.setTargetAtTime(0.5, now + 0.08, 0.25); }
      if (fire('crystal')) this.twinkle(F, now + 0.03);
      if (fire('heart')) { this.thump(now + 0.02, 52, 0.8 + F.vig); this.thump(now + 0.28, 42, 0.6 + F.vig); this.mark(30, now, 0.3, 'latido', F.vig); }
      if (fire('flute')) B.play('fx_4_atmosphere', this.chordTones(60, 84)[0], now, { dur: 5, att: 1.5, rel: 2, vel: 0.35 + 0.4 * F.wind_n, gain: 1.6, pan: this.caos() - 0.5, dest });
      if (fire('pizz')) this.synthPluck(this.chordTones(72, 96)[Math.floor(this.caos() * 5) % 5] || 84, now + 0.02, 0.25, this.caos() * 1.6 - 0.8, 0.12);
    }
  }
  gliss(F, t, dir) {
    const ct = this.chordTones(48, 96); if (dir < 0) ct.reverse();
    ct.forEach((m, k) => {
      if (this.mode === 'sinfonia') this.banco.play('orchestral_harp', m, t + k * 0.075, { dur: 2.5, att: 0.003, rel: 1.5, vel: 0.4 + 0.3 * k / ct.length, gain: 1.7, pan: -0.7 + 1.4 * k / ct.length, dest: this.layer.orq, loop: false });
      else this.synthPluck(m, t + k * 0.06, 0.35, -0.7 + 1.4 * k / ct.length, 0.2);
      this.mark(m, t + k * 0.075, 0.5, 'arpa', 0.6);
    });
  }
  twinkle(F, t) {
    const ct = this.chordTones(84, 100); const m = ct[Math.floor(this.caos() * ct.length) % ct.length] || 88;
    if (this.banco.has('fx_3_crystal')) this.banco.play('fx_3_crystal', m, t, { dur: 2, att: 0.003, rel: 1.2, vel: 0.3 + 0.3 * F.light, gain: 1.4, pan: this.caos() * 1.6 - 0.8, dest: this.layer.orq, loop: false });
    else this.bell(mtof(m), t, 0.4, this.caos() - 0.5);
    this.mark(m, t, 0.5, 'esfera', 0.6);
  }
  horns(F, t, v) {
    if (!this.chord) return;
    const [a, b, c2] = this.chord.upper;
    [a - 12, b - 12, c2 - 12].forEach((m, k) => {
      if (this.mode === 'sinfonia') this.banco.play('french_horn', m, t + k * 0.18, { dur: 5.5, att: 1.4, rel: 2.5, vel: 0.55 * v, gain: 1.9, pan: 0.3 - k * 0.25, dest: this.layer.orq, swell: 1.3 });
      else this.banco.play('pad_7_halo', m + 12, t + k * 0.18, { dur: 6, att: 2, rel: 3, vel: 0.5 * v, gain: 2, dest: this.layer.orq });
      this.mark(m, t + k * 0.18, 5, 'cellos', 0.8);
    });
  }
  drumRoll(t, dur, v) {
    if (!this.chord) return;
    const r = this.chord.bass, n = Math.floor(dur * 9);
    for (let k = 0; k < n; k++) {
      const vv = v * (0.2 + 0.8 * Math.sin(Math.PI * k / n));
      if (this.mode === 'sinfonia') this.banco.play('timpani', r, t + k / 9 + this.caos() * 0.02, { dur: 0.9, att: 0.003, rel: 0.5, vel: vv, gain: 1.9, dest: this.layer.orq, loop: false });
      else this.thump(t + k / 9, 48, vv);
    }
    this.mark(r, t, dur, 'timbal', v);
  }
  synthPluck(midi, t, vel, panV, decay) {
    const c = this.ctx, f = mtof(midi);
    const o = c.createOscillator(), o2 = c.createOscillator(); o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f * 1.003;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(Math.min(12000, f * 10), t); lp.frequency.setTargetAtTime(f * 1.2, t, decay * 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.005, decay * 0.4);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const p = this.pan(panV);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(p); p.connect(this.layer.orq); g.connect(this.layer.delayIn);
    [o, o2].forEach(x => { x.start(t); x.stop(t + decay * 3 + 0.2); });
    o.onended = () => { try { p.disconnect(); g.disconnect(); } catch (e) {} };
  }

  mapping(F, S) {
    if (!F || !S) return [];
    const f1 = (x, d = 1) => x.toFixed(d);
    const hz = k => this.N[k] ? (this.N[k].isi ? `${(1 / this.N[k].isi).toFixed(2)} Hz` : '') : '';
    if (this.mode === 'sinfonia') return [
      ['Armonía', 'cambia cuando el medio acumula tensión, no por compases', this.chordLabel || '—'],
      ['Cuerdas, contrabajo y cello', 'acorde sostenido; la luz abre el volumen', `${Math.round(S.PAR)} µmol`],
      ['Violín solista', 'neurona que integra el potencial de la hoja', `${f1(S.mv)} mV · ${hz('violin')}`],
      ['Cello', 'contracanto nocturno, en movimiento contrario', `${hz('cello')}`],
      ['Flauta', 'ráfagas de viento', `${f1(S.wind)} m/s`],
      ['Clarinete y oboe', 'humedad nocturna y estrés de la planta', `${f1(S.RHin, 0)} % · estrés ${Math.round(F.stress * 100)} %`],
      ['Arpa', 'cambios del agua del suelo; glisando en cada riego', `${f1(S.theta)} %`],
      ['Pizzicato', 'gotas de lluvia', `${f1(S.rain)} mm/h`],
      ['Celesta de cristal', 'condensación y rocío', `${Math.round(F.wet * 100)} %`],
      ['Coro', 'noche y disolución', F.light < 0.2 ? 'cantando' : 'en reposo'],
      ['Timbales', 'latido de la vigilia', F.vig > 0.18 ? `${Math.round(40 + 80 * F.vig)} lpm` : 'en silencio'],
    ];
    if (this.mode === 'synth') return [
      ['Armonía', 'tensión acumulada del medio', this.chordLabel || '—'],
      ['Superserra', 'el filtro abre con la luz y respira con el CO₂', `${Math.round(S.CO2)} ppm`],
      ['Arpegio', 'cada disparo de la neurona de la hoja; el eco sigue su ritmo', `${f1(S.mv)} mV · ${hz('arp')}`],
      ['Bajo', 'neurona de temperatura', `${f1(S.Tin)} °C · ${hz('bass')}`],
      ['Eco', 'la humedad alarga la cola', `${f1(S.RHin, 0)} %`],
      ['Atmósfera', 'viento', `${f1(S.wind)} m/s`],
      ['Cristales', 'condensación', `${Math.round(F.wet * 100)} %`],
      ['Latido', 'vigilia', F.vig > 0.18 ? `${Math.round(40 + 80 * F.vig)} lpm` : 'en silencio'],
    ];
    return super.mapping(F, S);
  }
}
