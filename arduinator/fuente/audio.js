/* ═══════════════════════════════════════════════════════════════════════════
   MODO PUENTE · el invernadero se vuelve audible
   Cuatro escuchas del mismo organismo:
     sinfonia  · orquesta de cuerdas, arpa y timbales; la crisis es una dominante
                 sin resolver y la homeostasis es la cadencia que vuelve a casa
     esferas   · cada sentido es un planeta que canta un armónico (Kepler)
     respira   · el invernadero como cuerpo: aliento, latido, voz
     paisaje   · escucha directa: viento, lluvia, aves, grillos y la máquina
   ═══════════════════════════════════════════════════════════════════════════ */
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = {
  lidio: [0, 2, 4, 6, 7, 9, 11], jonico: [0, 2, 4, 5, 7, 9, 11], mixolidio: [0, 2, 4, 5, 7, 9, 10],
  dorico: [0, 2, 3, 5, 7, 9, 10], eolico: [0, 2, 3, 5, 7, 8, 10], frigio: [0, 1, 3, 5, 7, 8, 10],
};
const KEYS = { primavera: 7, verano: 2, 'otoño': 9, invierno: 2 };          // Sol, Re, La, Re
const KEY_NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const DEG_NAMES = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
// tendencias armónicas clásicas: de cada grado, a qué grados se suele ir
const MARKOV = { 0: [3, 4, 5, 1, 3, 4], 1: [4, 4, 6], 2: [5, 3], 3: [4, 0, 1, 4], 4: [0, 0, 5, 0], 5: [3, 1, 3], 6: [0, 0] };

class Puente {
  constructor() {
    this.mode = 'sinfonia'; this.on = false; this.vol = 0.75;
    this.x = 0.4123;                         // estado caótico
    this.roll = [];                          // notas recientes, para la partitura viva
    this.queue = [];                         // eventos del organismo
    this.F = null;
    this.deg = 0; this.prevDeg = 0; this.chordEnd = 0; this.beat = 0; this.nextBeat = 0;
    this.melo = 4; this.breathT = 0; this.heartT = 0; this.birdT = 0; this.dropT = 0;
    this.midiOut = null; this.midiHeld = [];
    this.planets = [];
    this.status = '';
  }
  caos(inj = 0) {
    const r = 3.87 + 0.12 * Math.tanh(inj);
    this.x = r * this.x * (1 - this.x);
    this.x = (this.x + 1e-3 * inj + 1) % 1;
    if (this.x < 1e-6 || this.x > 1 - 1e-6) this.x = 0.5 + 0.1 * Math.sin(inj * 7.1 + 1);
    return this.x;
  }

