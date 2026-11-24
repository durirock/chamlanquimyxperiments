// Killer Pendiente — app web (celular y PC). Mismos datos que KP del PC vía Firebase.
// Reglas de premiación idénticas a kp828.py:
//   · nivel: costo(N→N+1) = 50·N·(N+1)
//   · calibración al cerrar con el timer: sobraba ≥50% → x1.5 · ≥20% → x1.2 · cada extensión pedida → x0.85
//     (si el reloj llegó a 00:00 no hay bono por adelantarse)
//   · "listo" antes de max(60 s, 5% del tiempo) → ¿dónde lo hiciste? (en mi vida / aquí / volver)
//   · cierre "en mi vida": sin multiplicador de calibración
//   · objetivo semanal: los Pv van a todos los aspectos (salvo Dios) y se marca completado en todos
//   · recompensas (is_reward / prioridad R): se usan, no dan Pv; si tienen duración abren un timer
(function () {
  'use strict';

  // ══ reglas de KP (kp828.py) ══════════════════════════════════════
  const NIVEL_XP_BASE = 50;
  const BONUS_TEMPRANO_ALTO = 1.5;     // sobraba 50% o más del tiempo del timer
  const BONUS_TEMPRANO_MEDIO = 1.2;    // sobraba entre 20% y 50%
  const PENALIZACION_POR_EXTENSION = 0.85;
  const CIERRE_DETECTADO_SEG = 60;
  const CIERRE_DETECTADO_FRACCION = 0.05;
  const SEG_CALENTAMIENTO = 120;       // "Solo 2 minutos" (umbral; no cambia las reglas de Pv)

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dos = (n) => String(n).padStart(2, '0');
  const ahoraMs = () => Date.now();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'w' + Math.random().toString(16).slice(2) + Date.now().toString(16));
  const azar = (a) => a[Math.floor(Math.random() * a.length)];
  const mmss = (s) => `${dos(Math.floor(s / 60))}:${dos(s % 60)}`;
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let db, auth, FV;
  let yo = null;
  const st = {
    aspectos: {}, tareas: {}, general: [], privEnv: {}, privRec: {}, correosRec: {}, correosEnv: {}, dhana: {},
    sala: 'General', bandeja: 'entrada', verCompletadas: false, desuscribir: [], filtro: 'todas',
    panel: 'ahora', red: 'chat', sugerida: 0,
    bitP: {}, bitC: {}, bitG: {}, mega: { activa: null, historial: [] }, bit: 'personal', bitModo: 'general', bitBuscar: ''
  };

  // ══ preferencias locales ═════════════════════════════════════════
  const PREF0 = { flotar: true, sonido: true, pantalla: true, tema: 'auto' };
  let pref = Object.assign({}, PREF0);
  try { pref = Object.assign(pref, JSON.parse(localStorage.getItem('kp_prefs') || '{}')); } catch (e) { }
  const guardarPref = () => { try { localStorage.setItem('kp_prefs', JSON.stringify(pref)); } catch (e) { } };

  // ══ fechas (mismos formatos que KP) ══════════════════════════════
  function fechaKP(d = new Date()) { return `${dos(d.getDate())}-${dos(d.getMonth() + 1)}-${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`; }
  function fechaDia(d = new Date()) { return `${dos(d.getDate())}-${dos(d.getMonth() + 1)}-${d.getFullYear()}`; }
  function fechaISO(d = new Date()) { return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`; }
  function leerFecha(s) {
    if (!s) return null;
    let m = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return null;
  }
  function diasDesde(s) { const d = leerFecha(s); return d ? Math.max(0, Math.floor((Date.now() - d) / 86400000)) : 0; }

  // ══ cálculos de KP ═══════════════════════════════════════════════
  function nivel(xp) {
    let n = 1, resto = xp || 0, sig = NIVEL_XP_BASE * n * (n + 1);
    while (resto >= sig) { resto -= sig; n += 1; sig = NIVEL_XP_BASE * n * (n + 1); }
    return { n, resto, sig };
  }
  function presion(t) {
    const dias = diasDesde(t.date_added);
    const peso = { A: 3, B: 2, C: 1 }[t.priority] || 1;
    const pv = Math.min(t.xp || 0, 100);
    return Math.round(dias * peso * (1 + (t.delays || 0) * 0.3) * (1 + pv / 200));
  }
  function colorPresion(p) {
    const k = Math.min(1, Math.log1p(p) / Math.log1p(400));
    const a = [88, 196, 106], b = [245, 200, 66], c = [150, 20, 40];
    const mezcla = (x, y, q) => x.map((v, i) => Math.round(v + (y[i] - v) * q));
    const r = k < 0.5 ? mezcla(a, b, k * 2) : mezcla(b, c, (k - 0.5) * 2);
    return `rgb(${r.join(',')})`;
  }
  function multiplicadorCalibracion(t, fraccionRestante) {
    let m = 1;
    if (fraccionRestante >= 0.5) m *= BONUS_TEMPRANO_ALTO;
    else if (fraccionRestante >= 0.2) m *= BONUS_TEMPRANO_MEDIO;
    const ap = t.delays || 0;
    if (ap > 0) m *= Math.pow(PENALIZACION_POR_EXTENSION, ap);
    return m;
  }
  const esPremio = (t) => !!(t && (t.is_reward || t.priority === 'R'));
  const otros = () => Object.keys(st.aspectos).filter((u) => u !== yo && u !== 'Dios').sort();
  const _cc = document.createElement('canvas').getContext('2d'), _hex = {};
  function hex6(c) {                    // cualquier color CSS → #rrggbb (el canvas lo necesita así)
    if (!c) return '#7dffb0';
    if (_hex[c]) return _hex[c];
    _cc.fillStyle = '#7dffb0'; _cc.fillStyle = String(c);
    const v = /^#[0-9a-f]{6}$/i.test(_cc.fillStyle) ? _cc.fillStyle : '#7dffb0';
    return (_hex[c] = (v.toLowerCase() === '#000000' ? '#7dffb0' : v));   // negro = sin color en KP
  }
  const colorDe = (u) => hex6(st.aspectos[u] && st.aspectos[u].color);
  const miAspecto = () => st.aspectos[yo] || {};
  const refYo = () => db.collection('aspectos').doc(yo);
  const refTarea = (id, u = yo) => db.collection('aspectos').doc(u).collection('tareas').doc(id);

  // ══ palabras ═════════════════════════════════════════════════════
  const FRASES_AHORA = [
    'No hay que ganar la guerra hoy. Solo esta batalla.',
    'Dos minutos bastan para cruzar el umbral.',
    'EgoSombra no soporta un pendiente cerrado.',
    'El cuerpo sabe empezar antes de que la mente esté lista.',
    'York lo vio desde 2044: el que empieza ya cambió el futuro.',
    'La Colmena espera que lo dejes para mañana.',
    'Una sola cosa. Bien hecha. Ahora.'
  ];
  const ALIENTO = [
    'Respira. Vuelve a la hoja. La espada sigue en tu mano.',
    'Distraerse es humano. Volver es el entrenamiento.',
    'Cada retorno vale más que la perfección.',
    'Mushin: solo esto, ahora.',
    'Lo que haces ahora le llega a York.',
    'No es contra ti. Es a favor de lo que viene.',
    'El foco no se tiene: se recupera, una y otra vez.'
  ];
  const CIERRE = [
    'Un pendiente menos en la Colmena.',
    'El Sol de la Voluntad creció un poco.',
    'Esa gestalt se cerró. Siente el espacio que dejó.',
    'EgoSombra perdió una hebra.',
    'El tú de mañana te lo agradece.',
    'Esto es poder personal: hacer lo que dijiste.',
    'Lo hecho ya no se puede deshacer. Es tuyo.'
  ];
  const YORK = [
    'Las cosas pequeñas sostuvieron todo. Sigue.',
    'Aquí recordamos el día en que dejaste de castigarte y empezaste a cerrar.',
    'La Colmena nunca entendió esto: un acto terminado no se puede disolver.',
    'Cada tarea que cierras abre una ruta que aquí ya existe.',
    'Tu voluntad de hoy es la energía con que encendemos las ciudades.'
  ];

  // ══ utilidades de interfaz ═══════════════════════════════════════
  function avisar(txt, ms = 2600) {
    const a = $('#aviso'); a.textContent = txt; a.classList.remove('oculto');
    clearTimeout(avisar._t); avisar._t = setTimeout(() => a.classList.add('oculto'), ms);
  }
  let alCerrarHoja = null;
  function abrirHoja(html, alMontar, alCerrar) {
    if (alCerrarHoja) { const f = alCerrarHoja; alCerrarHoja = null; f(); }
    $('#hoja').innerHTML = html; $('#hoja').classList.remove('oculto'); $('#velo').classList.remove('oculto');
    alCerrarHoja = alCerrar || null;
    if (alMontar) alMontar($('#hoja'));
  }
  function cerrarHoja() {
    $('#hoja').classList.add('oculto'); $('#velo').classList.add('oculto'); $('#hoja').innerHTML = '';
    if (alCerrarHoja) { const f = alCerrarHoja; alCerrarHoja = null; f(); }
  }
  $('#velo').onclick = cerrarHoja;

  // pregunta con botones en la hoja; devuelve el valor (o undefined si se cierra)
  function opcionesHoja(titulo, texto, opciones) {
    return new Promise((res) => {
      let listo = false;
      abrirHoja(`<h2>${esc(titulo)}</h2>${texto ? `<p class="sub">${esc(texto)}</p>` : ''}
        <div class="botones">${opciones.map((o, i) => `<button data-i="${i}" class="${o.pri ? 'primario' : ''}">${esc(o.t)}</button>`).join('')}</div>`,
        (h) => h.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { listo = true; cerrarHoja(); res(opciones[+b.dataset.i].v); }),
        () => { if (!listo) res(undefined); });
    });
  }
  // en PC con la ventana flotante abierta, pregunta ahí mismo; si no, en la hoja
  async function preguntaFlex(titulo, texto, opciones) {
    if (window.Flotante && Flotante.interactivo()) {
      const v = await Flotante.preguntar(titulo, texto, opciones);
      if (v !== undefined) return v;
    }
    return opcionesHoja(titulo, texto, opciones);
  }
  function pedirMinutos(titulo, texto) {
    return new Promise(async (res) => {
      if (window.Flotante && Flotante.interactivo()) {
        const v = await Flotante.preguntar(titulo, texto, [5, 10, 15, 25].map((m) => ({ t: m + ' min', v: m })).concat([{ t: 'ninguno', v: 0 }]));
        if (v !== undefined) { res(v > 0 ? v : null); return; }
      }
      let listo = false;
      abrirHoja(`<h2>${esc(titulo)}</h2><p class="sub">${esc(texto)}</p>
        <div class="opciones">${[5, 10, 15, 25, 45].map((m) => `<button data-m="${m}">${m} min</button>`).join('')}</div>
        <label>Otro<input id="h-num" type="number" min="1" inputmode="numeric"></label>
        <div class="botones"><button class="primario" id="h-ok">Aceptar</button><button id="h-no">Cancelar</button></div>`, (h) => {
        const fin = (v) => { listo = true; cerrarHoja(); res(v); };
        h.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => fin(+b.dataset.m));
        h.querySelector('#h-ok').onclick = () => { const v = parseInt(h.querySelector('#h-num').value, 10); fin(v > 0 ? v : null); };
        h.querySelector('#h-no').onclick = () => fin(null);
      }, () => { if (!listo) res(null); });
    });
  }

  // ══ sonido y tacto ═══════════════════════════════════════════════
  let audio = null;
  function ac() { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); return audio; }
  function tono(f, g, d, t0 = 0, tipo = 'sine') {
    const a = ac(), t = a.currentTime + t0, o = a.createOscillator(), v = a.createGain();
    o.frequency.value = f; o.type = tipo;
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(a.destination); o.start(t); o.stop(t + d + 0.1);
  }
  function gong() {
    if (pref.sonido) { try { [[110, .5, 7], [220.5, .28, 5], [303, .2, 4], [418, .12, 3], [592, .08, 2.2]].forEach(([f, g, d]) => tono(f, g, d)); } catch (e) { } }
    if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  }
  function campanas() {             // acorde ascendente breve: cierre
    if (pref.sonido) { try { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tono(f, .12, 1.4, i * .07, 'triangle')); } catch (e) { } }
    if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
  }
  function tic() { if (navigator.vibrate) navigator.vibrate(12); }

  // ══ partículas (detonación) ══════════════════════════════════════
  const fx = $('#fx'), fxc = fx.getContext('2d');
  let parts = [], fxOn = false;
  function tamFx() { const r = devicePixelRatio || 1; fx.width = innerWidth * r; fx.height = innerHeight * r; fxc.setTransform(r, 0, 0, r, 0, 0); }
  addEventListener('resize', tamFx); tamFx();
  function detonar(n = 110) {
    if (reducido) return;
    const cx = innerWidth / 2, cy = innerHeight * 0.42, cols = [colorDe(yo), '#7dffb0', '#ffffff', '#ffd27a'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 7;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, r: 1.5 + Math.random() * 3, c: azar(cols), v: 1 });
    }
    if (!fxOn) { fxOn = true; requestAnimationFrame(pasoFx); }
  }
  function pasoFx() {
    fxc.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.v > 0.02);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.985; p.v *= 0.975;
      fxc.globalAlpha = p.v; fxc.fillStyle = p.c; fxc.beginPath(); fxc.arc(p.x, p.y, p.r, 0, 7); fxc.fill();
    });
    fxc.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(pasoFx); else { fxOn = false; fxc.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ══ tema ═════════════════════════════════════════════════════════
  const TEMAS = ['auto', 'noche', 'amanecer', 'sol', 'washi', 'morado', 'beskar', 'ambar'];
  const SKINS = {
    auto: ['Según la hora', 'amanecer · sol · noche', ['#070b09', '#7dffb0', '#ffd27a']],
    noche: ['Noche', 'oscuro, el color de tu aspecto', ['#070b09', '#e6efe9', '#7dffb0']],
    amanecer: ['Amanecer', 'cálido y suave', ['#120b07', '#ffeedd', '#ffd27a']],
    sol: ['Sol · fósforo', 'alto contraste para el reflejo', ['#000000', '#b9ffcf', '#00ff66']],
    washi: ['Washi', 'papel japonés, sumi y bermellón · tu color en los detalles', ['#f4ecdc', '#22201b', '#b7282e']],
    morado: ['Morado', 'violeta profundo · tu color en los detalles', ['#120a1f', '#efe6ff', '#b07cff']],
    beskar: ['Beskar', 'acero frío · tu color en los detalles', ['#0c1014', '#dfe6ec', '#8fb8d0']],
    ambar: ['Ámbar', 'terminal ámbar · tu color en los detalles', ['#0d0904', '#ffd9a0', '#ffb347']]
  };
  function pintarSkins() {
    const c = $('#aj-skins'); if (!c) return;
    c.innerHTML = TEMAS.map((k) => { const [n, d, col] = SKINS[k];
      return `<button data-skin="${k}" class="skin ${pref.tema === k ? 'activa' : ''}" aria-pressed="${pref.tema === k}">
        <span class="muestra">${col.map((x) => `<i style="background:${x}"></i>`).join('')}</span><b>${n}</b><small>${d}</small></button>`; }).join('');
    c.querySelectorAll('[data-skin]').forEach((b) => b.onclick = () => { pref.tema = b.dataset.skin; guardarPref(); aplicarTema(); pintarSkins(); tic(); });
  }
  function temaPorHora() { const h = new Date().getHours(); return h >= 5 && h < 9 ? 'amanecer' : h >= 9 && h < 18 ? 'sol' : 'noche'; }
  function aplicarTema() {
    const t = pref.tema === 'auto' || !TEMAS.includes(pref.tema) ? temaPorHora() : pref.tema;
    document.documentElement.dataset.tema = t;
    $('#b-tema').title = 'Skin: ' + (SKINS[pref.tema] || SKINS.auto)[0] + (pref.tema === 'auto' ? ' (' + t + ')' : '');
  }
  $('#b-tema').onclick = () => { if (!TEMAS.includes(pref.tema)) pref.tema = 'auto'; pref.tema = TEMAS[(TEMAS.indexOf(pref.tema) + 1) % TEMAS.length]; guardarPref(); aplicarTema(); pintarSkins(); avisar('Skin: ' + SKINS[pref.tema][0]); };
  aplicarTema(); pintarSkins(); setInterval(aplicarTema, 10 * 60000);

  // ══ entrada ══════════════════════════════════════════════════════
  function iniciar() {
    const cfg = window.KP_FIREBASE || {};
    if (!cfg.apiKey || String(cfg.apiKey).indexOf('PEGA') === 0) { $('#e-error').textContent = 'Falta configurar Firebase en config.js.'; return; }
    firebase.initializeApp(cfg);
    auth = firebase.auth(); db = firebase.firestore(); FV = firebase.firestore.FieldValue;
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { });
    // La sesión de Firebase se comparte con kpmovil (mismo dominio). Al abrir la app no se entra sola:
    // se pregunta "Continuar como X" o "Entrar con otro aspecto". Tras escribir correo y clave, se entra directo.
    let primera = true;
    auth.onAuthStateChanged(async (u) => {
      const alAbrir = primera; primera = false;
      if (!u) { salirDeApp(); mostrarFormulario(); return; }
      try {
        const tok = await u.getIdTokenResult(true);
        const asp = tok.claims && tok.claims.aspecto;
        if (!asp) { $('#e-error').textContent = 'Esta cuenta no está ligada a un aspecto. Créala con: python kp_nube.py crear-cuenta'; auth.signOut(); return; }
        if (alAbrir && !entradaExplicita) { ofrecerContinuar(asp); return; }
        entrarApp(asp);
      } catch (e) { $('#e-error').textContent = 'No se pudo entrar: ' + e.message; }
    });
  }
  let entradaExplicita = false;
  // Gmail base: el de config.js o, si no está, el que este navegador aprendió en la primera entrada con correo completo
  function correoBase() {
    const c = (window.KP_CORREO_BASE || '').trim();
    if (c.includes('@')) return c;
    try { return localStorage.getItem('kp_correo_base') || ''; } catch (e) { return ''; }
  }
  function aprenderBase(correo) {
    const m = /^([^@+]+)(?:\+[^@]*)?@(.+)$/.exec((correo || '').trim());
    if (m) { try { localStorage.setItem('kp_correo_base', m[1] + '@' + m[2]); } catch (e) { } }
  }
  // "Ralok" → gmail+ralok@gmail.com (misma regla de alias que crear_cuentas.py y kpmovil)
  function correoDe(txt) {
    txt = (txt || '').trim();
    const base = correoBase();
    if (txt.includes('@') || !base.includes('@')) return txt;
    const alias = txt.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'aspecto';
    const [local, dominio] = base.split('@');
    return local.split('+')[0] + '+' + alias + '@' + dominio;
  }
  function mostrarFormulario() {
    $('#e-recordado').classList.add('oculto'); $('#f-entrada').classList.remove('oculto');
  }
  function ofrecerContinuar(asp) {
    $('#e-nombre').textContent = asp;
    $('#e-recordado').classList.remove('oculto'); $('#f-entrada').classList.add('oculto');
    $('#e-continuar').onclick = () => { entradaExplicita = true; entrarApp(asp); };
    $('#e-otro').onclick = async () => { entradaExplicita = true; await auth.signOut(); mostrarFormulario(); setTimeout(() => $('#e-correo').focus(), 50); };
  }
  $('#f-entrada').onsubmit = async (ev) => {
    ev.preventDefault(); $('#e-error').textContent = ''; entradaExplicita = true;
    try {
      const correo = correoDe($('#e-correo').value);
      await auth.signInWithEmailAndPassword(correo, $('#e-clave').value);
      if (correo.includes('@')) aprenderBase(correo);
    }
    catch (e) { $('#e-error').textContent = correoBase().includes('@') || $('#e-correo').value.includes('@') ? 'Aspecto o contraseña incorrectos.' : 'La primera vez en este navegador entra con tu correo completo (por ejemplo tucorreo+ralok@gmail.com). Desde ahí basta con el nombre del aspecto.'; }
  };
  function salirDeApp() {
    st.desuscribir.forEach((f) => { try { f(); } catch (e) { } }); st.desuscribir = [];
    yo = null; $('#v-app').classList.remove('activa'); $('#v-entrada').classList.add('activa');
  }
  const mapa = (s) => { const m = {}; s.docs.forEach((d) => { m[d.id] = d.data(); }); return m; };

  function entrarApp(asp) {
    yo = asp;
    $('#v-entrada').classList.remove('activa'); $('#v-app').classList.add('activa');
    const oir = (q, fn) => st.desuscribir.push(q.onSnapshot(fn, (e) => console.warn('[KP]', e.message)));
    oir(db.collection('aspectos'), (s) => {
      st.aspectos = {}; s.docs.forEach((d) => { st.aspectos[d.id] = d.data(); });
      document.documentElement.style.setProperty('--asp', colorDe(yo));
      pintarCabecera(); pintarSer(); pintarSalas(); pintarChat(); pintarAhora(); guardarHuevoLuego();
    });
    oir(refYo().collection('tareas'), (s) => {
      st.tareas = {}; s.docs.forEach((d) => { const t = d.data(); if (!t._borrada) st.tareas[d.id] = Object.assign({ id: d.id }, t); });
      pintarCampo(); pintarAhora(); pintarSer(); guardarHuevoLuego(); red();
      if (timer) pintarTimer();
    });
    oir(db.collection('chat_general').orderBy('timestamp').limitToLast(300), (s) => { st.general = s.docs.map((d) => d.data()); pintarChat(); pintarSalas(); });
    oir(db.collection('chat_privado').where('sender', '==', yo), (s) => { st.privEnv = mapa(s); pintarChat(); });
    oir(db.collection('chat_privado').where('recipient', '==', yo), (s) => { st.privRec = mapa(s); pintarChat(); pintarSalas(); });
    oir(db.collection('correos').where('recipient', '==', yo), (s) => { st.correosRec = mapa(s); pintarCorreos(); });
    oir(db.collection('correos').where('sender', '==', yo), (s) => { st.correosEnv = mapa(s); pintarCorreos(); });
    oir(db.collection('bitacora').where('username', '==', yo), (s) => { st.bitP = mapa(s); pintarBitacora(); });
    oir(db.collection('bitacora_cosmica').orderBy('date').limitToLast(500), (s) => { st.bitC = mapa(s); pintarBitacora(); });
    oir(refMega(), (d) => {
      const v = d.exists ? d.data() : null;
      st.mega = { activa: (v && v.activa) || null, historial: (v && v.historial) || [] };
      pintarMega(); if (timer) pintarTimer();
    });
    oir(db.collection('gran_bitacora').orderBy('date').limitToLast(500), (s) => { st.bitG = mapa(s); pintarBitacora(); });
    oir(db.collection('dhana').where('aspecto', '==', yo), (s) => { st.dhana = mapa(s); pintarZazen(); pintarCabecera(); pintarSer(); guardarHuevoLuego(); });
    irA(st.panel || 'ahora');
    cargarSesiones();
    reanudarTimer();
    reanudarZazen();
    pintarAjustes();
  }

  function red() {
    const on = navigator.onLine;
    $('#c-red').classList.toggle('fuera', !on);
    $('#c-red').title = on ? 'en línea' : 'sin señal · se sube al volver';
  }
  addEventListener('online', () => { red(); avisar('De vuelta en línea · sincronizando'); });
  addEventListener('offline', () => { red(); avisar('Sin señal · todo se guarda y se sube al volver'); });

  // ══ navegación ═══════════════════════════════════════════════════
  function irA(panel) {
    st.panel = panel;
    $$('.navegacion button').forEach((x) => x.classList.toggle('activa', x.dataset.panel === panel || (panel === 'campo' && x.dataset.panel === 'campo')));
    $$('.panel').forEach((p) => p.classList.toggle('activa', p.id === 'p-' + panel));
    document.body.classList.toggle('dual', (panel === 'ahora' || panel === 'campo') && innerWidth >= 980);
    if (panel === 'red' && st.red === 'chat') { marcarLeido(st.sala); pintarChat(true); }
    if (panel === 'ser') animarSol();
    scrollTo({ top: 0, behavior: reducido ? 'auto' : 'smooth' });
  }
  $$('.navegacion button').forEach((b) => b.onclick = () => { tic(); irA(b.dataset.panel); });
  addEventListener('resize', () => document.body.classList.toggle('dual', (st.panel === 'ahora' || st.panel === 'campo') && innerWidth >= 980));
  $('#c-quien').onclick = () => irA('ser');

  // ══ cabecera y Ser ═══════════════════════════════════════════════
  function dhanaTotal() { return Math.floor(Object.values(st.dhana).reduce((a, s) => a + (s.real_seg || 0), 0) / 60); }
  function diasZazen() { return new Set(Object.values(st.dhana).map((s) => String(s.fecha || '').slice(0, 10))); }
  function racha() {
    const dias = diasZazen(), d = new Date(); let n = 0;
    const clave = (x) => `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}`;
    if (!dias.has(clave(d))) d.setDate(d.getDate() - 1);
    while (dias.has(clave(d))) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  }
  function pintarCabecera() {
    if (!yo) return;
    const a = miAspecto(), nv = nivel(a.pv || 0);
    $('#c-nombre').textContent = yo;
    $('#c-nivel').textContent = nv.n;
    $('#c-anillo').style.strokeDashoffset = (119.4 * (1 - nv.resto / nv.sig)).toFixed(1);
    $('#c-pv').textContent = `${(a.pv || 0).toLocaleString('es-CL')} Pv`;
    $('#c-mu').textContent = (a.mu || 0) + ' Mu';
    $('#c-dhana').textContent = dhanaTotal() + ' $D';
  }
  function completadasHoy() {
    const hoy = fechaDia();
    return Object.values(st.tareas).filter((t) => t.completed && String(t.date_completed || '').slice(0, 10) === hoy)
      .sort((a, b) => (leerFecha(b.date_completed) || 0) - (leerFecha(a.date_completed) || 0));
  }
  const pvDe = (t) => (t.xp_otorgado_calibracion != null ? t.xp_otorgado_calibracion : (esPremio(t) ? 0 : (t.xp || 0)));
  function pintarSer() {
    if (!yo) return;
    const a = miAspecto(), nv = nivel(a.pv || 0);
    $('#s-nivel').textContent = 'Nivel ' + nv.n;
    $('#s-falta').textContent = `faltan ${(nv.sig - nv.resto).toLocaleString('es-CL')} Pv`;
    $('#s-barra').style.width = Math.round(100 * nv.resto / nv.sig) + '%';
    const hoy = completadasHoy();
    const filas = [['Voluntad total', (a.pv || 0).toLocaleString('es-CL') + ' Pv'], ['En este nivel', `${nv.resto} / ${nv.sig} Pv`],
      ['Pv canjeables', a.pv_canjeables || 0], ['Monedas universales', (a.mu || 0) + ' Mu'], ['Dhana', dhanaTotal() + ' $D'],
      ['Cerradas hoy', hoy.length], ['Sesiones de zazen', Object.keys(st.dhana).length], ['Racha de zazen', racha() + ' días']];
    $('#pf-datos').innerHTML = filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    solDatos = { nv, rayos: hoy.length, color: colorDe(yo) };
  }
  $('#b-cambiar').onclick = async () => {
    if (timer) { avisar('Cierra el timer antes de cambiar de aspecto'); return; }
    entradaExplicita = true; await auth.signOut(); mostrarFormulario(); setTimeout(() => $('#e-correo').focus(), 50);
  };
  $('#b-salir').onclick = async () => { if (await opcionesHoja('Cerrar sesión', '¿Salir de ' + yo + '?', [{ t: 'Salir', v: 1, pri: 1 }, { t: 'Quedarme', v: 0 }])) auth.signOut(); };

  // Sol de la Voluntad: el núcleo crece con el nivel, el halo marca el avance, cada rayo es una tarea cerrada hoy.
  const sol = $('#sol'), solc = sol.getContext('2d');
  let solDatos = null, solAnim = false;
  function animarSol() { if (!solAnim) { solAnim = true; requestAnimationFrame(pasoSol); } }
  function pasoSol(ts) {
    if (st.panel !== 'ser' || !solDatos) { solAnim = false; return; }
    const r = devicePixelRatio || 1, W = 320;
    if (sol.width !== W * r) { sol.width = W * r; sol.height = W * r; }
    const c = solc; c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, W, W);
    const { nv, rayos, color } = solDatos, cx = W / 2, cy = W / 2, t = reducido ? 0 : ts / 1000;
    const resp = 1 + 0.025 * Math.sin(t * 1.2);
    const nucleo = (58 + Math.min(26, nv.n * 1.1)) * resp;          // crece con el nivel
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, nucleo * 1.9);
    g.addColorStop(0, color + 'aa'); g.addColorStop(0.45, color + '40'); g.addColorStop(1, color + '00');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, nucleo * 1.9, 0, 7); c.fill();
    c.fillStyle = color + '22'; c.beginPath(); c.arc(cx, cy, nucleo, 0, 7); c.fill();
    c.strokeStyle = color + '66'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, nucleo, 0, 7); c.stroke();
    const n = Math.min(36, rayos);                                      // un rayo por tarea cerrada hoy
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(n, 1)) * Math.PI * 2 + t * 0.08;
      const l1 = 104, l2 = 118 + 5 * Math.sin(t * 2 + i * 1.7);
      c.strokeStyle = color; c.globalAlpha = 0.85; c.lineWidth = 3.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); c.lineTo(cx + Math.cos(a) * l2, cy + Math.sin(a) * l2); c.stroke();
    }
    c.globalAlpha = 1;
    c.lineWidth = 5; c.strokeStyle = '#ffffff14'; c.beginPath(); c.arc(cx, cy, 142, 0, 7); c.stroke();
    c.strokeStyle = color; c.shadowColor = color; c.shadowBlur = 14; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy, 142, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.005, nv.resto / nv.sig)); c.stroke(); c.shadowBlur = 0;
    requestAnimationFrame(pasoSol);
  }

  // ══ tareas ═══════════════════════════════════════════════════════
  function ordenarPendientes(lista) {
    const dias = (t) => diasDesde(t.date_added);
    const semanales = lista.filter((t) => t.weekly_goal).sort((a, b) => dias(b) - dias(a));
    const premios = lista.filter((t) => !t.weekly_goal && esPremio(t)).sort((a, b) => dias(b) - dias(a));
    const resto = lista.filter((t) => !t.weekly_goal && !esPremio(t))
      .sort((a, b) => ('ABC'.indexOf(a.priority) - 'ABC'.indexOf(b.priority)) || (dias(b) - dias(a)));
    return semanales.concat(premios, resto);
  }
  function chipDe(t) {
    if (t.weekly_goal) return '<span class="chip S">Semanal</span>';
    if (esPremio(t)) return '<span class="chip R">Premio</span>';
    return `<span class="chip ${esc(t.priority)}">${esc(t.priority || 'C')}</span>`;
  }
  function itemTarea(t) {
    const d = diasDesde(t.date_added), p = presion(t);
    const sub = Array.isArray(t.subtasks) && t.subtasks.length ? `<span>${t.subtasks.filter((s) => s.completed).length}/${t.subtasks.length} sub</span>` : '';
    return `<li class="tarea" data-id="${esc(t.id)}" style="--presion:${t.completed ? '' : colorPresion(p)}">
      <div class="t1">${chipDe(t)}<span class="nombre">${esc(t.name)}</span></div>
      <div class="t2">${esPremio(t) ? '' : `<span>${t.completed ? pvDe(t) : (t.xp || 0)} Pv</span>`}<span>${t.time || 0} min</span><span>${d} ${d === 1 ? 'día' : 'días'}</span>${t.delays ? `<span>${t.delays} ext.</span>` : ''}${sub}</div></li>`;
  }
  function pasaFiltro(t) {
    const f = st.filtro;
    if (f === 'todas') return true;
    if (f === 'S') return !!t.weekly_goal;
    if (f === 'R') return esPremio(t);
    return !t.weekly_goal && !esPremio(t) && t.priority === f;
  }
  function pintarCampo() {
    const todas = Object.values(st.tareas);
    const pend = ordenarPendientes(todas.filter((t) => !t.completed && pasaFiltro(t)));
    const hechas = todas.filter((t) => t.completed).sort((a, b) => (leerFecha(b.date_completed) || 0) - (leerFecha(a.date_completed) || 0));
    $('#l-tareas').innerHTML = pend.length ? pend.map(itemTarea).join('') : '<li class="sub">Nada aquí. El campo está despejado.</li>';
    $('#b-ver-completadas').textContent = hechas.length ? `${st.verCompletadas ? 'Ocultar' : 'Ver'} completadas (${hechas.length})` : '';
    $('#l-completadas').innerHTML = hechas.slice(0, 100).map(itemTarea).join('');
    $('#l-completadas').classList.toggle('oculto', !st.verCompletadas);
  }
  $('#filtros').onclick = (ev) => {
    const b = ev.target.closest('[data-f]'); if (!b) return;
    st.filtro = b.dataset.f; $$('#filtros button').forEach((x) => x.classList.toggle('activa', x === b)); pintarCampo();
  };
  $('#b-ver-completadas').onclick = () => { st.verCompletadas = !st.verCompletadas; pintarCampo(); };
  ['#l-tareas', '#l-completadas', '#h-lista'].forEach((s) => $(s).onclick = (ev) => {
    const li = ev.target.closest('[data-id]'); if (li) hojaTarea(st.tareas[li.dataset.id]);
  });

  function hojaTarea(t) {
    if (!t) return;
    const n = (t.distractions || []).length;
    const premio = esPremio(t);
    abrirHoja(`<h2>${esc(t.name)}</h2>
      <p class="sub">${premio ? 'Recompensa' : 'Prioridad ' + esc(t.weekly_goal ? 'semanal' : t.priority)} · ${premio ? '' : (t.completed ? pvDe(t) : (t.xp || 0)) + ' Pv · '}${t.time || 0} min · ${diasDesde(t.date_added)} días${t.delays ? ' · ' + t.delays + ' extensiones' : ''}${n ? ' · ' + n + ' distracciones' : ''}${t.completed ? ' · cerrada ' + esc(t.date_completed || '') : ''}</p>
      <div class="botones">
        ${t.completed ? '' : premio ? '<button class="primario" id="h-usar">Usar recompensa</button>' : '<button class="primario" id="h-iniciar">⚔ Iniciar timer</button>'}
        ${t.completed || premio ? '' : '<button id="h-dos">Solo 2 minutos</button>'}
        ${t.large && !t.completed ? '<button id="h-sub">Subtareas</button>' : ''}
        ${t.completed || premio ? '' : '<button id="h-vida">🌿 Lo hice en mi vida</button>'}
        ${t.completed || premio || t.weekly_goal ? '' : '<button id="h-mega">👑 Convertir en Mega Task</button>'}
        ${t.completed ? '' : '<button id="h-editar">Editar</button>'}
        <button id="h-borrar" class="peligro">Eliminar</button>
      </div>`, (h) => {
      const on = (id, fn) => { const b = h.querySelector(id); if (b) b.onclick = fn; };
      on('#h-iniciar', () => { cerrarHoja(); iniciarTarea(t, 'tarea'); });
      on('#h-dos', () => { cerrarHoja(); iniciarTarea(t, 'dos'); });
      on('#h-usar', () => { cerrarHoja(); usarRecompensa(t); });
      on('#h-sub', () => hojaSubtareas(t.id));
      on('#h-vida', () => { cerrarHoja(); cerrarEnVida(t.id, null); });
      on('#h-editar', () => formTarea(t));
      on('#h-mega', () => { cerrarHoja(); declararMega(t); });
      on('#h-borrar', async () => {
        if (!(await opcionesHoja('Eliminar', `¿Eliminar «${t.name}»?`, [{ t: 'Eliminar', v: 1 }, { t: 'Cancelar', v: 0 }]))) return;
        await refTarea(t.id).set({ _borrada: true, _mod: ahoraMs() });
        avisar('Tarea eliminada');
      });
    });
  }

  function formTarea(t, base) {
    const nueva = !t; t = t || Object.assign({ priority: 'C' }, base || {});
    abrirHoja(`<h2>${nueva ? 'Nueva tarea' : 'Editar tarea'}</h2>
      <label>Tarea<input id="f-nombre" value="${esc(t.name || '')}" required></label>
      <div class="fila"><label>Pv<input id="f-pv" type="number" min="0" inputmode="numeric" value="${esc(t.xp == null ? '' : t.xp)}"></label>
      <label>Duración (min)<input id="f-min" type="number" min="1" inputmode="numeric" value="${esc(t.time == null ? '' : t.time)}"></label></div>
      <label>Prioridad</label>
      <div class="prioridades">${['A', 'B', 'C'].map((p) => `<label><input type="radio" name="f-pri" value="${p}" ${t.priority === p ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div>
      <label class="marca"><input id="f-grande" type="checkbox" ${t.large ? 'checked' : ''}> Tarea grande (con subtareas)</label>
      <label class="marca"><input id="f-semanal" type="checkbox" ${t.weekly_goal ? 'checked' : ''}> Objetivo semanal</label>
      <p id="f-error" class="error"></p>
      <div class="botones"><button class="primario" id="f-guardar">${nueva ? 'Añadir' : 'Guardar'}</button><button id="f-cancelar">Cancelar</button></div>`, (h) => {
      const foco = !t.name ? '#f-nombre' : t.xp == null ? '#f-pv' : t.time == null ? '#f-min' : '#f-nombre';
      if (nueva) setTimeout(() => h.querySelector(foco).focus(), 50);
      h.querySelector('#f-cancelar').onclick = cerrarHoja;
      h.querySelector('#f-guardar').onclick = async () => {
        const nombre = h.querySelector('#f-nombre').value.trim(), pv = h.querySelector('#f-pv').value, min = h.querySelector('#f-min').value;
        if (!nombre || pv === '' || min === '') { h.querySelector('#f-error').textContent = 'Por favor, completa todos los campos antes de añadir la tarea.'; return; }
        if (!/^\d+$/.test(pv) || !/^\d+$/.test(min)) { h.querySelector('#f-error').textContent = "Los campos 'Pv' y 'Duración' deben ser números válidos."; return; }
        const grande = h.querySelector('#f-grande').checked;
        const datos = { name: nombre, xp: +pv, time: +min, priority: h.querySelector('input[name=f-pri]:checked').value,
          large: grande, weekly_goal: h.querySelector('#f-semanal').checked, _mod: ahoraMs() };
        if (nueva) await crearTarea(datos);
        else {
          if (grande && !Array.isArray(t.subtasks)) datos.subtasks = [];
          await refTarea(t.id).set(datos, { merge: true });
        }
        cerrarHoja(); avisar(nueva ? 'Tarea añadida' : 'Tarea guardada');
      };
    });
  }
  async function crearTarea(datos) {
    const id = uuid();
    const t = Object.assign({ id, completed: false, date_added: fechaDia(), subtasks: datos.large ? [] : null }, datos, { _mod: ahoraMs() });
    await refTarea(id).set(t);
    return t;
  }
  $('#b-nueva').onclick = () => formTarea(null);

  function hojaSubtareas(id) {
    const pintar = (h) => {
      const t = st.tareas[id]; const subs = (t && t.subtasks) || [];
      h.querySelector('#s-lista').innerHTML = subs.map((s, i) => `<li class="${s.completed ? 'hecha' : ''}"><input type="checkbox" data-i="${i}" ${s.completed ? 'checked' : ''}><span>${esc(s.name)}</span><button data-borrar="${i}" class="peligro">×</button></li>`).join('') || '<li class="sub">Sin subtareas</li>';
    };
    const guardar = async (subs) => { await refTarea(id).set({ subtasks: subs, _mod: ahoraMs() }, { merge: true }); st.tareas[id].subtasks = subs; pintar($('#hoja')); };
    abrirHoja(`<h2>Subtareas</h2><p class="sub">${esc(st.tareas[id].name)}</p><ul id="s-lista" class="subtareas"></ul>
      <div class="fila"><input id="s-nueva" placeholder="Nueva subtarea"><button class="primario" id="s-agregar" style="flex:0 0 auto">Añadir</button></div>
      <div class="botones"><button id="s-cerrar">Listo</button></div>`, (h) => {
      pintar(h);
      h.querySelector('#s-cerrar').onclick = cerrarHoja;
      const agregar = () => { const v = h.querySelector('#s-nueva').value.trim(); if (!v) return; h.querySelector('#s-nueva').value = ''; guardar(((st.tareas[id].subtasks) || []).concat([{ name: v, completed: false }])); };
      h.querySelector('#s-agregar').onclick = agregar;
      h.querySelector('#s-nueva').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } };
      h.querySelector('#s-lista').onclick = (ev) => {
        const subs = ((st.tareas[id].subtasks) || []).map((s) => Object.assign({}, s));
        if (ev.target.dataset.borrar != null) { subs.splice(+ev.target.dataset.borrar, 1); guardar(subs); }
        else if (ev.target.dataset.i != null) {
          subs[+ev.target.dataset.i].completed = ev.target.checked; guardar(subs);
          if (ev.target.checked) { tic(); }
          if (subs.length && subs.every((s) => s.completed)) { avisar('¡Todas las subtareas han sido completadas!'); campanas(); }
        }
      };
    });
  }

  // ══ AHORA ════════════════════════════════════════════════════════
  function candidatas() {
    const pend = Object.values(st.tareas).filter((t) => !t.completed && !esPremio(t));
    const peso = { A: 3, B: 2, C: 1 };
    return pend.sort((a, b) => (presion(b) - presion(a)) || ((peso[b.priority] || 1) - (peso[a.priority] || 1)) || ((b.xp || 0) - (a.xp || 0)));
  }
  function sugerida() { const c = candidatas(); return c.length ? c[st.sugerida % c.length] : null; }
  function fraseAhora(t) {
    const h = new Date().getHours(), hechas = completadasHoy().length;
    if (!t) return 'El campo está despejado. Momento de sembrar.';
    const d = diasDesde(t.date_added);
    if (d >= 7) return `«${t.name}» lleva ${d} días esperando. Su peso también es su potencia.`;
    if (hechas >= 3) return `${hechas} cerradas hoy. El organismo está en movimiento.`;
    if (h < 5) return 'La noche es corta. Una sola cosa basta.';
    return FRASES_AHORA[(new Date().getDate() + st.sugerida) % FRASES_AHORA.length];
  }
  function pintarAhora() {
    if (!yo) return;
    const t = sugerida();
    $('#a-frase').textContent = fraseAhora(t);
    $('#a-carta').classList.toggle('vacia', !t);
    if (!t) {
      $('#a-nombre').textContent = 'Sin pendientes. Escribe abajo lo que te pesa.';
      $('#a-datos').innerHTML = ''; $('#a-presion').style.width = '0';
      ['#a-desenvainar', '#a-dos', '#a-otra'].forEach((s) => $(s).disabled = true);
    } else {
      const d = diasDesde(t.date_added), p = presion(t);
      $('#a-nombre').textContent = t.name;
      $('#a-datos').innerHTML = `${chipDe(t)}<span>${t.xp || 0} Pv</span><span>${t.time || 0} min</span><span>${d} ${d === 1 ? 'día' : 'días'}</span>${t.delays ? `<span>${t.delays} ext.</span>` : ''}`;
      $('#a-presion').style.width = Math.max(6, Math.min(100, Math.log1p(p) / Math.log1p(400) * 100)) + '%';
      $('#a-presion').style.background = colorPresion(p);
      ['#a-desenvainar', '#a-dos'].forEach((s) => $(s).disabled = false);
      $('#a-otra').disabled = candidatas().length < 2;
    }
    const hoy = completadasHoy();
    const pvHoy = hoy.reduce((a, t) => a + pvDe(t), 0);
    $('#h-resumen').textContent = hoy.length ? `${hoy.length} cerradas · +${pvHoy.toLocaleString('es-CL')} Pv` : 'aún nada · empieza por algo pequeño';
    $('#h-lista').innerHTML = hoy.slice(0, 8).map((x) => `<li data-id="${esc(x.id)}"><span>${esc(x.name)}</span><b>${esPremio(x) ? '🎁' : '+' + pvDe(x) + ' Pv'}</b></li>`).join('');
  }
  $('#a-otra').onclick = () => { st.sugerida += 1; tic(); pintarAhora(); };
  $('#a-desenvainar').onclick = () => { const t = sugerida(); if (t) iniciarTarea(t, 'tarea'); };
  $('#a-dos').onclick = () => { const t = sugerida(); if (t) iniciarTarea(t, 'dos'); };
  $('#a-nombre').onclick = () => { const t = sugerida(); if (t) hojaTarea(t); };

  // ── captura rápida: un solo intérprete (el mismo que usarán Telegram y la voz) ──
  // "llamar al dentista !A 15m 40pv #semanal #grande"
  function interpretar(txt) {
    let s = ' ' + String(txt || '') + ' ';
    const r = {};
    s = s.replace(/\s!([abcABC])(?=\s)/, (_, p) => { r.priority = p.toUpperCase(); return ' '; });
    s = s.replace(/\s(\d{1,2})h(?:\s?(\d{1,2})m(?:in)?)?(?=\s)/i, (_, h, m) => { r.time = (+h) * 60 + (+(m || 0)); return ' '; });
    s = s.replace(/\s(\d{1,4})\s?(?:m|min|mins|minutos?)(?=\s)/i, (_, m) => { if (r.time == null) r.time = +m; return ' '; });
    s = s.replace(/\s(\d{1,6})\s?pv(?=\s)/i, (_, p) => { r.xp = +p; return ' '; });
    s = s.replace(/\s#semanal(?=\s)/i, () => { r.weekly_goal = true; return ' '; });
    s = s.replace(/\s#grande(?=\s)/i, () => { r.large = true; return ' '; });
    r.name = s.replace(/\s+/g, ' ').trim();
    return r;
  }
  function vistaCaptura() {
    const v = $('#cap-texto').value.trim(); if (!v) { $('#cap-vista').innerHTML = ''; return; }
    const r = interpretar(v);
    const ch = (ok, t) => `<span class="${ok ? 'ok' : ''}">${esc(t)}</span>`;
    $('#cap-vista').innerHTML = ch(r.priority, 'prioridad ' + (r.priority || 'C')) + ch(r.xp != null, r.xp != null ? r.xp + ' Pv' : 'Pv ?') +
      ch(r.time != null, r.time != null ? r.time + ' min' : 'min ?') + (r.weekly_goal ? ch(1, 'semanal') : '') + (r.large ? ch(1, 'grande') : '');
  }
  $('#cap-texto').oninput = vistaCaptura;
  $('#f-captura').onsubmit = async (ev) => {
    ev.preventDefault();
    const r = interpretar($('#cap-texto').value);
    if (!r.name) { $('#cap-texto').focus(); return; }
    const base = { name: r.name, priority: r.priority || 'C', xp: r.xp, time: r.time, weekly_goal: !!r.weekly_goal, large: !!r.large };
    $('#cap-texto').value = ''; vistaCaptura();
    if (r.xp == null || r.time == null) { formTarea(null, base); return; }   // KP exige Pv y duración
    await crearTarea({ name: base.name, xp: base.xp, time: base.time, priority: base.priority, large: base.large, weekly_goal: base.weekly_goal });
    tic(); avisar('Sembrada: ' + base.name);
  };

  // ══ TIMER ════════════════════════════════════════════════════════
  // timer = {id, total, fin, tipo:'tarea'|'dos'|'recompensa', nombre, sono}
  // sesiones[id] = {inicio, distracciones}  — una extensión no reinicia la sesión (igual que KP)
  let timer = null, sesiones = {}, wakeLock = null, alientoT = 0;
  const kT = () => 'kp_timer_' + yo, kS = () => 'kp_ses_' + yo;
  function guardarTimer() { try { timer ? localStorage.setItem(kT(), JSON.stringify(timer)) : localStorage.removeItem(kT()); } catch (e) { } }
  function cargarSesiones() { try { sesiones = JSON.parse(localStorage.getItem(kS()) || '{}') || {}; } catch (e) { sesiones = {}; } }
  function guardarSesiones() { try { localStorage.setItem(kS(), JSON.stringify(sesiones)); } catch (e) { } }
  function reanudarTimer() {
    try { const t = JSON.parse(localStorage.getItem(kT()) || 'null'); if (t && t.fin) { timer = t; mostrarFoco(); arrancarReloj(); } } catch (e) { }
  }

  function pedirPermisos() {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { }
  }

  function iniciarTarea(t, tipo) {
    if (timer) { avisar('Ya hay un timer corriendo'); mostrarFoco(); return; }
    const s0 = sesiones[t.id];             // una sesión abandonada hace más de 12 h no cuenta
    if (!s0 || ahoraMs() - s0.inicio > 12 * 3600000) { sesiones[t.id] = { inicio: ahoraMs(), distracciones: 0 }; guardarSesiones(); }
    const seg = tipo === 'dos' ? SEG_CALENTAMIENTO : Math.max(1, (t.time || 25)) * 60;
    abrirTimer({ id: t.id, total: seg, fin: ahoraMs() + seg * 1000, tipo, nombre: t.name });
  }
  function abrirTimer(tm) {
    timer = tm; guardarTimer();
    pedirPermisos();
    campanas();
    mostrarFoco(); arrancarReloj();
    if (pref.flotar && Flotante.soporte()) abrirFlotante(true);
  }
  function arrancarReloj() { Reloj.iniciar(tick); tick(); configurarMediaSession(); }

  async function abrirFlotante(alIniciar) {
    if (!timer) return;
    if (Flotante.soporte() === 'video' || Flotante.soporte() === 'webkit') Flotante.preparar();
    Flotante.pintar(estadoFlotante());
    const ok = await Flotante.abrir();
    if (ok && Flotante.esMovil) minimizarFoco();
    else if (!ok && !alIniciar) avisar('Este navegador no permite la ventana flotante. Usa Chrome.');
  }
  function configurarMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: timer ? timer.nombre : 'Killer Pendiente', artist: yo || 'Killer Pendiente', album: 'Killer Pendiente' });
      navigator.mediaSession.setActionHandler('enterpictureinpicture', () => abrirFlotante(false));
    } catch (e) { }
  }

  function restaSeg() { return timer ? Math.max(0, Math.ceil((timer.fin - ahoraMs()) / 1000)) : 0; }
  function estadoFlotante() {
    const r = restaSeg();
    return { nombre: timer ? timer.nombre : '', resta: r, total: timer ? timer.total : 1, color: colorDe(yo), aspecto: yo, final: !!(timer && r === 0), tipo: timer ? timer.tipo : '' };
  }
  function tick() {
    if (!timer) { Reloj.detener(); return; }
    const resta = restaSeg();
    pintarTimer(resta);
    Flotante.pintar(estadoFlotante());
    if (!$('#foco').classList.contains('oculto') && ahoraMs() - alientoT > 45000) rotarAliento();
    if (resta === 0 && !timer.sono) {
      timer.sono = true; guardarTimer(); gong(); notificarFin();
      setTimeout(() => finalizarPorReloj(), 1500);
    }
  }
  function pintarTimer(resta = restaSeg()) {
    if (!timer) return;
    const frac = timer.total ? resta / timer.total : 0;
    const col = resta === 0 ? 'var(--alerta)' : frac <= 0.2 ? 'var(--alerta)' : frac <= 0.5 ? 'var(--tension)' : 'var(--asp)';
    $('#f-reloj').textContent = mmss(resta);
    $('#f-arco').style.strokeDashoffset = (678.6 * (1 - frac)).toFixed(1);
    $('#f-arco').style.stroke = col;
    $('#foco').classList.toggle('final', resta === 0);
    $('#fo-nombre').textContent = timer.nombre;
    $('#f-tipo').textContent = timer.tipo === 'recompensa' ? 'Recompensa' : timer.tipo === 'dos' ? 'Umbral · 2 minutos' : 'Combate';
    $('#p-reloj').textContent = mmss(resta); $('#p-nombre').textContent = timer.nombre;
    document.title = `${mmss(resta)} · ${timer.nombre}`;
  }
  function rotarAliento() { alientoT = ahoraMs(); $('#f-aliento').textContent = azar(ALIENTO); }

  function mostrarFoco() {
    if (!timer) return;
    const rec = timer.tipo === 'recompensa';
    $('#f-distraccion').classList.toggle('oculto', rec);
    $('#f-listo').textContent = rec ? 'terminar' : 'listo';
    $('#foco').classList.remove('oculto'); $('#pildora').classList.add('oculto');
    rotarAliento(); pintarTimer(); pedirPantalla();
  }
  function minimizarFoco() {
    if (!timer) return;
    $('#foco').classList.add('oculto'); $('#pildora').classList.remove('oculto'); soltarPantalla();
  }
  function ocultarTodoTimer() {
    $('#foco').classList.add('oculto'); $('#pildora').classList.add('oculto'); soltarPantalla();
    document.title = 'Killer Pendiente';
  }
  async function pedirPantalla() {
    if (!pref.pantalla || !('wakeLock' in navigator) || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { }
  }
  function soltarPantalla() { try { if (wakeLock) wakeLock.release(); } catch (e) { } wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (timer && !$('#foco').classList.contains('oculto')) pedirPantalla();
      if (pendienteAlVolver) { const f = pendienteAlVolver; pendienteAlVolver = null; f(); }
    } else if (timer && pref.flotar && !Flotante.abierto()) {
      Flotante.abrir().catch(() => { });         // solo funciona si el navegador lo permite sin gesto
    }
  });

  $('#f-minimizar').onclick = minimizarFoco;
  $('#pildora').onclick = mostrarFoco;
  $('#f-flotar').onclick = () => abrirFlotante(false);
  $('#f-cerrar').onclick = async () => {
    if (timer && timer.tipo === 'recompensa') { cerrarTimer(); return; }
    if (await opcionesHoja('Cerrar el timer', 'La tarea queda pendiente. ¿Cerrar?', [{ t: 'Cerrar timer', v: 1 }, { t: 'Seguir', v: 0, pri: 1 }])) cerrarTimer();
  };
  $('#f-listo').onclick = () => pulsarListo();
  $('#f-distraccion').onclick = () => anotarDistraccion(false);
  Flotante.alAccion((a) => { if (a === 'listo') pulsarListo(); else if (a === 'distraccion') anotarDistraccion(true); });

  function cerrarTimer(mantenerFlotante) {
    Reloj.detener();
    const tm = timer; timer = null; guardarTimer();
    ocultarTodoTimer();
    if (!mantenerFlotante) Flotante.cerrar();
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); } catch (e) { }
    return tm;
  }

  async function notificarFin() {
    if (document.visibilityState === 'visible' && !Flotante.abierto()) return;
    const titulo = '¡Tiempo!', cuerpo = (timer && timer.nombre) ? `${timer.nombre} · vuelve a Killer Pendiente` : 'Vuelve a Killer Pendiente';
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.showNotification(titulo, { body: cuerpo, tag: 'kp-timer', requireInteraction: true, vibrate: [300, 120, 300], icon: 'icono-192.png', badge: 'icono-192.png' });
      else new Notification(titulo, { body: cuerpo, tag: 'kp-timer' });
    } catch (e) { }
  }

  // si el cierre ocurre con la app en segundo plano (celular), la pregunta espera a que vuelvas
  let pendienteAlVolver = null;
  function cuandoVisible(fn) {
    if (document.visibilityState === 'visible' || Flotante.interactivo()) fn();
    else pendienteAlVolver = fn;
  }

  function finalizarPorReloj() {
    if (!timer) return;
    const tm = timer;
    if (tm.tipo === 'recompensa') { cerrarTimer(); cuandoVisible(() => { avisar('Recompensa disfrutada 🎁'); }); return; }
    if (tm.tipo === 'dos') { cuandoVisible(() => finUmbral(tm)); return; }
    // terminó por el reloj: sin bono por adelantarse (fracción 0)
    cerrarTimer(true);
    cuandoVisible(() => preguntarCompletada(tm.id, 0));
  }

  async function finUmbral(tm) {
    const t = tareaPorId(tm.id);
    const T = Math.max(1, (t && t.time) || 25) * 60, ses = sesiones[tm.id];
    const usado = ses ? Math.round((ahoraMs() - ses.inicio) / 1000) : SEG_CALENTAMIENTO;
    const queda = Math.max(60, T - usado);
    const v = await preguntaFlex('El umbral está cruzado', 'Dos minutos y ya estás dentro. ¿Sigues?',
      [{ t: `Seguir (${Math.round(queda / 60)} min)`, v: 'seguir', pri: 1 }, { t: 'Lo terminé', v: 'listo' }, { t: 'Dejarlo por ahora', v: 'dejar' }]);
    if (!timer || timer.id !== tm.id) return;
    if (v === 'seguir') {
      timer = { id: tm.id, total: queda, fin: ahoraMs() + queda * 1000, tipo: 'tarea', nombre: tm.nombre };
      guardarTimer(); campanas(); mostrarFoco(); arrancarReloj();
    } else if (v === 'listo') {
      cerrarTimer(true); cerrarTareaDesdeListo(tm.id, T, usado);
    } else { cerrarTimer(); avisar('Queda en el campo. Sin castigo: vuelve cuando quieras.'); }
  }

  // ── [listo] ──
  async function pulsarListo() {
    if (!timer) return;
    const tm = timer;
    if (tm.tipo === 'recompensa') { cerrarTimer(); avisar('Recompensa disfrutada 🎁'); return; }
    const t = tareaPorId(tm.id);
    if (tm.tipo === 'dos') {              // durante el umbral: la fracción se mide contra el tiempo real de la tarea
      const T = Math.max(1, (t && t.time) || 25) * 60, ses = sesiones[tm.id];
      const usado = ses ? Math.round((ahoraMs() - ses.inicio) / 1000) : SEG_CALENTAMIENTO - restaSeg();
      cerrarTimer(true); cerrarTareaDesdeListo(tm.id, T, usado); return;
    }
    // v8.27: "listo" a los pocos segundos = probablemente se hizo en la vida
    const sosp = listoSospechoso(tm.id);
    if (sosp != null) {
      const r = await preguntaFlex('¿Dónde lo hiciste?', `Apretaste listo a los ${Math.floor(sosp)} s. ¿Dónde hiciste este pendiente?`,
        [{ t: '🌿 En mi vida, fuera de KP', v: 'vida' }, { t: '⚡ Aquí, y fue rapidísimo', v: 'aqui' }, { t: '↩ Volver al timer', v: 'volver', pri: 1 }]);
      if (!timer || timer.id !== tm.id) return;
      if (r === 'volver' || r === undefined) return;
      if (r === 'aqui') { cerrarTimer(true); preguntarCompletada(tm.id, 0); return; }     // sin bono temprano
      cerrarTimer(true); cerrarEnVida(tm.id, sosp); return;
    }
    const fraccion = tm.total ? restaSeg() / tm.total : 0;
    cerrarTimer(true);
    preguntarCompletada(tm.id, fraccion);
  }
  function listoSospechoso(id) {
    const ses = sesiones[id], t = tareaPorId(id);
    if (!ses || !t) return null;
    const trans = (ahoraMs() - ses.inicio) / 1000;
    const total = (parseFloat(t.time) || 0) * 60;
    return trans < Math.max(CIERRE_DETECTADO_SEG, CIERRE_DETECTADO_FRACCION * total) ? trans : null;
  }
  async function cerrarTareaDesdeListo(id, T, usado) {
    const sosp = listoSospechoso(id);
    if (sosp != null) {
      const r = await preguntaFlex('¿Dónde lo hiciste?', `Apretaste listo a los ${Math.floor(sosp)} s. ¿Dónde hiciste este pendiente?`,
        [{ t: '🌿 En mi vida, fuera de KP', v: 'vida' }, { t: '⚡ Aquí, y fue rapidísimo', v: 'aqui', pri: 1 }]);
      if (r === 'vida') { cerrarEnVida(id, sosp); return; }
      preguntarCompletada(id, 0); return;
    }
    preguntarCompletada(id, Math.max(0, (T - usado) / T));
  }

  // ── distracción (sin castigo: se anota y se vuelve) ──
  function anotarDistraccion(desdeFlotante) {
    if (!timer || timer.tipo === 'recompensa') return;
    const id = timer.id;
    const registrar = async (txt) => {
      const t = tareaPorId(id);
      if (sesiones[id]) { sesiones[id].distracciones = (sesiones[id].distracciones || 0) + 1; guardarSesiones(); }
      if (t) {
        const lista = (t.distractions || []).concat([{ text: txt, timestamp: fechaISO(), task_name: t.name }]);
        await guardarCampos(id, { distractions: lista });
      }
    };
    if (desdeFlotante && Flotante.interactivo()) {
      registrar('(anotada desde la ventana flotante)');
      Flotante.preguntar('Anotado', azar(ALIENTO), [{ t: 'Volver al combate', v: 1, pri: 1 }]);
      return;
    }
    abrirHoja(`<h2>Me distraje</h2><p class="sub">${esc(azar(ALIENTO))}</p><textarea id="d-texto" rows="3" placeholder="¿Qué te distrajo? (opcional)"></textarea>
      <div class="botones"><button class="primario" id="d-guardar">Anotar y volver</button></div>`, (h) => {
      setTimeout(() => h.querySelector('#d-texto').focus(), 50);
      h.querySelector('#d-guardar').onclick = async () => { const txt = h.querySelector('#d-texto').value.trim(); cerrarHoja(); await registrar(txt); avisar('Anotado. Volver es el entrenamiento.'); };
    });
  }

  // ── ¿Completaste la tarea? (igual que KP) ──
  async function preguntarCompletada(id, fraccion) {
    for (let i = 0; i < 20 && !tareaPorId(id); i++) await new Promise((r) => setTimeout(r, 250));
    const t = tareaPorId(id); if (!t) { Flotante.cerrar(); return; }
    const t0 = ahoraMs();
    const si = await preguntaFlex('Tarea Completa', '¿Completaste la tarea?', [{ t: 'Sí', v: true, pri: 1 }, { t: 'No', v: false }]);
    const segPregunta = Math.round((ahoraMs() - t0) / 100) / 10;
    if (si === undefined) { Flotante.cerrar(); return; }            // cerró sin responder: queda pendiente
    if (si) { completar(t, fraccion, 'timer'); return; }
    const delays = (t.delays || 0) + 1;
    const dt = (t.delay_times || []).slice();
    await guardarCampos(id, { delays, delay_times: dt });
    const extra = await pedirMinutos('Tiempo Adicional', '¿Cuánto tiempo adicional necesitas? (en minutos)');
    const segTotal = Math.round((ahoraMs() - t0) / 100) / 10;
    const reg = (t.tiempo_sin_accion_seg || []).concat([{ pregunta_seg: segPregunta, total_seg: segTotal, respondio_tiempo: extra != null, fecha: new Date().toISOString().slice(0, 19) }]);
    const cambios = { tiempo_sin_accion_seg: reg };
    if (extra) cambios.delay_times = dt.concat([extra]);
    await guardarCampos(id, cambios);
    if (extra) { abrirTimer({ id, total: extra * 60, fin: ahoraMs() + extra * 60000, tipo: 'tarea', nombre: t.name }); }
    else { Flotante.cerrar(); avisar('Queda en el campo. Vuelve cuando quieras.'); }
  }

  // ── cierre "en mi vida" ──
  function cerrarEnVida(id, detectadoSeg) {
    const t = tareaPorId(id); if (!t || t.completed) { Flotante.cerrar(); return; }
    const grupos = [['¿Cuándo?', 'cuando', ['recién', 'hoy más temprano', 'ayer o antes'], 0],
      ['¿Cuánto te tomó?', 'duracion', ['menos de lo estimado', 'lo estimado', 'más'], 1],
      ['¿Te distrajiste?', 'distracciones', ['0', '1–2', 'varias'], 0]];
    if (Flotante.interactivo()) {
      (async () => {
        const datos = {};
        for (const [tit, k, ops] of grupos) {
          const v = await Flotante.preguntar('🌿 ' + tit, t.name, ops.map((o) => ({ t: o, v: o })));
          if (v === undefined) return;
          datos[k] = v;
        }
        datos.detectado = detectadoSeg != null;
        completar(t, 0, 'vida', datos);
      })();
      return;
    }
    const sel = {}; grupos.forEach(([, k, ops, d]) => { sel[k] = ops[d]; });
    abrirHoja(`<h2>🌿 ${esc(t.name)}</h2>
      ${detectadoSeg != null ? `<p class="sub">Lo cerraste a los ${Math.floor(detectadoSeg)} s de iniciar el timer.</p>` : ''}
      <p class="sub">Lo que haces fuera de KP es lo que importa. Solo cuéntale cómo fue:</p>
      ${grupos.map(([tit, k, ops]) => `<label>${tit}</label><div class="opciones" data-g="${k}">${ops.map((o) => `<button data-v="${esc(o)}" class="${sel[k] === o ? 'sel' : ''}">${esc(o)}</button>`).join('')}</div>`).join('')}
      <div class="botones"><button class="primario" id="v-ok">Registrar</button><button id="v-no">Cancelar</button></div>`, (h) => {
      h.querySelectorAll('[data-g]').forEach((g) => g.onclick = (ev) => {
        const b = ev.target.closest('[data-v]'); if (!b) return;
        sel[g.dataset.g] = b.dataset.v; g.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      });
      h.querySelector('#v-no').onclick = cerrarHoja;
      h.querySelector('#v-ok').onclick = () => { cerrarHoja(); completar(t, 0, 'vida', Object.assign({ detectado: detectadoSeg != null }, sel)); };
    });
  }

  // ── completar (reglas de kp828.complete_task) ──
  async function completar(t, fraccion, modo, datosVida) {
    if (t.mega) { vencerMega(modo, datosVida); return; }            // v8.27: es el jefe final
    let xp = t.xp || 0, m = 1;
    if (modo !== 'vida') { m = multiplicadorCalibracion(t, fraccion); if (m !== 1) xp = Math.round(xp * m); }
    const antes = nivel(miAspecto().pv || 0).n;
    const ses = sesiones[t.id]; delete sesiones[t.id]; guardarSesiones();
    const tarea = { completed: true, color: 'orange', date_completed: fechaKP(), modo_cierre: modo || (ses ? 'timer' : 'otro'),
      total_time: (t.time || 0) + (t.delay_times || []).reduce((a, b) => a + b, 0), _mod: ahoraMs() };
    if (m !== 1) tarea.xp_otorgado_calibracion = xp;
    if (modo === 'vida' && datosVida) tarea.cierre_vida = datosVida;
    if (modo === 'timer' && ses) tarea.tiempo_medido_min = Math.round((ahoraMs() - ses.inicio) / 6000) / 10;
    const lote = db.batch();
    lote.set(refTarea(t.id), tarea, { merge: true });
    lote.set(refYo(), { pv: FV.increment(xp), pv_canjeables: FV.increment(xp), _mod: ahoraMs() }, { merge: true });
    lote.set(db.collection('pulsos').doc(), {
      type: 'TASK_COMPLETE', event_id: uuid().replace(/-/g, ''), pv: xp, user: yo, user_color: colorDe(yo),
      task_name: t.name || '', task_id: t.id, priority: t.priority || 'C', days_delayed: diasDesde(t.date_added),
      timestamp: new Date().toISOString(), origen: 'celular', _mod: ahoraMs()
    });
    try { await lote.commit(); } catch (e) { avisar('No se pudo guardar: ' + e.message, 5000); return; }
    if (t.weekly_goal) {                       // objetivo semanal: todos los aspectos ganan los Pv (Dios no)
      otros().forEach((u) => {
        db.collection('aspectos').doc(u).update({ pv: FV.increment(xp), _mod: ahoraMs() }).catch(() => { });
        refTarea(t.id, u).update({ completed: true, color: 'orange', date_completed: tarea.date_completed, _mod: ahoraMs() }).catch(() => { });
      });
    }
    celebrar(t, xp, m, antes);
  }

  function celebrar(t, xp, m, antes) {
    const extra = m > 1 ? `⚡ Bono x${+m.toFixed(2)} por terminar antes` : m < 1 ? `⏳ x${+m.toFixed(2)} por tiempo extra pedido` : '';
    campanas(); detonar(t.weekly_goal ? 180 : 110);
    Flotante.celebrar(`<b>+${xp} Pv</b>¡Ese es mi toro! 🐂`);
    const york = Math.random() < 0.12;
    st.sugerida = 0;
    abrirHoja(`<div class="detona">
      ${t.weekly_goal ? '<p class="toro">¡VAMOS CTM!!</p><p>¡Objetivo Semanal Completado!</p>' : '<p class="toro">¡Ese es mi toro! 🐂</p>'}
      <div class="mas-pv" id="cuenta">+0</div>
      <p>¡Poder Personal sumado!</p>${extra ? `<p class="sub">${esc(extra)}</p>` : ''}
      <p class="frase-final">${esc(azar(CIERRE))}</p>
      ${york ? `<div class="york">▸ TRANSMISIÓN · 2044 · YORK<br>${esc(azar(YORK))}</div>` : ''}
      </div>
      <label>Una palabra de cierre (opcional)<input id="c-palabra" maxlength="40" placeholder="¿Cómo quedó el cuerpo?"></label>
      <div class="botones"><button class="primario" id="c-sig">Siguiente batalla →</button><button id="c-ok">Respirar y volver</button></div>`, (h) => {
      const el = h.querySelector('#cuenta'), t0 = performance.now(), dur = reducido ? 1 : 900;
      const paso = (ts) => { const k = Math.min(1, (ts - t0) / dur); el.textContent = '+' + Math.round(xp * (1 - Math.pow(1 - k, 3))).toLocaleString('es-CL') + ' Pv'; if (k < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
      const palabra = async () => { const p = h.querySelector('#c-palabra').value.trim(); if (p) await refTarea(t.id).set({ palabra_cierre: p, _mod: ahoraMs() }, { merge: true }); };
      h.querySelector('#c-sig').onclick = async () => { await palabra(); cerrarHoja(); irA('ahora'); };
      h.querySelector('#c-ok').onclick = async () => { await palabra(); cerrarHoja(); };
    });
    setTimeout(() => {
      const despues = nivel(miAspecto().pv || 0).n;
      if (despues > antes) { avisar(`¡Felicitaciones! ¡Has subido al nivel ${despues}!`, 4500); detonar(200); campanas(); }
    }, 1400);
  }

  // ── recompensas: se usan (sin Pv), igual que KP ──
  async function usarRecompensa(t) {
    await refTarea(t.id).set({ completed: true, date_completed: fechaKP(), _mod: ahoraMs() }, { merge: true });
    if ((t.time || 0) > 0) abrirTimer({ id: t.id, total: t.time * 60, fin: ahoraMs() + t.time * 60000, tipo: 'recompensa', nombre: t.name });
    else avisar(`¡Has usado '${t.name}'!`);
  }

  // ══ chat ═════════════════════════════════════════════════════════
  $$('#red-pestanas [data-red]').forEach((b) => b.onclick = () => {
    st.red = b.dataset.red;
    $$('#red-pestanas [data-red]').forEach((x) => x.classList.toggle('activa', x === b));
    $('#red-chat').classList.toggle('oculto', st.red !== 'chat'); $('#red-correo').classList.toggle('oculto', st.red !== 'correo');
    if (st.red === 'chat') { marcarLeido(st.sala); pintarChat(true); }
  });
  function mensajesSala(sala) {
    if (sala === 'General') return st.general.slice();
    const id = [yo, sala].sort().join('_');
    return Object.values(st.privEnv).concat(Object.values(st.privRec)).filter((m) => m.chat_id === id).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }
  function noLeidos(sala) {
    const visto = ((miAspecto().leidos) || {})[sala] || '';
    return mensajesSala(sala).filter((m) => m.sender !== yo && String(m.timestamp) > visto).length;
  }
  const chatVisible = () => st.panel === 'red' && st.red === 'chat';
  function avisosRed() {
    const hayChat = ['General'].concat(otros()).some((s) => noLeidos(s) && !(s === st.sala && chatVisible()));
    const hayCorreo = Object.values(st.correosRec).some((m) => !m.read);
    $('#n-chat2').classList.toggle('oculto', !hayChat); $('#n-correo2').classList.toggle('oculto', !hayCorreo);
    $('#n-red').classList.toggle('oculto', !(hayChat || hayCorreo));
  }
  function pintarSalas() {
    if (!yo) return;
    const salas = ['General'].concat(otros());
    $('#chat-salas').innerHTML = salas.map((s) => `<button data-sala="${esc(s)}" class="${s === st.sala ? 'activa' : ''}">${esc(s)}${noLeidos(s) && s !== st.sala ? '<i class="aviso"></i>' : ''}</button>`).join('');
    $('#chat-salas').querySelectorAll('button').forEach((b) => b.onclick = () => { st.sala = b.dataset.sala; marcarLeido(st.sala); pintarSalas(); pintarChat(true); });
    avisosRed();
  }
  function pintarChat(alFinal) {
    if (!yo) return;
    const caja = $('#chat-mensajes');
    const abajo = alFinal || caja.scrollHeight - caja.scrollTop - caja.clientHeight < 60;
    caja.innerHTML = mensajesSala(st.sala).map((m) => `<div class="msj ${m.sender === yo ? 'mio' : ''}">
      ${m.sender === yo ? '' : `<div class="de" style="color:${esc(colorDe(m.sender))}">${esc(m.sender)}</div>`}
      <div>${esc(m.message)}</div><div class="hora">${esc(String(m.timestamp).slice(5, 16))}</div></div>`).join('') || '<p class="sub">Sin mensajes todavía.</p>';
    if (abajo) caja.scrollTop = caja.scrollHeight;
    if (chatVisible() && noLeidos(st.sala)) marcarLeido(st.sala);
    avisosRed();
  }
  function marcarLeido(sala) {
    const ult = mensajesSala(sala).map((m) => String(m.timestamp)).sort().pop();
    if (!ult || (((miAspecto().leidos) || {})[sala] || '') >= ult) return;
    refYo().set({ leidos: { [sala]: ult } }, { merge: true });
  }
  $('#f-chat').onsubmit = async (ev) => {
    ev.preventDefault();
    const txt = $('#chat-texto').value.trim(); if (!txt) return;
    $('#chat-texto').value = '';
    const m = { sender: yo, timestamp: fechaISO(), message: txt, read: false, _mod: ahoraMs() };
    if (st.sala === 'General') await db.collection('chat_general').add(m);
    else await db.collection('chat_privado').add(Object.assign(m, { chat_id: [yo, st.sala].sort().join('_'), recipient: st.sala }));
  };
  $('#chat-texto').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('#f-chat').requestSubmit(); } });

  // ══ correo ═══════════════════════════════════════════════════════
  function pintarCorreos() {
    const lista = (st.bandeja === 'entrada' ? Object.values(st.correosRec) : Object.values(st.correosEnv)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('#l-correos').innerHTML = lista.map((m) => `<li class="correo ${st.bandeja === 'entrada' && !m.read ? 'nuevo' : ''}" data-id="${esc(m.id)}">
      <div class="c1"><span>${esc(st.bandeja === 'entrada' ? 'De: ' + m.sender : 'Para: ' + m.recipient)}</span><span>${esc(String(m.date).slice(0, 16))}</span></div>
      <div class="asunto">${esc(m.subject || '(sin asunto)')}</div></li>`).join('') || '<li class="sub">No hay correos.</li>';
    avisosRed();
  }
  $$('[data-bandeja]').forEach((b) => b.onclick = () => {
    st.bandeja = b.dataset.bandeja; $$('[data-bandeja]').forEach((x) => x.classList.toggle('activa', x === b)); pintarCorreos();
  });
  $('#l-correos').onclick = (ev) => {
    const li = ev.target.closest('.correo'); if (!li) return;
    const lista = Object.values(st.correosRec).concat(Object.values(st.correosEnv));
    const correo = lista.find((x) => x.id === li.dataset.id); if (!correo) return;
    if (correo.recipient === yo && !correo.read) {
      const docId = Object.keys(st.correosRec).find((k) => st.correosRec[k].id === correo.id);
      if (docId) db.collection('correos').doc(docId).update({ read: true, _mod: ahoraMs() });
    }
    abrirHoja(`<h2>${esc(correo.subject || '(sin asunto)')}</h2>
      <p class="sub">De: ${esc(correo.sender)} · Para: ${esc(correo.recipient)}<br>${esc(correo.date)}</p>
      <div class="cuerpo-correo">${esc(correo.body)}</div>
      <div class="botones">${correo.recipient === yo ? '<button class="primario" id="m-resp">Responder</button>' : ''}<button id="m-cerrar">Cerrar</button></div>`, (h) => {
      h.querySelector('#m-cerrar').onclick = cerrarHoja;
      if (h.querySelector('#m-resp')) h.querySelector('#m-resp').onclick = () => redactar(correo);
    });
  };
  function redactar(resp) {
    const para = otros();
    abrirHoja(`<h2>${resp ? 'Responder' : 'Nuevo correo'}</h2>
      <label>Para<select id="m-para">${para.map((u) => `<option ${resp && resp.sender === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
      <label>Cc</label><div>${para.map((u) => `<label class="marca"><input type="checkbox" class="m-cc" value="${esc(u)}"> ${esc(u)}</label>`).join('')}</div>
      <label>Asunto<input id="m-asunto" value="${esc(resp ? 'Re: ' + (resp.subject || '') : '')}"></label>
      <label>Mensaje<textarea id="m-cuerpo" rows="7">${esc(resp ? `\n\n--- ${resp.sender} escribió (${resp.date}) ---\n${resp.body}` : '')}</textarea></label>
      <p id="m-error" class="error"></p>
      <div class="botones"><button class="primario" id="m-enviar">Enviar</button><button id="m-cancelar">Cancelar</button></div>`, (h) => {
      h.querySelector('#m-cancelar').onclick = cerrarHoja;
      h.querySelector('#m-enviar').onclick = async () => {
        const destino = new Set([h.querySelector('#m-para').value]);
        h.querySelectorAll('.m-cc:checked').forEach((c) => destino.add(c.value));
        destino.delete(yo);
        if (!destino.size) { h.querySelector('#m-error').textContent = 'Elige un destinatario.'; return; }
        const lote = db.batch(), fecha = fechaISO();
        destino.forEach((rec) => {
          const id = uuid();
          lote.set(db.collection('correos').doc(id), { id, sender: yo, recipient: rec, subject: h.querySelector('#m-asunto').value, body: h.querySelector('#m-cuerpo').value, date: fecha, read: false, _mod: ahoraMs() });
        });
        await lote.commit(); cerrarHoja(); avisar('Correo enviado');
      };
    });
  }
  $('#b-redactar').onclick = () => redactar(null);


  // ══ bitácoras (mismo formato que KP: {username, entry, date "YYYY-mm-dd HH:MM"}; Gran Bitácora + type general|dream) ══
  const BIT = {
    personal: { col: 'bitacora', st: 'bitP', desc: 'Tu bitácora. Solo la ve tu aspecto.' },
    cosmica: { col: 'bitacora_cosmica', st: 'bitC', desc: 'Bitácora cósmica: compartida entre todos los aspectos. Cada uno firma la suya.' },
    gran: { col: 'gran_bitacora', st: 'bitG', desc: 'Gran Bitácora Universal: el registro central que comparten todos los aspectos. Notas y sueños.' }
  };
  function fechaBit(d = new Date()) { return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`; }
  function pintarBitacora() {
    if (!yo) return;
    const b = BIT[st.bit];
    $('#bit-desc').textContent = b.desc;
    $('#bit-modo').classList.toggle('oculto', st.bit !== 'gran');
    const sueno = st.bit === 'gran' && st.bitModo === 'dream';
    $('#bit-sueno').classList.toggle('oculto', !sueno);
    $('#bit-texto').placeholder = sueno ? 'Describe el sueño…' : st.bit === 'gran' ? 'Una nota para la Gran Bitácora…' : 'Escribe…';
    const q = st.bitBuscar.toLowerCase();
    const lista = Object.entries(st[b.st]).map(([id, e]) => Object.assign({ _id: id }, e))
      .filter((e) => st.bit !== 'gran' || (e.type || 'general') === st.bitModo)
      .filter((e) => !q || String(e.entry || '').toLowerCase().includes(q))
      .sort((a, c) => String(c.date).localeCompare(String(a.date)));
    $('#bit-lista').innerHTML = lista.map((e) => {
      const mio = st.bit === 'personal' || (st.bit === 'cosmica' ? e.username === yo : e.autor === yo);
      const autor = st.bit === 'gran' ? (e.autor || e.username || 'Yo') : st.bit === 'cosmica' ? (e.username || '') : '';
      const largo = String(e.entry || '').length > 260;
      return `<li data-id="${esc(e._id)}" class="${e.type === 'dream' ? 'sueno' : ''}">
        <div class="bit-cab"><span>${esc(e.date || '')}</span>${autor ? `<b style="color:${esc(colorDe(e.autor || e.username || ''))}">${esc(autor)}</b>` : ''}</div>
        <div class="bit-txt ${largo ? 'corto' : ''}">${esc(e.entry)}</div>
        ${mio ? '<button class="bit-borrar" data-borrar="1" aria-label="Eliminar entrada">×</button>' : ''}</li>`;
    }).join('') || `<li class="sub">${q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay entradas.'}</li>`;
  }
  $$('#bit-pestanas [data-bit]').forEach((x) => x.onclick = () => {
    st.bit = x.dataset.bit; $$('#bit-pestanas [data-bit]').forEach((y) => y.classList.toggle('activa', y === x)); pintarBitacora();
  });
  $$('#bit-modo [data-modo]').forEach((x) => x.onclick = () => {
    st.bitModo = x.dataset.modo; $$('#bit-modo [data-modo]').forEach((y) => y.classList.toggle('activa', y === x)); pintarBitacora();
  });
  $('#bit-claridad').oninput = () => { $('#bit-clar-n').textContent = $('#bit-claridad').value; };
  $('#bit-buscar').oninput = () => { st.bitBuscar = $('#bit-buscar').value.trim(); pintarBitacora(); };
  $('#f-bit').onsubmit = async (ev) => {
    ev.preventDefault();
    const texto = $('#bit-texto').value.trim();
    const b = BIT[st.bit];
    let doc;
    if (st.bit === 'gran' && st.bitModo === 'dream') {
      const tit = $('#bit-titulo').value.trim();
      if (!tit || !texto) { avisar('El título y la descripción no pueden estar vacíos'); return; }
      doc = { username: 'Yo', autor: yo, entry: `[SUEÑO] ${tit} (Claridad: ${$('#bit-claridad').value}/10)\n\n${texto}`, date: fechaBit(), type: 'dream' };
    } else {
      if (!texto) { avisar('La entrada no puede estar vacía'); return; }
      doc = st.bit === 'gran' ? { username: 'Yo', autor: yo, entry: texto, date: fechaBit(), type: 'general' } : { username: yo, entry: texto, date: fechaBit() };
    }
    doc._mod = ahoraMs(); doc.origen = 'web';
    try { await db.collection(b.col).add(doc); } catch (e) { avisar('No se pudo guardar: ' + e.message, 5000); return; }
    $('#bit-texto').value = ''; $('#bit-titulo').value = ''; $('#bit-claridad').value = 5; $('#bit-clar-n').textContent = '5';
    tic(); avisar(doc.type === 'dream' ? 'Sueño registrado en la Gran Bitácora' : 'Entrada guardada');
  };

  // ── traer bitácoras desde KP del PC (.cegg o los json de KP). Ids fijos por entrada: importar dos veces no duplica ──
  function hashTxt(str) {                 // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function leerJSONdeKP(txt) {
    const a = txt.indexOf('<<<DATA-START>>>'), b = txt.indexOf('<<<DATA-END>>>');
    return JSON.parse(a >= 0 ? txt.slice(a + 16, b > a ? b : undefined) : txt);
  }
  function entradasDeArchivo(nombre, datos) {
    const out = { personal: [], cosmica: [], gran: [] };
    const n = nombre.toLowerCase();
    if (Array.isArray(datos)) {
      if (n.includes('cosmic')) out.cosmica = datos;
      else if (n.includes('gran') || datos.some((e) => e && e.type)) out.gran = datos;
      else out.personal = datos;
    } else if (datos && typeof datos === 'object') {
      const pg = datos.perfil_global || {};
      out.gran = pg.gran_bitacora_universal || datos.gran_bitacora_universal || [];
      const pu = datos.perfiles_usuarios || {};
      const mio = pu[yo] || {};
      out.personal = ((mio.datos_cualitativos || {}).bitacora_personal || []).map((e) => Object.assign({ username: yo }, e));
      if (Array.isArray(datos.bitacora_cosmica)) out.cosmica = datos.bitacora_cosmica;
    }
    out.personal = out.personal.filter((e) => e && e.entry && (e.username || yo) === yo);   // la personal es solo tuya
    out.cosmica = out.cosmica.filter((e) => e && e.entry);
    out.gran = out.gran.filter((e) => e && e.entry);
    return out;
  }
  $('#bit-archivo').onchange = async (ev) => {
    const archivos = [...ev.target.files]; ev.target.value = '';
    if (!archivos.length) return;
    const todo = { personal: [], cosmica: [], gran: [] };
    for (const f of archivos) {
      try {
        const e = entradasDeArchivo(f.name, leerJSONdeKP(await f.text()));
        Object.keys(todo).forEach((k) => todo[k].push(...e[k]));
      } catch (e) { avisar(`No pude leer ${f.name}: ${e.message}`, 5000); }
    }
    const docs = [];
    todo.personal.forEach((e) => docs.push(['bitacora', 'bitP', { username: yo, entry: String(e.entry), date: e.date || '' }]));
    todo.cosmica.forEach((e) => docs.push(['bitacora_cosmica', 'bitC', { username: e.username || yo, entry: String(e.entry), date: e.date || '' }]));
    todo.gran.forEach((e) => docs.push(['gran_bitacora', 'bitG', { username: e.username || 'Yo', entry: String(e.entry), date: e.date || '', type: e.type || 'general' }]));
    let nuevas = 0, ya = 0, fallas = 0;
    avisar(`Trayendo ${docs.length} entradas…`, 2500);
    for (let i = 0; i < docs.length; i += 400) {
      const lote = db.batch(); let enLote = 0;
      docs.slice(i, i + 400).forEach(([col, clave, d]) => {
        const id = 'kp-' + hashTxt(col + '|' + d.username + '|' + d.date + '|' + d.entry);
        if (st[clave][id]) { ya++; return; }
        lote.set(db.collection(col).doc(id), Object.assign(d, { importado: true, origen: 'kp-pc', _mod: ahoraMs() }));
        enLote++;
      });
      if (!enLote) continue;
      try { await lote.commit(); nuevas += enLote; } catch (e) { fallas += enLote; console.warn('[KP] importar', e.message); }
    }
    if (fallas && !nuevas) avisar('Firebase no aceptó las entradas: publica las reglas nuevas de firestore.rules y vuelve a intentar.', 7000);
    else avisar(`Bitácoras: ${nuevas} entradas nuevas${ya ? ` · ${ya} ya estaban` : ''}${fallas ? ` · ${fallas} con error` : ''}`, 5000);
    tic();
  };
  $('#bit-lista').onclick = async (ev) => {
    const li = ev.target.closest('li[data-id]'); if (!li) return;
    if (ev.target.dataset.borrar) {
      if (!(await opcionesHoja('Eliminar entrada', '¿Eliminar esta entrada de la bitácora?', [{ t: 'Eliminar', v: 1 }, { t: 'Cancelar', v: 0, pri: 1 }]))) return;
      try { await db.collection(BIT[st.bit].col).doc(li.dataset.id).delete(); avisar('Entrada eliminada'); } catch (e) { avisar('No se pudo eliminar: ' + e.message, 5000); }
      return;
    }
    const t = li.querySelector('.bit-txt.corto'); if (t) t.classList.remove('corto');
  };


  // ══ MEGA TASK — el jefe final (kp828 v8.27): una sola, visible para todos los aspectos ══
  const MEGA_MULTIPLICADORES = [[2, 50], [3, 30], [5, 15], [7, 5]];
  const MEGA_HP_MAX = 100, MEGA_GOLPE_FASE = 15, MEGA_HP_MIN_VIVO = 10, MEGA_FRACCION_FASE = 0.2;
  const refMega = () => db.collection('mega').doc('estado');
  function tareaPorId(id) {
    const m = st.mega.activa;
    return st.tareas[id] || (m && m.id === id ? Object.assign({}, m) : null);
  }
  async function guardarCampos(id, cambios) {
    const m = st.mega.activa;
    if (m && m.id === id) {
      const nuevo = Object.assign({}, m, cambios); st.mega.activa = nuevo;
      await refMega().set({ activa: nuevo, _mod: ahoraMs() }, { merge: true });
    } else await refTarea(id).set(Object.assign({}, cambios, { _mod: ahoraMs() }), { merge: true });
  }
  function tirarMultiplicador() {
    const total = MEGA_MULTIPLICADORES.reduce((a, [, p]) => a + p, 0);
    let r = Math.random() * total;
    for (const [m, p] of MEGA_MULTIPLICADORES) { if ((r -= p) < 0) return m; }
    return 2;
  }
  const aspectosReales = () => Object.keys(st.aspectos).filter((u) => u !== 'Dios');
  async function repartirATodos(cant) {                 // los Pv del jefe van a todos los aspectos por igual
    if (cant <= 0) return;
    const lote = db.batch();
    aspectosReales().forEach((u) => {
      const cambios = { pv: FV.increment(cant), _mod: ahoraMs() };
      if (u === yo) cambios.pv_canjeables = FV.increment(cant);
      lote.set(db.collection('aspectos').doc(u), cambios, { merge: true });
    });
    await lote.commit();
  }
  const faseActual = (m) => { const f = (m.fases || []).find((x) => !x.hecha); return f ? f.nombre : null; };
  function pintarMega() {
    const m = st.mega.activa, fr = $('#mega-franja');
    if (!fr) return;
    fr.classList.toggle('oculto', !m);
    if (!m) return;
    const hp = +m.hp || 0, max = +m.hp_max || MEGA_HP_MAX;
    $('#mega-nombre').textContent = m.name || '';
    $('#mega-sub').textContent = `Próxima fase: ${faseActual(m) || 'agrega una fase'}  ·  ${diasDesde(m.mega_desde)} d como jefe  ·  toca para atacar`;
    $('#mega-vida').style.width = Math.max(2, 100 * hp / max) + '%';
    if (!$('#hoja').classList.contains('oculto') && $('#hoja').dataset.mega) hojaMega(true);
  }
  $('#mega-franja').onclick = () => hojaMega();

  async function pedirTexto(titulo, texto, placeholder, tipo = 'text') {
    return new Promise((res) => {
      let listo = false;
      abrirHoja(`<h2>${esc(titulo)}</h2><p class="sub">${esc(texto)}</p><input id="h-txt" type="${tipo}" ${tipo === 'number' ? 'min="1" inputmode="numeric"' : ''} placeholder="${esc(placeholder || '')}">
        <div class="botones"><button class="primario" id="h-ok">Aceptar</button><button id="h-no">Cancelar</button></div>`, (h) => {
        setTimeout(() => h.querySelector('#h-txt').focus(), 50);
        const fin = (v) => { listo = true; cerrarHoja(); res(v); };
        h.querySelector('#h-ok').onclick = () => fin(h.querySelector('#h-txt').value.trim());
        h.querySelector('#h-txt').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fin(h.querySelector('#h-txt').value.trim()); } };
        h.querySelector('#h-no').onclick = () => fin(null);
      }, () => { if (!listo) res(null); });
    });
  }

  async function declararMega(t) {
    if (t.completed) return;
    if (t.weekly_goal) { avisar('Un Objetivo Semanal ya es de todos los aspectos. Quítale la marca semanal primero.', 4500); return; }
    if (timer && timer.id === t.id) { avisar('Termina primero el timer de este pendiente.'); return; }
    if (st.mega.activa) {
      const actual = st.mega.activa.name || '';
      const ok = await opcionesHoja('Solo puede haber un jefe final', `La Mega Task actual es «${actual}». ¿Destronarla? Vuelve a la lista de su aspecto con sus fases.`,
        [{ t: 'Destronar y coronar la nueva', v: 1 }, { t: 'Cancelar', v: 0, pri: 1 }]);
      if (!ok || !(await destronarMega(true))) return;
    }
    let xp = t.xp;
    if (!(Number.isInteger(xp) && xp > 0)) {
      const v = await pedirTexto('Mega Task', '¿Cuántos Pv vale este jefe? Al vencerlo se multiplican x2, x3, x5 o x7 para todos.', 'Pv', 'number');
      xp = parseInt(v, 10); if (!(xp > 0)) return;
    }
    const fase1 = await pedirTexto('Primera fase', 'El jefe se vence por fases. ¿Cuál es el primer paso mínimo (unos 5 minutos)? Puedes dejarlo vacío y agregarlas después.', 'Ej: escribir 3 líneas pidiendo el informe');
    const mega = Object.assign({}, t, {
      xp, time: parseInt(t.time, 10) || 25, mega: true, mega_dueno: yo, mega_desde: fechaKP(),
      hp: MEGA_HP_MAX, hp_max: MEGA_HP_MAX, completed: false,
      fases: fase1 ? [{ nombre: fase1, hecha: false }] : []
    });
    delete mega._borrada; delete mega._mod;
    const lote = db.batch();
    lote.set(refMega(), { activa: mega, historial: st.mega.historial || [], _mod: ahoraMs() });
    lote.set(refTarea(t.id), { _borrada: true, _mod: ahoraMs() });
    await lote.commit();
    st.mega.activa = mega;
    campanas(); detonar(140);
    avisar('👑 Nueva Mega Task: ' + (t.name || ''), 3500);
    irA('ahora');
  }

  async function destronarMega(silencioso) {
    const m = st.mega.activa; if (!m) return true;
    if (timer && timer.id === m.id) { avisar('Hay un timer corriendo para el jefe: termínalo primero.'); return false; }
    const dueno = m.mega_dueno || yo;
    if (dueno !== yo) { avisar(`Solo ${dueno} puede destronarla (vuelve a su lista).`, 4000); return false; }
    if (!silencioso && !(await opcionesHoja('Destronar', '¿Devolver la Mega Task a una tarea normal? Sus fases quedan guardadas.', [{ t: 'Destronar', v: 1 }, { t: 'Cancelar', v: 0, pri: 1 }]))) return false;
    const normal = Object.assign({}, m); ['mega', 'hp', 'hp_max'].forEach((k) => delete normal[k]);
    normal.fases_mega = normal.fases || []; delete normal.fases; normal.completed = false; normal._mod = ahoraMs();
    const lote = db.batch();
    lote.set(refTarea(m.id), normal);
    lote.set(refMega(), { activa: null, _mod: ahoraMs() }, { merge: true });
    await lote.commit();
    st.mega.activa = null;
    if (!silencioso) avisar('La Mega Task volvió a tu lista');
    return true;
  }

  async function megaAgregarFase(nombre) {
    nombre = (nombre || '').trim(); const m = st.mega.activa;
    if (!nombre || !m) return;
    await guardarCampos(m.id, { fases: (m.fases || []).concat([{ nombre, hecha: false }]) });
    tic();
  }

  async function megaFaseCumplida(idx) {
    const m = st.mega.activa; if (!m) return;
    const fases = (m.fases || []).map((f) => Object.assign({}, f));
    if (!(idx >= 0 && idx < fases.length) || fases[idx].hecha) return;
    Object.assign(fases[idx], { hecha: true, fecha: fechaKP(), aspecto: yo });
    const hp = Math.max(MEGA_HP_MIN_VIVO, (+m.hp || MEGA_HP_MAX) - MEGA_GOLPE_FASE);
    const golpe = Math.max(1, Math.round((+m.xp || 0) * MEGA_FRACCION_FASE));
    await guardarCampos(m.id, { fases, hp });
    await repartirATodos(golpe);
    campanas(); detonar(90);
    avisar(`⚔ Golpe al jefe · vida ${hp}/${m.hp_max || MEGA_HP_MAX} · +${golpe} Pv para cada aspecto`, 4500);
  }

  async function vencerMega(modo, datos) {
    const m = st.mega.activa; if (!m) return;
    const ses = sesiones[m.id]; delete sesiones[m.id]; guardarSesiones();
    const base = +m.xp || 0, mult = tirarMultiplicador(), premio = base * mult;
    const vencida = Object.assign({}, m, { completed: true, hp: 0, multiplicador: mult, modo_cierre: modo || 'timer',
      date_completed: fechaKP(), vencido_por: yo });
    if (ses) vencida.tiempo_medido_min = Math.round((ahoraMs() - ses.inicio) / 6000) / 10;
    if (datos) vencida.cierre_vida = datos;
    const historial = (st.mega.historial || []).concat([vencida]).slice(-50);
    try {
      await refMega().set({ activa: null, historial, _mod: ahoraMs() });
      await repartirATodos(premio);
    } catch (e) { avisar('No se pudo guardar: ' + e.message, 5000); return; }
    st.mega.activa = null;
    const n = aspectosReales().length;
    campanas(); setTimeout(campanas, 450); detonar(260); setTimeout(() => detonar(160), 500);
    Flotante.celebrar(`<b>x${mult}</b>👑 ¡Jefe vencido!`, 3200);
    abrirHoja(`<div class="detona mega-victoria">
      <p class="toro">👑 ¡JEFE FINAL VENCIDO!</p>
      <p class="frase-final">«${esc(m.name)}»</p>
      <p>La suerte tiró</p><div class="mas-pv mult">x${mult}</div>
      <div class="mas-pv" id="cuenta">+0</div>
      <p>para cada uno de los ${n} aspectos</p>
      ${Math.random() < 0.5 ? `<div class="york">▸ TRANSMISIÓN · 2044 · YORK<br>${esc(azar(YORK))}</div>` : ''}
      </div><div class="botones"><button class="primario" id="c-ok">Volver al campo</button></div>`, (h) => {
      const el = h.querySelector('#cuenta'), t0 = performance.now(), dur = reducido ? 1 : 1400;
      const paso = (ts) => { const k = Math.min(1, (ts - t0) / dur); el.textContent = '+' + Math.round(premio * (1 - Math.pow(1 - k, 3))).toLocaleString('es-CL') + ' Pv'; if (k < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
      h.querySelector('#c-ok').onclick = () => { cerrarHoja(); irA('ahora'); };
    });
  }

  function hojaMega(refrescar) {
    const m = st.mega.activa;
    if (!m) { if (refrescar) cerrarHoja(); return; }
    const fases = m.fases || [];
    const html = `<div class="mega-hoja"><h2>👑 ${esc(m.name)}</h2>
      <p class="sub">Vida ${m.hp}/${m.hp_max || MEGA_HP_MAX} · ${m.xp} Pv base · al vencerlo x2, x3, x5 o x7 para todos · ${diasDesde(m.mega_desde)} d como jefe${m.mega_dueno ? ' · de ' + esc(m.mega_dueno) : ''}</p>
      <div class="mega-barra"><i style="width:${Math.max(2, 100 * (+m.hp || 0) / (m.hp_max || MEGA_HP_MAX))}%"></i></div>
      <label>Fases (cada una le quita vida al jefe y da Pv a todos)</label>
      <ul class="mega-fases">${fases.map((f, i) => `<li class="${f.hecha ? 'hecha' : ''}"><span>${esc(f.nombre)}${f.hecha && f.aspecto ? ` <small>· ${esc(f.aspecto)}</small>` : ''}</span>${f.hecha ? '<b>✓</b>' : `<button data-fase="${i}">⚔ Cumplida</button>`}</li>`).join('') || '<li class="sub">Sin fases todavía. Agrega un primer paso mínimo.</li>'}</ul>
      <div class="fila"><input id="mf-nueva" placeholder="Nueva fase (unos 5 minutos)"><button id="mf-agregar" style="flex:0 0 auto">➕ Fase</button></div>
      <div class="botones">
        <button class="primario" id="m-timer">⏱ Atacar con timer</button>
        <button id="m-vida">🌿 Lo vencí en mi vida</button>
        <button id="m-destronar">Destronar</button>
      </div></div>`;
    const montar = (h) => {
      h.dataset.mega = '1';
      h.querySelectorAll('[data-fase]').forEach((b) => b.onclick = () => megaFaseCumplida(+b.dataset.fase));
      const agregar = () => { const v = h.querySelector('#mf-nueva').value; megaAgregarFase(v); };
      h.querySelector('#mf-agregar').onclick = agregar;
      h.querySelector('#mf-nueva').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } };
      h.querySelector('#m-timer').onclick = () => { cerrarHoja(); iniciarTarea(tareaPorId(m.id), 'tarea'); };
      h.querySelector('#m-vida').onclick = () => { cerrarHoja(); cerrarEnVida(m.id, null); };
      h.querySelector('#m-destronar').onclick = async () => { cerrarHoja(); await destronarMega(false); };
    };
    if (refrescar) { $('#hoja').innerHTML = html; montar($('#hoja')); }
    else abrirHoja(html, montar, () => { delete $('#hoja').dataset.mega; });
  }

  // ══ zazen ════════════════════════════════════════════════════════
  let zazen = null;
  function guardarZazen() { try { zazen ? localStorage.setItem('kp_zazen_' + yo, JSON.stringify(zazen)) : localStorage.removeItem('kp_zazen_' + yo); } catch (e) { } }
  function reanudarZazen() { try { const z = JSON.parse(localStorage.getItem('kp_zazen_' + yo) || 'null'); if (z) { zazen = z; correrZazen(); } } catch (e) { } }
  function pintarZazen() {
    const n = Object.keys(st.dhana).length, dias = diasZazen(), d = new Date(); let html = '';
    for (let i = 6; i >= 0; i--) {
      const x = new Date(d); x.setDate(d.getDate() - i);
      const k = `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}`;
      html += `<i class="${dias.has(k) ? 'si' : ''}" title="${k}"></i>`;
    }
    $('#z-semana').innerHTML = html;
    $('#z-resumen').textContent = `${dhanaTotal()} $D · ${n} ${n === 1 ? 'sesión' : 'sesiones'} · racha ${racha()} días`;
  }
  function correrZazen() {
    $('#z-iniciar').disabled = true;
    clearInterval(correrZazen._i);
    correrZazen._i = setInterval(() => {
      const resta = Math.max(0, Math.ceil((zazen.fin - ahoraMs()) / 1000));
      $('#z-reloj').textContent = mmss(resta);
      if (resta === 0) { gong(); cerrarZazen(); }
    }, 250);
  }
  async function cerrarZazen() {
    if (!zazen) return;
    clearInterval(correrZazen._i);
    const z = zazen; zazen = null; guardarZazen();
    $('#z-iniciar').disabled = false;
    $('#z-reloj').textContent = `${dos($('#z-minutos').value || 5)}:00`;
    const real = Math.min(z.plan, Math.round((ahoraMs() - z.inicio) / 1000));
    if (real < 5) return;
    const d = new Date(z.inicio);
    const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
    await db.collection('dhana').add({ aspecto: yo, fecha, contexto: 'voluntaria', plan_seg: z.plan, real_seg: real, completa: real >= z.plan, _mod: ahoraMs() });
    avisar(`Zazen registrado: ${Math.floor(real / 60)} min ${real % 60} s`);
  }
  $('#z-iniciar').onclick = () => {
    if (zazen) return;
    const min = parseInt($('#z-minutos').value, 10);
    if (!(min > 0)) { avisar('Por favor, ingresa una duración válida.'); return; }
    zazen = { plan: min * 60, inicio: ahoraMs(), fin: ahoraMs() + min * 60000 };
    guardarZazen(); gong(); correrZazen();
  };
  $('#z-detener').onclick = () => cerrarZazen();
  $('#z-minutos').oninput = () => { if (!zazen) $('#z-reloj').textContent = `${dos($('#z-minutos').value || 0)}:00`; };

  // ══ ajustes ══════════════════════════════════════════════════════
  function pintarAjustes() {
    $('#aj-flotar').checked = !!pref.flotar; $('#aj-sonido').checked = !!pref.sonido; $('#aj-pantalla').checked = !!pref.pantalla;
    const s = Flotante.soporte();
    $('#aj-pip-info').textContent = s === 'doc' ? 'Ventana flotante: completa, con botones (este navegador de PC la soporta).'
      : s ? 'Ventana flotante: el timer flota sobre cualquier app. Al terminar llega una notificación; responde al volver.'
        : 'Este navegador no tiene ventana flotante. En Android y PC usa Chrome; en iPhone, Safari.';
  }
  [['#aj-flotar', 'flotar'], ['#aj-sonido', 'sonido'], ['#aj-pantalla', 'pantalla']].forEach(([s, k]) => $(s).onchange = () => { pref[k] = $(s).checked; guardarPref(); });

  // ══ huevo cósmico (.cegg) ═══════════════════════════════════════
  function huevo() {
    const a = miAspecto(), nv = nivel(a.pv || 0), tareas = Object.values(st.tareas), sesionesZ = Object.values(st.dhana);
    return {
      version: 'cegg-web-1', origen: 'app web KP', generado: new Date().toISOString(),
      perfil_arquetipo: { nombre: yo, color_hex: colorDe(yo), nivel_actual: nv.n, xp_en_nivel_actual: nv.resto, xp_para_siguiente_nivel: nv.sig },
      metricas: { pv_total: a.pv || 0, pv_canjeables: a.pv_canjeables || 0, mu: a.mu || 0, dhana: dhanaTotal(), sesiones_zazen: sesionesZ.length, racha_zazen: racha(),
        tareas_pendientes: tareas.filter((t) => !t.completed).length, tareas_completadas: tareas.filter((t) => t.completed).length },
      tareas, zazen: sesionesZ.map((s) => ({ fecha: s.fecha, contexto: s.contexto, plan_seg: s.plan_seg, real_seg: s.real_seg, completa: s.completa }))
    };
  }
  let huevoT = null;
  function guardarHuevoLuego() {
    if (!yo) return;
    clearTimeout(huevoT);
    huevoT = setTimeout(() => {
      let h = huevo();
      if (JSON.stringify(h).length > 900000) h = Object.assign(h, { tareas: h.tareas.filter((t) => !t.completed) });
      db.collection('huevos').doc(yo).set(Object.assign(h, { _mod: ahoraMs() })).catch((e) => console.warn('[KP] huevo', e.message));
    }, 3000);
  }
  $('#b-cegg').onclick = () => {
    const blob = new Blob([JSON.stringify(huevo(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `HuevoCosmico_${yo}.cegg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ══ PWA ══════════════════════════════════════════════════════════
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
    navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'kp-foco' && timer) mostrarFoco(); });
  }

  window.KP_WEB = { st, nivel, presion, multiplicadorCalibracion, interpretar, get yo() { return yo; }, get timer() { return timer; }, sesiones: () => sesiones };
  iniciar();
})();
