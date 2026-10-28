'use strict';
/* Encuestas a usuarios finales: preguntas, metas y textos del speech. Lo usan el navegador y el servidor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalEncuestasComun = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const META = { porDia: 100, porSede: 50, semanas: 4, diasHabiles: 20, total: 2000 };
  const SEDES = ['polanco', 'reforma'];

  const RESULTADOS = [
    { key: 'completa', label: 'Aceptó y respondió' },
    { key: 'ocupado', label: 'Ocupado: atender en otro momento' },
    { key: 'rechazo', label: 'No desea participar' },
  ];
  const INCONVENIENTES = [
    { key: 'lentitud', label: 'Lentitud' },
    { key: 'desconexiones', label: 'Desconexiones' },
    { key: 'cobertura', label: 'Mala cobertura' },
    { key: 'acceso', label: 'Problemas de acceso' },
    { key: 'otro', label: 'Otro' },
  ];
  const FRECUENCIAS = [
    { key: 'rara', label: 'Rara vez' },
    { key: 'semana', label: 'Algunas veces por semana' },
    { key: 'diario', label: 'Diariamente' },
    { key: 'varias', label: 'Varias veces al día' },
  ];
  const ACTIVIDADES = [
    { key: 'web', label: 'Navegación web' },
    { key: 'video', label: 'Videollamadas' },
    { key: 'apps', label: 'Aplicaciones corporativas' },
    { key: 'archivos', label: 'Transferencia de archivos' },
    { key: 'vpn', label: 'Conexión VPN' },
    { key: 'otro', label: 'Otro' },
  ];

  const SPEECH = {
    inicio: 'Buen día. Mi nombre es {nombre} y estamos realizando una breve encuesta para conocer la experiencia de los usuarios con la conexión WiFi de BBVA. ¿Tendría un minuto disponible para responder unas preguntas rápidas? La intención es identificar oportunidades de mejora en el servicio y contribuir a que su experiencia de conexión sea cada vez mejor.',
    acepta: 'Muchas gracias por su apoyo. Le haré unas preguntas breves sobre su experiencia al conectarse a la red WiFi. Sus respuestas nos ayudarán a identificar áreas de oportunidad y fortalecer el servicio.',
    ocupado: 'Entiendo, no se preocupe. ¿Le sería posible atendernos en otro momento que le resulte más conveniente? No queremos interrumpir sus actividades.',
    cierre: 'Muchas gracias por su tiempo y participación. Sus comentarios son importantes para ayudarnos a mejorar la experiencia de conexión WiFi en BBVA. Que tenga un excelente día.',
  };
  const PREGUNTAS = {
    q1: 'Actualmente, ¿la calidad de la conexión Wi-Fi cumple con tus expectativas para realizar tus actividades?',
    comentario: '¿Hay algún comentario o sugerencia que nos quieras compartir?',
    q2: '¿Cuál es el principal inconveniente que percibes?',
    q3: '¿Qué tan frecuente es este inconveniente?',
    q4: '¿En qué tipo de actividad notas más el problema?',
  };
  const RECOMENDACIONES = [
    'Abordar en el momento adecuado: evitar acercarse cuando el usuario esté en una llamada, reunión o concentrado en una actividad importante.',
    'Ser breves y naturales: procurar que la encuesta dure entre uno y dos minutos.',
    'No sugerir respuestas: mantener una actitud neutral para obtener información real sobre la experiencia del usuario.',
    'No asumir que existe una falla: el objetivo es conocer su experiencia, incluso si su conexión funciona correctamente.',
    'Respetar su decisión: si no tiene tiempo o no desea participar, agradecer y retirarse amablemente.',
  ];

  const INICIATIVA = {
    name: 'Encuestas a usuarios finales',
    subtitle: 'Voz del usuario · Polanco y Reforma',
    value: 'Escuchar directamente a los colaboradores sobre su experiencia WiFi permite confirmar dónde el servicio cumple y dónde hay que actuar, con datos por sede, piso y tipo de actividad.',
    impact: [
      'Medición directa de la satisfacción con el WiFi en las sedes corporativas.',
      'Identificación de pisos y actividades con más inconvenientes para priorizar acciones.',
      'Cada usuario encuestado recibe las recomendaciones de uso y el canal para reportar incidencias (Service Now).',
    ],
    fields: [
      { key: 'encuestas', label: 'Encuestas realizadas en la semana', integer: true, min: 0, max: 5000, required: true },
      { key: 'satisfechos', label: 'Usuarios que dicen que el WiFi cumple sus expectativas', integer: true, min: 0, max: 5000, maxField: 'encuestas' },
    ],
    kpis: [
      { key: 'acumulado', label: 'Encuestas acumuladas del levantamiento', unit: 'encuestas', short: 'encuestas', dir: 'up', baseline: 0, target: 2000, op: '>=', decimals: 0, note: 'Avance contra la meta total: 100 encuestas por día hábil (50 en Polanco y 50 en Reforma) durante 4 semanas.' },
      { key: 'encuestas', label: 'Encuestas por semana', unit: 'encuestas / semana', short: 'encuestas', dir: 'up', baseline: 0, target: 500, op: '>=', decimals: 0, note: 'Meta: 100 encuestas por día hábil, 50 en Polanco y 50 en Reforma, durante 4 semanas (2,000 en total).' },
      { key: 'satisfaccion', label: 'Usuarios satisfechos', unit: '%', short: '%', dir: 'up', baseline: null, target: null, decimals: 0, ratio: ['satisfechos', 'encuestas'], note: 'Porcentaje que responde "Sí" a la pregunta 1.' },
    ],
    sections: [
      { title: 'Speech de la encuesta', type: 'steps', intro: 'Tiempo aproximado: 3 a 5 minutos.', items: [
        'Inicio y presentación: ' + SPEECH.inicio.replace('{nombre}', '[nombre del encuestador]'),
        'Si el usuario acepta: ' + SPEECH.acepta,
        'Si el usuario está ocupado: ' + SPEECH.ocupado,
        'Cierre: ' + SPEECH.cierre + ' Se entrega o muestra la postal con recomendaciones y el canal para reportar incidencias.',
      ] },
      { title: 'Preguntas', type: 'steps', items: [
        PREGUNTAS.q1 + ' (Sí / No)',
        'Si responde Sí: ' + PREGUNTAS.comentario + ' (respuesta abierta).',
        'Si responde No: ' + PREGUNTAS.q2 + ' (Lentitud, Desconexiones, Mala cobertura, Problemas de acceso, Otro).',
        PREGUNTAS.q3 + ' (Rara vez, Algunas veces por semana, Diariamente, Varias veces al día).',
        PREGUNTAS.q4 + ' (Navegación web, Videollamadas, Aplicaciones corporativas, Transferencia de archivos, Conexión VPN, Otro).',
        'Información complementaria: fecha, sede, piso y referencia (zona, AP o ID de la posición).',
      ] },
      { title: 'Recomendaciones para los encuestadores', type: 'list', items: RECOMENDACIONES },
    ],
  };

  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const habil = (s) => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
  function diasHabiles(desde, hasta) { const out = []; if (!desde || !hasta) return out; for (let d = desde; d <= hasta; d = addDays(d, 1)) if (habil(d)) out.push(d); return out; }
  /** Último día hábil del levantamiento: 20 días hábiles a partir del inicio. */
  function finDe(inicio) { let d = inicio, n = habil(d) ? 1 : 0; while (n < META.diasHabiles) { d = addDays(d, 1); if (habil(d)) n += 1; } return d; }

  return { META, SEDES, RESULTADOS, INCONVENIENTES, FRECUENCIAS, ACTIVIDADES, SPEECH, PREGUNTAS, RECOMENDACIONES, INICIATIVA, plain, addDays, diasHabiles, finDe };
});