  /* ─────────── cadena maestra ─────────── */
  async start() {
    if (this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 3; this.comp.attack.value = 0.02; this.comp.release.value = 0.4;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.82;
    this.inp = c.createGain();
    this.dry = c.createGain(); this.wet = c.createGain();
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(4.2);
    this.inp.connect(this.dry); this.inp.connect(this.wet); this.wet.connect(this.verb);
    this.dry.connect(this.master); this.verb.connect(this.master);
    this.master.connect(this.comp); this.comp.connect(this.analyser); this.analyser.connect(c.destination);
    this.noiseBuf = this.makeNoise(4);
    this.on = true;
    this.master.gain.setTargetAtTime(this.vol, c.currentTime, 0.8);
    this.nextBeat = c.currentTime + 0.2; this.chordEnd = 0;
    this.buildMode();
    this.timer = setInterval(() => this.tick(), 90);
  }
  stop() {
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime;
    this.master.gain.setTargetAtTime(0, t, 0.4);
    clearInterval(this.timer); this.on = false;
    this.midiAllOff();
    setTimeout(() => { try { c.close(); } catch (e) {} }, 2200);
  }
  setVolume(v) { this.vol = v; if (this.on) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); }
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (!this.on) return;
    this.teardown();
    this.buildMode();
  }

  impulse(sec) {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * sec), buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let y = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const a = 0.9 - 0.75 * k;                            // las altas se apagan antes
        y += a * ((Math.random() * 2 - 1) - y);
        let v = y * Math.pow(1 - k, 2.6);
        if (i < sr * 0.08 && Math.random() < 0.004) v += (Math.random() - 0.5) * 1.6 * (1 - i / (sr * 0.08));
        d[i] = v * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return buf;
  }
  makeNoise(sec) {
    const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.loopStart = Math.random() * 3; return s; }
  pan(v) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, v)); return p; }

  /* ─────────── instrumentos ─────────── */
  // cuerda sostenida (sección): tres sierras desafinadas, vibrato, filtro de cuerpo
  stringSection(midi, panV, level, bright = 0.5) {
    const c = this.ctx, t = c.currentTime, f = mtof(midi);
    const out = c.createGain(); out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = Math.min(9000, f * (3 + 5 * bright));
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 420; body.Q.value = 1.1; body.gain.value = 3;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = Math.max(30, f * 0.6);
    const lfo = c.createOscillator(); lfo.frequency.value = 4.8 + Math.random() * 0.9;
    const lg = c.createGain(); lg.gain.value = f * 0.0045;
    lfo.connect(lg);
    const oscs = [-9, 0, 8].map((dt, k) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (Math.random() - 0.5) * 3;
      lg.connect(o.frequency);
      const g = c.createGain(); g.gain.value = k === 1 ? 0.36 : 0.3;
      o.connect(g); g.connect(hp); o.start(t); return o;
    });
    hp.connect(lp); lp.connect(body); body.connect(out);
    const p = this.pan(panV); out.connect(p); p.connect(this.layer.bus);
    lfo.start(t);
    out.gain.setTargetAtTime(level, t, 1.2);
    const v = {
      midi, oscs, out, lp, lg,
      setNote: (m, when, glide = 0.18) => {
        const nf = mtof(m); v.midi = m;
        oscs.forEach(o => o.frequency.setTargetAtTime(nf, when, glide));
        lg.gain.setTargetAtTime(nf * 0.0045, when, 0.3);
        lp.frequency.setTargetAtTime(Math.min(9000, nf * (3 + 5 * bright)), when, 0.3);
        hp.frequency.setTargetAtTime(Math.max(30, nf * 0.6), when, 0.3);
        // cambio de arco: una pequeña inflexión de volumen
        out.gain.setTargetAtTime(v.level * 0.72, when, 0.03);
        out.gain.setTargetAtTime(v.level, when + 0.09, 0.25);
      },
      setLevel: (l, when, tc = 0.8) => { v.level = l; out.gain.setTargetAtTime(l, when, tc); },
      setBright: (b, when) => { bright = b; lp.frequency.setTargetAtTime(Math.min(9000, mtof(v.midi) * (3 + 5 * b)), when, 0.6); },
      stop: when => { out.gain.setTargetAtTime(0, when, 0.5); oscs.forEach(o => o.stop(when + 3)); lfo.stop(when + 3); },
      level,
    };
    return v;
  }
  // nota de violín solista con arco, vibrato tardío y expresión
  bowNote(midi, when, dur, vel, panV = 0.15) {
    const c = this.ctx, f = mtof(midi);
    const out = c.createGain(); out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 2.5; lp.Q.value = 0.8;
    const form = c.createBiquadFilter(); form.type = 'peaking'; form.frequency.value = 2800; form.Q.value = 1.4; form.gain.value = 4;
    const lfo = c.createOscillator(); lfo.frequency.value = 5.6 + Math.random() * 0.6;
    const lg = c.createGain(); lg.gain.value = 0;
    lfo.connect(lg);
    const oscs = [-5, 4].map(dt => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; lg.connect(o.frequency); o.connect(lp); return o; });
    lp.connect(form); form.connect(out);
    const p = this.pan(panV); out.connect(p); p.connect(this.layer.bus);
    const att = 0.07 + 0.2 * (1 - vel), rel = 0.35 + 0.4 * (1 - vel);
    const peak = 0.11 * (0.35 + 0.65 * vel);
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(peak, when + att);
    out.gain.setTargetAtTime(peak * 0.82, when + att, dur * 0.4);
    out.gain.setTargetAtTime(0, when + dur, rel / 3);
    lp.frequency.setValueAtTime(f * 1.6, when);
    lp.frequency.linearRampToValueAtTime(Math.min(9500, f * (3.5 + 3 * vel)), when + att);
    lg.gain.setValueAtTime(0, when); lg.gain.setTargetAtTime(f * 0.006, when + Math.min(0.35, dur * 0.4), 0.25);
    oscs.forEach(o => { o.start(when); o.stop(when + dur + rel * 2.5); });
    lfo.start(when); lfo.stop(when + dur + rel * 2.5);
    oscs[0].onended = () => { out.disconnect(); p.disconnect(); };
    this.mark(midi, when, dur, 'violin', vel);
    this.midiNote(0, midi, vel, when, dur);
  }
  pluck(midi, when, vel = 0.6, panV = 0, kind = 'arpa') {
    const c = this.ctx, f = mtof(midi);
    const out = c.createGain(); out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    const o1 = c.createOscillator(); o1.type = kind === 'pizz' ? 'sawtooth' : 'triangle'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.002;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out);
    const p = this.pan(panV); out.connect(p); p.connect(this.layer.bus);
    const dec = kind === 'pizz' ? 0.25 : kind === 'gota' ? 0.12 : 1.6 + 1.2 * (1 - Math.min(1, f / 1200));
    const peak = (kind === 'pizz' ? 0.09 : kind === 'gota' ? 0.05 : 0.12) * vel;
    out.gain.setValueAtTime(0, when); out.gain.linearRampToValueAtTime(peak, when + 0.004);
    out.gain.setTargetAtTime(0, when + 0.004, dec / 3);
    lp.frequency.setValueAtTime(Math.min(12000, f * (kind === 'pizz' ? 6 : 10)), when);
    lp.frequency.setTargetAtTime(f * 1.5, when + 0.005, dec / 4);
    [o1, o2].forEach(o => { o.start(when); o.stop(when + dec * 2 + 0.05); });
    o1.onended = () => { out.disconnect(); p.disconnect(); };
    this.mark(midi, when, Math.min(dec, 1.2), kind, vel);
    if (kind === 'arpa') this.midiNote(3, midi, vel, when, 0.6);
  }
  timpani(midi, when, vel = 0.7) {
    const c = this.ctx, f = mtof(midi);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, when); o.frequency.exponentialRampToValueAtTime(f, when + 0.07);
    const g = c.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.42 * vel, when + 0.006); g.gain.setTargetAtTime(0, when + 0.01, 0.45);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.5;
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.1 * vel, when); g2.gain.setTargetAtTime(0, when, 0.2);
    const n = this.noise(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 0.8;
    const gn = c.createGain(); gn.gain.setValueAtTime(0.25 * vel, when); gn.gain.setTargetAtTime(0, when, 0.04);
    n.connect(bp); bp.connect(gn);
    const p = this.pan(-0.2);
    o.connect(g); o2.connect(g2); g.connect(p); g2.connect(p); gn.connect(p); p.connect(this.layer.bus);
    o.start(when); o.stop(when + 3); o2.start(when); o2.stop(when + 1.5); n.start(when); n.stop(when + 0.4);
    o.onended = () => p.disconnect();
    this.mark(midi, when, 0.5, 'timbal', vel);
    this.midiNote(9, 47, vel, when, 0.3);
  }
  bell(f, when, vel = 0.5, panV = 0, ratio = 3.5, dec = 4) {
    const c = this.ctx;
    const car = c.createOscillator(); car.frequency.value = f;
    const mod = c.createOscillator(); mod.frequency.value = f * ratio;
    const mg = c.createGain(); mg.gain.setValueAtTime(f * 2.4 * vel, when); mg.gain.setTargetAtTime(f * 0.2, when, dec / 5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.09 * vel, when + 0.005); g.gain.setTargetAtTime(0, when + 0.01, dec / 3.5);
    const p = this.pan(panV); car.connect(g); g.connect(p); p.connect(this.layer.bus);
    [car, mod].forEach(o => { o.start(when); o.stop(when + dec * 1.6); });
    car.onended = () => p.disconnect();
  }
  chirp(when, base, kind) {                 // canto de ave sintético
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    const n = 2 + Math.floor(this.caos() * 6), step = 0.06 + this.caos() * 0.08;
    g.gain.value = 0;
    for (let k = 0; k < n; k++) {
      const t = when + k * step, up = kind === 0 ? 1.5 : kind === 1 ? 0.7 : 1.15;
      o.frequency.setValueAtTime(base * (1 + 0.08 * Math.sin(k * 1.7)), t);
      o.frequency.exponentialRampToValueAtTime(base * up, t + step * 0.7);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.01); g.gain.linearRampToValueAtTime(0, t + step * 0.8);
    }
    const p = this.pan((this.caos() - 0.5) * 1.6);
    o.connect(g); g.connect(p); p.connect(this.layer.bus);
    o.start(when); o.stop(when + n * step + 0.1); o.onended = () => p.disconnect();
  }
  blip(f, when, dur, vel, panV, type = 'sine') {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, when); o.frequency.exponentialRampToValueAtTime(f * 0.55, when + dur);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vel, when + 0.003); g.gain.setTargetAtTime(0, when + 0.004, dur / 3);
    const p = this.pan(panV); o.connect(g); g.connect(p); p.connect(this.layer.bus);
    o.start(when); o.stop(when + dur * 2); o.onended = () => p.disconnect();
  }
  mark(midi, t, dur, sec, vel) {
    this.roll.push({ midi, t, dur, sec, vel });
    if (this.roll.length > 220) this.roll.shift();
  }

  /* ─────────── MIDI (si el navegador lo permite) ─────────── */
  async enableMidi() {
    if (!navigator.requestMIDIAccess) throw new Error('Este navegador no ofrece Web MIDI');
    const acc = await navigator.requestMIDIAccess();
    const outs = [...acc.outputs.values()];
    if (!outs.length) throw new Error('No hay salidas MIDI conectadas');
    this.midiOut = outs[0];
    return outs.map(o => o.name);
  }
  midiNote(ch, note, vel, when, dur) {
    if (!this.midiOut || this.mode !== 'sinfonia') return;
    const ms = performance.now() + (when - this.ctx.currentTime) * 1000;
    const v = Math.max(1, Math.min(127, Math.round(vel * 110)));
    try { this.midiOut.send([0x90 | ch, note, v], ms); this.midiOut.send([0x80 | ch, note, 0], ms + dur * 1000); } catch (e) {}
  }
  midiAllOff() { if (!this.midiOut) return; try { for (let ch = 0; ch < 16; ch++) this.midiOut.send([0xB0 | ch, 123, 0]); } catch (e) {} }

  /* ─────────── armonía guiada por los datos ─────────── */
  harmony(F) {
    const root = KEYS[F.season] ?? 7;
    let modo = F.light > 0.55 ? 'lidio' : F.light > 0.12 ? 'jonico' : F.elev > -0.12 ? 'mixolidio' : 'dorico';
    if (F.season === 'invierno' || F.season === 'otoño') modo = F.light > 0.4 ? 'dorico' : 'eolico';
    if (F.vig > 0.55) modo = 'frigio';
    return { root, modo, sc: SCALES[modo] };
  }
  chordNotes(H, deg, base, n = 4) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const d = deg + 2 * k, oct = Math.floor(d / 7);
      out.push(base + H.root + H.sc[d % 7] + 12 * oct);
    }
    return out;
  }
  nearest(target, pool) { let best = pool[0], bd = 99; for (const p of pool) { const d = Math.abs(p - target); if (d < bd) { bd = d; best = p; } } return best; }

  /* ─────────── construcción de cada modo ─────────── */
  buildMode() {
    const c = this.ctx, t = c.currentTime;
    const bus = c.createGain(); bus.gain.value = 1; bus.connect(this.inp);
    this.layer = { bus, items: [], stoppers: [] };
    const wetFor = { sinfonia: 0.42, esferas: 0.75, respira: 0.5, paisaje: 0.28 }[this.mode];
    this.wet.gain.setTargetAtTime(wetFor, t, 0.5);
    this.dry.gain.setTargetAtTime(this.mode === 'esferas' ? 0.55 : 0.85, t, 0.5);
    const F = this.F || { light: 0.5, season: 'primavera', elev: 0.3, vig: 0 };
    if (this.mode === 'sinfonia') {
      const H = this.harmony(F); const ch = this.chordNotes(H, 0, 36, 4);
      const swell = c.createGain(); swell.gain.value = 1; swell.connect(bus);
      const trem = c.createGain(); trem.gain.value = 1; trem.connect(swell);
      const tl = c.createOscillator(); tl.frequency.value = 7.2; const tlg = c.createGain(); tlg.gain.value = 0; tl.connect(tlg); tlg.connect(trem.gain); tl.start(t);
      this.layer.swell = swell; this.layer.tremG = tlg;
      const mk = (m, p, l, b) => { const v = this.stringSection(m, p, l, b); v.out.disconnect(); const pp = this.pan(p); v.out.connect(pp); pp.connect(trem); return v; };
      this.layer.secs = {
        contrabajo: mk(ch[0] - 0, -0.35, 0.22, 0.25),
        cellos: mk(ch[2] + 12, -0.55, 0.15, 0.35),
        violas: mk(ch[1] + 24, 0.35, 0.10, 0.45),
        violines2: mk(ch[3] + 24, 0.6, 0.075, 0.55),
      };
      this.layer.stoppers.push(w => { Object.values(this.layer.secs).forEach(s => s.stop(w)); tl.stop(w + 3); });
      this.chordEnd = 0;
    }
    if (this.mode === 'esferas') {
      const H = this.harmony(F); const f0 = mtof(36 + H.root);
      const names = ['Tin', 'theta', 'CO2', 'light', 'RH', 'EC', 'bio'];
      this.planets = names.map((k, idx) => {
        const o = c.createOscillator(); o.type = 'sine';
        const o2 = c.createOscillator(); o2.type = 'sine';
        const g = c.createGain(); g.gain.value = 0; const g2 = c.createGain(); g2.gain.value = 0.18;
        const p = c.createStereoPanner();
        o.frequency.value = f0 * (2 + idx); o2.frequency.value = f0 * (2 + idx) * 2.0;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(p); p.connect(bus);
        o.start(t); o2.start(t);
        return { k, o, o2, g, p, n: 2 + idx, ph: Math.random() * 6.28, r: 0.25 + idx * 0.1, speed: 0.04 + 0.03 * (7 - idx) / 7, val: 0.5 };
      });
      // la armonía del mundo: un pedal de quintas que respira
      const pedal = [1, 1.5, 2, 3].map((r, i) => { const o = c.createOscillator(); o.frequency.value = f0 * r; o.detune.value = (i - 1.5) * 2; const g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.025 / (1 + i * 0.4), t, 3); o.connect(g); g.connect(bus); o.start(t); return { o, g }; });
      this.layer.pedal = pedal; this.layer.f0 = f0;
      this.layer.stoppers.push(w => { this.planets.forEach(pl => { pl.g.gain.setTargetAtTime(0, w, 0.6); pl.o.stop(w + 3); pl.o2.stop(w + 3); }); pedal.forEach(q => { q.g.gain.setTargetAtTime(0, w, 0.6); q.o.stop(w + 3); }); });
    }
    if (this.mode === 'respira') {
      const H = this.harmony(F);
      const n = this.noise(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.9;
      const bp2 = c.createBiquadFilter(); bp2.type = 'lowpass'; bp2.frequency.value = 2400;
      const bg = c.createGain(); bg.gain.value = 0; n.connect(bp); bp.connect(bp2); bp2.connect(bg); bg.connect(bus); n.start(t);
      // cuerpo: dron grave que se abre con el aliento
      const dron = [0, 7, 12].map((iv, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(24 + H.root + iv); o.detune.value = i * 4 - 4; return o; });
      const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 140; dlp.Q.value = 2;
      const dg = c.createGain(); dg.gain.value = 0; dg.gain.setTargetAtTime(0.07, t, 2);
      dron.forEach(o => { o.connect(dlp); o.start(t); }); dlp.connect(dg); dg.connect(bus);
      // voz: fuente glotal y tres formantes
      const vo = c.createOscillator(); vo.type = 'sawtooth'; vo.frequency.value = mtof(52 + H.root);
      const vl = c.createOscillator(); vl.frequency.value = 5.1; const vlg = c.createGain(); vlg.gain.value = 2.2; vl.connect(vlg); vlg.connect(vo.frequency);
      const forms = [730, 1090, 2440].map((fr, i) => { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = 9 + i * 3; const g = c.createGain(); g.gain.value = [1, 0.55, 0.25][i]; vo.connect(b); b.connect(g); return { b, g }; });
      const vg = c.createGain(); vg.gain.value = 0; forms.forEach(f => f.g.connect(vg)); const vp = this.pan(0.1); vg.connect(vp); vp.connect(bus);
      vo.start(t); vl.start(t);
      Object.assign(this.layer, { bg, bp, dlp, dg, vo, vg, forms, dron });
      this.layer.stoppers.push(w => { bg.gain.setTargetAtTime(0, w, 0.4); dg.gain.setTargetAtTime(0, w, 0.5); vg.gain.setTargetAtTime(0, w, 0.4); [n, vo, vl, ...dron].forEach(o => o.stop(w + 3)); });
      this.breathT = t + 0.3; this.heartT = t + 1;
    }
    if (this.mode === 'paisaje') {
      const mkNoise = (type, f, q) => { const n = this.noise(); const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = c.createGain(); g.gain.value = 0; n.connect(b); b.connect(g); g.connect(bus); n.start(t); return { n, b, g }; };
      const viento = mkNoise('lowpass', 400, 0.7), silbido = mkNoise('bandpass', 900, 14), lluvia = mkNoise('highpass', 2200, 0.5), lluviaG = mkNoise('lowpass', 500, 0.5);
      const ventilador = mkNoise('bandpass', 320, 2), niebla = mkNoise('highpass', 5000, 0.7);
      const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100; const hlp = c.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 380; const hg = c.createGain(); hg.gain.value = 0; hum.connect(hlp); hlp.connect(hg); hg.connect(bus); hum.start(t);
      const cri = c.createOscillator(); cri.frequency.value = 4350; const crg = c.createGain(); crg.gain.value = 0;
      const gate = c.createOscillator(); gate.type = 'square'; gate.frequency.value = 27; const gg = c.createGain(); gg.gain.value = 0.5; gate.connect(gg);
      const cam = c.createGain(); cam.gain.value = 0.5; gg.connect(cam.gain); cri.connect(cam); cam.connect(crg); const crp = this.pan(0.5); crg.connect(crp); crp.connect(bus); cri.start(t); gate.start(t);
      Object.assign(this.layer, { viento, silbido, lluvia, lluviaG, ventilador, niebla, hg, crg, gate });
      this.layer.stoppers.push(w => { [viento, silbido, lluvia, lluviaG, ventilador, niebla].forEach(x => { x.g.gain.setTargetAtTime(0, w, 0.4); x.n.stop(w + 3); }); hg.gain.setTargetAtTime(0, w, 0.3); crg.gain.setTargetAtTime(0, w, 0.3); [hum, cri, gate].forEach(o => o.stop(w + 3)); });
    }
  }
  teardown() {
    const L = this.layer; if (!L) return;
    const w = this.ctx.currentTime;
    L.stoppers.forEach(f => f(w));
    L.bus.gain.setTargetAtTime(0, w + 0.6, 0.5);
    setTimeout(() => { try { L.bus.disconnect(); } catch (e) {} }, 4000);
    this.midiAllOff();
    this.layer = null;
  }

  /* ─────────── el pulso: cada 90 ms lee al organismo y agenda sonido ─────────── */
  tick() {
    if (!this.on || !this.layer || !this.F) return;
    const c = this.ctx, F = this.F, now = c.currentTime, ahead = now + 0.3;
    const ev = this.queue.splice(0);
    if (this.mode === 'sinfonia') this.tickSinfonia(F, ev, now, ahead);
    if (this.mode === 'esferas') this.tickEsferas(F, ev, now);
    if (this.mode === 'respira') this.tickRespira(F, ev, now, ahead);
    if (this.mode === 'paisaje') this.tickPaisaje(F, ev, now, ahead);
    const cut = now - 14; while (this.roll.length && this.roll[0].t + this.roll[0].dur < cut) this.roll.shift();
  }

  tickSinfonia(F, ev, now, ahead) {
    const L = this.layer, H = this.harmony(F);
    const bpm = 44 + 34 * F.Tin_n + 14 * F.vig;
    const spb = 60 / bpm;
    // dinámica: la luz es el crescendo; el CO₂ es la respiración lenta de la sección
    const lvl = 0.55 + 0.45 * F.light;
    const breath = 1 + 0.18 * Math.sin(now * 2 * Math.PI * (0.05 + 0.08 * Math.min(1, Math.abs(F.dCO2) / 120)));
    L.swell.gain.setTargetAtTime(lvl * breath, now, 0.6);
    L.tremG.gain.setTargetAtTime(0.45 * Math.max(0, F.vig - 0.15), now, 0.4);
    const S = L.secs;
    S.violas.setBright(0.3 + 0.5 * F.EC_n, now); S.violines2.setBright(0.35 + 0.55 * F.EC_n, now);
    for (const e of ev) {
      if (e === 'pump:on') { this.arpeggio(H, ahead, F, 1); }
      if (e === 'pump:off') this.arpeggio(H, ahead, F, -1);
      if (e === 'fert:on') this.pluck(84 + H.root, ahead + 0.1, 0.5, 0.5);
      if (e === 'salva' || e === 'evento:fin') this.chordEnd = 0;                  // resolver
      if (e.startsWith('evento:') && e !== 'evento:fin') { this.timpani(36 + H.root + 7, ahead, 0.9); this.timpani(36 + H.root, ahead + spb, 0.8); }
      if (e === 'cosecha') [0, 4, 7, 12].forEach((iv, k) => this.pluck(72 + H.root + iv, ahead + k * 0.12, 0.7, 0.3));
    }
    while (this.nextBeat < ahead) {
      const t = this.nextBeat;
      // cambio de acorde
      if (t >= this.chordEnd) {
        this.prevDeg = this.deg;
        let next;
        if (F.vig > 0.45) next = this.caos(F.bio) < 0.7 ? 4 : 6;                     // tensión: dominante sostenida
        else if (this.prevDeg === 4 || this.prevDeg === 6) next = 0;                 // la crisis pasa: cadencia
        else { const opts = MARKOV[this.deg]; next = opts[Math.floor(this.caos(F.bio + F.theta_n) * opts.length) % opts.length]; }
        this.deg = next;
        const ch = this.chordNotes(H, this.deg, 36, 4);
        const bass = this.nearest(S.contrabajo.midi, [ch[0], ch[0] + 12].filter(m => m >= 33 && m <= 52));
        S.contrabajo.setNote(bass, t, 0.08);
        const pool = (lo, hi) => { const r = []; for (const m of ch) for (let o = -24; o <= 36; o += 12) if (m + o >= lo && m + o <= hi) r.push(m + o); return r; };
        S.cellos.setNote(this.nearest(S.cellos.midi, pool(45, 64)), t, 0.12);
        S.violas.setNote(this.nearest(S.violas.midi, pool(55, 72)), t, 0.12);
        S.violines2.setNote(this.nearest(S.violines2.midi, pool(64, 81)), t, 0.12);
        const bars = F.vig > 0.4 ? 1 : (F.light < 0.1 ? 4 : 2);
        this.chordEnd = t + bars * 4 * spb;
        this.chordLabel = `${KEY_NAMES[H.root]} ${H.modo} · ${DEG_NAMES[this.deg]}`;
        [bass, S.cellos.midi, S.violas.midi, S.violines2.midi].forEach((m, k) => this.mark(m, t, bars * 4 * spb, ['contrabajo', 'cellos', 'violas', 'violines2'][k], 0.5));
        this.midiChord([bass, S.cellos.midi, S.violas.midi, S.violines2.midi], t, bars * 4 * spb);
      }
      // melodía de violín: densidad = luz y agitación bioeléctrica
      const dens = 0.12 + 0.55 * F.light * (0.4 + 0.6 * Math.min(1, Math.abs(F.bio) / 1.5)) + 0.15 * F.vig;
      if (this.caos(F.bio) < dens) {
        const ch = this.chordNotes(H, this.deg, 72, 3);
        const strong = this.beat % 2 === 0;
        const step = Math.round(F.bio * 1.4 + (this.caos() - 0.5) * 3.2);
        this.melo = Math.max(0, Math.min(16, this.melo + (step === 0 ? 1 : step)));
        const oct = Math.floor(this.melo / 7), d = this.melo % 7;
        let m = 72 + H.root - 12 + H.sc[d] + 12 * oct;
        if (strong) m = this.nearest(m, ch.concat(ch.map(x => x + 12), ch.map(x => x - 12)));
        const durBeats = this.caos() < 0.6 ? 1 : this.caos() < 0.7 ? 2 : 0.5;
        this.bowNote(m, t, durBeats * spb * 0.95, 0.35 + 0.5 * F.light + 0.15 * F.vig);
        if (durBeats === 0.5 && this.caos() < 0.5) this.bowNote(m + (this.caos() < 0.5 ? 2 : -1), t + spb / 2, spb * 0.45, 0.4 + 0.4 * F.light);
      }
      // arpa del agua del suelo; pizzicato de lluvia
      if (this.caos(F.theta_n) < 0.06 + 0.22 * F.theta_n) { const ch = this.chordNotes(H, this.deg, 60, 4); this.pluck(ch[Math.floor(this.caos() * 4) % 4] + 12, t + spb * 0.5, 0.35 + 0.3 * F.theta_n, (this.caos() - 0.5)); }
      if (F.rain_n > 0.02) { const k = Math.floor(F.rain_n * 4 + this.caos()); const ch = this.chordNotes(H, this.deg, 60, 4); for (let j = 0; j < k; j++) this.pluck(ch[j % 4] + 12 * (j % 2), t + spb * (j / Math.max(1, k)), 0.5, 0.6 - j * 0.3, 'pizz'); }
      // latido de timbal en vigilia
      if (F.vig > 0.2 && this.beat % 2 === 0) { this.timpani(36 + H.root + 7, t, 0.35 + 0.6 * F.vig); this.timpani(36 + H.root, t + spb * 0.42, 0.25 + 0.5 * F.vig); }
      if (F.wind_n > 0.55 && this.caos() < F.wind_n - 0.4) for (let j = 0; j < 6; j++) this.timpani(36 + H.root, t + j * spb / 6, 0.12 + 0.05 * j);
      this.nextBeat += spb; this.beat++;
    }
  }
  midiChord(notes, t, dur) { if (!this.midiOut) return; notes.forEach((m, k) => this.midiNote(k === 0 ? 2 : 1, m, 0.5, t, dur * 0.98)); }
  arpeggio(H, t, F, dir) {
    const ch = this.chordNotes(H, this.deg, 48, 4);
    const notes = [];
    for (let o = 0; o < 3; o++) ch.forEach(m => notes.push(m + 12 * o));
    if (dir < 0) notes.reverse();
    notes.forEach((m, k) => this.pluck(m, t + k * 0.085, 0.55 + 0.3 * (k / notes.length), -0.6 + 1.2 * k / notes.length));
  }

  tickEsferas(F, ev, now) {
    const H = this.harmony(F), f0 = mtof(36 + H.root);
    const vals = { Tin: F.Tin_n, theta: F.theta_n, CO2: F.CO2_n, light: F.light, RH: F.RH_n, EC: F.EC_n, bio: 0.5 + F.bio / 6 };
    const HARM = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16];
    const pedal = this.layer.pedal;
    pedal.forEach((q, i) => q.o.frequency.setTargetAtTime(f0 * [1, 1.5, 2, 3][i], now, 4));
    this.planets.forEach((pl, idx) => {
      const v = Math.max(0, Math.min(1, vals[pl.k]));
      pl.val = v;
      const n = HARM[Math.round(v * (HARM.length - 1))];
      if (n !== pl.n) { this.bell(f0 * n * 2, now + 0.05, 0.45, Math.sin(pl.ph), 3.5, 5); pl.n = n; this.mark(Math.round(69 + 12 * Math.log2(f0 * n / 440)), now, 2, 'esfera', 0.6); }
      pl.o.frequency.setTargetAtTime(f0 * n, now, 2.5); pl.o2.frequency.setTargetAtTime(f0 * n * 2.003, now, 2.5);
      pl.ph += pl.speed * (0.4 + Math.abs(F.bio) * 0.2 + F.light * 0.6) * 0.09 * 2 * Math.PI / 6;
      const a = 0.045 / Math.sqrt(1 + idx * 0.4) * (0.55 + 0.45 * Math.sin(pl.ph)) * (0.5 + 0.5 * F.light + 0.3);
      pl.g.gain.setTargetAtTime(a, now, 0.25);
      pl.p.pan.setTargetAtTime(Math.cos(pl.ph) * 0.8, now, 0.25);
    });
    for (const e of ev) {
      if (e === 'pump:on') [1, 2, 3, 4, 5].forEach((k, j) => this.bell(f0 * k * 4, now + j * 0.18, 0.4, j / 2 - 1, 1.4, 3));
      if (e.startsWith('evento:')) this.bell(f0 * 2, now, 0.9, 0, 2.76, 9);
      if (e === 'cosecha') [4, 5, 6, 8].forEach((k, j) => this.bell(f0 * k * 2, now + j * 0.25, 0.6, 0, 3.5, 6));
    }
    if (F.vig > 0.3 && this.caos(F.bio) < 0.08 * F.vig) this.bell(f0 * 1.5 * 4, now, 0.5 * F.vig, 0, 1.41, 2);
    if (F.rain_n > 0 && this.caos() < F.rain_n * 0.5) this.bell(f0 * [6, 8, 9, 12][Math.floor(this.caos() * 4) % 4] * 2, now, 0.2, this.caos() - 0.5, 3.5, 1.5);
  }

  tickRespira(F, ev, now, ahead) {
    const L = this.layer, H = this.harmony(F);
    // aliento: de día inhala CO₂ (fotosíntesis), de noche exhala (respiración)
    if (this.breathT < ahead) {
      const per = 4.5 + 6 * (1 - F.light) + 3 * (1 - F.vig) - 2.5 * F.vig;
      const t = Math.max(this.breathT, now), inh = per * (F.dCO2 < 0 ? 0.55 : 0.38), exh = per - inh;
      const depth = 0.05 + 0.12 * Math.min(1, Math.abs(F.dCO2) / 150) + 0.05 * F.vig;
      L.bg.gain.cancelScheduledValues(t); L.bg.gain.setValueAtTime(L.bg.gain.value, t);
      L.bg.gain.linearRampToValueAtTime(depth * (F.dCO2 < 0 ? 1 : 0.6), t + inh);
      L.bg.gain.linearRampToValueAtTime(depth * (F.dCO2 < 0 ? 0.6 : 1), t + inh + exh * 0.25);
      L.bg.gain.linearRampToValueAtTime(0.004, t + per);
      L.bp.frequency.setTargetAtTime(600 + 900 * F.RH_n, t, inh / 2);
      L.bp.frequency.setTargetAtTime(500 + 600 * F.RH_n, t + inh, exh / 3);
      L.dlp.frequency.setTargetAtTime(110 + 260 * F.light, t, inh / 2);
      L.dlp.frequency.setTargetAtTime(90 + 120 * F.light, t + inh, exh / 2);
      this.breathT = t + per;
      this.mark(48 + H.root, t, per, 'aliento', depth * 5);
      // la voz canta una frase por respiración
      if (this.caos(F.bio) < 0.45 + 0.4 * F.light) {
        const step = Math.round(F.bio * 1.5 + (this.caos() - 0.5) * 3);
        this.melo = Math.max(0, Math.min(11, this.melo + step));
        const m = 52 + H.root + H.sc[this.melo % 7] + 12 * Math.floor(this.melo / 7) - (F.light < 0.2 ? 12 : 0);
        L.vo.frequency.setTargetAtTime(mtof(m), t, 0.25);
        L.vg.gain.setTargetAtTime(0.0, t, 0.1);
        L.vg.gain.setTargetAtTime(0.05 + 0.05 * F.light, t + 0.2, inh / 3);
        L.vg.gain.setTargetAtTime(0, t + inh + exh * 0.4, exh / 4);
        const V = F.stress > 0.45 ? [270, 2290, 3010] : F.light > 0.5 ? [730, 1090, 2440] : F.light > 0.1 ? [570, 840, 2410] : [300, 870, 2240];
        L.forms.forEach((f, i) => f.b.frequency.setTargetAtTime(V[i], t, 0.6));
        this.mark(m, t + 0.2, inh + exh * 0.4, 'voz', 0.6);
      }
    }
    // corazón
    const bpm = 34 + 22 * F.Tin_n + 70 * F.vig;
    while (this.heartT < ahead) {
      const t = Math.max(this.heartT, now);
      const amp = 0.25 + 0.6 * F.vig + 0.1 * F.light;
      this.thump(t, 58, amp); this.thump(t + 0.24, 46, amp * 0.7);
      this.mark(30, t, 0.3, 'latido', amp);
      this.heartT = t + 60 / bpm;
    }
    for (const e of ev) {
      if (e === 'pump:on') for (let j = 0; j < 14; j++) this.blip(300 + this.caos() * 500, now + j * 0.11 + this.caos() * 0.05, 0.09, 0.05, this.caos() - 0.5);
      if (e === 'heat:on') this.blip(110, now, 1.6, 0.06, 0);
      if (e.startsWith('evento:') && e !== 'evento:fin') { this.thump(now + 0.05, 40, 1.2); this.thump(now + 0.3, 35, 0.9); }
    }
  }
  thump(t, f, amp) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * amp, t + 0.008); g.gain.setTargetAtTime(0, t + 0.02, 0.09);
    o.connect(g); g.connect(this.layer.bus); o.start(t); o.stop(t + 0.8); o.onended = () => g.disconnect();
  }

  tickPaisaje(F, ev, now, ahead) {
    const L = this.layer;
    const gust = 0.6 + 0.4 * Math.sin(now * 0.7) * Math.sin(now * 0.23 + 1);
    L.viento.g.gain.setTargetAtTime(0.02 + 0.22 * Math.pow(F.wind_n, 1.4) * gust, now, 0.5);
    L.viento.b.frequency.setTargetAtTime(220 + 900 * F.wind_n * gust, now, 0.5);
    L.silbido.g.gain.setTargetAtTime(F.wind_n > 0.45 ? 0.04 * (F.wind_n - 0.45) * gust : 0, now, 0.6);
    L.silbido.b.frequency.setTargetAtTime(700 + 600 * gust, now, 0.8);
    L.lluvia.g.gain.setTargetAtTime(0.16 * Math.sqrt(F.rain_n), now, 0.8);
    L.lluviaG.g.gain.setTargetAtTime(0.12 * Math.sqrt(F.rain_n), now, 0.8);
    L.ventilador.g.gain.setTargetAtTime(F.acts.fan ? 0.05 : 0, now, 0.6);
    L.niebla.g.gain.setTargetAtTime(F.acts.mist ? 0.05 : 0, now, 0.4);
    L.hg.gain.setTargetAtTime(F.acts.pump ? 0.03 : 0, now, 0.4);
    const crick = F.elev < -0.05 && F.Tout > 10 ? 0.012 * Math.min(1, (F.Tout - 10) / 6) : 0;
    L.crg.gain.setTargetAtTime(crick * (0.6 + 0.4 * Math.sin(now * 1.3)), now, 0.3);
    L.gate.frequency.setTargetAtTime(18 + 1.6 * F.Tout, now, 2);
    // aves: coro del alba y del crepúsculo, menos en invierno, nada con lluvia fuerte
    const dawn = Math.exp(-Math.pow((F.elev - 0.05) / 0.12, 2));
    const birdRate = (0.08 + 1.2 * dawn + 0.25 * Math.max(0, F.light - 0.1)) * (F.season === 'invierno' ? 0.4 : 1) * (1 - Math.min(1, F.rain_n * 1.5)) * (F.elev > -0.1 ? 1 : 0);
    if (this.birdT < ahead) {
      if (this.caos() < birdRate * 0.6) this.chirp(ahead, 2200 + this.caos() * 3800, Math.floor(this.caos() * 3));
      this.birdT = ahead + 0.12;
    }
    // gotas sobre el plástico y goteo del riego
    const drops = F.rain_n * 18 + (F.acts.pump ? 6 : 0);
    if (this.caos() < drops * 0.09) this.blip(F.acts.pump && this.caos() < 0.6 ? 900 + this.caos() * 900 : 2500 + this.caos() * 3500, ahead + this.caos() * 0.08, 0.025, 0.04, this.caos() * 1.6 - 0.8);
    for (const e of ev) {
      if (e.startsWith('vent:')) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(520, now); o.frequency.linearRampToValueAtTime(e === 'vent:on' ? 760 : 440, now + 1.1); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.02, now + 0.1); g.gain.setTargetAtTime(0, now + 1.0, 0.1); o.connect(g); g.connect(L.bus); o.start(now); o.stop(now + 1.6); }
      if (e === 'heat:on') this.blip(60, now, 0.8, 0.08, 0, 'square');
    }
  }

  /* ─────────── qué traduce cada voz, en este instante ─────────── */
  mapping(F, S) {
    if (!F || !S) return [];
    const f1 = (x, d = 1) => x.toFixed(d);
    if (this.mode === 'sinfonia') return [
      ['Contrabajo y cellos', 'grado armónico guiado por el agua del suelo', `${f1(S.theta)} %`],
      ['Violas y violines II', 'brillo del timbre según nutrientes', `${f1(S.EC, 2)} mS/cm`],
      ['Violín solista', 'potencial eléctrico de la hoja', `${f1(S.mv)} mV`],
      ['Pulso', 'tempo según temperatura interior', `${Math.round(44 + 34 * F.Tin_n + 14 * F.vig)} bpm · ${f1(S.Tin)} °C`],
      ['Crescendo', 'luz fotosintética', `${Math.round(S.PAR)} µmol/m²·s`],
      ['Respiración de la sección', 'ritmo del CO₂', `${Math.round(S.CO2)} ppm`],
      ['Arpa', 'cada riego, en arpegio', F.acts.pump ? 'regando' : 'en espera'],
      ['Pizzicato', 'lluvia sobre el techo', `${f1(S.rain)} mm/h`],
      ['Timbales', 'vigilia y temporal', F.vig > 0.2 ? 'latiendo' : 'en silencio'],
    ];
    if (this.mode === 'esferas') return this.planets.map(p => [({ Tin: 'Esfera del calor', theta: 'Esfera del agua', CO2: 'Esfera del aire', light: 'Esfera de la luz', RH: 'Esfera de la niebla', EC: 'Esfera de la tierra', bio: 'Esfera de la hoja' })[p.k], 'armónico ' + p.n + ' sobre la fundamental', ({ Tin: `${f1(S.Tin)} °C`, theta: `${f1(S.theta)} %`, CO2: `${Math.round(S.CO2)} ppm`, light: `${Math.round(S.PAR)} µmol`, RH: `${f1(S.RHin, 0)} %`, EC: `${f1(S.EC, 2)} mS/cm`, bio: `${f1(S.mv)} mV` })[p.k]]);
    if (this.mode === 'respira') return [
      ['Aliento', F.dCO2 < 0 ? 'inhala: la planta fotosintetiza' : 'exhala: la planta respira', `${F.dCO2 > 0 ? '+' : ''}${Math.round(F.dCO2)} ppm/h`],
      ['Timbre del aliento', 'humedad del aire', `${f1(S.RHin, 0)} %`],
      ['Corazón', 'temperatura y vigilia', `${Math.round(34 + 22 * F.Tin_n + 70 * F.vig)} lpm`],
      ['Cuerpo', 'luz que abre el dron grave', `${Math.round(S.PAR)} µmol`],
      ['Voz', F.stress > 0.45 ? 'vocal tensa: estrés' : 'vocal según la hora', `${f1(S.mv)} mV`],
      ['Gorgoteo', 'agua entrando al suelo', F.acts.pump ? 'regando' : '—'],
    ];
    return [
      ['Viento', 'anemómetro exterior', `${f1(S.wind)} m/s`],
      ['Lluvia', 'pluviómetro sobre el techo', `${f1(S.rain)} mm/h`],
      ['Aves', 'sol en el horizonte', `${f1(F.elev * 180 / Math.PI, 0)}° de elevación`],
      ['Grillos', 'noche tibia', `${f1(S.Tout)} °C afuera`],
      ['Máquina', 'bomba, ventilador, niebla, ventanas', Object.entries(F.acts).filter(([k, v]) => v && ['pump', 'fan', 'mist'].includes(k)).map(([k]) => ({ pump: 'bomba', fan: 'ventilador', mist: 'niebla' })[k]).join(', ') || 'quieta'],
    ];
  }
}
