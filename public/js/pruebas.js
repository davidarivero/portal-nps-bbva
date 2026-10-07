/*
 * Catálogo de pruebas de los recorridos proactivos, umbrales y lectura de resultados (OCR).
 * Lo usan el servidor (Node) y el navegador: una sola definición para ambos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pruebas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- umbrales ----------
   * dir 'low'  = menos es mejor:  alarmante si v >= alarm, regular si v >= regular
   * dir 'high' = más es mejor:    alarmante si v <  alarm, regular si v <  regular */
  const TH = {
    pingLat: { dir: 'low', regular: 50, alarm: 80 },
    pingLatUmbrella: { dir: 'low', regular: 80, alarm: 100 },
    loss: { dir: 'low', regular: 3, alarm: 8 },
    speed: { dir: 'high', regular: 180, alarm: 100 },
    speedLat: { dir: 'low', regular: 40, alarm: 80 },
    meet: { dir: 'low', regular: 150, alarm: 300 },
  };
  const LEVELS = {
    good: { label: 'Bueno', rank: 1 },
    regular: { label: 'Regular', rank: 2 },
    alarm: { label: 'Alarmante', rank: 3 },
  };
  function level(v, th) {
    if (v === null || v === undefined || !th || !Number.isFinite(v)) return null;
    if (th.dir === 'low') return v >= th.alarm ? 'alarm' : v >= th.regular ? 'regular' : 'good';
    return v < th.alarm ? 'alarm' : v < th.regular ? 'regular' : 'good';
  }
  const thText = (th) => (th.dir === 'low'
    ? `Bueno < ${th.regular} · Regular ≥ ${th.regular} · Alarmante ≥ ${th.alarm}`
    : `Bueno ≥ ${th.regular} · Regular < ${th.regular} · Alarmante < ${th.alarm}`);

  /* ---------- campos por tipo de prueba ---------- */
  const pingFields = (latTh) => [
    { key: 'lat', label: 'Latencia promedio', unit: 'ms', th: latTh, required: true, max: 60000 },
    { key: 'min', label: 'Mínima', unit: 'ms', max: 60000 },
    { key: 'max', label: 'Máxima', unit: 'ms', max: 60000 },
    { key: 'enviados', label: 'Enviados', integer: true, required: true, max: 100000, min: 1 },
    { key: 'recibidos', label: 'Recibidos', integer: true, required: true, max: 100000, maxField: 'enviados' },
  ];
  const TYPES = {
    ping: { derived: [{ key: 'perdida', label: '% pérdida', unit: '%', th: TH.loss }] },
    speed: { fields: [
      { key: 'descarga', label: 'Descarga', unit: 'Mb/s', th: TH.speed, required: true, max: 100000 },
      { key: 'carga', label: 'Carga', unit: 'Mb/s', th: TH.speed, required: true, max: 100000 },
      { key: 'latencia', label: 'Latencia', unit: 'ms', th: TH.speedLat, required: true, max: 60000 },
    ] },
    meet: { fields: [{ key: 'retraso', label: 'Retraso de la conexión', unit: 'ms', th: TH.meet, required: true, max: 60000 }] },
    youtube: { fields: [
      { key: 'conexion', label: 'Velocidad de conexión', unit: 'Kbps', max: 100000000 },
      { key: 'frames_perdidos', label: 'Fotogramas perdidos', integer: true, max: 100000000 },
    ] },
    evidence: { fields: [] },
  };

  const GROUPS = [
    { key: 'dns', label: 'Ping DNS (5 minutos)' },
    { key: 'zscaler', label: 'Ping IP Neptuno (Zscaler)' },
    { key: 'sitios', label: 'Ping a sitios' },
    { key: 'video', label: 'Contenido de video' },
    { key: 'speed', label: 'Speed test nPerf' },
    { key: 'zs', label: 'Evidencia Zscaler' },
    { key: 'red', label: 'Datos de conexión a red' },
  ];

  const T = (key, group, type, label, short, hint, extra) => ({ key, group, type, label, short, hint, ...(extra || {}) });
  const TESTS = [
    T('ping_google1', 'dns', 'ping', 'Ping DNS principal Google', 'Google 1', 'ping -n 300 8.8.8.8', { target: '8.8.8.8' }),
    T('ping_google2', 'dns', 'ping', 'Ping DNS secundario Google', 'Google 2', 'ping -n 300 8.8.4.4', { target: '8.8.4.4' }),
    T('ping_umbrella1', 'dns', 'ping', 'Ping DNS principal Umbrella', 'Umbrella 1', 'ping -n 300 208.67.222.222', { target: '208.67.222.222', latTh: TH.pingLatUmbrella }),
    T('ping_umbrella2', 'dns', 'ping', 'Ping DNS secundario Umbrella', 'Umbrella 2', 'ping -n 300 208.67.220.220', { target: '208.67.220.220', latTh: TH.pingLatUmbrella }),
    T('ping_zscaler1', 'zscaler', 'ping', 'Ping Zscaler 1', 'Zscaler 1', 'ping -n 300 185.46.212.88', { target: '185.46.212.88' }),
    T('ping_zscaler2', 'zscaler', 'ping', 'Ping Zscaler 2', 'Zscaler 2', 'ping -n 300 185.46.212.89', { target: '185.46.212.89' }),
    T('ping_zscaler3', 'zscaler', 'ping', 'Ping Zscaler 3', 'Zscaler 3', 'ping -n 300 185.46.212.93', { target: '185.46.212.93' }),
    T('ping_bbva', 'sitios', 'ping', 'Ping a sitio interno BBVA', 'Sitio BBVA', 'Zona BR: ping -n 300 login.mypurecloud.com · Otras zonas: ping -n 300 bbva-intranet.appspot.com', { hosts: ['mypurecloud', 'bbva-intranet', 'appspot'] }),
    T('ping_internet', 'sitios', 'ping', 'Ping a sitio de Internet (El Universal)', 'Internet', 'ping -n 300 www.eluniversal.com.mx', { hosts: ['eluniversal'] }),
    T('meet', 'video', 'meet', 'Google Meet activa', 'Meet', 'Solución de problemas y ayuda → Retraso de la conexión'),
    T('youtube', 'video', 'youtube', 'Video 4K en YouTube', 'YouTube', 'Con las métricas de reproducción de video habilitadas'),
    T('speedtest1', 'speed', 'speed', 'Speed test navegador 1 (Chrome)', 'Speed test 1', 'https://www.nperf.com/es/ en Chrome'),
    T('speedtest2', 'speed', 'speed', 'Speed test navegador 2 (Firefox o Edge)', 'Speed test 2', 'https://www.nperf.com/es/ en Firefox o Edge'),
    T('zs_security', 'zs', 'evidence', 'Zscaler: Status Internet Security', 'ZS Internet Security', 'Pantalla Status Internet Security'),
    T('zs_dx', 'zs', 'evidence', 'Zscaler: Status Digital Experience', 'ZS Digital Experience', 'Pantalla Status Digital Experience'),
    T('zs_more', 'zs', 'evidence', 'Zscaler: More', 'ZS More', 'Pantalla More'),
    T('ipconfig', 'red', 'evidence', 'CMD ipconfig /all', 'ipconfig', 'Sección: Adaptador de LAN inalámbrica Wi-Fi'),
    T('ssid', 'red', 'evidence', 'SSID al que se tiene conexión', 'SSID', 'Pantalla del SSID conectado'),
    T('meraki', 'red', 'evidence', 'Meraki 10.128.128.126', 'Meraki', 'Sección: Access Point details'),
    T('wifi_list', 'red', 'evidence', 'Redes Wi-Fi escuchadas', 'Redes Wi-Fi', 'Lista de redes Wi-Fi visibles'),
  ];
  const BY_KEY = Object.fromEntries(TESTS.map((t) => [t.key, t]));
  const fieldsOf = (t) => (t.type === 'ping' ? pingFields(t.latTh || TH.pingLat) : TYPES[t.type].fields);

  /** Valores con sus derivados (por ejemplo % de pérdida) y el nivel de cada uno. */
  function evaluate(test, values) {
    const out = [];
    const v = values || {};
    for (const f of fieldsOf(test)) {
      if (v[f.key] === undefined || v[f.key] === null) continue;
      out.push({ key: f.key, label: f.label, unit: f.unit || '', value: v[f.key], level: level(v[f.key], f.th), th: f.th || null });
    }
    if (test.type === 'ping' && v.enviados > 0 && v.recibidos !== undefined && v.recibidos !== null) {
      const p = Math.max(0, ((v.enviados - v.recibidos) / v.enviados) * 100);
      out.push({ key: 'perdida', label: '% pérdida', unit: '%', value: Math.round(p * 100) / 100, level: level(p, TH.loss), th: TH.loss, derived: true });
    }
    return out;
  }
  const worst = (levels) => levels.filter(Boolean).sort((a, b) => LEVELS[b].rank - LEVELS[a].rank)[0] || null;
  const hasRequired = (test, values) => fieldsOf(test).filter((f) => f.required).every((f) => values && Number.isFinite(values[f.key]));

  /** Indicadores que se resumen (mínimo, promedio, máximo) en el tablero. */
  const INDICATORS = [];
  for (const t of TESTS) {
    if (t.type === 'ping') {
      INDICATORS.push({ test: t.key, key: 'lat', label: `${t.short}: latencia`, unit: 'ms', th: t.latTh || TH.pingLat });
      INDICATORS.push({ test: t.key, key: 'perdida', label: `${t.short}: pérdida`, unit: '%', th: TH.loss });
    } else if (t.type !== 'evidence') {
      for (const f of TYPES[t.type].fields) if (f.th) INDICATORS.push({ test: t.key, key: f.key, label: `${t.short}: ${f.label.toLowerCase()}`, unit: f.unit, th: f.th });
    }
  }

  /* ---------- lectura de resultados a partir del texto del OCR ---------- */
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fixDigits = (s) => s.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(',', '.');
  const N = '([0-9oOlI|]+(?:[.,][0-9oO]+)?)';
  const SEP = '\\s*[=:~\\-–—]*\\s*';
  const grab = (t, re) => { const m = t.match(re); if (!m) return undefined; const n = parseFloat(fixDigits(m[1])); return Number.isFinite(n) ? n : undefined; };

  function parsePing(t) {
    const v = {};
    v.enviados = grab(t, new RegExp(`(?:enviados|sent)${SEP}${N}`, 'i'));
    v.recibidos = grab(t, new RegExp(`(?:recibidos|received)${SEP}${N}`, 'i'));
    if (v.enviados === undefined) v.enviados = grab(t, new RegExp(`${N}\\s+probes\\s+sent`, 'i'));
    if (v.recibidos === undefined) v.recibidos = grab(t, new RegExp(`${N}\\s+successful`, 'i'));
    const unix = t.match(/(\d+)\s+packets\s+transmitted,\s*(\d+)\s+(?:packets\s+)?received/i);
    if (unix) { v.enviados = Number(unix[1]); v.recibidos = Number(unix[2]); }
    v.min = grab(t, new RegExp(`(?:m.nim\\w*)${SEP}${N}\\s*[mn]?s`, 'i'));
    v.max = grab(t, new RegExp(`(?:m.xim\\w*)${SEP}${N}\\s*[mn]?s`, 'i'));
    v.lat = grab(t, new RegExp(`(?:media|average|promedio)${SEP}${N}\\s*[mn]?s`, 'i'));
    const rt = t.match(/min\/avg\/max(?:\/\w+)?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/i);
    if (rt) { v.min = Number(rt[1]); v.lat = Number(rt[2]); v.max = Number(rt[3]); }
    return v;
  }
  function parseSpeed(t) {
    const v = {};
    const rates = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:mb\/s|mbps|mbit\/s|mb\/5)/gi)].map((m) => parseFloat(m[1].replace(',', '.')));
    if (rates.length >= 2) { v.descarga = rates[0]; v.carga = rates[1]; }
    v.latencia = grab(t, /\b(?:latencia|latency|ping)\b\D{0,40}?(\d+(?:[.,]\d+)?)\s*ms/i);
    if (v.latencia === undefined) v.latencia = grab(t, /(\d+(?:[.,]\d+)?)\s*ms\b/i);
    if (v.descarga === undefined) {
      // Etiquetas en un renglón y valores en el siguiente: se toman en el orden de las etiquetas.
      const labels = [...t.matchAll(/\b(bajada|descarga|download|subida|carga|upload|latencia|latency)\b/gi)];
      const kind = (w) => (/^(bajada|descarga|download)$/i.test(w) ? 'descarga' : /^(subida|carga|upload)$/i.test(w) ? 'carga' : 'latencia');
      const order = []; let end = 0;
      for (const m of labels) { const k = kind(m[1]); if (!order.includes(k)) { order.push(k); end = m.index + m[0].length; } }
      const nums = [...t.slice(end).matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => parseFloat(m[1].replace(',', '.')));
      if (order.includes('descarga') && order.includes('carga') && nums.length >= order.length) {
        order.forEach((k, i) => { if (v[k] === undefined) v[k] = nums[i]; });
      }
    }
    return v;
  }
  function parseMeet(t) {
    const v = {};
    v.retraso = grab(t, /(?:retraso|delay|latenc)[^\d]{0,80}?(\d+(?:[.,]\d+)?)\s*ms/i);
    if (v.retraso === undefined) v.retraso = grab(t, /(\d+(?:[.,]\d+)?)\s*ms\b/i);
    return v;
  }
  function parseYoutube(t) {
    return {
      conexion: grab(t, /(?:connection speed|velocidad de conexi.n)\D{0,12}(\d+)\s*kbps/i),
      frames_perdidos: grab(t, /(\d+)\s+(?:dropped of|fotogramas?\s+(?:omitidos|perdidos|descartados))/i),
    };
  }
  const PARSERS = { ping: parsePing, speed: parseSpeed, meet: parseMeet, youtube: parseYoutube, evidence: () => ({}) };
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && Number.isFinite(x)));

  /** Identifica a qué prueba corresponde una captura. Devuelve la clave, el tipo ('speed' sin número) o null. */
  function detect(text) {
    const t = plain(text).replace(/\s*\.\s*/g, '.');
    const isPing = /(estadisticas de ping|ping statistics|haciendo ping|pinging|paquetes: ?enviados|packets: ?sent|probes sent|packets transmitted|tiempo[=<]\d|time[=<]\d)/.test(t);
    if (isPing) {
      const head = (t.match(/(?:estadisticas de ping para|ping statistics for|haciendo ping a|pinging)\s+(\S+)/) || [])[1] || '';
      for (const scope of [head, t]) {
        if (!scope) continue;
        const byIp = TESTS.filter((x) => x.target).sort((a, b) => b.target.length - a.target.length).find((x) => scope.includes(x.target));
        if (byIp) return byIp.key;
        const byHost = TESTS.find((x) => x.hosts && x.hosts.some((hst) => scope.includes(hst)));
        if (byHost) return byHost.key;
      }
      return 'ping';
    }
    if (/nperf/.test(t) || (/\b(bajada|descarga|download)\b/.test(t) && /\b(subida|carga|upload)\b/.test(t))) return 'speed';
    if (/(retraso|retras0|problemas y ayuda|troubleshooting|connection delay|meet\.google)/.test(t)) return 'meet';
    if (/(stats for nerds|estadisticas para nerds|video id|connection speed|velocidad de conexion|buffer health|estado del bufer)/.test(t)) return 'youtube';
    if (/(adaptador de lan inalambrica|wireless lan adapter|configuracion ip de windows|windows ip configuration|dhcp habilitado|dhcp enabled)/.test(t)) return 'ipconfig';
    if (/(access point details|my\.meraki|10\.128\.128\.126|this access point|client connection)/.test(t)) return 'meraki';
    return null;
  }

  /** Lee los valores de una captura. `testKey` opcional: si se indica, se lee con el formato de esa prueba. */
  function parse(text, testKey) {
    const detected = detect(text);
    const key = testKey || (BY_KEY[detected] ? detected : null);
    const type = key ? BY_KEY[key].type : (detected === 'ping' || detected === 'speed' ? detected : null);
    const values = type ? clean(PARSERS[type](String(text || ''))) : {};
    if (type === 'ping' && values.recibidos > values.enviados) delete values.recibidos;
    const doubts = [];
    if (type === 'ping') {
      if (values.min !== undefined && values.lat !== undefined && values.min > values.lat) doubts.push('la mínima es mayor que el promedio');
      if (values.min !== undefined && values.max !== undefined && values.min > values.max) doubts.push('la mínima es mayor que la máxima');
      if (values.max !== undefined && values.lat !== undefined && values.max < values.lat) doubts.push('la máxima es menor que el promedio');
      const pct = String(text || '').match(/\((\d+)\s*%\s*(?:perdidos|loss)/i);
      if (pct && values.enviados > 0 && values.recibidos !== undefined) {
        const real = ((values.enviados - values.recibidos) / values.enviados) * 100;
        if (Math.abs(real - Number(pct[1])) > 1.5) doubts.push('el % de pérdida no coincide con enviados y recibidos');
      }
    }
    return { detected, test: key, type, values, doubts, complete: key ? hasRequired(BY_KEY[key], values) : false };
  }

  return { TH, LEVELS, GROUPS, TESTS, BY_KEY, INDICATORS, fieldsOf, level, thText, evaluate, worst, hasRequired, detect, parse, plain };
});
