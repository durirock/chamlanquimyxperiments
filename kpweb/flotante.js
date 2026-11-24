// Killer Pendiente · ventana flotante (Picture-in-Picture) y reloj de fondo.
//
// · PC (Chrome/Edge):  Document Picture-in-Picture → ventana siempre encima, con botones
//                      (listo, me distraje) y las preguntas de cierre dentro de ella.
// · Celular (Android / iPhone): no existe Document PiP. Se dibuja el timer en un <canvas>,
//                      se convierte en video (captureStream) y ese video entra en PiP:
//                      flota sobre cualquier app. Es solo de mirar (Android no permite tocar
//                      botones propios), al terminar llega una notificación.
// · Reloj: un Web Worker marca el paso cada 250 ms. Los workers no se congelan cuando
//          la pestaña queda en segundo plano, así la ventana flotante sigue avanzando.
(function () {
  'use strict';

  // ── reloj de fondo ─────────────────────────────────────────────
  const Reloj = (() => {
    let w = null, intervalo = null, fn = null;
    function iniciar(cb) {
      fn = cb; detener();
      try {
        const src = 'let t=null;onmessage=e=>{clearInterval(t);if(e.data==="go")t=setInterval(()=>postMessage(0),250)};';
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = () => fn && fn();
        w.postMessage('go');
      } catch (e) { intervalo = setInterval(() => fn && fn(), 250); }
    }
    function detener() {
      if (w) { try { w.postMessage('stop'); w.terminate(); } catch (e) { } w = null; }
      clearInterval(intervalo); intervalo = null;
    }
    return { iniciar, detener };
  })();

  // ── detección ─────────────────────────────────────────────────
  const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  function soporte() {
    if (!esMovil && 'documentPictureInPicture' in window) return 'doc';
    const v = document.createElement('video');
    if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') return 'video';
    if (typeof v.webkitSetPresentationMode === 'function') return 'webkit';
    if ('documentPictureInPicture' in window) return 'doc';
    return null;
  }

  let modo = null;            // 'doc' | 'video' | 'webkit' | null (abierto)
  let docWin = null, el = {};
  let canvas = null, ctx = null, video = null;
  let ultimo = null;          // último estado pintado
  let alAccion = () => { };
  let pregunta = null;        // {resolver}

  const dos = (n) => String(n).padStart(2, '0');
  const mmss = (s) => `${dos(Math.floor(s / 60))}:${dos(s % 60)}`;

  // ── Document PiP (PC) ─────────────────────────────────────────
  const CSS_DOC = `
    *{box-sizing:border-box}html,body{margin:0;height:100%}
    body{background:#030605;color:#e6efe9;font:15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      display:flex;flex-direction:column;padding:10px 12px;gap:6px;user-select:none;overflow:hidden;
      background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--asp) 16%,#030605),#030605 70%)}
    .cab{display:flex;align-items:center;gap:8px;font-size:12px;color:#8fa39a;letter-spacing:.08em;text-transform:uppercase}
    .pt{width:9px;height:9px;border-radius:50%;background:var(--asp);box-shadow:0 0 10px var(--asp)}
    .reloj{font-size:min(17vw,62px);font-weight:200;font-variant-numeric:tabular-nums;line-height:1;text-align:center;margin-top:2px}
    .fin .reloj{color:#ff5d6c;animation:p 1s infinite}@keyframes p{50%{opacity:.4}}
    .nom{text-align:center;color:#8fa39a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .barra{height:4px;background:#1f2d27;border-radius:4px;overflow:hidden}.barra i{display:block;height:100%;background:var(--asp);width:100%;transition:width .3s linear}
    .bot{display:flex;gap:8px;margin-top:auto}
    button{flex:1;min-height:38px;border-radius:10px;border:1px solid #1f2d27;background:#121b17;color:#e6efe9;font:inherit;cursor:pointer}
    button:hover{border-color:var(--asp)}button.pri{background:var(--asp);color:#04110a;border-color:transparent;font-weight:700}
    .preg{display:none;flex-direction:column;gap:6px;flex:1;overflow:auto}.preg h4{margin:0;font-size:15px}.preg p{margin:0;color:#8fa39a;font-size:13px}
    .preg .ops{display:flex;flex-wrap:wrap;gap:6px}.preg .ops button{flex:1 1 40%;min-height:34px}
    body.preguntando .reloj,body.preguntando .nom,body.preguntando .barra,body.preguntando .bot{display:none}
    body.preguntando .preg{display:flex}
    .ok{display:none;text-align:center;margin:auto}.ok b{display:block;font-size:34px;color:var(--asp)}
    body.celebra>*:not(.ok){display:none!important}body.celebra .ok{display:block}`;

  async function abrirDoc() {
    docWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 210 });
    const d = docWin.document;
    const st = d.createElement('style'); st.textContent = CSS_DOC; d.head.appendChild(st);
    d.title = 'Killer Pendiente';
    d.body.innerHTML = `
      <div class="cab"><span class="pt"></span><span data-k="asp"></span></div>
      <div class="reloj" data-k="reloj">00:00</div>
      <div class="nom" data-k="nom"></div>
      <div class="barra"><i data-k="barra"></i></div>
      <div class="bot"><button data-a="distraccion">me distraje</button><button class="pri" data-a="listo">listo</button></div>
      <div class="preg" data-k="preg"><h4 data-k="ptit"></h4><p data-k="ptxt"></p><div class="ops" data-k="pops"></div></div>
      <div class="ok" data-k="ok"></div>`;
    el = {};
    d.querySelectorAll('[data-k]').forEach((n) => { el[n.dataset.k] = n; });
    d.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => alAccion(b.dataset.a)));
    docWin.addEventListener('pagehide', () => {
      docWin = null; el = {}; if (modo === 'doc') modo = null;
      if (pregunta) { const p = pregunta; pregunta = null; p.resolver(undefined); }
    });
    modo = 'doc';
    if (ultimo) pintar(ultimo);
  }

  // ── Video PiP (celular) ───────────────────────────────────────
  function preparar() {                       // se llama dentro del gesto que inicia el timer
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    ctx = canvas.getContext('2d');
    dibujarCanvas(ultimo || { resta: 0, total: 1, nombre: '', aspecto: '', color: '#7dffb0' });
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(video);
    try { video.srcObject = canvas.captureStream(8); } catch (e) { }
    video.addEventListener('leavepictureinpicture', () => { if (modo === 'video') modo = null; });
    video.addEventListener('webkitpresentationmodechanged', () => {
      if (video.webkitPresentationMode !== 'picture-in-picture' && modo === 'webkit') modo = null;
    });
    video.play().catch(() => { });
  }

  function lineas(c, txt, x, y, ancho, alto, max) {
    const pal = String(txt || '').split(/\s+/); let l = '', n = 0;
    for (let i = 0; i < pal.length; i++) {
      const p = l ? l + ' ' + pal[i] : pal[i];
      if (c.measureText(p).width > ancho && l) {
        n++; if (n === max) { c.fillText(l.replace(/.{1}$/, '…'), x, y); return; }
        c.fillText(l, x, y); y += alto; l = pal[i];
      } else l = p;
    }
    if (l) c.fillText(l, x, y);
  }

  function dibujarCanvas(e) {
    if (!ctx) return;
    const c = ctx, W = 640, H = 360, col = e.color || '#7dffb0';
    c.fillStyle = '#030605'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(170, 180, 10, 170, 180, 260);
    g.addColorStop(0, col + '33'); g.addColorStop(1, '#03060500');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const frac = e.total ? Math.max(0, Math.min(1, e.resta / e.total)) : 0;
    // anillo
    c.lineWidth = 16; c.lineCap = 'round';
    c.strokeStyle = '#1f2d27'; c.beginPath(); c.arc(170, 180, 120, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = e.final ? '#ff5d6c' : col; c.shadowColor = c.strokeStyle; c.shadowBlur = 18;
    c.beginPath(); c.arc(170, 180, 120, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (e.final ? 1 : frac)); c.stroke();
    c.shadowBlur = 0;
    // reloj
    c.fillStyle = e.final ? '#ff5d6c' : '#e6efe9'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '300 68px system-ui, -apple-system, Roboto, sans-serif';
    c.fillText(mmss(Math.max(0, e.resta | 0)), 170, 184);
    // texto derecho
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = col; c.font = '700 22px system-ui, -apple-system, Roboto, sans-serif';
    c.fillText(String(e.aspecto || 'KILLER PENDIENTE').toUpperCase(), 330, 84);
    c.fillStyle = '#e6efe9'; c.font = '600 34px system-ui, -apple-system, Roboto, sans-serif';
    lineas(c, e.final ? '¡Tiempo! Vuelve a KP' : e.nombre, 330, 140, 285, 42, 4);
    c.fillStyle = '#5b6d65'; c.font = '500 18px system-ui, -apple-system, Roboto, sans-serif';
    c.fillText(e.tipo === 'recompensa' ? 'recompensa' : 'killer pendiente', 330, 330);
  }

  async function abrirVideo() {
    preparar();
    try { await video.play(); } catch (e) { }
    if (video.readyState < 1) {
      await new Promise((r) => { video.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 800); });
    }
    if (soporte() === 'webkit' || typeof video.requestPictureInPicture !== 'function') {
      video.webkitSetPresentationMode('picture-in-picture'); modo = 'webkit';
    } else {
      await video.requestPictureInPicture(); modo = 'video';
    }
  }

  // ── API ───────────────────────────────────────────────────────
  async function abrir() {
    if (modo) return true;
    const s = soporte();
    try {
      if (s === 'doc') await abrirDoc();
      else if (s === 'video' || s === 'webkit') await abrirVideo();
      else return false;
      return true;
    } catch (e) { console.warn('[KP] PiP:', e && e.message); modo = null; return false; }
  }

  function cerrar() {
    if (pregunta) { const p = pregunta; pregunta = null; p.resolver(undefined); }
    try { if (docWin) docWin.close(); } catch (e) { }
    docWin = null;
    try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) { }
    try { if (video && video.webkitPresentationMode === 'picture-in-picture') video.webkitSetPresentationMode('inline'); } catch (e) { }
    modo = null;
  }

  function pintar(e) {
    ultimo = e;
    if (modo === 'doc' && docWin && el.reloj) {
      docWin.document.documentElement.style.setProperty('--asp', e.color || '#7dffb0');
      el.reloj.textContent = mmss(Math.max(0, e.resta | 0));
      el.nom.textContent = e.final ? '¡Tiempo!' : (e.nombre || '');
      el.asp.textContent = e.tipo === 'recompensa' ? 'recompensa' : (e.aspecto || '');
      el.barra.style.width = (e.total ? Math.max(0, Math.min(100, 100 * e.resta / e.total)) : 0) + '%';
      docWin.document.body.classList.toggle('fin', !!e.final);
      const bot = docWin.document.querySelector('.bot');
      if (bot) bot.style.display = e.tipo === 'recompensa' ? 'none' : '';
    }
    if (ctx) dibujarCanvas(e);
  }

  // Pregunta con botones dentro de la ventana flotante (solo PC). Devuelve el valor elegido.
  function preguntar(titulo, texto, opciones) {
    if (modo !== 'doc' || !docWin) return Promise.resolve(undefined);
    if (pregunta) { const p = pregunta; pregunta = null; p.resolver(undefined); }
    const b = docWin.document.body;
    el.ptit.textContent = titulo; el.ptxt.textContent = texto || '';
    el.pops.innerHTML = '';
    return new Promise((resolver) => {
      pregunta = { resolver };
      opciones.forEach((o) => {
        const bt = docWin.document.createElement('button');
        bt.textContent = o.t; if (o.pri) bt.className = 'pri';
        bt.onclick = () => { b.classList.remove('preguntando'); const p = pregunta; pregunta = null; if (p) p.resolver(o.v); };
        el.pops.appendChild(bt);
      });
      b.classList.add('preguntando');
    });
  }

  function celebrar(html, ms = 2600) {
    if (modo !== 'doc' || !docWin) { cerrar(); return; }
    el.ok.innerHTML = html; docWin.document.body.classList.add('celebra');
    setTimeout(() => cerrar(), ms);
  }

  window.Flotante = {
    soporte, esMovil, preparar, abrir, cerrar, pintar, preguntar, celebrar,
    lienzo: () => canvas, abierto: () => !!modo, interactivo: () => modo === 'doc' && !!docWin,
    alAccion: (fn) => { alAccion = fn; }
  };
  window.Reloj = Reloj;
})();
