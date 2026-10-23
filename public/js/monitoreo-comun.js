'use strict';
/* Monitoreo proactivo de indicadores clave: catálogos y lectores compartidos por el navegador y el servidor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalMonitoreoComun = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // Estados del caso: el orden es el del embudo (de lo más avanzado a lo pendiente).
  const ESTADOS = [
    { key: 'exito', label: 'Atendido con éxito', short: 'Éxito', cls: 'good' },
    { key: 'cita', label: 'Cita agendada para atención', short: 'Cita', cls: 'prog' },
    { key: 'sin_respuesta', label: 'Contactado sin respuesta', short: 'Sin respuesta', cls: 'warn' },
    { key: 'sin_datos', label: 'Sin datos para contactar', short: 'Sin datos', cls: 'none' },
    { key: 'no_identificado', label: 'MAC o usuario no identificado en Meraki', short: 'No identificado', cls: 'none' },
    { key: 'pendiente', label: 'Por contactar', short: 'Por contactar', cls: 'none' },
  ];
  const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.key, e]));
  const CONTACTADOS = ['exito', 'cita', 'sin_respuesta'];

  const FALLAS = [
    'RADIUS authentication rejected by server',
    'EAPOL: Timeout waiting for client EAP response',
    'Previous authentication no longer valid',
    'RADIUS timeout',
    'Unspecified',
    'Unacceptable power capability IE',
  ];
  const SSIDS = ['BBVA_GLOBAL', 'BBVA', 'BBVA CLIENTES'];
  const COMENTARIOS = [
    'Se contacta a usuario y comenta que no tiene problemas con la conectividad',
    'Se identifica que tiene la red de Banca, se olvida y se conecta a la red de Global.',
    'Usuario atendido, se configuró un userid válido y ya conecta correctamente',
    'Se agenda cita para la atención',
    'Se contactó al usuario pero no se tuvo respuesta',
    'Sin datos para contactar usuario',
  ];

  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  /** Propone el estado a partir del comentario del ingeniero. */
  function estadoDe(comentario) {
    const t = plain(comentario).trim();
    if (!t) return 'pendiente';
    if (/sin datos|no hay datos|sin informacion de contacto|anonymous/.test(t)) return 'sin_datos';
    // la MAC o el usuario no se pudieron identificar: no hay a quién dar seguimiento
    if (/sin conexion(es)?( en meraki)?|no hay registro de la mac|ninguno coincide|no coincide|user(id)? no encontrado|usuario no encontrado|user(id)? invalido|usuario invalido|muchos usuarios utilizan/.test(t)) return 'no_identificado';
    if (/agend|cita\b|pendiente de visit|en espera|nos notifica cuando|se acuerda ayudarle|regresar(a|e)? a|visita programada/.test(t)) return 'cita';
    if (/sin respuesta|no se tuvo respuesta|no se obtiene respuesta|no se obtuvo respuesta|no contest|no respond|no responde|sin contestar/.test(t)) return 'sin_respuesta';
    return 'exito';
  }

  /* ---------- usernames: misma persona escrita distinto ---------- */
  const userKey = (u) => String(u || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const userTokens = (u) => String(u || '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 5);
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const nameKey = (n) => plain(n).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  /** Usernames conocidos que probablemente son el mismo: igual sin mayúsculas ni signos, un token en común (M56255-M562557 / M562557),
   *  o a 1–2 letras de distancia (MI02818 / MIO2818). known: [{u, nombre, n}]. */
  function similares(username, known, nombre) {
    const k = userKey(username); if (k.length < 4) return [];
    const toks = userTokens(username), nk = nameKey(nombre);
    const out = [];
    for (const x of known) {
      const xk = userKey(x.u); if (!xk) continue;
      let why = null;
      if (xk === k) why = 'mismo username';
      else if (toks.some((t) => userTokens(x.u).includes(t)) || (k.length >= 6 && (xk.startsWith(k) || k.startsWith(xk)) && Math.abs(xk.length - k.length) <= 2)) why = 'comparten parte del username';
      else if (k.length >= 6 && lev(k, xk) <= (k.length >= 8 ? 2 : 1)) why = 'username casi igual';
      else if (nk && x.nombre && nameKey(x.nombre) === nk) why = 'mismo nombre';
      if (why) out.push({ ...x, why, exacto: xk === k });
    }
    return out.sort((a, b) => b.exacto - a.exacto || b.n - a.n).slice(0, 3);
  }

  const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
  const MESES = { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  /** Fecha y hora del último intento: "oct 19 2026 13:01", "Sep 10 2026 12:37", "2026-10-16 11:59", "19/10/2026 13:01". Devuelve "AAAA-MM-DDTHH:MM" o null. */
  function fechaHora(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim();
    let m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
    if (m && MESES[plain(m[1])]) return `${m[3]}-${pad(MESES[plain(m[1])])}-${pad(m[2])}T${pad(m[4] || 0)}:${m[5] || '00'}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad(m[4] || 0)}:${m[5] || '00'}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 0)}:${m[5] || '00'}`;
    return null;
  }
  const fechaDe = (v) => { const x = fechaHora(v); return x ? x.slice(0, 10) : null; };
  const vacio = (v) => { const t = String(v === null || v === undefined ? '' : v).trim(); return !t || /^(n\/?a|na|-|sin datos de contacto|none)$/i.test(t) ? '' : t; };

  /* ---------- texto pegado (desde Meraki, Excel o el chat) ---------- */
  const HEAD = {
    fecha: /^fecha$/, username: /^(username|usuario|userid)$/, nombre: /^nombre$/, mac: /^(mac|name|dispositivo)$/,
    falla: /^(log detectado|razon|failure type|falla)$/, intentos: /^(intentos fallidos|failed attempts|intentos)$/,
    ssid: /^ssid$/, ap: /^(ap|access point)$/, evento: /^(fecha|last failed attempt.*|ultimo intento)$/, comentario: /^(comentarios?|seguimiento)$/,
  };
  function fromCols(cols, map) {
    const g = (k) => (map[k] === undefined ? '' : (cols[map[k]] || '').trim());
    return { fecha: fechaDe(g('fecha')), username: vacio(g('username')), nombre: vacio(g('nombre')), mac: vacio(g('mac')), falla: g('falla'),
      intentos: Number(g('intentos').replace(/[^\d.]/g, '')) || null, ssid: g('ssid'), ap: g('ap'), evento: fechaHora(g('evento')), comentario: g('comentario') };
  }
  // Renglón en una sola línea separada por espacios, como se copia del chat o del correo.
  const LINE = new RegExp('^(?:(\\d{1,2}/\\d{1,2}/\\d{4})\\s+)?' + // fecha de revisión (opcional)
    '(?:(\\S+)\\s+(.*?)\\s+)?' + // username y nombre (opcionales)
    '((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[A-Z]{2,}-[A-Z0-9-]{4,}|N/A|SIN DATOS DE CONTACTO)\\s+' + // MAC o nombre del equipo
    '(.+?)\\s+(\\d+)\\s+' + // falla e intentos
    '(BBVA[_ ]GLOBAL|BBVA CLIENTES|BBVA|MAC&CEL|\\S+)\\s+' + // SSID
    '(AP-\\S+)\\s+' + // AP
    '([A-Za-z]{3}\\s+\\d{1,2}\\s+\\d{4}\\s+\\d{1,2}:\\d{2}|\\d{4}-\\d{2}-\\d{2}[ T]\\d{1,2}:\\d{2}(?::\\d{2})?|\\d{1,2}/\\d{1,2}/\\d{4}\\s+\\d{1,2}:\\d{2})' + // último intento
    '\\s*(.*)$', 'i');
  /** @returns {{rows: object[], omitidos: string[]}} */
  function parsePegado(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.trim());
    const rows = [], omitidos = [];
    if (!lines.length) return { rows, omitidos };
    const tabbed = lines.some((l) => l.includes('\t'));
    if (tabbed) {
      const first = lines[0].split('\t').map((c) => plain(c).trim());
      const isHead = first.some((c) => HEAD.falla.test(c) || HEAD.ap.test(c) || HEAD.ssid.test(c));
      let map = {};
      if (isHead) {
        first.forEach((c, i) => {
          for (const [k, re] of Object.entries(HEAD)) {
            if (!re.test(c)) continue;
            if (k === 'fecha' && map.fecha !== undefined) { if (map.evento === undefined) map.evento = i; continue; }
            if (k === 'evento' && c === 'fecha') continue;
            if (map[k] === undefined) map[k] = i;
          }
        });
        if (map.evento === undefined && map.fecha !== undefined && !lines.slice(1).some((l) => /\d:\d/.test(l.split('\t')[map.fecha] || ''))) { /* solo fecha */ }
      } else {
        const n = lines[0].split('\t').length;
        map = n >= 10 ? { fecha: 0, username: 1, nombre: 2, mac: 3, falla: 4, intentos: 5, ssid: 6, ap: 7, evento: 8, comentario: 9 }
          : n >= 8 ? { username: 0, nombre: 1, mac: 2, falla: 3, intentos: 4, ssid: 5, ap: 6, evento: 7, comentario: n >= 10 ? 9 : n === 9 ? 8 : undefined }
            : { mac: 0, falla: 1, intentos: 2, ssid: 3, ap: 4, evento: 5 };
      }
      for (const l of lines.slice(isHead ? 1 : 0)) {
        const r = fromCols(l.split('\t'), map);
        if (r.mac || r.ap || r.username) rows.push(r); else omitidos.push(l);
      }
      return { rows, omitidos };
    }
    for (const l of lines) {
      if (/^fecha\s+username|^username\s+nombre|^name\s+failure/i.test(l.trim())) continue; // encabezado
      const m = l.trim().match(LINE);
      if (!m) { omitidos.push(l); continue; }
      rows.push({ fecha: m[1] ? fechaDe(m[1]) : null, username: vacio(m[2]), nombre: vacio(m[3]), mac: vacio(m[4]), falla: m[5].trim(), intentos: Number(m[6]),
        ssid: m[7].replace(/^BBVA GLOBAL$/i, 'BBVA_GLOBAL'), ap: m[8], evento: fechaHora(m[9]), comentario: m[10].trim() });
    }
    return { rows, omitidos };
  }

  return { ESTADOS, ESTADO, CONTACTADOS, FALLAS, SSIDS, COMENTARIOS, estadoDe, userKey, similares, nameKey, fechaHora, fechaDe, vacio, parsePegado, plain, MAC_RE };
});
