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

  /* ---------- reportes de detalle (Abaton e ISE) ---------- */
  const ISE = {
    12303: 'PEAP no permitido: el equipo intenta usuario y contraseña donde se exige certificado (EAP-TLS)',
    11510: 'El equipo rechazó el método EAP de la política y no propuso otro',
    11512: 'El equipo pidió un protocolo EAP no soportado',
    11514: 'Mensaje TLS vacío: el equipo abandonó la negociación',
    12514: 'Certificado del equipo emitido por una CA desconocida',
    12520: 'El equipo rechazó el certificado de ISE',
    12521: 'Falla TLS después de una alerta del equipo',
    12918: 'Respuesta EAP con identificador que no corresponde',
    12980: 'EAP-TTLS no permitido',
    22047: 'Certificado del equipo sin atributo de usuario',
  };
  const CATEGORIAS = [
    { key: 'sin_ise', label: '802.1X sin registro en ISE (timeout o abandono)', hint: 'La falla no llegó a ISE: el equipo no completó el intercambio 802.1X.' },
    { key: 'eap', label: 'Método EAP no soportado por el equipo', hint: 'Configuración del supplicant: el equipo no ofrece EAP-TLS.' },
    { key: 'certificado', label: 'Certificado o TLS', hint: 'CA desconocida, certificado de ISE rechazado o certificado sin usuario.' },
    { key: 'dhcp', label: 'DHCP (sin solicitud o sin respuesta)', hint: 'El equipo se autenticó, pero no obtuvo dirección IP.' },
    { key: 'otra', label: 'Asociación, DNS u otra', hint: '' },
  ];
  const CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c]));
  const PRIORIDADES = [
    { key: 'alta', label: 'Alta', cls: 'crit', hint: 'Sin conexión posterior y con 2 días o más, 9 fallos o más, o un código de ISE de configuración.' },
    { key: 'media', label: 'Media', cls: 'warn', hint: 'Sin conexión posterior, un día y pocos fallos.' },
    { key: 'baja', label: 'Baja', cls: 'good', hint: 'Se conectó con éxito después del último intento fallido.' },
  ];
  const PRIORIDAD = Object.fromEntries(PRIORIDADES.map((p) => [p.key, p]));
  const codigoDe = (log) => { const m = String(log || '').match(/^\s*(\d{5})/); return m ? m[1] : null; };
  /** Categoría de un dispositivo en investigación a partir del código de ISE y los tipos de falla de Abaton. */
  function categoria(codigo, tipos) {
    if (['11510', '11512', '12980', '12918'].includes(codigo)) return 'eap';
    if (['12514', '12520', '12521', '11514', '22047'].includes(codigo)) return 'certificado';
    const t = String(tipos || '').toUpperCase();
    if (t.includes('802.1X')) return 'sin_ise';
    if (t.includes('DHCP')) return 'dhcp';
    return codigo ? 'eap' : 'otra';
  }
  function prioridad({ recuperado, dias, fallos, codigo }) {
    if (recuperado) return 'baja';
    if (dias >= 2 || fallos >= 9 || (codigo && codigo !== '12303')) return 'alta';
    return 'media';
  }

  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));

  return { SEDES, SEDE, SSIDS, META, plain, sedeDe, ssidDe, totales, ESTADOS, ESTADO, CAUSAS, INICIATIVA, ISE, CATEGORIAS, CATEGORIA, PRIORIDADES, PRIORIDAD, codigoDe, categoria, prioridad, addDays, mondayOf };
});
