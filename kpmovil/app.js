// Killer Pendiente — app web (celular). Mismos datos que KP del PC, vía Firebase.
// Tareas con prioridades · timer popup · niveles · chat · zazen · correo · huevo (.cegg) automático.
(function () {
  'use strict';

  const NIVEL_BASE = 50;                       // igual que KP: costo(N→N+1) = 50·N·(N+1)
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dos = (n) => String(n).padStart(2, '0');
  const ahoraMs = () => Date.now();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'w' + Math.random().toString(16).slice(2) + Date.now().toString(16));

  let db, auth, FV;
  let yo = null;
  const st = {
    aspectos: {}, tareas: {}, general: [], privEnv: {}, privRec: {}, correosRec: {}, correosEnv: {}, dhana: {},
    sala: 'General', bandeja: 'entrada', verCompletadas: false, desuscribir: []
  };

  // ── fechas (mismos formatos que KP) ──
  function fechaKP(d = new Date()) {         // date_added / date_completed: dd-mm-YYYY HH:MM:SS
    return `${dos(d.getDate())}-${dos(d.getMonth() + 1)}-${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
  }
  function fechaDia(d = new Date()) { return `${dos(d.getDate())}-${dos(d.getMonth() + 1)}-${d.getFullYear()}`; }
  function fechaISO(d = new Date()) {        // chat / correo: YYYY-mm-dd HH:MM:SS
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
  }
  function leerFecha(s) {
    if (!s) return null;
    let m = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return null;
  }
  function diasDesde(s) { const d = leerFecha(s); return d ? Math.max(0, Math.floor((Date.now() - d) / 86400000)) : 0; }

  // ── reglas de KP ──
  function nivel(xp) {
    let n = 1, resto = xp || 0, sig = NIVEL_BASE * n * (n + 1);
    while (resto >= sig) { resto -= sig; n += 1; sig = NIVEL_BASE * n * (n + 1); }
    return { n, resto, sig };
  }
  function presion(t) {                       // días × peso prioridad × aplazos × Pv (igual que KP)
    const dias = diasDesde(t.date_added);
    const peso = { A: 3, B: 2, C: 1 }[t.priority] || 1;
    const pv = Math.min(t.xp || 0, 100);
    return Math.round(dias * peso * (1 + (t.delays || 0) * 0.3) * (1 + pv / 200));
  }
  function colorPresion(p) {                  // fresco → cálido → rojo vino
    const k = Math.min(1, Math.log1p(p) / Math.log1p(400));
    const a = [88, 196, 106], b = [245, 200, 66], c = [150, 20, 40];
    const mezcla = (x, y, q) => x.map((v, i) => Math.round(v + (y[i] - v) * q));
    const r = k < 0.5 ? mezcla(a, b, k * 2) : mezcla(b, c, (k - 0.5) * 2);
    return `rgb(${r.join(',')})`;
  }
  function multiplicador(t, fraccion) {
    let m = 1;
    if (fraccion >= 0.5) m *= 1.5; else if (fraccion >= 0.2) m *= 1.2;
    const ap = t.delays || 0;
    if (ap > 0) m *= Math.pow(0.85, ap);
    return m;
  }
  const otros = () => Object.keys(st.aspectos).filter((u) => u !== yo && u !== 'Dios').sort();
  const colorDe = (u) => (st.aspectos[u] && st.aspectos[u].color) || '#93a59b';
  const miAspecto = () => st.aspectos[yo] || {};
  const refYo = () => db.collection('aspectos').doc(yo);
  const refTarea = (id, u = yo) => db.collection('aspectos').doc(u).collection('tareas').doc(id);

  // ── utilidades de interfaz ──
  function avisar(txt, ms = 2600) {
    const a = $('#aviso'); a.textContent = txt; a.classList.remove('oculto');
    clearTimeout(avisar._t); avisar._t = setTimeout(() => a.classList.add('oculto'), ms);
  }
  function abrirHoja(html, alMontar) {
    $('#hoja').innerHTML = html; $('#hoja').classList.remove('oculto'); $('#velo').classList.remove('oculto');
    if (alMontar) alMontar($('#hoja'));
  }
  function cerrarHoja() { $('#hoja').classList.add('oculto'); $('#velo').classList.add('oculto'); $('#hoja').innerHTML = ''; }
  function preguntar(titulo, texto, si = 'Sí', no = 'No') {
    return new Promise((res) => {
      abrirHoja(`<h2>${esc(titulo)}</h2><p>${esc(texto)}</p><div class="botones"><button class="primario" data-r="1">${esc(si)}</button><button data-r="0">${esc(no)}</button></div>`,
        (h) => h.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { cerrarHoja(); res(b.dataset.r === '1'); }));
    });
  }
  function pedirNumero(titulo, texto, valor = '') {
    return new Promise((res) => {
      abrirHoja(`<h2>${esc(titulo)}</h2><label>${esc(texto)}<input id="h-num" type="number" min="1" inputmode="numeric" value="${esc(valor)}"></label>
        <div class="botones"><button class="primario" id="h-ok">Aceptar</button><button id="h-no">Cancelar</button></div>`, (h) => {
        h.querySelector('#h-num').focus();
        h.querySelector('#h-ok').onclick = () => { const v = parseInt(h.querySelector('#h-num').value, 10); cerrarHoja(); res(v > 0 ? v : null); };
        h.querySelector('#h-no').onclick = () => { cerrarHoja(); res(null); };
      });
    });
  }
  $('#velo').onclick = cerrarHoja;

  // gong sintetizado (no hace falta archivo de audio)
  let audio = null;
  function gong() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      [[110, 0.5, 7], [220.5, 0.28, 5], [303, 0.2, 4], [418, 0.12, 3], [592, 0.08, 2.2]].forEach(([f, g, d]) => {
        const o = audio.createOscillator(), v = audio.createGain();
        o.frequency.value = f; o.type = 'sine';
        v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(v).connect(audio.destination); o.start(t); o.stop(t + d + 0.1);
      });
    } catch (e) { /* sin audio */ }
    if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  }

  // ── entrada ──
  function iniciar() {
    const cfg = window.KP_FIREBASE || {};
    if (!cfg.apiKey || String(cfg.apiKey).indexOf('PEGA') === 0) {
      $('#e-error').textContent = 'Falta configurar Firebase en config.js.';
      return;
    }
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    FV = firebase.firestore.FieldValue;
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { });   // sigue andando sin señal
    auth.onAuthStateChanged(async (u) => {
      if (!u) { salirDeApp(); return; }
      try {
        const tok = await u.getIdTokenResult(true);
        const asp = tok.claims && tok.claims.aspecto;
        if (!asp) {
          $('#e-error').textContent = 'Esta cuenta no está ligada a un aspecto. Créala con: python kp_nube.py crear-cuenta';
          auth.signOut(); return;
        }
        entrarApp(asp);
      } catch (e) { $('#e-error').textContent = 'No se pudo entrar: ' + e.message; }
    });
  }
  $('#f-entrada').onsubmit = async (ev) => {
    ev.preventDefault();
    $('#e-error').textContent = '';
    try { await auth.signInWithEmailAndPassword($('#e-correo').value.trim(), $('#e-clave').value); }
    catch (e) { $('#e-error').textContent = 'Correo o contraseña incorrectos.'; }
  };
  function salirDeApp() {
    st.desuscribir.forEach((f) => { try { f(); } catch (e) { } }); st.desuscribir = [];
    yo = null; $('#v-app').classList.remove('activa'); $('#v-entrada').classList.add('activa');
  }

  function entrarApp(asp) {
    yo = asp;
    $('#v-entrada').classList.remove('activa'); $('#v-app').classList.add('activa');
    const oir = (q, fn) => st.desuscribir.push(q.onSnapshot(fn, (e) => console.warn('[KP]', e.message)));
    oir(db.collection('aspectos'), (s) => {
      st.aspectos = {}; s.docs.forEach((d) => { st.aspectos[d.id] = d.data(); });
      pintarCabecera(); pintarPerfil(); pintarSalas(); pintarChat(); guardarHuevoLuego();
    });
    oir(refYo().collection('tareas'), (s) => {
      st.tareas = {}; s.docs.forEach((d) => { const t = d.data(); if (!t._borrada) st.tareas[d.id] = Object.assign({ id: d.id }, t); });
      pintarTareas(); guardarHuevoLuego();
      $('#c-red').classList.toggle('fuera', !navigator.onLine);
    });
    oir(db.collection('chat_general').orderBy('timestamp').limitToLast(300), (s) => {
      st.general = s.docs.map((d) => d.data()); pintarChat(); pintarSalas();
    });
    oir(db.collection('chat_privado').where('sender', '==', yo), (s) => { st.privEnv = mapa(s); pintarChat(); });
    oir(db.collection('chat_privado').where('recipient', '==', yo), (s) => { st.privRec = mapa(s); pintarChat(); pintarSalas(); });
    oir(db.collection('correos').where('recipient', '==', yo), (s) => { st.correosRec = mapa(s); pintarCorreos(); });
    oir(db.collection('correos').where('sender', '==', yo), (s) => { st.correosEnv = mapa(s); pintarCorreos(); });
    oir(db.collection('dhana').where('aspecto', '==', yo), (s) => { st.dhana = mapa(s); pintarZazen(); pintarCabecera(); pintarPerfil(); guardarHuevoLuego(); });
    reanudarTimer();
    reanudarZazen();
  }
  const mapa = (s) => { const m = {}; s.docs.forEach((d) => { m[d.id] = d.data(); }); return m; };

  function red() { $('#c-red').textContent = navigator.onLine ? 'en línea' : 'sin señal · se sube al volver'; $('#c-red').classList.toggle('fuera', !navigator.onLine); }
  window.addEventListener('online', red); window.addEventListener('offline', red);

  // ── navegación ──
  document.querySelectorAll('.navegacion button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.navegacion button').forEach((x) => x.classList.toggle('activa', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('activa', p.id === 'p-' + b.dataset.panel));
    if (b.dataset.panel === 'chat') { marcarLeido(st.sala); pintarChat(true); }
  });

  // ── cabecera y perfil ──
  function dhanaTotal() { return Math.floor(Object.values(st.dhana).reduce((a, s) => a + (s.real_seg || 0), 0) / 60); }
  function pintarCabecera() {
    if (!yo) return;
    const a = miAspecto(), nv = nivel(a.pv || 0);
    $('#c-nombre').textContent = yo;
    $('#c-punto').style.background = colorDe(yo); $('#c-punto').style.color = colorDe(yo);
    $('#c-nivel').textContent = 'Nivel ' + nv.n;
    $('#c-pv').textContent = `${(a.pv || 0).toLocaleString('es-CL')} Pv · ${nv.resto}/${nv.sig}`;
    $('#c-barra').style.width = Math.round(100 * nv.resto / nv.sig) + '%';
    $('#c-mu').textContent = (a.mu || 0) + ' Mu';
    $('#c-dhana').textContent = dhanaTotal() + ' $D';
    red();
  }
  function racha() {
    const dias = new Set(Object.values(st.dhana).map((s) => String(s.fecha || '').slice(0, 10)));
    const d = new Date(); let n = 0;
    const clave = (x) => `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}`;
    if (!dias.has(clave(d))) d.setDate(d.getDate() - 1);
    while (dias.has(clave(d))) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  }
  function pintarPerfil() {
    if (!yo) return;
    const a = miAspecto(), nv = nivel(a.pv || 0);
    $('#pf-nombre').textContent = yo; $('#pf-nombre').style.color = colorDe(yo);
    const filas = [['Nivel', nv.n], ['Voluntad total', (a.pv || 0).toLocaleString('es-CL') + ' Pv'],
      ['En este nivel', `${nv.resto} / ${nv.sig} Pv`], ['Pv canjeables', a.pv_canjeables || 0],
      ['Monedas universales', (a.mu || 0) + ' Mu'], ['Dhana', dhanaTotal() + ' $D'],
      ['Sesiones de zazen', Object.keys(st.dhana).length], ['Racha', racha() + ' días']];
    $('#pf-datos').innerHTML = filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }
  $('#b-salir').onclick = async () => { if (await preguntar('Cerrar sesión', '¿Salir de ' + yo + '?')) auth.signOut(); };

  // ── tareas ──
  function ordenarPendientes(lista) {
    const dias = (t) => diasDesde(t.date_added);
    const semanales = lista.filter((t) => t.weekly_goal).sort((a, b) => dias(b) - dias(a));
    const premios = lista.filter((t) => !t.weekly_goal && (t.is_reward || t.priority === 'R')).sort((a, b) => dias(b) - dias(a));
    const resto = lista.filter((t) => !t.weekly_goal && !(t.is_reward || t.priority === 'R'))
      .sort((a, b) => ('ABC'.indexOf(a.priority) - 'ABC'.indexOf(b.priority)) || (dias(b) - dias(a)));
    return semanales.concat(premios, resto);
  }
  function itemTarea(t) {
    const d = diasDesde(t.date_added), p = presion(t);
    const chip = t.weekly_goal ? '<span class="chip S">Semanal</span>' : `<span class="chip ${esc(t.priority)}">${esc(t.priority)}</span>`;
    const sub = Array.isArray(t.subtasks) && t.subtasks.length ? ` · ${t.subtasks.filter((s) => s.completed).length}/${t.subtasks.length} sub` : '';
    return `<li class="tarea" data-id="${esc(t.id)}" style="--presion:${colorPresion(p)}">
      <div class="t1">${chip}<span class="nombre">${esc(t.name)}</span></div>
      <div class="t2"><span>${t.xp || 0} Pv</span><span>${t.time || 0} min</span><span>${d} ${d === 1 ? 'día' : 'días'}</span>${t.delays ? `<span>${t.delays} aplazos</span>` : ''}${sub}</div></li>`;
  }
  function pintarTareas() {
    const todas = Object.values(st.tareas);
    const pend = ordenarPendientes(todas.filter((t) => !t.completed));
    const hechas = todas.filter((t) => t.completed).sort((a, b) => (leerFecha(b.date_completed) || 0) - (leerFecha(a.date_completed) || 0));
    $('#l-tareas').innerHTML = pend.length ? pend.map(itemTarea).join('') : '<li class="sub">Sin pendientes. Agrega uno.</li>';
    $('#b-ver-completadas').textContent = hechas.length ? `${st.verCompletadas ? 'Ocultar' : 'Ver'} completadas (${hechas.length})` : '';
    $('#l-completadas').innerHTML = hechas.slice(0, 100).map(itemTarea).join('');
    $('#l-completadas').classList.toggle('oculto', !st.verCompletadas);
  }
  $('#b-ver-completadas').onclick = () => { st.verCompletadas = !st.verCompletadas; pintarTareas(); };
  ['#l-tareas', '#l-completadas'].forEach((s) => $(s).onclick = (ev) => {
    const li = ev.target.closest('.tarea'); if (li) hojaTarea(st.tareas[li.dataset.id]);
  });

  function hojaTarea(t) {
    if (!t) return;
    const n = (t.distractions || []).length;
    abrirHoja(`<h2>${esc(t.name)}</h2>
      <p class="sub">Prioridad ${esc(t.weekly_goal ? 'semanal' : t.priority)} · ${t.xp || 0} Pv · ${t.time || 0} min · ${diasDesde(t.date_added)} días${t.delays ? ' · ' + t.delays + ' aplazos' : ''}${n ? ' · ' + n + ' distracciones' : ''}</p>
      <div class="botones">
        ${t.completed ? '' : '<button class="primario" id="h-iniciar">Iniciar timer</button>'}
        ${t.large ? '<button id="h-sub">Subtareas</button>' : ''}
        ${t.completed ? '' : '<button id="h-editar">Editar</button>'}
        <button id="h-borrar" class="peligro">Eliminar</button>
      </div>`, (h) => {
      if (h.querySelector('#h-iniciar')) h.querySelector('#h-iniciar').onclick = () => { cerrarHoja(); abrirTimer(t.id, (t.time || 25) * 60); };
      if (h.querySelector('#h-sub')) h.querySelector('#h-sub').onclick = () => hojaSubtareas(t.id);
      if (h.querySelector('#h-editar')) h.querySelector('#h-editar').onclick = () => formTarea(t);
      h.querySelector('#h-borrar').onclick = async () => {
        if (!(await preguntar('Eliminar', `¿Eliminar «${t.name}»?`))) return;
        await refTarea(t.id).set({ _borrada: true, _mod: ahoraMs() });   // el PC también la borra al sincronizar
        avisar('Tarea eliminada');
      };
    });
  }

  function formTarea(t) {
    const nueva = !t; t = t || { priority: 'C' };
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
      if (nueva) h.querySelector('#f-nombre').focus();
      h.querySelector('#f-cancelar').onclick = cerrarHoja;
      h.querySelector('#f-guardar').onclick = async () => {
        const nombre = h.querySelector('#f-nombre').value.trim(), pv = h.querySelector('#f-pv').value, min = h.querySelector('#f-min').value;
        if (!nombre || pv === '' || min === '') { h.querySelector('#f-error').textContent = 'Por favor, completa todos los campos antes de añadir la tarea.'; return; }
        if (!/^\d+$/.test(pv) || !/^\d+$/.test(min)) { h.querySelector('#f-error').textContent = "Los campos 'Pv' y 'Duración' deben ser números válidos."; return; }
        const grande = h.querySelector('#f-grande').checked;
        const datos = { name: nombre, xp: +pv, time: +min, priority: h.querySelector('input[name=f-pri]:checked').value,
          large: grande, weekly_goal: h.querySelector('#f-semanal').checked, _mod: ahoraMs() };
        if (nueva) {
          const id = uuid();
          Object.assign(datos, { id, completed: false, date_added: fechaDia(), subtasks: grande ? [] : null });
          await refTarea(id).set(datos);
        } else {
          if (grande && !Array.isArray(t.subtasks)) datos.subtasks = [];
          await refTarea(t.id).set(datos, { merge: true });
        }
        cerrarHoja(); avisar(nueva ? 'Tarea añadida' : 'Tarea guardada');
      };
    });
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
      h.querySelector('#s-agregar').onclick = () => {
        const v = h.querySelector('#s-nueva').value.trim(); if (!v) return;
        h.querySelector('#s-nueva').value = '';
        guardar(((st.tareas[id].subtasks) || []).concat([{ name: v, completed: false }]));
      };
      h.querySelector('#s-lista').onclick = (ev) => {
        const subs = ((st.tareas[id].subtasks) || []).map((s) => Object.assign({}, s));
        if (ev.target.dataset.borrar != null) { subs.splice(+ev.target.dataset.borrar, 1); guardar(subs); }
        else if (ev.target.dataset.i != null) {
          subs[+ev.target.dataset.i].completed = ev.target.checked; guardar(subs);
          if (subs.length && subs.every((s) => s.completed)) avisar('¡Todas las subtareas han sido completadas!');
        }
      };
    });
  }

  // ── timer popup ──
  let timer = null;                           // {id, total, fin}
  function guardarTimer() { try { timer ? localStorage.setItem('kp_timer_' + yo, JSON.stringify(timer)) : localStorage.removeItem('kp_timer_' + yo); } catch (e) { } }
  function reanudarTimer() {
    try { const t = JSON.parse(localStorage.getItem('kp_timer_' + yo) || 'null'); if (t && t.fin) { timer = t; mostrarTimer(); } } catch (e) { }
  }
  function abrirTimer(id, segundos) {
    if (timer) { avisar('Ya hay un timer corriendo'); return; }
    timer = { id, total: segundos, fin: ahoraMs() + segundos * 1000 };
    guardarTimer(); mostrarTimer();
  }
  function mostrarTimer() {
    const t = st.tareas[timer.id];
    $('#t-nombre').textContent = t ? t.name : '';
    $('#timer').classList.remove('oculto');
    clearInterval(mostrarTimer._i); mostrarTimer._i = setInterval(tick, 250); tick();
  }
  function tick() {
    if (!timer) return;
    const resta = Math.max(0, Math.ceil((timer.fin - ahoraMs()) / 1000));
    const pct = timer.total ? (resta / timer.total) * 100 : 100;
    const el = $('#t-reloj');
    el.textContent = `${dos(Math.floor(resta / 60))}:${dos(resta % 60)}`;
    el.style.color = resta === 0 ? '#ff3333' : pct <= 20 ? '#ff3333' : pct <= 50 ? '#ffaa00' : '#00ff00';
    if (!$('#t-nombre').textContent && st.tareas[timer.id]) $('#t-nombre').textContent = st.tareas[timer.id].name;
    if (resta === 0 && !timer.sono) {
      timer.sono = true; guardarTimer(); el.textContent = '00:00'; gong();
      setTimeout(() => terminarTimer(0), 1500);
    }
  }
  function cerrarTimer() { clearInterval(mostrarTimer._i); const id = timer && timer.id; timer = null; guardarTimer(); $('#timer').classList.add('oculto'); return id; }
  function terminarTimer(fraccion) { const id = cerrarTimer(); if (id) preguntarCompletada(id, fraccion); }
  $('#t-listo').onclick = () => { if (!timer) return; const resta = Math.max(0, (timer.fin - ahoraMs()) / 1000); terminarTimer(timer.total ? resta / timer.total : 0); };
  $('#t-cerrar').onclick = async () => { if (await preguntar('Cerrar el timer', 'La tarea queda pendiente. ¿Cerrar?')) cerrarTimer(); };
  $('#t-distraccion').onclick = () => {
    if (!timer) return;
    const id = timer.id;
    abrirHoja(`<h2>Distracción</h2><textarea id="d-texto" rows="4" placeholder="¿Qué te distrajo?"></textarea>
      <div class="botones"><button class="primario" id="d-guardar">guardar</button></div>`, (h) => {
      h.querySelector('#d-texto').focus();
      h.querySelector('#d-guardar').onclick = async () => {
        const t = st.tareas[id], txt = h.querySelector('#d-texto').value.trim();
        if (t) {
          const lista = (t.distractions || []).concat([{ text: txt, timestamp: fechaISO(), task_name: t.name }]);
          await refTarea(id).set({ distractions: lista, _mod: ahoraMs() }, { merge: true });
        }
        cerrarHoja();
      };
    });
  };

  async function preguntarCompletada(id, fraccion) {
    for (let i = 0; i < 20 && !st.tareas[id]; i++) await new Promise((r) => setTimeout(r, 250));   // recién abierta: espera las tareas
    const t = st.tareas[id]; if (!t) return;
    if (await preguntar('Tarea Completa', '¿Completaste la tarea?')) { completar(t, fraccion); return; }
    const delays = (t.delays || 0) + 1;
    await refTarea(id).set({ delays, delay_times: t.delay_times || [], _mod: ahoraMs() }, { merge: true });
    const extra = await pedirNumero('Tiempo Adicional', '¿Cuánto tiempo adicional necesitas? (en minutos)');
    if (extra) {
      await refTarea(id).set({ delay_times: (t.delay_times || []).concat([extra]), _mod: ahoraMs() }, { merge: true });
      abrirTimer(id, extra * 60);
    }
  }

  async function completar(t, fraccion) {
    const m = multiplicador(t, fraccion);
    let xp = t.xp || 0;
    if (m !== 1) xp = Math.round(xp * m);
    const antes = nivel(miAspecto().pv || 0).n;
    const tarea = { completed: true, color: 'orange', date_completed: fechaKP(),
      total_time: (t.time || 0) + (t.delay_times || []).reduce((a, b) => a + b, 0), _mod: ahoraMs() };
    if (m !== 1) tarea.xp_otorgado_calibracion = xp;
    const lote = db.batch();
    lote.set(refTarea(t.id), tarea, { merge: true });
    lote.set(refYo(), { pv: FV.increment(xp), pv_canjeables: FV.increment(xp), _mod: ahoraMs() }, { merge: true });
    lote.set(db.collection('pulsos').doc(), {
      type: 'TASK_COMPLETE', event_id: uuid().replace(/-/g, ''), pv: xp, user: yo, user_color: colorDe(yo),
      task_name: t.name || '', task_id: t.id, priority: t.priority || 'C', days_delayed: diasDesde(t.date_added),
      timestamp: new Date().toISOString(), origen: 'celular', _mod: ahoraMs()
    });
    await lote.commit();
    if (t.weekly_goal) {                     // objetivo semanal: todos los aspectos ganan los Pv
      otros().forEach((u) => {
        refYo().parent.doc(u).update({ pv: FV.increment(xp), _mod: ahoraMs() }).catch(() => { });
        refTarea(t.id, u).update({ completed: true, color: 'orange', date_completed: tarea.date_completed, _mod: ahoraMs() }).catch(() => { });
      });
    }
    const extra = m > 1 ? `Bono x${+m.toFixed(2)} por terminar antes` : m < 1 ? `x${+m.toFixed(2)} por tiempo extra pedido` : '';
    abrirHoja(`<h2>${t.weekly_goal ? '¡VAMOS CTM!!' : '¡Bien hecho!'}</h2>
      ${t.weekly_goal ? '<p>¡Objetivo Semanal Completado!</p>' : ''}
      <p style="font-size:22px;font-weight:800;color:var(--acento2)">¡Ese es mi toro!</p>
      <p>¡Poder Personal sumado! +${xp} Pv</p>${extra ? `<p class="sub">${esc(extra)}</p>` : ''}
      <div class="botones"><button class="primario" id="ok">Aceptar</button></div>`, (h) => h.querySelector('#ok').onclick = cerrarHoja);
    setTimeout(() => {
      const despues = nivel(miAspecto().pv || 0).n;
      if (despues > antes) avisar(`¡Felicitaciones! ¡Has subido al nivel ${despues}!`, 4000);
    }, 1200);
  }

  // ── chat ──
  function mensajesSala(sala) {
    if (sala === 'General') return st.general.slice();
    const id = [yo, sala].sort().join('_');
    return Object.values(st.privEnv).concat(Object.values(st.privRec)).filter((m) => m.chat_id === id)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }
  function noLeidos(sala) {
    const visto = ((miAspecto().leidos) || {})[sala] || '';
    return mensajesSala(sala).filter((m) => m.sender !== yo && String(m.timestamp) > visto).length;
  }
  function pintarSalas() {
    if (!yo) return;
    const salas = ['General'].concat(otros());
    $('#chat-salas').innerHTML = salas.map((s) => `<button data-sala="${esc(s)}" class="${s === st.sala ? 'activa' : ''}">${esc(s)}${noLeidos(s) && s !== st.sala ? '<i class="aviso"></i>' : ''}</button>`).join('');
    $('#chat-salas').querySelectorAll('button').forEach((b) => b.onclick = () => { st.sala = b.dataset.sala; marcarLeido(st.sala); pintarSalas(); pintarChat(true); });
    const hay = salas.some((s) => noLeidos(s) && !(s === st.sala && $('#p-chat').classList.contains('activa')));
    $('#n-chat').classList.toggle('oculto', !hay);
  }
  function pintarChat(alFinal) {
    if (!yo) return;
    const caja = $('#chat-mensajes');
    const abajo = alFinal || caja.scrollHeight - caja.scrollTop - caja.clientHeight < 60;
    caja.innerHTML = mensajesSala(st.sala).map((m) => `<div class="msj ${m.sender === yo ? 'mio' : ''}">
      ${m.sender === yo ? '' : `<div class="de" style="color:${esc(colorDe(m.sender))}">${esc(m.sender)}</div>`}
      <div>${esc(m.message)}</div><div class="hora">${esc(String(m.timestamp).slice(5, 16))}</div></div>`).join('') || '<p class="sub">Sin mensajes todavía.</p>';
    if (abajo) caja.scrollTop = caja.scrollHeight;
    if ($('#p-chat').classList.contains('activa') && noLeidos(st.sala)) marcarLeido(st.sala);
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
  $('#chat-texto').addEventListener('keydown', (ev) => {   // Enter envía · Shift+Enter salto de línea
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('#f-chat').requestSubmit(); }
  });

  // ── correo ──
  function pintarCorreos() {
    const lista = (st.bandeja === 'entrada' ? Object.values(st.correosRec) : Object.values(st.correosEnv))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('#l-correos').innerHTML = lista.map((m) => `<li class="correo ${st.bandeja === 'entrada' && !m.read ? 'nuevo' : ''}" data-id="${esc(m.id)}">
      <div class="c1"><span>${esc(st.bandeja === 'entrada' ? 'De: ' + m.sender : 'Para: ' + m.recipient)}</span><span>${esc(String(m.date).slice(0, 16))}</span></div>
      <div class="asunto">${esc(m.subject || '(sin asunto)')}</div></li>`).join('') || '<li class="sub">No hay correos.</li>';
    $('#n-correo').classList.toggle('oculto', !Object.values(st.correosRec).some((m) => !m.read));
  }
  document.querySelectorAll('[data-bandeja]').forEach((b) => b.onclick = () => {
    st.bandeja = b.dataset.bandeja;
    document.querySelectorAll('[data-bandeja]').forEach((x) => x.classList.toggle('activa', x === b));
    pintarCorreos();
  });
  $('#l-correos').onclick = (ev) => {
    const li = ev.target.closest('.correo'); if (!li) return;
    const m = st.correosRec[li.dataset.id] || st.correosEnv[li.dataset.id];
    const lista = Object.values(st.correosRec).concat(Object.values(st.correosEnv));
    const correo = m || lista.find((x) => x.id === li.dataset.id); if (!correo) return;
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
          lote.set(db.collection('correos').doc(id), { id, sender: yo, recipient: rec, subject: h.querySelector('#m-asunto').value,
            body: h.querySelector('#m-cuerpo').value, date: fecha, read: false, _mod: ahoraMs() });
        });
        await lote.commit(); cerrarHoja(); avisar('Correo enviado');
      };
    });
  }
  $('#b-redactar').onclick = () => redactar(null);

  // ── zazen ──
  let zazen = null;                           // {plan, inicio, fin}
  function guardarZazen() { try { zazen ? localStorage.setItem('kp_zazen_' + yo, JSON.stringify(zazen)) : localStorage.removeItem('kp_zazen_' + yo); } catch (e) { } }
  function reanudarZazen() { try { const z = JSON.parse(localStorage.getItem('kp_zazen_' + yo) || 'null'); if (z) { zazen = z; correrZazen(); } } catch (e) { } }
  function pintarZazen() {
    const n = Object.keys(st.dhana).length;
    $('#z-resumen').textContent = `${dhanaTotal()} $D · ${n} ${n === 1 ? 'sesión' : 'sesiones'} · racha ${racha()} días`;
  }
  function correrZazen() {
    $('#z-iniciar').disabled = true;
    clearInterval(correrZazen._i);
    correrZazen._i = setInterval(() => {
      const resta = Math.max(0, Math.ceil((zazen.fin - ahoraMs()) / 1000));
      $('#z-reloj').textContent = `${dos(Math.floor(resta / 60))}:${dos(resta % 60)}`;
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
    if (real < 5) return;                     // menos de 5 s no cuenta (como en KP)
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

  // ── huevo cósmico (.cegg) del aspecto: se guarda solo ──
  function huevo() {
    const a = miAspecto(), nv = nivel(a.pv || 0);
    const tareas = Object.values(st.tareas);
    const sesiones = Object.values(st.dhana);
    return {
      version: 'cegg-web-1', origen: 'app web KP', generado: new Date().toISOString(),
      perfil_arquetipo: { nombre: yo, color_hex: colorDe(yo), nivel_actual: nv.n, xp_en_nivel_actual: nv.resto, xp_para_siguiente_nivel: nv.sig },
      metricas: { pv_total: a.pv || 0, pv_canjeables: a.pv_canjeables || 0, mu: a.mu || 0, dhana: dhanaTotal(),
        sesiones_zazen: sesiones.length, racha_zazen: racha(),
        tareas_pendientes: tareas.filter((t) => !t.completed).length, tareas_completadas: tareas.filter((t) => t.completed).length },
      tareas, zazen: sesiones.map((s) => ({ fecha: s.fecha, contexto: s.contexto, plan_seg: s.plan_seg, real_seg: s.real_seg, completa: s.completa }))
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `HuevoCosmico_${yo}.cegg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  window.KP_WEB = { st, nivel, presion, multiplicador, get yo() { return yo; } };   // para pruebas
  iniciar();
})();
