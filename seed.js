'use strict';
/*
 * Definición inicial de las iniciativas, tomada de la presentación
 * "Actividades Mejora WLAN - NPS" (octubre 2026).
 *
 * Solo se usa la primera vez que arranca el portal (base de datos vacía).
 * Después, las metas se editan desde el portal con un usuario administrador.
 *
 * kpi.dir     'up'  = más es mejor · 'down' = menos es mejor
 * kpi.op      comparación contra el objetivo: '>=', '>', '<=', '<'
 * kpi.limit   umbral de alerta (no es objetivo): se grafica como línea de referencia
 * kpi.ratio   [numerador, denominador] → el indicador se calcula como porcentaje
 */

const DOC = 'Valor presentado en el documento "Actividades Mejora WLAN - NPS" (octubre 2026).';

// Semana a la que se asigna la "métrica actual" del documento.
const BASE_WEEK = '2026-09-28';

module.exports = {
  program: { name: 'Mejora NPS · WLAN', client: 'BBVA', provider: 'Sipnology' },
  baseWeek: BASE_WEEK,
  initiatives: [
    {
      slug: 'recorridos',
      name: 'Recorridos proactivos',
      subtitle: 'Salud del entorno Wi-Fi',
      value: 'Los recorridos proactivos de salud Wi-Fi permiten validar de forma periódica que los colaboradores cuentan con conectividad confiable, acceso a plataformas corporativas y una experiencia adecuada a su día a día.',
      impact: [
        'Menos interrupciones en las actividades diarias.',
        'Mayor productividad de los colaboradores.',
        'Reducción de quejas relacionadas con Wi-Fi y acceso a aplicaciones.',
      ],
      fields: [
        { key: 'recorridos', label: 'Recorridos realizados en la semana', integer: true, min: 0, max: 500, required: true },
      ],
      kpis: [
        { key: 'recorridos', label: 'Recorridos por semana', unit: 'recorridos / semana', short: 'rec.', dir: 'up', baseline: 0, target: 10, op: '>=', decimals: 0, note: 'Sedes Reforma y Polanco.' },
      ],
      sections: [
        { title: 'Pruebas que se realizan durante el recorrido', type: 'list', columns: true, items: [
          'Ping DNS Google 1', 'Ping DNS Google 2', 'Ping DNS Umbrella 1', 'Ping DNS Umbrella 2',
          'Ping Zscaler 1', 'Ping Zscaler 2', 'Ping Zscaler 3', 'Ping a sitio BBVA', 'Ping a sitio de Internet',
          'Speed Test navegador 1', 'Speed Test navegador 2', 'Google Meet', 'YouTube',
        ] },
        { title: 'Validaciones complementarias', type: 'list', items: [
          'Pantalla CMD ipconfig /all, sección "Adaptador de LAN inalámbrica Wi-Fi".',
          'Pantalla del SSID al que se tiene conexión.',
          'Pantalla Meraki 10.128.128.126, sección "Access Point details".',
          'Evidencia de redes Wi-Fi escuchadas.',
        ] },
      ],
      milestones: [],
      seed: { values: { recorridos: 6 }, sede: 'Reforma, Polanco', detail: DOC + ' 6 recorridos por semana en Reforma y Polanco.' },
    },
    {
      slug: 'monitoreo',
      name: 'Monitoreo proactivo de indicadores clave',
      subtitle: 'Contacto directo con usuarios',
      value: 'No esperamos a que el usuario tenga que pedir ayuda: buscamos garantizar que pueda trabajar sin interrupciones.',
      impact: [
        'Reduce la frustración del usuario.',
        'Disminuye interrupciones en la operación diaria.',
        'Genera una percepción positiva del área.',
      ],
      fields: [
        { key: 'contactados', label: 'Usuarios contactados en la semana', integer: true, min: 0, max: 5000, required: true },
        { key: 'corregidos', label: 'Usuarios corregidos', integer: true, min: 0, max: 5000, maxField: 'contactados' },
        { key: 'en_espera', label: 'Usuarios en espera de respuesta', integer: true, min: 0, max: 5000, maxField: 'contactados' },
      ],
      kpis: [
        { key: 'contactados', label: 'Usuarios contactados por semana', unit: 'usuarios / semana', short: 'usuarios', dir: 'up', baseline: 0, target: 25, op: '>=', decimals: 0 },
        { key: 'corregidos', label: 'Usuarios corregidos', unit: 'usuarios', short: 'usuarios', dir: 'up', baseline: null, target: null, decimals: 0 },
        { key: 'en_espera', label: 'En espera de respuesta', unit: 'usuarios', short: 'usuarios', dir: null, baseline: null, target: null, decimals: 0 },
      ],
      sections: [
        { title: 'Metodología de validación', type: 'steps', intro: 'Toda interacción es directamente a través del chat de Google institucional de BBVA. La selección de usuarios se realiza en el dashboard de Meraki por nombre de dispositivo y después se busca al cliente por usuario de red BBVA.', items: [
          'Selección de usuarios: Meraki → Assurance → Analytics → Overview.',
          'Identificación del usuario por hostname a través del directorio My Workday BBVA.',
          'Mensaje de presentación para confirmar algún problema de conexión de sus dispositivos y agendar un acercamiento.',
        ] },
        { title: 'Mensaje de contacto', type: 'quote', text: 'Hola, mi nombre es ______ y formo parte del equipo de Networking IC. Nos encontramos realizando acciones para mejorar la experiencia de conectividad de nuestros usuarios y hemos identificado algunos indicadores que podrían estar relacionados con la conexión a la red Wi-Fi. Queríamos acercarnos contigo para validar si has tenido algún problema reciente relacionado con tu conectividad. Si es así, podemos agendar una visita en el horario que te resulte conveniente para analizar la situación con mayor detalle y brindarte apoyo.' },
      ],
      milestones: [],
      seed: { values: { contactados: 11, corregidos: 4, en_espera: 7 }, detail: DOC + ' 11 usuarios contactados: 4 corregidos y 7 en espera de respuesta.' },
    },
    {
      slug: 'rediseno',
      name: 'Rediseño WLAN sedes centrales y divisionales',
      subtitle: 'Capacidad por Access Point',
      value: 'Mejora el soporte total de cada piso con los AP de refuerzo: más canales y redistribución de la carga para un mejor soporte de dispositivos por AP.',
      impact: [
        'Crecimiento de 16% en dispositivos (de 576 a 668 dispositivos en BR en todas las sedes divisionales).',
        'Nuevo soporte total de 960 dispositivos con los 11 AP de refuerzo.',
        'Revisión, análisis y reporte mensual del promedio de dispositivos por AP para posibles rediseños futuros.',
      ],
      fields: [
        { key: 'disp_por_ap', label: 'Dispositivos por AP (promedio)', integer: false, min: 0, max: 500, required: true },
      ],
      kpis: [
        { key: 'disp_por_ap', label: 'Dispositivos por AP (promedio)', unit: 'dispositivos / AP', short: 'disp./AP', dir: 'down', baseline: 18, target: null, limit: 37, limitLabel: 'Criterio de rediseño', decimals: 1, note: 'Más de 37 dispositivos por AP durante más de 5 días consecutivos en pisos críticos obliga a evaluar un rediseño WLAN.' },
      ],
      sections: [
        { title: 'Criterios para rediseños', type: 'list', items: [
          'El crecimiento de dispositivos está sujeto a la demanda y proyección de ocupación definida por el cliente.',
          'Más de 37 dispositivos por AP durante más de 5 días consecutivos en pisos críticos: evaluación de rediseño WLAN.',
        ] },
        { title: 'Procedimiento para crecimiento de usuarios Wi-Fi en pisos críticos', type: 'groups', groups: [
          { title: 'Levantamiento y baseline actual', items: ['Usuarios actuales y crecimiento esperado.', 'Distribución de usuarios de datos y VoWiFi.', 'Utilización de canales, airtime, RSSI/SNR y capacidad de los AP.', 'Validación de infraestructura LAN, PoE y uplinks.'] },
          { title: 'Diseño y optimización RF', items: ['Definir cantidad y ubicación de AP adicionales.', 'Simulación de crecimiento y ubicación óptima de nuevos AP.', 'Optimizar canales y potencia.', 'Considerar 20 MHz en escenarios de alta densidad.'] },
          { title: 'Validación de infraestructura', items: ['Disponibilidad de puertos y PoE.', 'Capacidad de uplinks.', 'Validación de VLAN, DHCP y autenticación.'] },
          { title: 'Implementación controlada', items: ['Instalación y adopción de nuevos AP.', 'Validación de conectividad y autenticación.', 'Pruebas de roaming y llamadas VoWiFi.'] },
          { title: 'Validación y cierre', items: ['Post-survey con Ekahau para comprobar el diseño.', 'Pruebas de cobertura, capacidad y roaming.', 'Comparación antes / después y documentación de resultados.'] },
        ] },
      ],
      milestones: [
        { date: '2026-07-04', text: 'Puebla Inxginia: instalación de 2 AP de refuerzo.' },
        { date: '2026-07-22', text: 'León City Center: instalación de 2 AP de refuerzo.' },
        { date: '2026-07-24', text: 'Tijuana BH: instalación de 2 AP de refuerzo.' },
        { date: '2026-08-03', text: 'Piso 28 MTY Obispado: instalación de 3 AP de refuerzo.' },
        { date: '2026-08-07', text: 'Piso 32 MTY Obispado: instalación de 2 AP de refuerzo.' },
      ],
      seed: { values: { disp_por_ap: 15.5 }, detail: DOC + ' Promedio de 15.5 dispositivos por AP después de instalar los AP de refuerzo.' },
    },
    {
      slug: 'mdns',
      name: 'Bloqueo de tráfico mDNS',
      subtitle: 'Saturación de tráfico inalámbrico',
      value: 'Garantizar las mejores condiciones de la infraestructura, sacando el mayor provecho de los recursos tecnológicos actuales del banco.',
      impact: [
        'Optimización del rendimiento de tráfico Wireless LAN.',
        'Red más estable y con menor congestión.',
        'Menor utilización de recursos de los equipos de comunicaciones.',
      ],
      fields: [
        { key: 'saturacion', label: 'Saturación de tráfico mDNS (%)', integer: false, min: 0, max: 100, required: true },
      ],
      kpis: [
        { key: 'saturacion', label: 'Saturación de tráfico mDNS', unit: '%', short: '%', dir: 'down', baseline: 12.93, target: 5, op: '<', decimals: 2 },
      ],
      sections: [
        { title: 'Metodología de validación', type: 'steps', intro: 'El cumplimiento de la métrica se comprueba con una captura de tráfico desde el dashboard de Meraki. Cualquier usuario con acceso a Meraki puede corroborar la información:', items: [
          'Ingresar al menú Assurance → Tools → Intelligence Capture.',
          'Seleccionar el archivo de captura a revisar.',
          'En la barra de filtro escribir "MDNS" y dar enter.',
          'Confirmar el resultado en la barra izquierda.',
        ], outro: 'Toda la extracción de información se realiza directamente en Meraki.' },
      ],
      milestones: [
        { date: '2026-06-02', text: 'Detección.' },
        { date: '2026-06-17', dateEnd: '2026-06-23', text: 'Pruebas y validaciones.' },
        { date: '2026-07-10', text: 'Ventana de aplicación de bloqueo en sedes Polanco, GDL y Tijuana (CRQ000101780582).' },
        { date: '2026-08-20', text: 'Ventana de aplicación de bloqueo en sedes Reforma, Murano, Toreo, Tecnoparque, Puebla, MTY y León (CRQ000101823553).' },
        { date: '2026-10-07', text: 'Revisión programada: actualización de KPI.' },
        { date: '2026-10-14', text: 'Revisión programada: actualización de KPI.' },
      ],
      seed: { values: { saturacion: 0.12 }, detail: DOC + ' Saturación de tráfico mDNS de 0.12% después de aplicar el bloqueo.' },
    },
    {
      slug: 'qos',
      name: 'Homologación QoS en bancas remotas',
      subtitle: 'Índice de Protección de Servicios Críticos (IPSC)',
      value: 'Asegurar que los servicios más relevantes para la operación mantengan su desempeño incluso cuando la red experimenta congestión.',
      impact: [
        'Aplicación de mecanismo de priorización de tráfico.',
        'Mitigación de riesgo de congestión.',
        'Reducción del riesgo de degradación en servicios de voz, videoconferencia y aplicaciones corporativas.',
      ],
      fields: [
        { key: 'aps_qos', label: 'AP con QoS aplicado', integer: true, min: 0, max: 100000, required: true, maxField: 'aps_total' },
        { key: 'aps_total', label: 'Total de AP en áreas BR', integer: true, min: 1, max: 100000, required: true },
      ],
      kpis: [
        { key: 'ipsc', label: 'IPSC', unit: '%', short: '%', dir: 'up', baseline: 0, target: 100, op: '>=', decimals: 0, ratio: ['aps_qos', 'aps_total'], note: 'IPSC = AP con QoS / total de AP × 100. Inicial: 0 de 32 AP.' },
      ],
      sections: [
        { title: 'Alcance', type: 'text', text: 'Se aplicó calidad de servicio a un total de 32 AP, que es el total en todas las áreas BR de las 6 sedes consideradas.' },
      ],
      milestones: [],
      seed: { values: { aps_qos: 32, aps_total: 32 }, detail: DOC + ' QoS aplicado en 32 de 32 AP de las áreas BR de las 6 sedes.' },
    },
    {
      slug: 'firmware',
      name: 'Debugging periódico de firmware',
      subtitle: 'Prevención de fallas de software',
      value: 'Garantizar la continuidad operativa de la red corporativa y proteger la productividad de los usuarios finales, anticipando fallas de software mediante monitoreo preventivo para evitar interrupciones masivas en sucursales y campus.',
      impact: [
        'Detección proactiva de fallas antes de que generen reportes de usuario final.',
        'Reducción drástica en tickets L1/L2 asociados a intermitencia y reconexión Wi-Fi.',
        'Validación controlada del ciclo de vida del firmware.',
      ],
      fields: [
        { key: 'defectos_activos', label: 'Defectos activos en producción', integer: true, min: 0, max: 10000, required: true },
        { key: 'fallas_identificadas', label: 'Fallas / bugs identificados (acumulado)', integer: true, min: 0, max: 10000 },
        { key: 'fallas_evaluadas', label: 'Fallas evaluadas y documentadas (acumulado)', integer: true, min: 0, max: 10000, maxField: 'fallas_identificadas' },
      ],
      kpis: [
        { key: 'defectos_activos', label: 'Defectos activos en producción', unit: 'defectos', short: 'defectos', dir: 'down', baseline: 2, baselineLabel: '2 bugs potenciales identificados', target: null, decimals: 0 },
        { key: 'evaluadas', label: 'Fallas evaluadas y documentadas', unit: '%', short: '%', dir: 'up', baseline: null, target: 95, op: '>', decimals: 0, ratio: ['fallas_evaluadas', 'fallas_identificadas'] },
      ],
      sections: [
        { title: 'Bugs reportados', type: 'list', items: [
          'MR-99882: Clients may experience latency spikes and packet loss on 5 GHz.',
          'MR-86063: Wi-Fi 6 APs may experience an unexpected reboot.',
        ], link: { label: 'Documentación del fabricante: MR 32.2.4 Release Notes', url: 'https://documentation.meraki.com/Wireless/Product_Information/Compatibility_and_Firmware/MR_32.2.4_Release_Notes#mr-86063' } },
        { title: 'Procedimiento', type: 'steps', items: [
          'Filtrado de plataforma: depuración de Release Notes aislando únicamente las fallas aplicables al hardware instalado (MR46/MR56) y features corporativas activas (802.1X, roaming).',
          'Extracción y auditoría forense: análisis periódico de eventos del dashboard (Wireless Health, desconexiones, Event Log) en busca de patrones de error conocidos.',
          'Clasificación de criticidad: separación de problemas externos a la red Wi-Fi (por ejemplo, latencia DNS o dispositivos fuera de cobertura) de fallas atribuibles a bugs de firmware.',
          'Resolución y prevención: validación formal del software en operación o aplicación preventiva de ajustes de configuración para resolver fallas sin reiniciar equipos fuera de ventana.',
        ] },
      ],
      milestones: [
        { label: 'Mes 1 · Estabilización', text: 'Monitoreo continuo de telemetría, descartando anomalías en asociaciones masivas y roaming.' },
        { label: 'Mes 2 · Auditoría', text: 'Correlación de logs contra bugs conocidos: confirmación de 0 impacto operativo.' },
        { label: 'Mes 3 a 5 · Monitoreo preventivo', text: 'Rastreo de nuevas actualizaciones de software, correcciones del fabricante y boletines de seguridad emitidos por Cisco Meraki.' },
        { label: 'Mes 6 · Evaluación de ciclo de vida', text: 'Decisión ante comité: mantener 32.2.4 como versión base estable del banco o planificar una ventana de actualización controlada si las nuevas versiones ofrecen mejoras operativas reales sin reintroducir riesgos.' },
      ],
      seed: { values: { defectos_activos: 0, fallas_identificadas: 2 }, detail: DOC + ' 2 bugs potenciales identificados (MR-99882 y MR-86063) y 0 defectos activos en producción.' },
    },
  ],
};
