'use strict';
/* Debugging periódico de firmware.
   Pestañas: Resumen para BBVA · Análisis de firmware · Actualizaciones · Reportes de fallos · Acerca de la iniciativa.
   La captura se hace en un panel lateral, como en Monitoreo. Todo se guarda en el servidor (no en el navegador). */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const F = window.PortalFirmwareComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const sedeN = (k) => (F.SEDE[k] ? F.SEDE[k].name : k || '—');
  const ddmm = (ts) => `${ts.slice(0, 10).split('-').reverse().join('/')} ${ts.slice(11, 16)}`;
  const pill = (cls, text, title) => h('span', { class: `pill pill-${cls} fw-pill`, title: title || null }, text);
  const decPill = (a) => (a.decision === 'piloto' && a.pilotoAprobado ? pill('good', 'Piloto aprobado', a.pilotoNota) : pill(F.DECISIONES[a.decision].cls, F.DECISIONES[a.decision].short, F.DECISIONES[a.decision].label));
  const resPill = (k) => pill(F.RESULTADO[k].cls, F.RESULTADO[k].label);
  const sevPill = (k) => pill(F.SEVERIDAD[k].cls, F.SEVERIDAD[k].label);
  const estPill = (k) => pill(F.ESTADO[k].cls, F.ESTADO[k].label);
  const TABS = [['resumen', 'Resumen para BBVA'], ['analisis', 'Análisis de firmware'], ['actualizaciones', 'Actualizaciones'], ['reportes', 'Reportes de fallos'], ['acerca', 'Acerca de la iniciativa']];
  const RAPIDO = [['30 días', 30], ['90 días', 90], ['Todo', 0]];
  const view = { tab: 'resumen', sede: '', desde: null, hasta: null, q: '' };
  let root = null, D = null, EXT = { resumen: [], acerca: [] };

  async function reload() { D = await api('GET', '/api/firmware/datos'); render(); }
  const inRange = (f) => (!view.desde || f >= view.desde) && (!view.hasta || f <= view.hasta);
  const scoped = (list) => list.filter((x) => (!view.sede || x.sede === view.sede) && inRange(x.fecha));
  const reportesDe = (x) => D.reportes.filter((r) => r.actualizacionId === x.id);
  const seguimiento = (x) => { const d = F.diasEntre(x.fecha, D.hoy); return { dias: d, abierto: d < F.DIAS_SEGUIMIENTO, restan: Math.max(0, F.DIAS_SEGUIMIENTO - d) }; };

  /* =================== página =================== */
  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const A = scoped(D.analisis), X = scoped(D.actualizaciones), R = scoped(D.reportes);
    const sedeTxt = view.sede ? sedeN(view.sede) : 'Todas las sedes';
    const periodo = view.desde ? `${fullDate(view.desde)} – ${fullDate(view.hasta)}` : 'Todo el historial';

    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, `Debugging de firmware · ${sedeTxt}`), h('p', {}, `Periodo: ${periodo}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));

    const abiertos = D.reportes.filter((r) => F.ESTADO[r.estado].abierto).length;
    const count = { analisis: A.length, actualizaciones: X.length, reportes: R.length };
    push(h('div', { class: 'mon-tabbar no-print', role: 'tablist' }, TABS.map(([k, t]) => h('button', {
      class: 'mon-tab' + (view.tab === k ? ' is-active' : ''), role: 'tab', type: 'button', 'aria-selected': String(view.tab === k), onclick: () => { view.tab = k; render(); } },
    t, count[k] !== undefined ? h('span', { class: 'mon-tcount' }, nf(count[k])) : null, k === 'reportes' && abiertos ? h('span', { class: 'badge' }, `${abiertos} abiertos`) : null))));

    if (view.tab !== 'acerca') {
      const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key] || '', max: D.hoy,
        onchange: (e) => { view[key] = e.target.value || null; if (view.desde && !view.hasta) view.hasta = D.hoy; if (view.desde && view.hasta && view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; render(); } }));
      push(h('div', { class: 'mon-filters no-print' }, dateInput('fw-desde', 'Desde', 'desde'), dateInput('fw-hasta', 'Hasta', 'hasta'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' }, RAPIDO.map(([t, n]) => h('button', { class: 'tab', type: 'button', onclick: () => { if (n) { view.hasta = D.hoy; view.desde = F.addDays(D.hoy, -(n - 1)); } else { view.desde = view.hasta = null; } render(); } }, t)))),
        h('div', { class: 'field' }, h('label', { for: 'fw-sede' }, 'Sede'), h('select', { id: 'fw-sede', onchange: (e) => { view.sede = e.target.value; render(); } }, h('option', { value: '' }, 'Todas las sedes'), F.SEDES.map((s) => h('option', { value: s.key, selected: s.key === view.sede }, s.name)))),
        h('p', { class: 'muted mon-range' }, `${periodo} · ${sedeTxt}`)));
    }
    if (view.tab === 'resumen') push(resumen(A, X, R, sedeTxt));
    else if (view.tab === 'analisis') push(analisisTab(A));
    else if (view.tab === 'actualizaciones') push(actualizacionesTab(X));
    else if (view.tab === 'reportes') push(reportesTab(R));
    else push(EXT.acerca, guia());
    root.append(...kids);
    if (view.tab === 'resumen' && EXT.draw) EXT.draw();
  }

  const tile = (label, num, sub, cls) => h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-num' }, num), sub ? h('span', { class: 'tile-sub' }, sub) : null);
  const hbars = (rows, colorOf) => { const max = Math.max(1, ...rows.map((r) => r.n)); return h('div', { class: 'mon-hbars' }, rows.map((r) => h('div', { class: 'mon-hrow' },
    h('span', { class: 'mon-hlabel', title: r.k }, r.k), h('div', { class: 'mon-htrack' }, h('div', { class: 'fw-bar', style: `width:${(r.n / max) * 100}%;background:${colorOf ? colorOf(r) : '#2a2b2e'}` })), h('span', { class: 'mon-hnum' }, nf(r.n))))); };
  const COLOR = { good: '#3a9a6a', prog: '#3f74c0', warn: '#d9a23a', crit: '#c8141b', none: '#a9aaae' };
  const countBy = (list, key, order) => { const m = new Map(); list.forEach((x) => m.set(key(x), (m.get(key(x)) || 0) + 1)); const rows = [...m.entries()].map(([k, n]) => ({ k, n })); return order ? order.map((k) => rows.find((r) => r.k === k) || { k, n: 0 }) : rows.sort((a, b) => b.n - a.n); };

  /* ---------- Resumen para BBVA ---------- */
  function resumen(A, X, R, sedeTxt) {
    const out = [EXT.resumen[0]];
    const alcance = X.reduce((s, x) => s + x.alcance, 0), ok = X.reduce((s, x) => s + x.actualizados, 0);
    const conIncidentes = X.filter((x) => x.incidentes && !/^sin incidentes\.?$/i.test(x.incidentes.trim())).length;
    const enSeguimiento = X.filter((x) => F.RESULTADO[x.resultado].instalada && seguimiento(x).abierto).length;
    const abiertos = R.filter((r) => F.ESTADO[r.estado].abierto), graves = abiertos.filter((r) => ['critica', 'alta'].includes(r.severidad));
    const rec = F.recurrencias(D.reportes.filter((r) => !view.sede || r.sede === view.sede), D.hoy).filter((g) => g.n >= F.RECURRENCIA.reportes);

    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Ciclo de firmware · ${sedeTxt}`),
      h('div', { class: 'fw-cycle' },
        h('div', {}, h('h3', {}, '1. Análisis previo'), h('div', { class: 'fw-tiles' },
          tile('Análisis', nf(A.length), 'Known Issues evaluados'),
          tile('Migrar', nf(A.filter((a) => a.vinculable).length), 'incluye pilotos aprobados', 'fw-t-good'),
          tile('Piloto', nf(A.filter((a) => a.decision === 'piloto' && !a.pilotoAprobado).length), 'laboratorio pendiente', 'fw-t-warn'),
          tile('No migrar', nf(A.filter((a) => a.decision === 'no_migrar').length), 'escalados al fabricante', 'fw-t-crit'))),
        h('div', {}, h('h3', {}, '2. Actualizaciones'), h('div', { class: 'fw-tiles' },
          tile('Ventanas', nf(X.length), `${nf(alcance)} AP en alcance`),
          tile('Éxito', alcance ? `${nf(pct(ok, alcance), 1)}%` : '—', `${nf(ok)} de ${nf(alcance)} AP actualizados`, alcance && ok / alcance >= 0.98 ? 'fw-t-good' : alcance ? 'fw-t-warn' : ''),
          tile('Con incidentes', nf(conIncidentes), 'desviaciones registradas', conIncidentes ? 'fw-t-warn' : ''),
          tile('En seguimiento', nf(enSeguimiento), `primeros ${F.DIAS_SEGUIMIENTO} días tras instalar`))),
        h('div', {}, h('h3', {}, '3. Reportes de fallos'), h('div', { class: 'fw-tiles' },
          tile('Reportes', nf(R.length), 'en el periodo'),
          tile('Abiertos', nf(abiertos.length), 'defectos activos', abiertos.length ? 'fw-t-warn' : 'fw-t-good'),
          tile('Críticos o altos', nf(graves.length), 'abiertos', graves.length ? 'fw-t-crit' : ''),
          tile('Patrones recurrentes', nf(rec.length), `${F.RECURRENCIA.reportes} o más en ${F.RECURRENCIA.dias} días`, rec.length ? 'fw-t-crit' : ''))))));

    // recomendación vigente: el análisis más reciente por sede y modelo
    const vig = new Map(); D.analisis.filter((a) => !view.sede || a.sede === view.sede).forEach((a) => { const k = `${a.sede}|${a.modelo}`; if (!vig.has(k)) vig.set(k, a); });
    out.push(h('section', { class: 'panel' }, h('h2', {}, 'Recomendación vigente por sede y modelo'),
      h('p', { class: 'muted' }, 'El análisis más reciente de cada combinación. Confirma siempre sede, modelo y firmware objetivo antes de programar una ventana.'),
      vig.size ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', {}, 'Modelo'), h('th', {}, 'Firmware'), h('th', {}, 'Known Issues aplicables'), h('th', {}, 'Recomendación'), h('th', {}, 'Fecha'))),
        h('tbody', {}, [...vig.values()].map((a) => {
          const x = D.actualizaciones.find((y) => y.analisisId === a.id);
          return h('tr', {}, h('td', {}, sedeN(a.sede)), h('td', {}, a.modelo), h('td', { class: 'nowrap' }, `${a.fwActual} → ${a.fwObjetivo}`),
            h('td', {}, a.sinIssues ? 'Ninguno' : `${a.aplicables} de ${a.issues.length} (${a.puntaje} pts)`), h('td', {}, decPill(a), x ? h('span', { class: 'meta' }, `Instalada el ${dayMonth(x.fecha)} · ${F.RESULTADO[x.resultado].label}`) : null),
            h('td', { class: 'nowrap' }, dayMonth(a.fecha)));
        })))) : h('p', { class: 'empty' }, 'Aún no hay análisis registrados.')));

    // resultado por sede
    const bySede = F.SEDES.map((s) => { const l = X.filter((x) => x.sede === s.key); return { s, n: l.length, alc: l.reduce((a, x) => a + x.alcance, 0), ok: l.reduce((a, x) => a + x.actualizados, 0), bad: l.reduce((a, x) => a + x.fallidos, 0) }; }).filter((x) => x.n);
    out.push(h('div', { class: 'two' },
      h('section', { class: 'panel' }, h('h2', {}, 'Actualizaciones por sede'), h('p', { class: 'muted' }, 'AP actualizados correctamente sobre los AP en alcance. No es lo mismo que la disponibilidad de la red.'),
        bySede.length ? h('div', { class: 'mon-hbars' }, bySede.map((x) => h('div', { class: 'mon-hrow fw-hrow' }, h('span', { class: 'mon-hlabel' }, x.s.name),
          h('div', { class: 'mon-stack' }, x.ok ? h('span', { style: `flex:${x.ok};background:${COLOR.good}`, title: `Actualizados: ${x.ok}` }) : null, x.bad ? h('span', { style: `flex:${x.bad};background:${COLOR.crit}`, title: `Con error o pendientes: ${x.bad}` }) : null,
            x.alc - x.ok - x.bad > 0 ? h('span', { style: `flex:${x.alc - x.ok - x.bad};background:#dcdcd8`, title: `Sin registrar: ${x.alc - x.ok - x.bad}` }) : null),
          h('span', { class: 'mon-hnum fw-wide' }, `${nf(pct(x.ok, x.alc), 1)}%`)))) : h('p', { class: 'empty' }, 'Sin actualizaciones en el periodo.'),
        bySede.length ? h('p', { class: 'legend mon-legend' }, h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.good}` }), 'Actualizados'), h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.crit}` }), 'Con error o pendientes')) : null),
      h('section', { class: 'panel' }, h('h2', {}, 'Resultado de las ventanas'), X.length ? hbars(countBy(X, (x) => F.RESULTADO[x.resultado].label, F.RESULTADOS.map((r) => r.label)).filter((r) => r.n), (r) => COLOR[F.RESULTADOS.find((x) => x.label === r.k).cls]) : h('p', { class: 'empty' }, 'Sin actualizaciones en el periodo.'))));

    // reportes
    if (R.length) {
      out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Reportes de fallos · ${sedeTxt}`),
        rec.length ? h('div', { class: 'notice fw-alert' }, h('strong', {}, 'Patrones recurrentes: '), rec.map((g) => `${g.n} reportes de «${g.patron}» (${F.CATEGORIA[g.categoria].label.slice(3)}) en ${g.sedes.map(sedeN).join(', ')}`).join('; '), '. Evaluar como posible bug: la recurrencia no lo confirma por sí sola.') : null,
        h('div', { class: 'fw-grid4' },
          h('div', {}, h('h3', {}, 'Por severidad'), hbars(countBy(R, (r) => F.SEVERIDAD[r.severidad].label, F.SEVERIDADES.map((s) => s.label)), (r) => COLOR[F.SEVERIDADES.find((s) => s.label === r.k).cls])),
          h('div', {}, h('h3', {}, 'Estado de investigación'), hbars(countBy(R, (r) => F.ESTADO[r.estado].label, F.ESTADOS.map((s) => s.label)).filter((r) => r.n), (r) => COLOR[F.ESTADOS.find((s) => s.label === r.k).cls])),
          h('div', {}, h('h3', {}, 'Categoría de impacto'), hbars(countBy(R, (r) => r.impacto).slice(0, 8))),
          h('div', {}, h('h3', {}, 'Alcance de la afectación'), hbars(countBy(R, (r) => r.alcance).slice(0, 8))))));
    }
    out.push(EXT.resumen[1]);
    return out.filter(Boolean);
  }

  /* ---------- Análisis ---------- */
  function analisisTab(A) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Análisis de firmware (${nf(A.length)})`), h('p', { class: 'muted' }, 'Evaluación de Known Issues antes de programar una actualización. Solo los análisis que recomiendan migrar (o con piloto aprobado) se vinculan a una actualización.')),
        canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAnalisis() }, 'Nuevo análisis') : null),
      A.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table fw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede'), h('th', {}, 'Modelo y firmware'), h('th', {}, 'Known Issues'), h('th', {}, 'Recomendación'), h('th', {}, 'Responsable'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, A.map((a) => h('tr', {},
          h('td', { class: 'nowrap' }, dayMonth(a.fecha)), h('td', {}, sedeN(a.sede)),
          h('td', {}, h('strong', {}, a.modelo), h('span', { class: 'meta mono' }, `${a.fwActual} → ${a.fwObjetivo}`)),
          h('td', {}, a.sinIssues ? 'Ninguno relevante' : `${a.aplicables} de ${a.issues.length} aplican`, a.sinIssues ? null : h('span', { class: 'meta' }, `Puntaje ${a.puntaje}`)),
          h('td', {}, decPill(a), a.usos ? h('span', { class: 'meta' }, `${a.usos} ${a.usos === 1 ? 'actualización' : 'actualizaciones'}`) : null),
          h('td', {}, a.responsable || '—'),
          h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => verAnalisis(a) }, 'Ver'),
            a.vinculable && canWrite() ? h('button', { class: 'link-btn', type: 'button', onclick: () => openActualizacion(a) }, 'Registrar actualización') : null)))))) : h('p', { class: 'empty' }, 'Aún no hay análisis. Registra el primero con «Nuevo análisis».'));
  }

  /* ---------- Actualizaciones ---------- */
  function actualizacionesTab(X) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Actualizaciones (${nf(X.length)})`), h('p', { class: 'muted' }, `Cada ventana con su checklist, resultado y evidencia. Tras instalar, la versión queda ${F.DIAS_SEGUIMIENTO} días en seguimiento de fallos.`)),
        canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openActualizacion() }, 'Registrar actualización') : null),
      X.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table fw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede'), h('th', {}, 'Modelo y firmware'), h('th', { class: 'num-col' }, 'AP'), h('th', { class: 'num-col' }, 'Éxito'), h('th', {}, 'Resultado'), h('th', {}, 'Seguimiento de fallos'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, X.map((x) => {
          const sg = seguimiento(x), n = reportesDe(x).length, inst = F.RESULTADO[x.resultado].instalada;
          return h('tr', {},
            h('td', { class: 'nowrap' }, dayMonth(x.fecha), h('span', { class: 'meta' }, `${x.ventanaInicio || ''}–${x.ventanaFin || ''}`)), h('td', {}, sedeN(x.sede), x.folio ? h('span', { class: 'meta' }, x.folio) : null),
            h('td', {}, h('strong', {}, x.modelo), h('span', { class: 'meta mono' }, `${x.fwActual} → ${x.fwObjetivo}`), x.excepcion ? h('span', { class: 'meta warn-text' }, 'Sin análisis previo (excepción)') : null),
            h('td', { class: 'num-col plain' }, `${nf(x.actualizados)}/${nf(x.alcance)}`), h('td', { class: 'num-col plain' }, `${nf(pct(x.actualizados, x.alcance), 1)}%`),
            h('td', {}, resPill(x.resultado)),
            h('td', {}, !inst ? h('span', { class: 'muted' }, 'No aplica') : sg.abierto ? [h('strong', {}, `Día ${sg.dias} de ${F.DIAS_SEGUIMIENTO}`), h('span', { class: 'meta' }, `${n} ${n === 1 ? 'reporte' : 'reportes'} · restan ${sg.restan} días`)]
              : [h('span', {}, 'Concluido'), h('span', { class: 'meta' }, n ? `${n} ${n === 1 ? 'reporte vinculado' : 'reportes vinculados'}` : 'Sin reportes vinculados')]),
            h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => verActualizacion(x) }, 'Ver'),
              inst && canWrite() ? h('button', { class: 'link-btn', type: 'button', onclick: () => openReporte(x) }, 'Reportar fallo') : null));
        })))) : h('p', { class: 'empty' }, 'Aún no hay actualizaciones registradas.'));
  }

  /* ---------- Reportes ---------- */
  function reportesTab(R) {
    const qn = F.plain(view.q);
    const list = R.filter((r) => !qn || F.plain([r.patron, r.sintoma, r.firmware, r.modelo, r.alcanceDetalle].join(' ')).includes(qn));
    const rec = F.recurrencias(D.reportes, D.hoy).filter((g) => g.n >= F.RECURRENCIA.reportes);
    const recIds = new Set(rec.flatMap((g) => g.ids));
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Reportes de fallos (${nf(list.length)})`), h('p', { class: 'muted' }, 'Evidencia para investigar si un comportamiento corresponde a un bug. Registrar un reporte no confirma un defecto.')),
        h('div', { class: 'mon-tools no-print' }, h('input', { type: 'search', placeholder: 'Buscar patrón, síntoma o firmware', value: view.q, 'aria-label': 'Buscar reporte', oninput: (e) => { view.q = e.target.value; clearTimeout(view.t); view.t = setTimeout(() => { render(); const i = root.querySelector('.mon-tools input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }),
          canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReporte() }, 'Reportar fallo') : null)),
      h('p', { class: 'muted fw-rule' }, `Regla de recurrencia: ${F.RECURRENCIA.reportes} o más reportes con el mismo tipo y el mismo patrón en ${F.RECURRENCIA.dias} días generan una advertencia para evaluar un posible bug.`),
      rec.length ? h('div', { class: 'notice fw-alert' }, h('strong', {}, 'Advertencia de recurrencia: '), rec.map((g) => `${g.n} reportes de «${g.patron}» (${F.CATEGORIA[g.categoria].label})`).join('; '), '.') : null,
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table fw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede'), h('th', {}, 'Patrón'), h('th', {}, 'Tipo'), h('th', {}, 'Severidad'), h('th', {}, 'Estado'), h('th', {}, 'Alcance'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, list.map((r) => {
          const x = D.actualizaciones.find((y) => y.id === r.actualizacionId);
          return h('tr', {},
            h('td', { class: 'nowrap' }, dayMonth(r.fecha), x ? h('span', { class: 'meta' }, `Día ${F.diasEntre(x.fecha, r.fecha)} tras actualizar`) : null),
            h('td', {}, sedeN(r.sede), h('span', { class: 'meta mono nowrap' }, [r.modelo, r.firmware].filter(Boolean).join(' · '))),
            h('td', { class: 'detail-col' }, h('strong', {}, r.patron), recIds.has(r.id) ? h('span', { class: 'tag mon-tag' }, 'Recurrente') : null, h('span', { class: 'meta mon-clip2' }, r.sintoma)),
            h('td', { title: r.subtipo || '' }, F.CATEGORIA[r.categoria].label),
            h('td', {}, sevPill(r.severidad)), h('td', {}, estPill(r.estado)),
            h('td', {}, r.alcance, r.alcanceDetalle ? h('span', { class: 'meta' }, r.alcanceDetalle) : null),
            h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => openSeguimiento(r) }, canWrite() ? 'Seguimiento' : 'Ver')));
        })))) : h('p', { class: 'empty' }, R.length ? 'Ningún reporte coincide con la búsqueda.' : 'Sin reportes de fallos en el periodo.'));
  }

  function guia() {
    const steps = [
      ['Análisis previo', 'Revisa las notas de versión del fabricante y registra cada Known Issue con su severidad y si aplica a nuestros modelos. El portal calcula la recomendación: migrar, piloto o no migrar.'],
      ['Piloto (si aplica)', 'Si el análisis pide laboratorio o piloto, pruébalo en un grupo reducido. Un administrador registra el resultado y, si es favorable, el análisis queda disponible para migrar.'],
      ['Actualización', 'Registra la ventana paso a paso: datos, comprobaciones previas, lo que pasó durante la ventana y las validaciones posteriores, con evidencia de conectividad.'],
      ['Seguimiento de 30 días', `Durante los ${F.DIAS_SEGUIMIENTO} días siguientes, cualquier fallo se reporta vinculado a la actualización para medir su impacto.`],
      ['Reportes de fallos', 'Usa un patrón corto y repítelo igual en reportes parecidos: con 4 reportes del mismo patrón en 30 días aparece una advertencia de posible bug.'],
    ];
    return h('section', { class: 'panel' }, h('h2', {}, 'Cómo se usa'), h('ol', { class: 'fw-guide' }, steps.map(([t, d]) => h('li', {}, h('strong', {}, t), h('p', { class: 'muted' }, d)))),
      h('p', { class: 'muted' }, 'Éxito de la actualización = AP actualizados correctamente ÷ AP en alcance. No equivale a disponibilidad de la red; la disponibilidad posterior se registra a partir de una medición real.'));
  }

  /* =================== panel lateral =================== */
  let drawer = null, dirty = false;
  function openDrawer(title, body, wide) {
    closeDrawer(true);
    const titleEl = h('h2', { id: 'fw-d-title' }, title);
    const panel = h('aside', { class: 'mon-drawer no-print' + (wide ? ' is-wide' : ''), role: 'dialog', 'aria-labelledby': 'fw-d-title' },
      h('header', { class: 'mon-dhead' }, titleEl, h('button', { class: 'mon-dclose', type: 'button', 'aria-label': 'Cerrar panel', onclick: () => closeDrawer() }, '✕')),
      h('div', { class: 'mon-dbody' }, body));
    document.body.append(panel); document.body.classList.add('mon-drawer-open');
    drawer = { panel, titleEl };
    return drawer;
  }
  function closeDrawer(silent) {
    if (!drawer) return;
    drawer.panel.remove(); drawer = null; document.body.classList.remove('mon-drawer-open');
    if (!silent && dirty) { dirty = false; state.stale = true; window.Portal.route(); }
  }
  const saved = (msg) => { toast(msg); dirty = true; closeDrawer(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); });
  window.addEventListener('hashchange', () => { if (drawer) closeDrawer(true); dirty = false; });

  let uid = 0;
  const ctl = (tag, attrs, ...kids) => h(tag, { id: 'fw-f-' + (++uid), ...attrs }, ...kids);
  const field = (label, control, extra, opt) => h('div', { class: 'field' }, h('label', { for: control.id }, label, opt ? h('span', { class: 'optional' }, ' (opcional)') : null), control, extra || null);
  const sel = (opts, value, attrs = {}) => ctl('select', attrs, h('option', { value: '' }, 'Selecciona…'), opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  const sedeSel = (v) => sel(F.SEDES.map((s) => [s.key, s.name]), v);
  const respSel = () => (isAdmin() ? sel(D.ingenieros.map((u) => [u.id, u.name]), state.user.id) : null);
  const fecha = (v) => ctl('input', { type: 'date', value: v || D.hoy, max: D.hoy });
  const modelo = (v) => { const dl = h('datalist', { id: 'fw-dl-modelos' }, F.MODELOS.map((m) => h('option', { value: m }))); const i = ctl('input', { value: v || '', list: 'fw-dl-modelos', placeholder: 'MR56', autocomplete: 'off' }); return [i, dl]; };
  const versiones = () => [...new Set([...D.analisis.flatMap((a) => [a.fwActual, a.fwObjetivo]), ...D.actualizaciones.flatMap((x) => [x.fwActual, x.fwObjetivo])])];
  const fwInput = (v, ph) => ctl('input', { value: v || '', list: 'fw-dl-versiones', placeholder: ph, autocomplete: 'off', class: 'mono' });
  const fwList = () => h('datalist', { id: 'fw-dl-versiones' }, versiones().map((v) => h('option', { value: v })));
  const errBox = () => h('p', { class: 'form-error', role: 'alert', hidden: true });
  const showErr = (box, msg) => { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); };

  /* ---------- nuevo análisis ---------- */
  function openAnalisis() {
    const f = { sede: sedeSel(view.sede), fecha: fecha(), resp: respSel(), modelo: modelo('MR56'), fwActual: fwInput('', 'Versión en producción'), fwObjetivo: fwInput('', 'Versión que se evalúa'),
      refs: ctl('textarea', { rows: 3, maxlength: 4000, placeholder: 'Resumen del boletín, IDs de bugs o referencia de Cisco Meraki. Si no se identificaron, indícalo.' }),
      liga: ctl('input', { type: 'url', placeholder: 'https://documentation.meraki.com/…' }), actuales: ctl('textarea', { rows: 2, maxlength: 4000, placeholder: 'Problemas ya presentes en producción, workaround y referencia.' }),
      sin: ctl('input', { type: 'checkbox' }) };
    const rows = h('div', { class: 'fw-issues' }); const evalBox = h('div', { class: 'fw-eval', role: 'status' }); const err = errBox();
    const issues = [];
    const addIssue = (data = {}) => {
      const it = { descripcion: data.descripcion || '', severidad: data.severidad || 'medio', aplica: data.aplica || 'pendiente', referencia: '' };
      issues.push(it);
      const n = issues.length;
      const desc = ctl('input', { value: it.descripcion, placeholder: 'Ej. MR-99882: picos de latencia y pérdida en 5 GHz', oninput: (e) => { it.descripcion = e.target.value; evaluar(); } });
      const sev = ctl('select', { onchange: (e) => { it.severidad = e.target.value; evaluar(); } }, F.SEVERIDADES_KI.map((s) => h('option', { value: s.key, selected: s.key === it.severidad }, `${s.label} (${s.puntos} ${s.puntos === 1 ? 'pt' : 'pts'}${s.key === 'critico' ? ', bloquea' : ''})`)));
      const ap = ctl('select', { onchange: (e) => { it.aplica = e.target.value; evaluar(); } }, F.APLICA.map((a) => h('option', { value: a.key, selected: a.key === it.aplica }, a.label)));
      const ref = ctl('input', { placeholder: 'Liga al release note, condiciones o workaround', oninput: (e) => { it.referencia = e.target.value; } });
      const box = h('div', { class: 'fw-issue' }, h('div', { class: 'fw-issue-head' }, h('strong', {}, `Known Issue ${n}`), h('button', { class: 'link-btn danger-text', type: 'button', onclick: () => { it.descripcion = ''; box.remove(); evaluar(); } }, 'Quitar')),
        field('Defecto o ID del bug', desc), h('div', { class: 'mon-g2' }, field('Impacto potencial', sev), field('¿Aplica a nuestros modelos?', ap)), field('Referencia', ref, null, true));
      rows.append(box); if (!data.descripcion) setTimeout(() => desc.focus(), 20);
      evaluar();
    };
    function evaluar() {
      const ev = F.evaluar(issues, f.sin.checked); const d = F.DECISIONES[ev.decision];
      evalBox.textContent = ''; evalBox.className = 'fw-eval fw-eval-' + d.cls;
      evalBox.append(h('div', { class: 'fw-eval-head' }, h('span', { class: 'tile-label' }, 'Recomendación automática'), h('strong', {}, d.label)),
        f.sin.checked ? null : h('p', {}, `Puntaje: ${ev.puntaje} · aplicables: ${ev.aplicables} de ${ev.total} (bajo ${ev.cuenta.bajo}, medio ${ev.cuenta.medio}, alto ${ev.cuenta.alto}, crítico ${ev.cuenta.critico})`),
        h('ul', {}, ev.motivos.map((m) => h('li', {}, m))));
      rows.classList.toggle('is-off', f.sin.checked); addBtn.disabled = f.sin.checked;
      return ev;
    }
    const addBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addIssue() }, '+ Agregar Known Issue');
    f.sin.addEventListener('change', evaluar);
    const save = async (btn) => {
      const ev = evaluar();
      if (!f.sin.checked && ev.total === 0) return showErr(err, 'Agrega al menos un Known Issue o marca que no se detectaron Known Issues relevantes.');
      if (ev.decision === 'pendiente') return showErr(err, 'Valida si cada Known Issue aplica a nuestros modelos antes de guardar.');
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/firmware/analisis', { sede: f.sede.value, fecha: f.fecha.value, responsableId: f.resp ? f.resp.value : undefined, modelo: f.modelo[0].value, fwActual: f.fwActual.value, fwObjetivo: f.fwObjetivo.value,
          referencias: f.refs.value, liga: f.liga.value, problemasActuales: f.actuales.value, sinIssues: f.sin.checked, issues: issues.filter((i) => i.descripcion.trim()) });
        view.tab = 'analisis';
        saved(`Análisis guardado · ${F.DECISIONES[r.decision].label}`);
      } catch (e) { showErr(err, e.message); btn.disabled = false; }
    };
    openDrawer('Nuevo análisis de firmware', h('div', { class: 'mon-form' },
      h('p', { class: 'muted' }, 'Evalúa los Known Issues de la versión objetivo antes de programar la actualización.'),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Datos'), h('div', { class: 'mon-g2' }, field('Sede', f.sede), field('Fecha del análisis', f.fecha)),
        f.resp ? field('Responsable', f.resp) : h('p', { class: 'meta' }, `Responsable: ${state.user.name}`),
        h('div', { class: 'mon-g2' }, field('Modelo de AP', f.modelo[0], f.modelo[1]), h('div')), h('div', { class: 'mon-g2' }, field('Firmware actual', f.fwActual), field('Firmware objetivo', f.fwObjetivo)), fwList()),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Fuentes'), field('Known Issues del fabricante / referencias', f.refs), field('Liga a las notas de versión', f.liga, null, true), field('Problemas conocidos de la versión actual', f.actuales, null, true)),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Evaluación por Known Issue'),
        h('p', { class: 'muted' }, 'Bajo = 1 punto, Medio = 2, Alto = 3. Solo suman los que aplican a nuestros modelos. Un crítico aplicable bloquea la migración; un alto o 5 puntos o más piden piloto.'),
        h('label', { class: 'fw-check' }, f.sin, h('span', {}, 'No se detectaron Known Issues relevantes para la versión objetivo', h('span', { class: 'meta' }, 'Márcalo solo después de revisar las notas de versión.'))),
        rows, addBtn, evalBox),
      err,
      h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar análisis'), h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar'))), true);
    addIssue();
  }

  function verAnalisis(a) {
    const dl = (pairs) => h('dl', { class: 'mon-dl' }, pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const nota = ctl('textarea', { rows: 2, maxlength: 600, placeholder: 'Resultado del laboratorio o piloto: AP probados, días, hallazgos.' }); const err = errBox();
    const piloto = async (btn, ok) => { btn.disabled = true; try { await api('POST', `/api/firmware/analisis/${a.id}/piloto`, { aprobado: ok, nota: nota.value }); saved(ok ? 'Piloto aprobado: el análisis ya se puede vincular' : 'Resultado del piloto registrado'); } catch (e) { showErr(err, e.message); btn.disabled = false; } };
    const del = (isAdmin() || a.createdBy === state.user.id) && !a.usos ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/firmware/analisis/${a.id}`); saved('Análisis eliminado'); }) }, 'Eliminar análisis') : null;
    openDrawer(`${a.modelo} · ${a.fwObjetivo}`, h('div', {},
      h('div', { class: 'mon-fsum' }, decPill(a), h('span', { class: 'muted' }, `${fullDate(a.fecha)} · ${sedeN(a.sede)}`)),
      dl([['Firmware', `${a.fwActual} → ${a.fwObjetivo}`], ['Responsable', a.responsable], ['Puntaje', a.sinIssues ? 'Sin Known Issues relevantes' : `${a.puntaje} (${a.aplicables} de ${a.issues.length} aplican)`],
        ['Referencias', a.referencias], ['Notas de versión', a.liga ? h('a', { href: a.liga, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir') : null], ['Versión actual', a.problemasActuales],
        ['Piloto', a.pilotoNota ? `${a.pilotoAprobado ? 'Aprobado' : 'No aprobado'} por ${a.pilotoPor || '—'}: ${a.pilotoNota}` : null]]),
      a.issues.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Known Issue'), h('th', {}, 'Impacto'), h('th', {}, 'Aplica'))),
        h('tbody', {}, a.issues.map((i) => h('tr', { class: i.aplica === 'si' ? '' : 'fw-muted' }, h('td', {}, i.descripcion, i.referencia ? h('span', { class: 'meta' }, i.referencia) : null), h('td', {}, F.SEV_KI[i.severidad].label), h('td', {}, i.aplica === 'si' ? 'Sí' : i.aplica === 'no' ? 'No' : 'Pendiente')))))) : null,
      h('p', { class: 'muted' }, F.DECISIONES[a.decision].hint),
      a.decision === 'piloto' && isAdmin() ? h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Resultado del piloto'), field('Resultado', nota), err,
        h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => piloto(e.currentTarget, true) }, 'Aprobar para migrar'), h('button', { class: 'btn', type: 'button', onclick: (e) => piloto(e.currentTarget, false) }, 'No aprobar'))) : null,
      h('div', { class: 'mon-dfoot' }, a.vinculable && canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openActualizacion(a) }, 'Registrar actualización') : null, del)), true);
  }

  /* ---------- registrar actualización (5 pasos) ---------- */
  function openActualizacion(pre) {
    const S = { step: 0, analisisId: pre ? pre.id : '', excepcion: '', checklist: {}, file: null };
    const v = { sede: pre ? pre.sede : view.sede, fecha: D.hoy, resp: state.user.id, folio: '', modelo: pre ? pre.modelo : 'MR56', alcance: '', fwActual: pre ? pre.fwActual : '', fwObjetivo: pre ? pre.fwObjetivo : '',
      ventanaInicio: '', ventanaFin: '', notasPrevias: '', horaInicio: '', horaFin: '', actualizados: '', fallidos: '0', incidentes: '', disponibilidad: '', conectividad: '', impactoPost: '', impactoPostNotas: '', notasFinales: '', resultado: '' };
    const STEPS = ['Datos', 'Antes', 'Durante', 'Después', 'Resumen'];
    const body = h('div', { class: 'mon-form' }); const err = errBox();
    const d = openDrawer('Registrar actualización', body, true);
    const bind = (el, key) => { el.value = v[key] ?? ''; el.addEventListener('input', () => { v[key] = el.value; }); el.addEventListener('change', () => { v[key] = el.value; }); return el; };
    const checks = (fase) => h('div', { class: 'fw-checks' }, F.CHECK[fase].map(([k, t, desc]) => h('label', { class: 'fw-check' }, h('input', { type: 'checkbox', checked: !!S.checklist[k], onchange: (e) => { S.checklist[k] = e.target.checked; } }), h('span', {}, t, h('span', { class: 'meta' }, desc)))));
    const eligible = () => D.analisis.filter((a) => a.vinculable);
    function draw() {
      body.textContent = ''; err.hidden = true;
      d.titleEl.textContent = `Registrar actualización · ${S.step + 1} de 5`;
      const bar = h('ol', { class: 'fw-steps' }, STEPS.map((t, i) => h('li', { class: i === S.step ? 'is-current' : i < S.step ? 'is-done' : '' }, `${i + 1}. ${t}`)));
      let content;
      if (S.step === 0) {
        const an = sel(eligible().map((a) => [a.id, `${sedeN(a.sede)} · ${a.modelo} · ${a.fwActual} → ${a.fwObjetivo} · ${dayMonth(a.fecha)}${a.decision === 'piloto' ? ' · piloto aprobado' : ''}`]), S.analisisId,
          { onchange: (e) => { S.analisisId = e.target.value; const a = D.analisis.find((x) => String(x.id) === S.analisisId); if (a) { v.sede = a.sede; v.modelo = a.modelo; v.fwActual = a.fwActual; v.fwObjetivo = a.fwObjetivo; } draw(); } });
        const exc = isAdmin() && !S.analisisId ? bind(ctl('textarea', { rows: 2, maxlength: 500, placeholder: 'Por qué se actualiza sin análisis previo (por ejemplo, corrección urgente de seguridad indicada por el fabricante).' }), 'excepcion') : null;
        if (exc) { exc.value = S.excepcion; exc.addEventListener('input', () => { S.excepcion = exc.value; }); }
        const m = modelo(v.modelo); bind(m[0], 'modelo');
        content = [
          field('Análisis previo aprobado', an, h('span', { class: 'meta' }, eligible().length ? 'Al elegirlo se llenan sede, modelo y firmware. Deben coincidir con la actualización.' : 'No hay análisis que recomienden migrar. Registra primero un análisis.')),
          exc ? field('Justificación de la excepción (solo administrador, sin análisis)', exc) : null,
          h('div', { class: 'mon-g2' }, field('Sede', bind(sedeSel(v.sede), 'sede')), field('Fecha de la intervención', bind(fecha(v.fecha), 'fecha'))),
          isAdmin() ? field('Responsable', bind(sel(D.ingenieros.map((u) => [u.id, u.name]), v.resp), 'resp')) : h('p', { class: 'meta' }, `Responsable: ${state.user.name}`),
          h('div', { class: 'mon-g2' }, field('Modelo de AP', m[0], m[1]), field('AP en el alcance', bind(ctl('input', { type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: '42' }), 'alcance'))),
          h('div', { class: 'mon-g2' }, field('Firmware actual', bind(fwInput(v.fwActual, 'Versión instalada'), 'fwActual')), field('Firmware objetivo', bind(fwInput(v.fwObjetivo, 'Versión aprobada'), 'fwObjetivo'))), fwList(),
          h('div', { class: 'mon-g2' }, field('Inicio de la ventana', bind(ctl('input', { type: 'time' }), 'ventanaInicio')), field('Fin de la ventana', bind(ctl('input', { type: 'time' }), 'ventanaFin'))),
          field('Folio o cambio', bind(ctl('input', { placeholder: 'CHG-000123', maxlength: 60 }), 'folio'), null, true),
        ];
      } else if (S.step === 1) {
        content = [h('p', { class: 'muted' }, 'Marca cada punto cuando esté confirmado. Si alguno no aplica, déjalo sin marcar y explica el motivo en las notas.'), checks('pre'),
          field('Notas previas', bind(ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Respaldo revisado, aprobación confirmada…' }), 'notasPrevias'), null, true)];
      } else if (S.step === 2) {
        content = [h('p', { class: 'muted' }, 'Registra lo observado. Desde el portal no se ejecuta ninguna acción sobre los equipos.'), checks('durante'),
          h('div', { class: 'mon-g2' }, field('Hora de inicio', bind(ctl('input', { type: 'time' }), 'horaInicio'), null, true), field('Hora de término', bind(ctl('input', { type: 'time' }), 'horaFin'), null, true)),
          h('div', { class: 'mon-g2' }, field('AP actualizados correctamente', bind(ctl('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric' }), 'actualizados')), field('AP con error o pendientes', bind(ctl('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric' }), 'fallidos'))),
          h('p', { class: 'meta' }, `Alcance: ${v.alcance || '—'} AP.`),
          field('Incidentes o desviaciones', bind(ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Qué ocurrió, a qué hora y qué se hizo. Si no hubo, escribe: Sin incidentes.' }), 'incidentes'))];
      } else if (S.step === 3) {
        const res = bind(sel(F.RESULTADOS.map((r) => [r.key, r.label]), v.resultado), 'resultado');
        const impBox = h('div', {});
        const drawImp = () => { impBox.textContent = ''; if (!(F.RESULTADO[v.resultado] || {}).instalada) return;
          impBox.append(h('fieldset', { class: 'mon-fs fw-post' }, h('legend', {}, 'Impacto posterior a la instalación'), h('p', { class: 'muted' }, 'Compara los Known Issues evaluados antes del cambio con lo observado en producción.'),
            field('¿Se materializó alguno de los impactos previstos?', bind(sel(F.IMPACTO_POST.map((i) => [i.key, i.label]), v.impactoPost), 'impactoPost')),
            field('Detalle o evidencia', bind(ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Síntoma, Known Issue relacionado, AP afectados, tickets y acciones.' }), 'impactoPostNotas'), null, true))); };
        res.addEventListener('change', drawImp);
        const file = ctl('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' });
        const fileTxt = h('span', { class: 'meta' }, S.file ? `Seleccionado: ${S.file.name}` : 'Captura de ping, traceroute o prueba de acceso, o PDF. Máximo 5 MB.');
        file.addEventListener('change', () => { const x = file.files[0]; if (x && x.size > 5 * 1024 * 1024) { file.value = ''; S.file = null; fileTxt.textContent = 'El archivo supera 5 MB.'; return; } S.file = x || null; fileTxt.textContent = x ? `Seleccionado: ${x.name} (${Math.round(x.size / 1024)} KB)` : ''; });
        content = [h('p', { class: 'muted' }, 'Confirma los servicios después de la actualización y registra cualquier diferencia.'), checks('post'),
          h('div', { class: 'mon-g2' }, field('Disponibilidad posterior (%)', bind(ctl('input', { type: 'number', min: 0, max: 100, step: 0.1, placeholder: '99.9' }), 'disponibilidad'), null, true), field('Prueba de conectividad', bind(sel(F.CONECTIVIDAD.map((c) => [c, c]), v.conectividad), 'conectividad'))),
          field('Evidencia de conectividad', file, fileTxt, true),
          field('Observaciones finales', bind(ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'SSID validado, clientes conectan, sin alertas…' }), 'notasFinales'), null, true),
          field('Resultado final', res), impBox];
        setTimeout(drawImp, 0);
      } else {
        const a = D.analisis.find((x) => String(x.id) === String(S.analisisId));
        const alc = Number(v.alcance) || 0, ok = Number(v.actualizados) || 0, bad = Number(v.fallidos) || 0;
        const ck = (f) => `${F.CHECK[f].filter(([k]) => S.checklist[k]).length} de ${F.CHECK[f].length}`;
        content = [h('dl', { class: 'mon-dl' }, [['Sede', sedeN(v.sede)], ['Fecha', fullDate(v.fecha)], ['Firmware', `${v.modelo} · ${v.fwActual} → ${v.fwObjetivo}`], ['Ventana', `${v.ventanaInicio} a ${v.ventanaFin}`],
          ['Análisis', a ? `${dayMonth(a.fecha)} · ${F.DECISIONES[a.decision].label}${a.pilotoAprobado ? ' (piloto aprobado)' : ''}` : `Excepción: ${S.excepcion}`],
          ['AP', `${ok} actualizados y ${bad} con error de ${alc} en alcance (${nf(pct(ok, alc), 1)}%)`], ['Checklist', `antes ${ck('pre')} · durante ${ck('durante')} · después ${ck('post')}`],
          ['Conectividad', v.conectividad || '—'], ['Evidencia', S.file ? S.file.name : 'Sin evidencia'], ['Resultado', F.RESULTADO[v.resultado].label],
          ['Impacto posterior', v.impactoPost ? F.IMPACTO_POST.find((i) => i.key === v.impactoPost).label : '—']].map(([k, t]) => [h('dt', {}, k), h('dd', {}, t)])),
        F.CHECK.post.some(([k]) => !S.checklist[k]) ? h('p', { class: 'notice' }, 'Hay validaciones posteriores sin marcar. Puedes guardar, pero explica el motivo en las observaciones.') : null];
      }
      const back = S.step ? h('button', { class: 'btn', type: 'button', onclick: () => { S.step -= 1; draw(); } }, '← Anterior') : null;
      const next = S.step < 4 ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { const m = validate(); if (m) return showErr(err, m); S.step += 1; draw(); } }, 'Siguiente →')
        : h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar actualización');
      body.append(bar, ...content.filter(Boolean), err, h('div', { class: 'mon-dfoot' }, back, next, h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar')));
      body.scrollTop = 0; d.panel.querySelector('.mon-dbody').scrollTop = 0;
    }
    function validate() {
      if (S.step === 0) {
        if (!S.analisisId && !isAdmin()) return 'Selecciona un análisis previo aprobado.';
        if (!S.analisisId && !S.excepcion.trim()) return 'Escribe la justificación de la excepción o selecciona un análisis.';
        if (!v.sede) return 'Selecciona la sede.';
        if (!v.modelo.trim() || !v.fwActual.trim() || !v.fwObjetivo.trim()) return 'Completa el modelo y las versiones de firmware.';
        if (!(Number(v.alcance) >= 1)) return 'Escribe cuántos AP incluye el alcance.';
        if (!v.ventanaInicio || !v.ventanaFin) return 'Escribe el horario de la ventana de mantenimiento.';
        const a = D.analisis.find((x) => String(x.id) === String(S.analisisId));
        if (a && (a.sede !== v.sede || a.modelo.toUpperCase() !== v.modelo.trim().toUpperCase() || a.fwObjetivo !== v.fwObjetivo.trim())) return 'El análisis debe coincidir con la sede, el modelo y el firmware objetivo.';
      }
      if (S.step === 2) {
        if (v.actualizados === '' || Number(v.actualizados) < 0) return 'Escribe cuántos AP se actualizaron correctamente.';
        const t = Number(v.alcance), s = Number(v.actualizados) + Number(v.fallidos || 0);
        if (s > t) return `Los AP actualizados más los AP con error (${s}) no pueden superar el alcance de ${t} AP.`;
      }
      if (S.step === 3 && !v.resultado) return 'Selecciona el resultado final.';
      return null;
    }
    async function save(btn) {
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/firmware/actualizaciones', { ...v, responsableId: v.resp, analisisId: S.analisisId || null, excepcion: S.excepcion, checklist: S.checklist });
        if (S.file) {
          const res = await fetch(`/api/firmware/actualizaciones/${r.id}/evidencia?nombre=${encodeURIComponent(S.file.name)}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: S.file });
          if (!res.ok) { const j = await res.json().catch(() => ({})); toast(`La actualización se guardó, pero la evidencia no: ${j.error || 'error al subir'}`, 'error'); }
        }
        view.tab = 'actualizaciones';
        saved('Actualización guardada');
      } catch (e) { showErr(err, e.message); btn.disabled = false; }
    }
    draw();
  }

  function verActualizacion(x) {
    const a = D.analisis.find((y) => y.id === x.analisisId), sg = seguimiento(x), reps = reportesDe(x);
    const ck = (fase) => h('ul', { class: 'fw-cklist' }, F.CHECK[fase].map(([k, t]) => h('li', { class: x.checklist[k] ? 'is-ok' : 'is-no' }, x.checklist[k] ? '✓ ' : '— ', t)));
    const del = isAdmin() || x.createdBy === state.user.id ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/firmware/actualizaciones/${x.id}`); saved('Actualización eliminada'); }) }, 'Eliminar') : null;
    openDrawer(`${sedeN(x.sede)} · ${x.fwObjetivo}`, h('div', {},
      h('div', { class: 'mon-fsum' }, resPill(x.resultado), h('span', { class: 'muted' }, `${fullDate(x.fecha)} · ${x.ventanaInicio}–${x.ventanaFin}`)),
      h('dl', { class: 'mon-dl' }, [['Modelo', x.modelo], ['Firmware', `${x.fwActual} → ${x.fwObjetivo}`], ['Responsable', x.responsable], ['Folio', x.folio], ['Análisis', a ? `${dayMonth(a.fecha)} · ${F.DECISIONES[a.decision].label}` : null], ['Excepción', x.excepcion],
        ['AP', `${x.actualizados} de ${x.alcance} actualizados (${nf(pct(x.actualizados, x.alcance), 1)}%) · ${x.fallidos} con error o pendientes`], ['Horario real', x.horaInicio ? `${x.horaInicio}–${x.horaFin || ''}` : null],
        ['Incidentes', x.incidentes], ['Disponibilidad', x.disponibilidad !== null ? `${x.disponibilidad}%` : null], ['Conectividad', x.conectividad],
        ['Evidencia', x.evidencia ? h('a', { href: `/api/firmware/actualizaciones/${x.id}/evidencia`, target: '_blank', rel: 'noopener' }, x.evidencia) : null],
        ['Impacto posterior', x.impactoPost ? F.IMPACTO_POST.find((i) => i.key === x.impactoPost).label : null], ['Detalle', x.impactoPostNotas], ['Notas previas', x.notasPrevias], ['Observaciones', x.notasFinales],
        ['Seguimiento', F.RESULTADO[x.resultado].instalada ? (sg.abierto ? `Día ${sg.dias} de ${F.DIAS_SEGUIMIENTO}; restan ${sg.restan} días` : `Concluido (${sg.dias} días)`) + ` · ${reps.length} ${reps.length === 1 ? 'reporte vinculado' : 'reportes vinculados'}` : null],
      ].filter(([, t]) => t !== null && t !== undefined && t !== '').map(([k, t]) => [h('dt', {}, k), h('dd', {}, t)])),
      h('div', { class: 'fw-ck3' }, h('div', {}, h('h3', { class: 'mon-dh3' }, 'Antes'), ck('pre')), h('div', {}, h('h3', { class: 'mon-dh3' }, 'Durante'), ck('durante')), h('div', {}, h('h3', { class: 'mon-dh3' }, 'Después'), ck('post'))),
      F.RESULTADO[x.resultado].instalada && !sg.abierto && !reps.length ? h('p', { class: 'muted' }, 'No se documentaron reportes de fallo vinculados durante el seguimiento. Esto refleja lo registrado en el portal, no la ausencia absoluta de fallos.') : null,
      h('div', { class: 'mon-dfoot' }, F.RESULTADO[x.resultado].instalada && canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReporte(x) }, 'Reportar fallo') : null, del)), true);
  }

  /* ---------- reportar fallo ---------- */
  function openReporte(x) {
    const f = { act: sel(D.actualizaciones.filter((y) => F.RESULTADO[y.resultado].instalada).map((y) => [y.id, `${dayMonth(y.fecha)} · ${sedeN(y.sede)} · ${y.modelo} · ${y.fwActual} → ${y.fwObjetivo}`]), x ? x.id : ''),
      sede: sedeSel(x ? x.sede : view.sede), fecha: fecha(), firmware: fwInput(x ? x.fwObjetivo : '', 'Versión en la que se observó'), modelo: modelo(x ? x.modelo : 'MR56'),
      cat: sel(F.CATEGORIAS.map((c) => [c.key, c.label]), ''), sub: ctl('select', {}, h('option', { value: '' }, 'Selecciona primero el tipo')),
      patron: ctl('input', { list: 'fw-dl-patrones', maxlength: 160, placeholder: 'Intermitencia de clientes tras actualizar a MR 31.x', autocomplete: 'off' }),
      sev: sel(F.SEVERIDADES.map((s) => [s.key, s.label]), ''), est: sel(F.ESTADOS.map((s) => [s.key, s.label]), 'nuevo'), imp: sel(F.IMPACTOS.map((i) => [i, i]), ''), alc: sel(F.ALCANCES.map((a) => [a, a]), ''),
      alcDet: ctl('input', { maxlength: 300, placeholder: 'Piso 4, sala de juntas, AP-P04-01…' }), sint: ctl('textarea', { rows: 3, maxlength: 3000, placeholder: 'Qué sucede, desde cuándo, cuántos AP o clientes afecta y cuál es el impacto al servicio.' }),
      repro: ctl('textarea', { rows: 2, maxlength: 3000, placeholder: 'Condiciones, pasos y pruebas: resultado esperado contra observado.' }), evid: ctl('textarea', { rows: 2, maxlength: 3000, placeholder: 'Alertas, logs, capturas, liga al release note o folio de soporte. Sin contraseñas.' }),
      mit: ctl('textarea', { rows: 2, maxlength: 3000, placeholder: 'Workaround, reversa aprobada, responsable o acción pendiente.' }) };
    const patrones = [...new Set(D.reportes.map((r) => r.patron))];
    const segBox = h('div', {}); const recBox = h('div', {}); const err = errBox();
    const drawSub = () => { const c = F.CATEGORIA[f.cat.value]; f.sub.textContent = ''; f.sub.append(h('option', { value: '' }, c ? 'Selecciona…' : 'Selecciona primero el tipo'), ...(c ? [...c.subtipos, 'Otro punto de verificación'] : []).map((s) => h('option', { value: s }, s))); };
    const drawSeg = () => { segBox.textContent = ''; const y = D.actualizaciones.find((z) => String(z.id) === f.act.value); if (!y) return; const sg = seguimiento(y), n = reportesDe(y).length;
      segBox.append(h('p', { class: 'notice' }, sg.abierto ? `Seguimiento abierto: día ${sg.dias} de ${F.DIAS_SEGUIMIENTO} desde la actualización del ${dayMonth(y.fecha)}. Reportes vinculados: ${n}.` : `El periodo de seguimiento de ${F.DIAS_SEGUIMIENTO} días concluyó (${sg.dias} días). Reportes vinculados: ${n}.`)); };
    const drawRec = () => { recBox.textContent = ''; if (!f.cat.value || !f.patron.value.trim()) return;
      const k = F.normPatron(f.patron.value); const n = D.reportes.filter((r) => r.categoria === f.cat.value && F.normPatron(r.patron) === k && r.fecha >= F.addDays(D.hoy, -(F.RECURRENCIA.dias - 1))).length;
      if (n) recBox.append(h('p', { class: 'meta ' + (n + 1 >= F.RECURRENCIA.reportes ? 'warn-text' : '') }, `Ya hay ${n} ${n === 1 ? 'reporte' : 'reportes'} con este patrón y tipo en ${F.RECURRENCIA.dias} días${n + 1 >= F.RECURRENCIA.reportes ? ': con este llegará a la advertencia de posible bug.' : '.'}`)); };
    f.act.addEventListener('change', () => { const y = D.actualizaciones.find((z) => String(z.id) === f.act.value); if (y) { f.sede.value = y.sede; f.firmware.value = y.fwObjetivo; f.modelo[0].value = y.modelo; } drawSeg(); });
    f.cat.addEventListener('change', () => { drawSub(); drawRec(); }); f.patron.addEventListener('input', drawRec);
    const save = async (btn) => {
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/firmware/reportes', { actualizacionId: f.act.value || null, sede: f.sede.value, fecha: f.fecha.value, firmware: f.firmware.value, modelo: f.modelo[0].value, categoria: f.cat.value, subtipo: f.sub.value,
          patron: f.patron.value, severidad: f.sev.value, estado: f.est.value, impacto: f.imp.value, alcance: f.alc.value, alcanceDetalle: f.alcDet.value, sintoma: f.sint.value, reproduccion: f.repro.value, evidencia: f.evid.value, mitigacion: f.mit.value });
        view.tab = 'reportes';
        saved(r.recurrencia ? `Reporte guardado. Advertencia: ${r.recurrencia} reportes con el mismo patrón en ${F.RECURRENCIA.dias} días; evaluar como posible bug.` : 'Reporte guardado');
      } catch (e) { showErr(err, e.message); btn.disabled = false; }
    };
    openDrawer('Reportar fallo', h('div', { class: 'mon-form' },
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Origen'), field('Actualización relacionada', f.act, null, true), segBox,
        h('div', { class: 'mon-g2' }, field('Sede', f.sede), field('Fecha de detección', f.fecha)), h('div', { class: 'mon-g2' }, field('Versión de firmware', f.firmware), field('Modelo de AP', f.modelo[0], f.modelo[1], true)), fwList()),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Clasificación'), h('div', { class: 'mon-g2' }, field('Tipo de reporte', f.cat), field('Subtipo', f.sub, null, true)),
        field('Patrón corto para detectar recurrencia', f.patron, h('span', {}, h('datalist', { id: 'fw-dl-patrones' }, patrones.map((p) => h('option', { value: p }))), h('span', { class: 'meta' }, 'Usa el mismo texto para reportes del mismo problema; la lista sugiere los ya registrados.'), recBox)),
        h('div', { class: 'mon-g2' }, field('Severidad', f.sev), field('Estado de investigación', f.est)), h('div', { class: 'mon-g2' }, field('Categoría de impacto', f.imp), field('Alcance de la afectación', f.alc)),
        field('Área, piso o equipos afectados', f.alcDet, null, true)),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Detalle'), field('Síntoma e impacto', f.sint), field('Pasos para reproducir y validaciones', f.repro, null, true), field('Evidencia o referencia', f.evid, null, true), field('Mitigación y siguiente acción', f.mit, null, true)),
      err, h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar reporte'), h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar'))), true);
    drawSeg();
  }

  function openSeguimiento(r) {
    const x = D.actualizaciones.find((y) => y.id === r.actualizacionId);
    const est = sel(F.ESTADOS.map((s) => [s.key, s.label]), r.estado); const nota = ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Qué se revisó, resultado, folio con el fabricante…' });
    const mit = ctl('textarea', { rows: 2, maxlength: 3000 }); mit.value = r.mitigacion || ''; const err = errBox();
    const save = async (btn) => { btn.disabled = true; try { await api('PUT', `/api/firmware/reportes/${r.id}`, { estado: est.value, nota: nota.value, mitigacion: mit.value }); saved('Seguimiento guardado'); } catch (e) { showErr(err, e.message); btn.disabled = false; } };
    const del = isAdmin() || r.createdBy === state.user.id ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/firmware/reportes/${r.id}`); saved('Reporte eliminado'); }) }, 'Eliminar reporte') : null;
    openDrawer(r.patron, h('div', {},
      h('div', { class: 'mon-fsum' }, sevPill(r.severidad), estPill(r.estado), h('span', { class: 'muted' }, `${fullDate(r.fecha)} · ${sedeN(r.sede)}`)),
      h('dl', { class: 'mon-dl' }, [['Firmware', [r.modelo, r.firmware].filter(Boolean).join(' · ')], ['Actualización', x ? `${dayMonth(x.fecha)} · ${x.fwActual} → ${x.fwObjetivo} (día ${F.diasEntre(x.fecha, r.fecha)})` : null],
        ['Tipo', `${F.CATEGORIA[r.categoria].label}${r.subtipo ? ' · ' + r.subtipo : ''}`], ['Impacto', r.impacto], ['Alcance', [r.alcance, r.alcanceDetalle].filter(Boolean).join(' · ')], ['Síntoma', r.sintoma], ['Reproducción', r.reproduccion], ['Evidencia', r.evidencia], ['Registró', r.autor]]
        .filter(([, t]) => t).map(([k, t]) => [h('dt', {}, k), h('dd', {}, t)])),
      canWrite() ? h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Actualizar seguimiento'), field('Nuevo estado', est), field('Nota', nota, null, true), field('Mitigación y siguiente acción', mit, null, true), err,
        h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar seguimiento'), del)) : null,
      h('h3', { class: 'mon-dh3' }, 'Historial'), h('ol', { class: 'timeline mon-hist' }, r.historial.slice().reverse().map((it) => h('li', { class: 'tl-item' }, h('span', { class: 'tl-when' }, `${ddmm(it.ts)} · ${it.user}`, it.estado ? estPill(it.estado) : null), it.nota ? h('span', { class: 'tl-text' }, it.nota) : null)))), true);
  }

  // el PDF siempre sale con el resumen para BBVA
  let prevTab = null;
  window.addEventListener('beforeprint', () => { if (root?.isConnected && view.tab !== 'resumen') { prevTab = view.tab; view.tab = 'resumen'; render(); } });
  window.addEventListener('afterprint', () => { if (prevTab && root?.isConnected) { view.tab = prevTab; prevTab = null; render(); } });

  window.PortalFirmware = {
    exportItems: () => [
      { label: 'Análisis (Excel CSV)', hint: 'Known Issues y recomendación de cada análisis', href: '/api/firmware/export/analisis.csv' },
      { label: 'Actualizaciones (Excel CSV)', hint: 'Ventanas, checklist, resultado e impacto', href: '/api/firmware/export/actualizaciones.csv' },
      { label: 'Reportes de fallos (Excel CSV)', hint: 'Patrón, severidad, estado y seguimiento', href: '/api/firmware/export/reportes.csv' },
    ],
    async mount(el, ext) {
      root = el; EXT = { resumen: (ext?.resumen || []).filter(Boolean), acerca: (ext?.acerca || []).filter(Boolean), draw: ext?.draw };
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando el debugging de firmware…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    nuevo(kind) { if (!D) return; if (kind === 'analisis') openAnalisis(); else if (kind === 'actualizacion') openActualizacion(); else openReporte(); },
  };
})();
