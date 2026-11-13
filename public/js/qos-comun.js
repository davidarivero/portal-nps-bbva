'use strict';
/* Homologación de QoS WLAN: pérdida de paquetes en las interfaces de switch hacia los AP.
   Catálogos, reglas del indicador y definición de la iniciativa. Lo usan el navegador y el servidor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalQosComun = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // el orden importa: primero los nombres propios, al final los sufijos cortos (-TF-, -CO-)
  const SEDES = [
    { key: 'gdl', name: 'Guadalajara · Landmark', host: /GDL/, alias: ['gdl', 'guadalajara', 'landmark'] },
    { key: 'leon', name: 'León · City Center', host: /LEON/, alias: ['leon', 'city center'] },
    { key: 'mty', name: 'Monterrey · Obispado', host: /MTY/, alias: ['mty', 'monterrey', 'obispado'] },
    { key: 'puebla', name: 'Puebla · Inxignia', host: /PUEBLA/, alias: ['puebla', 'inxignia'] },
    { key: 'tijuana', name: 'Tijuana', host: /TIJUANA/, alias: ['tijuana'] },
    { key: 'toreo', name: 'Toreo', host: /TOREO/, alias: ['toreo'] },
    { key: 'tecnoparque', name: 'Tecnoparque', host: /TECNO/, alias: ['tecno', 'tecnoparque'] },
    { key: 'murano', name: 'Murano', host: /MURANO/, alias: ['murano'] },
    { key: 'reforma', name: 'Torre Reforma', host: /-TF(-|$)/, alias: ['reforma'] },
    { key: 'polanco', name: 'Parques Polanco', host: /-CO(-|$)/, alias: ['polanco'] },
  ];
  const SEDE = Object.fromEntries(SEDES.map((s) => [s.key, s]));
  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sedeDeHost = (host) => { const h = String(host || '').toUpperCase(); const s = SEDES.find((x) => x.host.test(h)); return s ? s.key : null; };
  const sedeDeTexto = (txt) => { const t = plain(txt); const s = SEDES.find((x) => x.alias.some((a) => t.includes(a))); return s ? s.key : null; };

  /** Clases de la política 2P2Q1T_APs, en el orden de las colas de hardware (FED Q0 a Q3). */
  const CLASES = [
    { key: 'voice', name: 'Voice', hint: 'Prioridad 1 · DSCP EF', foco: true },
    { key: 'video', name: 'Video', hint: 'Prioridad 2 · AF41, CS4', foco: true },
    { key: 'signaling', name: 'Signaling', hint: 'Cola 3 · CS3, AF11', foco: true },
    { key: 'default', name: 'class-default', hint: 'Cola 4 · resto del tráfico', foco: false },
  ];
  const FOCO = [0, 1, 2];
  const POLITICA = '2P2Q1T_APs';
  const TIPOS = { base: 'Línea base (antes de QoS)', seguimiento: 'Seguimiento semanal' };

  const ABREV = { gigabitethernet: 'Gi', gi: 'Gi', twogigabitethernet: 'Tw', tw: 'Tw', fivegigabitethernet: 'Fi', fi: 'Fi', tengigabitethernet: 'Te', te: 'Te',
    twentyfivegige: 'Twe', twe: 'Twe', fortygigabitethernet: 'Fo', fo: 'Fo', hundredgige: 'Hu', hu: 'Hu', fastethernet: 'Fa', fa: 'Fa' };
  /** "TwoGigabitEthernet1/0/2", "fi1/0/47" → "Tw1/0/2", "Fi1/0/47". */
  function intf(txt) {
    const m = String(txt || '').trim().match(/^([A-Za-z]+)\s*(\d+(?:\/\d+)*)$/);
    if (!m) return String(txt || '').trim();
    const p = m[1].toLowerCase();
    return (ABREV[p] || (p.charAt(0).toUpperCase() + p.slice(1, 2))) + m[2];
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const pct = (d, e) => (d > 0 ? (d / (d + e)) * 100 : 0);
  /** ¿La interfaz cuenta como "con pérdida"? Línea base: cualquier descarte. Seguimiento: descarte en Voice, Video o Signaling. Cero tolerancia. */
  const conPerdida = (r, tipo) => (tipo === 'base' ? sum(r.nd) > 0 : r.nd[0] + r.nd[1] + r.nd[2] > 0);
  /** Peor porcentaje de pérdida entre las clases del indicador: {q, p}. */
  function peor(r, tipo) {
    let best = { q: -1, p: 0 };
    for (const q of (tipo === 'base' ? [0, 1, 2, 3] : FOCO)) { const p = pct(r.nd[q], r.ne[q]); if (r.nd[q] > 0 && p >= best.p) best = { q, p }; }
    return best;
  }
  const bytes = (b) => {
    if (!b) return '0';
    const f = (v, u, d) => `${new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)} ${u}`;
    return b >= 1e12 ? f(b / 1e12, 'TB', 2) : b >= 1e9 ? f(b / 1e9, 'GB', b >= 1e11 ? 0 : 1) : b >= 1e6 ? f(b / 1e6, 'MB', 1) : b >= 1e3 ? f(b / 1e3, 'KB', 1) : f(b, 'B', 0);
  };
  /** % de pérdida con los decimales necesarios para que no se vea como cero. */
  const perdida = (d, e) => {
    if (!d) return '0.00%';
    const p = pct(d, e);
    const dec = p >= 0.01 ? 2 : p >= 0.0001 ? 4 : 6;
    return `${p.toFixed(dec)}%`;
  };

  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));

  const META = { inicial: 55.6, inicialLabel: '5 nov 2026 · antes de QoS', objetivo: 100 };
  const OBJETIVOS = [{ fecha: '2026-11-30', valor: 99 }, { fecha: '2026-12-31', valor: 99.5 }, { fecha: '2027-01-31', valor: 100 }];

  const INICIATIVA = {
    version: 'qos-wlan-1',
    name: 'Homologación de QoS WLAN',
    subtitle: 'Pérdida de paquetes en interfaces de switch hacia Access Points',
    value: 'Mitigar la pérdida de paquetes (drops) entre las interfaces de los switches y los Access Points, para que la voz, el video y la señalización lleguen completos al usuario aun cuando la red tiene picos de tráfico.',
    impact: [
      'Política de QoS 2P2Q1T_APs homologada en todas las interfaces de switch que conectan a un AP, en todas las sedes.',
      'Tráfico prioritario (Voice y Video) y de señalización (Signaling) protegido: cero tolerancia a la pérdida.',
      'Seguimiento semanal por sede, switch e interfaz, con objetivos mensuales.',
    ],
    fields: [
      { key: 'sin_perdida', label: 'Interfaces hacia AP sin pérdida (%)', min: 0, max: 100, required: true },
      { key: 'con_perdida', label: 'Interfaces con pérdida', integer: true, min: 0, max: 1000000 },
      { key: 'interfaces', label: 'Interfaces hacia AP', integer: true, min: 0, max: 1000000 },
    ],
    kpis: [
      { key: 'sin_perdida', label: 'Interfaces hacia AP sin pérdida', unit: '%', short: '%', dir: 'up', baseline: META.inicial, baselineLabel: META.inicialLabel, target: META.objetivo, op: '>=', decimals: 1, yMin: 50,
        note: 'Interfaces de switch hacia AP sin descarte en Voice, Video ni Signaling ÷ interfaces leídas. Cero tolerancia.' },
      { key: 'con_perdida', label: 'Interfaces con pérdida', unit: '', short: '', dir: 'down', baseline: null, target: null, decimals: 0 },
    ],
    sections: [
      { title: 'Cómo se mide', type: 'steps', items: [
        'Cada semana se cargan los respaldos de los switches con los contadores de las colas de cada interfaz que conecta a un AP (show platform hardware fed … qos queue stats interface).',
        'Por interfaz se separa el tráfico cursado y el descartado de cada clase de la política: Voice, Video, Signaling y class-default.',
        'Una interfaz cuenta como «con pérdida» si descartó aunque sea un byte de Voice, Video o Signaling desde la carga anterior (cero tolerancia). class-default se muestra como referencia.',
        'El indicador es el porcentaje de interfaces leídas sin pérdida. Los objetivos son mensuales y el seguimiento es semanal.',
      ] },
      { title: 'Política aplicada en las interfaces hacia AP', type: 'list', items: [
        'Voice (DSCP EF): priority level 1, police rate percent 10.',
        'Video (AF41, CS4): priority level 2, police rate percent 20.',
        'Signaling (CS3, AF11): bandwidth remaining percent 10.',
        'class-default: bandwidth remaining percent 60, queue-buffers ratio 60.',
      ] },
      { title: 'Sedes', type: 'list', items: ['Torre Reforma', 'Parques Polanco', 'Tecnoparque', 'Murano', 'Toreo', 'Guadalajara · Landmark', 'Monterrey · Obispado', 'Puebla · Inxignia', 'León · City Center', 'Tijuana'] },
    ],
    milestones: [],
  };

  return { SEDES, SEDE, sedeDeHost, sedeDeTexto, plain, CLASES, FOCO, POLITICA, TIPOS, intf, sum, pct, conPerdida, peor, bytes, perdida, addDays, mondayOf, META, OBJETIVOS, INICIATIVA };
});
