'use strict';
/* Monitoreo proactivo de indicadores clave 2.0: conexiones a BBVA_GLOBAL y BBVA. Catálogos, cálculos y definición de la iniciativa.
   Lo usan el navegador y el servidor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalConexionesComun = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const SEDES = [
    { key: 'reforma', name: 'Torre Reforma', alias: ['reforma', 'torre reforma'] },
    { key: 'polanco', name: 'Parques Polanco', alias: ['polanco', 'parques polanco', 'parques'] },
    { key: 'tecnoparque', name: 'Tecnoparque', alias: ['tecnoparque', 'tecno'] },
    { key: 'murano', name: 'Murano', alias: ['murano'] },
    { key: 'toreo', name: 'Toreo', alias: ['toreo'] },
    { key: 'gdl', name: 'Guadalajara', alias: ['guadalajara', 'gdl', 'landmark'] },
    { key: 'tijuana', name: 'Tijuana', alias: ['tijuana', 'tij'] },
  ];
  const SEDE = Object.fromEntries(SEDES.map((s) => [s.key, s]));
  const SSIDS = ['BBVA_GLOBAL', 'BBVA'];
  const META = { inicial: 91.3, objetivo: 95, codigo: '12303' };

  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /** Sede a partir del nombre de una hoja o un texto ("Reforma", "Polanco - Conexiones…"). */
  function sedeDe(txt) {
    const t = plain(txt).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    return SEDES.find((s) => s.alias.some((a) => t === a || t.startsWith(a + ' ') || t.includes(' ' + a) || t.includes(a))) || null;
  }
  const ssidDe = (txt) => { const t = String(txt || '').toUpperCase(); return /BBVA[_ ]GLOBAL/.test(t) ? 'BBVA_GLOBAL' : /\bBBVA\b/.test(t) ? 'BBVA' : null; };

  /** Totales ponderados: suma de exitosos ÷ suma de dispositivos (no el promedio de porcentajes diarios). */
  function totales(rows) {
    const t = { dias: 0, disp: 0, ok: 0, fail: 0, auth: 0, inv: 0 };
    for (const r of rows) { t.dias += 1; t.disp += r.dispositivos; t.ok += r.exitosos; t.fail += r.fallidos; t.auth += r.auth12303; t.inv += r.fallidos - r.auth12303; }
    const p = (n) => (t.disp ? (n / t.disp) * 100 : null);
    return { ...t, pctOk: p(t.ok), pctFail: p(t.fail), pctAuth: p(t.auth), pctInv: p(t.inv) };
  }

  /* ---------- universo en investigación: casos ---------- */
  const ESTADOS = [
    { key: 'nuevo', label: 'Por analizar', cls: 'none', abierto: true },
    { key: 'analisis', label: 'En análisis', cls: 'prog', abierto: true },
    { key: 'atencion', label: 'En atención con el usuario', cls: 'warn', abierto: true },
    { key: 'resuelto', label: 'Resuelto', cls: 'good', abierto: false },
    { key: 'externo', label: 'Causa externa a la red Wi-Fi', cls: 'good', abierto: false },
    { key: 'sin_contacto', label: 'Sin datos para contactar', cls: 'none', abierto: false },
  ];
  const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.key, e]));
  const CAUSAS = [
    'Credenciales o certificado del usuario',
    'Configuración del equipo (supplicant o driver)',
    'Equipo sin actualizar o fuera de política',
    'RADIUS / ISE: otro código de falla',
    'Cobertura o RF',
    'Roaming entre AP',
    'Equipo personal no autorizado',
    'Por determinar',
  ];

  const INICIATIVA = {
    name: 'Monitoreo proactivo de indicadores clave 2.0',
    subtitle: 'Conexiones exitosas a BBVA_GLOBAL y BBVA',
    value: 'Medir cada día qué porcentaje de los dispositivos que intentan conectarse a la red corporativa lo logran y concentrar el esfuerzo en las fallas que no tienen una causa conocida, para que el usuario no tenga que reportar el problema.',
    impact: [
      'Trazabilidad semanal de la mejora en conexiones exitosas por sede, desde 91.3 % hacia 95 %.',
      'Separación de las fallas de credenciales (ID Authentication 12303) de las que requieren investigación.',
      'Atención caso por caso del universo en investigación hasta resolverlo o descartar la red Wi-Fi.',
    ],
    fields: [
      { key: 'exitosas', label: 'Conexiones exitosas (%)', min: 0, max: 100, required: true },
      { key: 'auth12303', label: 'Fallas ID Authentication 12303 (%)', min: 0, max: 100 },
      { key: 'investigacion', label: 'Fallas en investigación (%)', min: 0, max: 100 },
      { key: 'dispositivos', label: 'Dispositivos (intentos de conexión)', integer: true, min: 0, max: 10000000 },
    ],
    kpis: [
      { key: 'exitosas', label: 'Conexiones exitosas', unit: '%', short: '%', dir: 'up', baseline: META.inicial, baselineLabel: 'Semana del 26 al 30 oct 2026', target: META.objetivo, op: '>=', decimals: 1, yMin: 88,
        note: 'Exitosos ÷ dispositivos de todas las sedes y de ambos SSID en la semana (ponderado).' },
      { key: 'investigacion', label: 'Fallas en investigación', unit: '%', short: '%', dir: 'down', baseline: null, target: null, decimals: 2 },
      { key: 'auth12303', label: 'Fallas ID Authentication 12303', unit: '%', short: '%', dir: 'down', baseline: null, target: null, decimals: 1 },
    ],
    sections: [
      { title: 'Cómo se mide', type: 'steps', items: [
        'Cada día, por sede y por SSID (BBVA_GLOBAL o BBVA), se registran los dispositivos que intentaron conectarse, los exitosos y los fallidos.',
        'De los fallidos se separan los de ID Authentication 12303 (credenciales del usuario); el resto es el universo en investigación.',
        'El indicador semanal es la suma de exitosos entre la suma de dispositivos de la semana (ponderado por volumen).',
        'El universo en investigación se atiende caso por caso en el portal hasta resolverlo o confirmar que la causa es externa a la red Wi-Fi.',
      ] },
      { title: 'Sedes', type: 'list', items: SEDES.map((s) => s.name) },
    ],
  };

  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));

  return { SEDES, SEDE, SSIDS, META, plain, sedeDe, ssidDe, totales, ESTADOS, ESTADO, CAUSAS, INICIATIVA, addDays, mondayOf };
});
