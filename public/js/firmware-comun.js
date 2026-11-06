'use strict';
/* Debugging periódico de firmware: catálogos y reglas compartidas por el navegador y el servidor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalFirmwareComun = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // Catálogo propio de esta iniciativa (no depende de Recorridos ni de Monitoreo).
  const SEDES = [
    { key: 'gdl', name: 'Guadalajara · Landmark' },
    { key: 'mty', name: 'Monterrey · Torre Obispado' },
    { key: 'polanco', name: 'CDMX · Parques Polanco' },
    { key: 'reforma', name: 'CDMX · Reforma' },
    { key: 'murano', name: 'CDMX · Murano' },
    { key: 'puebla', name: 'Puebla · Torre Inxignia' },
    { key: 'tijuana', name: 'Tijuana · Torre BH' },
    { key: 'leon', name: 'León · City Center' },
  ];
  const SEDE = Object.fromEntries(SEDES.map((s) => [s.key, s]));
  const MODELOS = ['MR56', 'MR46', 'MR36', 'MR44', 'MR57', 'CW9166'];

  /* ---------- análisis previo: known issues ---------- */
  const SEVERIDADES_KI = [
    { key: 'bajo', label: 'Bajo', puntos: 1 },
    { key: 'medio', label: 'Medio', puntos: 2 },
    { key: 'alto', label: 'Alto', puntos: 3 },
    { key: 'critico', label: 'Crítico', puntos: 3 },
  ];
  const SEV_KI = Object.fromEntries(SEVERIDADES_KI.map((s) => [s.key, s]));
  const APLICA = [
    { key: 'pendiente', label: 'Pendiente de validar' },
    { key: 'si', label: 'Sí, aplica a nuestros modelos' },
    { key: 'no', label: 'No aplica a nuestros modelos' },
  ];
  const DECISIONES = {
    migrar: { label: 'Se recomienda migrar', short: 'Migrar', cls: 'good', hint: 'Sin Known Issues altos o críticos aplicables. Proceder con las validaciones previas.' },
    piloto: { label: 'Requiere laboratorio o piloto', short: 'Piloto', cls: 'warn', hint: 'Hay al menos un Known Issue alto aplicable o el puntaje supera 4. Probar en un grupo reducido antes de decidir.' },
    no_migrar: { label: 'No migrar: escalar al fabricante', short: 'No migrar', cls: 'crit', hint: 'Hay un Known Issue crítico aplicable. Se bloquea la migración y se escala.' },
    pendiente: { label: 'Pendiente: validar aplicabilidad', short: 'Pendiente', cls: 'none', hint: 'Falta confirmar si cada Known Issue aplica a nuestros modelos.' },
  };
  const PUNTAJE_PILOTO = 5; // 5 puntos o más (por ejemplo, tres issues medios) envían a piloto

  /** Evalúa los Known Issues de un análisis. issues: [{descripcion, severidad, aplica}] */
  function evaluar(issues, sinIssues) {
    const list = (issues || []).filter((i) => String(i.descripcion || '').trim());
    const aplicables = list.filter((i) => i.aplica === 'si');
    const puntaje = aplicables.reduce((s, i) => s + (SEV_KI[i.severidad] ? SEV_KI[i.severidad].puntos : 0), 0);
    const cuenta = Object.fromEntries(SEVERIDADES_KI.map((s) => [s.key, aplicables.filter((i) => i.severidad === s.key).length]));
    let decision;
    if (sinIssues) decision = 'migrar';
    else if (list.some((i) => i.aplica === 'pendiente' || !i.aplica)) decision = 'pendiente';
    else if (cuenta.critico) decision = 'no_migrar';
    else if (cuenta.alto || puntaje >= PUNTAJE_PILOTO) decision = 'piloto';
    else decision = 'migrar';
    const motivos = [];
    if (sinIssues) motivos.push('Se revisaron las notas de versión y no se detectaron Known Issues relevantes.');
    else {
      motivos.push(`${aplicables.length} de ${list.length} Known Issues aplican a nuestros modelos (puntaje ${puntaje}).`);
      if (decision === 'pendiente') motivos.push('Hay issues con aplicabilidad pendiente: no se puede autorizar el avance hasta validarlos.');
      if (cuenta.critico) motivos.push(`${cuenta.critico} crítico(s) aplicable(s): bloqueo y escalamiento al fabricante.`);
      if (cuenta.alto) motivos.push(`${cuenta.alto} alto(s) aplicable(s): probar en laboratorio o piloto.`);
      if (!cuenta.critico && !cuenta.alto && puntaje >= PUNTAJE_PILOTO) motivos.push(`El puntaje llega a ${puntaje} (5 o más): varios issues menores suman un riesgo que conviene probar en piloto.`);
      if (decision === 'migrar') motivos.push('Los issues bajos o medios por sí solos no envían a piloto.');
    }
    return { decision, puntaje, aplicables: aplicables.length, total: list.length, cuenta, motivos };
  }

  /* ---------- registro de actualización ---------- */
  const CHECK = {
    pre: [
      ['aprobacion', 'Ventana de mantenimiento autorizada', 'El cambio tiene aprobación y horario acordado.'],
      ['linea_base', 'Estado inicial registrado', 'Estado de los AP, alertas y conectividad antes del cambio.'],
      ['reversa', 'Plan de reversa disponible', 'Se conoce el procedimiento para volver a la versión anterior.'],
      ['alcance', 'Alcance de equipos confirmado', 'La sede y la cantidad de AP corresponden al cambio.'],
      ['avisos', 'Áreas interesadas notificadas', 'Se informó a las personas o equipos afectados.'],
    ],
    durante: [
      ['monitoreo', 'Monitoreo activo durante la ventana', 'Alertas, disponibilidad y estado de los equipos.'],
      ['avance', 'Avance de actualización revisado', 'Cuántos AP terminaron y cuáles requieren seguimiento.'],
      ['incidentes', 'Incidentes documentados', 'Hora, síntoma y acción tomada de cada desviación.'],
    ],
    post: [
      ['estado_ap', 'Estado de los AP validado', 'Los AP esperados aparecen en estado operativo con la versión nueva.'],
      ['ssid', 'SSID y autenticación probados', 'Prueba autorizada de conexión inalámbrica.'],
      ['conectividad', 'Conectividad validada', 'Acceso a los recursos que correspondan a la sede.'],
      ['alertas', 'Alertas posteriores revisadas', 'Alertas nuevas o pendientes en el dashboard.'],
      ['usuarios', 'Impacto al usuario revisado', 'Afectaciones reportadas tras el cambio.'],
    ],
  };
  const RESULTADOS = [
    { key: 'completada', label: 'Completada', cls: 'good', instalada: true },
    { key: 'observaciones', label: 'Completada con observaciones', cls: 'warn', instalada: true },
    { key: 'parcial', label: 'Parcial', cls: 'warn', instalada: true },
    { key: 'revertida', label: 'Revertida', cls: 'crit', instalada: false },
    { key: 'cancelada', label: 'Cancelada', cls: 'none', instalada: false },
  ];
  const RESULTADO = Object.fromEntries(RESULTADOS.map((r) => [r.key, r]));
  const CONECTIVIDAD = ['Correcta', 'Con observaciones', 'Fallida', 'No realizada'];
  const IMPACTO_POST = [
    { key: 'no', label: 'No se observaron impactos asociados' },
    { key: 'previsto', label: 'Sí, se observó un impacto previsto' },
    { key: 'no_previsto', label: 'Se observó un impacto no previsto' },
    { key: 'pendiente', label: 'Pendiente de confirmar en monitoreo' },
  ];
  const DIAS_SEGUIMIENTO = 30;

  /* ---------- reportes de fallos ---------- */
  const CATEGORIAS = [
    { key: 'A', label: 'A. Control de cambio y firmware', subtipos: ['Release notes, bugs conocidos y funciones afectadas', 'Compatibilidad, configuración y alcance'] },
    { key: 'B', label: 'B. Estado y disponibilidad de AP', subtipos: ['Estado de AP y versión instalada', 'Reinicios repetidos o desconexiones de nube'] },
    { key: 'C', label: 'C. SSID, autenticación y acceso', subtipos: ['SSID, asociación y autenticación', '802.1X / RADIUS / MAB / portal cautivo', 'VLAN, DHCP, DNS, gateway y direccionamiento'] },
    { key: 'D', label: 'D. RF y calidad de conexión', subtipos: ['Canales, ancho de canal, potencia y RF', 'Ruido, SNR, RSSI y utilización de canal / airtime', 'Interferencia, retransmisiones y pérdida de paquetes'] },
    { key: 'E', label: 'E. Rendimiento y experiencia del usuario', subtipos: ['Latencia, pérdida, jitter y rendimiento', 'Aplicaciones críticas, VPN, voz o videollamadas'] },
    { key: 'F', label: 'F. Monitoreo y cierre', subtipos: ['Event log y comparación con línea base', 'Incremento de tickets o quejas de usuarios'] },
  ];
  const CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c]));
  const SEVERIDADES = [
    { key: 'critica', label: 'Crítica', cls: 'crit' },
    { key: 'alta', label: 'Alta', cls: 'crit' },
    { key: 'media', label: 'Media', cls: 'warn' },
    { key: 'baja', label: 'Baja', cls: 'none' },
  ];
  const SEVERIDAD = Object.fromEntries(SEVERIDADES.map((s) => [s.key, s]));
  // Defectos activos = reportes abiertos; evaluados = los que ya pasaron de "Nuevo".
  const ESTADOS = [
    { key: 'nuevo', label: 'Nuevo', cls: 'none', abierto: true },
    { key: 'investigacion', label: 'En investigación', cls: 'prog', abierto: true },
    { key: 'reproducido', label: 'Reproducido', cls: 'warn', abierto: true },
    { key: 'escalado', label: 'Escalado al fabricante', cls: 'warn', abierto: true },
    { key: 'confirmado', label: 'Bug confirmado', cls: 'crit', abierto: true },
    { key: 'no_reproducible', label: 'No reproducible', cls: 'good', abierto: false },
    { key: 'cerrado', label: 'Cerrado / workaround', cls: 'good', abierto: false },
  ];
  const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.key, e]));
  const IMPACTOS = ['Utilización alta', 'Intermitencia', 'Lentitud', 'Desconexiones de clientes', 'Problemas de autenticación', 'Pérdida de conectividad', 'Reinicio de AP', 'Problema de cobertura o señal', 'Errores de firmware / actualización', 'Otro'];
  const ALCANCES = ['Afectación total de la sede', 'Área específica', 'Piso específico', 'AP o grupo de AP específico', 'Usuarios específicos', 'Sin afectación de servicio confirmada', 'Por determinar'];
  const RECURRENCIA = { reportes: 4, dias: 30 };

  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /** Patrón normalizado: "Intermitencia tras MR 31.x" y "intermitencia  tras mr-31.x" cuentan como el mismo. */
  const normPatron = (s) => plain(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

  /** Grupos de reportes con la misma categoría y patrón dentro de la ventana móvil que termina en `hoy`. */
  function recurrencias(reportes, hoy) {
    const desde = addDays(hoy, -(RECURRENCIA.dias - 1));
    const g = new Map();
    for (const r of reportes) {
      if (!r.fecha || r.fecha < desde || r.fecha > hoy || !r.patron) continue;
      const k = `${r.categoria}|${normPatron(r.patron)}`;
      const x = g.get(k) || { categoria: r.categoria, patron: r.patron, n: 0, sedes: new Set(), ids: [] };
      x.n += 1; x.sedes.add(r.sede); x.ids.push(r.id); g.set(k, x);
    }
    return [...g.values()].map((x) => ({ ...x, sedes: [...x.sedes] })).sort((a, b) => b.n - a.n);
  }

  return { SEDES, SEDE, MODELOS, SEVERIDADES_KI, SEV_KI, APLICA, DECISIONES, PUNTAJE_PILOTO, evaluar, CHECK, RESULTADOS, RESULTADO, CONECTIVIDAD, IMPACTO_POST, DIAS_SEGUIMIENTO,
    CATEGORIAS, CATEGORIA, SEVERIDADES, SEVERIDAD, ESTADOS, ESTADO, IMPACTOS, ALCANCES, RECURRENCIA, plain, normPatron, addDays, diasEntre, recurrencias };
});
