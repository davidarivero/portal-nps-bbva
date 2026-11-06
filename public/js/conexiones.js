'use strict';
/* Monitoreo proactivo de indicadores clave 2.0 (conexiones a BBVA_GLOBAL y BBVA).
   Pestañas: Reporte ejecutivo · Registro diario · Universo en investigación · Acerca de la iniciativa. Captura en panel lateral. */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const X = window.PortalConexionesComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
  const nint = (v) => nf(v, 0);
  const p1 = (v) => (v === null || v === undefined ? '—' : `${nf(v, 1)}%`);
  const p2 = (v) => (v === null || v === undefined ? '—' : `${nf(v, 2)}%`);
  const sedeN = (k) => (X.SEDE[k] ? X.SEDE[k].name : k || '—');
  const ddmm = (ts) => `${ts.slice(0, 10).split('-').reverse().join('/')} ${ts.slice(11, 16)}`;
  const COLOR = { ok: '#3a9a6a', auth: '#d9a23a', inv: '#c8141b' };
  const TABS = [['resumen', 'Reporte ejecutivo'], ['registro', 'Registro diario'], ['investigacion', 'Universo en investigación'], ['acerca', 'Acerca de la iniciativa']];
  const view = { tab: 'resumen', sede: '', ssid: '', desde: null, hasta: null, estado: 'abiertos', prioridad: '', q: '' };
  let anaTok = 0;
  let root = null, D = null, EXT = { resumen: [], acerca: [] };
  const lvl = (v) => (v === null ? '' : v >= X.META.objetivo ? 'good' : v >= X.META.inicial ? 'prog' : 'crit');
  const PR_ORD = { alta: 0, media: 1, baja: 2 };
  const prPill = (k) => h('span', { class: `pill pill-${X.PRIORIDAD[k].cls} fw-pill`, title: X.PRIORIDAD[k].hint }, X.PRIORIDAD[k].label);
  const estPill = (k) => h('span', { class: `pill pill-${X.ESTADO[k].cls} fw-pill` }, X.ESTADO[k].label);

  async function reload() {
    D = await api('GET', '/api/conexiones/datos');
    if (!view.hasta) { view.hasta = D.hoy; view.desde = X.addDays(X.mondayOf(D.hoy), -21); }
    render();
  }
  const inRange = (f) => (!view.desde || f >= view.desde) && (!view.hasta || f <= view.hasta);
  const L = () => D.lecturas.filter((r) => inRange(r.fecha) && (!view.sede || r.sede === view.sede) && (!view.ssid || r.ssid === view.ssid));
  const casosScope = () => D.casos.filter((c) => inRange(c.fecha) && (!view.sede || c.sede === view.sede) && (!view.ssid || !c.ssid || c.ssid === view.ssid));

  /* =================== página =================== */
  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const scopeTxt = [view.sede ? sedeN(view.sede) : 'Todas las sedes', view.ssid || 'BBVA_GLOBAL y BBVA'].join(' · ');
    const periodo = view.desde ? `${fullDate(view.desde)} – ${fullDate(view.hasta)}` : 'Todo el historial';
    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, 'Monitoreo proactivo 2.0 · Reporte ejecutivo'),
        h('p', {}, `${scopeTxt} · Periodo: ${periodo}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));
    const abiertos = D.casos.filter((c) => X.ESTADO[c.estado].abierto).length;
    push(h('div', { class: 'mon-tabbar no-print', role: 'tablist' }, TABS.map(([k, t]) => h('button', {
      class: 'mon-tab' + (view.tab === k ? ' is-active' : ''), role: 'tab', type: 'button', 'aria-selected': String(view.tab === k), onclick: () => { view.tab = k; render(); } },
    t, k === 'investigacion' && abiertos ? h('span', { class: 'badge' }, `${abiertos} abiertos`) : null))));
    if (view.tab !== 'acerca') {
      const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key] || '', max: D.hoy,
        onchange: (e) => { view[key] = e.target.value || null; if (view.desde && !view.hasta) view.hasta = D.hoy; if (view.desde && view.hasta && view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; render(); } }));
      const rapido = [['Esta semana', () => [X.mondayOf(D.hoy), D.hoy]], ['4 semanas', () => [X.addDays(X.mondayOf(D.hoy), -21), D.hoy]], ['12 semanas', () => [X.addDays(X.mondayOf(D.hoy), -77), D.hoy]], ['Todo', () => [null, null]]];
      push(h('div', { class: 'mon-filters no-print' }, dateInput('cx-desde', 'Desde', 'desde'), dateInput('cx-hasta', 'Hasta', 'hasta'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' }, rapido.map(([t, f]) => h('button', { class: 'tab', type: 'button', onclick: () => { [view.desde, view.hasta] = f(); render(); } }, t)))),
        h('div', { class: 'field' }, h('label', { for: 'cx-sede' }, 'Sede'), h('select', { id: 'cx-sede', onchange: (e) => { view.sede = e.target.value; render(); } }, h('option', { value: '' }, 'Todas las sedes'), X.SEDES.map((s) => h('option', { value: s.key, selected: s.key === view.sede }, s.name)))),
        h('div', { class: 'field' }, h('label', { for: 'cx-ssid' }, 'SSID'), h('select', { id: 'cx-ssid', onchange: (e) => { view.ssid = e.target.value; render(); } }, h('option', { value: '' }, 'Ambos'), X.SSIDS.map((s) => h('option', { value: s, selected: s === view.ssid }, s)))),
        h('p', { class: 'muted mon-range' }, `${periodo} · ${scopeTxt}`)));
    }
    if (view.tab === 'resumen') push(resumen(scopeTxt));
    else if (view.tab === 'registro') push(registroTab());
    else if (view.tab === 'investigacion') push(investigacionTab());
    else push(EXT.acerca);
    root.append(...kids);
    if (view.tab === 'resumen' && EXT.draw) EXT.draw();
  }

  const stack = (t) => h('div', { class: 'mon-stack is-tall', role: 'img', 'aria-label': `Exitosos ${p1(t.pctOk)}, 12303 ${p1(t.pctAuth)}, investigación ${p2(t.pctInv)}` },
    t.ok ? h('span', { style: `flex:${t.ok};background:${COLOR.ok}`, title: `Exitosos: ${nint(t.ok)} (${p1(t.pctOk)})` }, t.pctOk >= 12 ? p1(t.pctOk) : '') : null,
    t.auth ? h('span', { style: `flex:${t.auth};background:${COLOR.auth}`, title: `ID Authentication 12303: ${nint(t.auth)} (${p1(t.pctAuth)})` }) : null,
    t.inv ? h('span', { style: `flex:${t.inv};background:${COLOR.inv}`, title: `En investigación: ${nint(t.inv)} (${p2(t.pctInv)})` }) : null);
  const legend = () => h('p', { class: 'legend mon-legend' }, h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.ok}` }), 'Exitosos'), h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.auth}` }), 'Fallidos ID Authentication 12303'), h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.inv}` }), 'Fallidos en investigación'));

  /* ---------- Reporte ejecutivo ---------- */
  function resumen(scopeTxt) {
    const rows = L(); const t = X.totales(rows);
    const out = [];
    if (!rows.length) {
      out.push(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No hay lecturas en este periodo. Amplía las fechas o carga el Excel diario de conexiones.')));
      out.push(EXT.resumen[1]); return out;
    }
    const delta = t.pctOk - X.META.inicial, falta = X.META.objetivo - t.pctOk;
    const item = (label, num, unit, cls) => h('div', { class: 'trio-item' + (cls ? ' ' + cls : '') }, h('span', { class: 'trio-label' }, label), h('span', { class: 'trio-num' }, num), h('span', { class: 'trio-unit' }, unit));
    out.push(h('div', { class: 'mon-trio' }, h('p', { class: 'kpi-caption' }, `Conexiones exitosas · ${scopeTxt}`),
      h('div', { class: 'trio' }, item('Métrica inicial', `${nf(X.META.inicial, 1)}%`, 'semana del 26 al 30 oct 2026'),
        item('Métrica actual', p1(t.pctOk), `${nint(t.ok)} de ${nint(t.disp)} intentos · ponderado`, 'trio-current'), item('Métrica objetivo', `${nf(X.META.objetivo, 0)}%`, 'conexiones exitosas')),
      h('p', { class: 'facts' }, h('span', { class: `pill pill-${lvl(t.pctOk)} fw-pill` }, falta <= 0 ? 'Objetivo cumplido' : Math.abs(delta) < 0.05 ? 'Igual a la inicial' : `${delta > 0 ? '+' : ''}${nf(delta, 1)} pts vs. inicial`),
        falta > 0 ? ` Faltan ${nf(falta, 1)} puntos para el 95 %.` : ' Se alcanzó el 95 %.', ' Cálculo: exitosos ÷ dispositivos del periodo (no promedio de porcentajes diarios).')));

    // nivel 1: composición
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Nivel 1 · Composición de los intentos de conexión · ${scopeTxt}`),
      h('div', { class: 'cx-tiles' },
        tile('Intentos de conexión', nint(t.disp), `${t.dias} lecturas diarias`),
        tile('Exitosos', p1(t.pctOk), `${nint(t.ok)} dispositivos`, 'fw-t-good'),
        tile('ID Authentication 12303', p1(t.pctAuth), `${nint(t.auth)} · credenciales del usuario`, 'fw-t-warn'),
        tile('En investigación', p2(t.pctInv), `${nint(t.inv)} dispositivos · foco de atención`, 'fw-t-crit')),
      stack(t), legend()));

    // nivel 2: por sede
    const bySede = X.SEDES.map((s) => { const l = rows.filter((r) => r.sede === s.key); return { s, t: X.totales(l), n: l.length, casos: casosScope().filter((c) => c.sede === s.key) }; }).filter((x) => x.n);
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 2 · Resultado por sede'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-sedes' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Intentos'), h('th', { class: 'num-col' }, '% exitosos'), h('th', { class: 'num-col' }, 'vs. 91.3 %'), h('th', { class: 'num-col' }, '% 12303'), h('th', { class: 'num-col' }, 'En investigación'), h('th', { class: 'num-col' }, 'Casos atendidos'), h('th', { class: 'mon-col-stack' }, 'Composición'))),
        h('tbody', {}, bySede.map(({ s, t: x, casos }) => h('tr', { class: s.key === view.sede ? 'is-selected' : '' },
          h('td', {}, h('button', { class: 'link-btn mon-sede-btn', type: 'button', title: 'Ver solo esta sede', onclick: () => { view.sede = view.sede === s.key ? '' : s.key; render(); } }, s.name)),
          h('td', { class: 'num-col plain' }, nint(x.disp)), h('td', { class: `num-col cx-v cx-${lvl(x.pctOk)}` }, p1(x.pctOk)),
          h('td', { class: 'num-col plain' }, `${x.pctOk - X.META.inicial >= 0 ? '+' : ''}${nf(x.pctOk - X.META.inicial, 1)}`), h('td', { class: 'num-col plain' }, p1(x.pctAuth)),
          h('td', { class: 'num-col plain' }, `${nint(x.inv)} (${p2(x.pctInv)})`), h('td', { class: 'num-col plain' }, `${casos.length}${casos.length ? ` · ${casos.filter((c) => !X.ESTADO[c.estado].abierto).length} cerrados` : ''}`),
          h('td', { class: 'mon-col-stack' }, stack(x))))))), legend()));

    // nivel 3: trazabilidad semanal por sede
    const weeks = [...new Set(rows.map((r) => X.mondayOf(r.fecha)))].sort().slice(-10);
    if (weeks.length) {
      const cell = (l, prev) => { if (!l.length) return h('td', { class: 'num-col empty-cell' }, '—'); const v = X.totales(l).pctOk; const d = prev === null ? null : v - prev;
        return h('td', { class: `num-col cx-v cx-${lvl(v)}`, title: `${nint(X.totales(l).ok)} de ${nint(X.totales(l).disp)}` }, p1(v), d === null ? null : h('span', { class: 'cx-delta ' + (d > 0.05 ? 'is-up' : d < -0.05 ? 'is-down' : '') }, `${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '='} ${nf(Math.abs(d), 1)}`)); };
      const sedes = [...bySede.map((x) => x.s)];
      const rowFor = (label, filt) => { let prev = null; return h('tr', {}, h('td', {}, label), weeks.map((w) => { const l = rows.filter((r) => X.mondayOf(r.fecha) === w && filt(r)); const c = cell(l, prev); if (l.length) prev = X.totales(l).pctOk; return c; })); };
      out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 3 · Trazabilidad semanal de la mejora (% de conexiones exitosas)'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table cx-trend' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), weeks.map((w) => h('th', { class: 'num-col' }, `Sem. ${dayMonth(w)}`)))),
          h('tbody', {}, rowFor(h('strong', {}, view.sede ? sedeN(view.sede) : 'Todas las sedes'), () => true), view.sede ? null : sedes.map((s) => rowFor(s.name, (r) => r.sede === s.key))))),
        h('p', { class: 'legend mon-legend' }, h('span', {}, h('i', { class: 'mon-dot', style: 'background:var(--good)' }), '95 % o más'), h('span', {}, h('i', { class: 'mon-dot', style: 'background:var(--prog)' }), 'Arriba de la inicial (91.3 %)'), h('span', {}, h('i', { class: 'mon-dot', style: 'background:var(--crit)' }), 'Debajo de la inicial'), h('span', { class: 'muted' }, '▲▼ cambio en puntos contra la semana anterior.'))));
    }

    // foco: universo en investigación
    const cs = casosScope();
    const causas = new Map(); cs.forEach((c) => causas.set(c.causa || 'Sin causa registrada', (causas.get(c.causa || 'Sin causa registrada') || 0) + 1));
    const cr = [...causas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6); const mx = Math.max(1, ...cr.map((x) => x[1]));
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Foco de atención · Universo en investigación'),
      h('div', { class: 'cx-focus' },
        h('div', { class: 'cx-tiles cx-tiles-3' },
          tile('Dispositivos en investigación', nint(t.inv), `${p2(t.pctInv)} de los intentos`, 'fw-t-crit'),
          tile('Casos registrados', nint(cs.length), cs.length ? `${nf((cs.filter((c) => c.estado !== 'nuevo').length / cs.length) * 100, 0)}% con avance · ${cs.filter((c) => c.prioridad === 'alta' && X.ESTADO[c.estado].abierto).length} de prioridad alta abiertos` : ''),
          tile('Resueltos o descartados', nint(cs.filter((c) => !X.ESTADO[c.estado].abierto).length), `${cs.filter((c) => X.ESTADO[c.estado].abierto).length} siguen abiertos`, 'fw-t-good')),
        h('div', {}, h('h3', {}, 'Causas identificadas'), cr.length ? h('div', { class: 'mon-hbars' }, cr.map(([k, n]) => h('div', { class: 'mon-hrow' }, h('span', { class: 'mon-hlabel', title: k }, k), h('div', { class: 'mon-htrack' }, h('div', { class: 'fw-bar', style: `width:${(n / mx) * 100}%;background:#2a2b2e` })), h('span', { class: 'mon-hnum' }, n)))) : h('p', { class: 'muted' }, 'Aún no hay casos registrados en el periodo.')))));
    out.push(detalleSection());
    out.push(EXT.resumen[1]);
    return out.filter(Boolean);
  }
  const tile = (label, num, sub, cls) => h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-num' }, num), sub ? h('span', { class: 'tile-sub' }, sub) : null);

  /* ---------- Registro diario ---------- */
  function registroTab() {
    const rows = L();
    const can = canWrite();
    return [h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Lecturas diarias (${nint(rows.length)})`), h('p', { class: 'muted' }, 'Un renglón por día, sede y SSID. Investigación = fallidos − ID Authentication 12303.')),
        can ? h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => openExcel() }, 'Cargar Excel'), h('button', { class: 'btn', type: 'button', onclick: () => openDetalle() }, 'Cargar reportes Abaton / ISE'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCaptura() }, 'Capturar día')) : null),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table fw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede'), h('th', {}, 'SSID'), h('th', { class: 'num-col' }, 'Dispositivos'), h('th', { class: 'num-col' }, 'Exitosos'), h('th', { class: 'num-col' }, '% exitosos'), h('th', { class: 'num-col' }, 'Fallidos'), h('th', { class: 'num-col' }, 'ID Auth. 12303'), h('th', { class: 'num-col' }, 'En investigación'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, rows.map((r) => { const v = (r.exitosos / r.dispositivos) * 100; const inv = r.fallidos - r.auth12303; return h('tr', {},
          h('td', { class: 'nowrap' }, fullDate(r.fecha)), h('td', {}, sedeN(r.sede)), h('td', { class: 'mono' }, r.ssid), h('td', { class: 'num-col plain' }, nint(r.dispositivos)), h('td', { class: 'num-col plain' }, nint(r.exitosos)),
          h('td', { class: `num-col cx-v cx-${lvl(v)}` }, p1(v)), h('td', { class: 'num-col plain' }, nint(r.fallidos)), h('td', { class: 'num-col plain' }, `${nint(r.auth12303)} (${p1((r.auth12303 / r.dispositivos) * 100)})`),
          h('td', { class: 'num-col plain' }, `${nint(inv)} (${p2((inv / r.dispositivos) * 100)})`),
          h('td', { class: 'actions no-print' }, can ? h('button', { class: 'link-btn', type: 'button', onclick: () => openCaptura(r) }, 'Corregir') : null, can && inv > 0 ? h('button', { class: 'link-btn', type: 'button', onclick: () => openCaso(null, r) }, 'Registrar caso') : null)); })))) : h('p', { class: 'empty' }, 'Sin lecturas en el periodo.')),
    coberturaPanel(),
    h('section', { class: 'panel' }, h('h2', {}, 'Cargas de información'),
      D.cargas.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha y hora'), h('th', {}, 'Quién'), h('th', {}, 'Origen'), h('th', { class: 'num-col' }, 'Nuevas'), h('th', { class: 'num-col' }, 'Actualizadas'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, D.cargas.map((c) => h('tr', {}, h('td', { class: 'nowrap' }, ddmm(c.ts)), h('td', {}, c.user || '—'),
          h('td', {}, ({ excel: 'Excel de lecturas', manual: 'Captura manual', abaton: `Abaton · ${sedeN(c.resumen.sede)} ${c.resumen.fecha ? dayMonth(c.resumen.fecha) : ''}`, ise: `ISE · ${sedeN(c.resumen.sede)} ${c.resumen.fecha ? dayMonth(c.resumen.fecha) : ''}` })[c.tipo] || c.tipo, c.archivo ? h('span', { class: 'meta' }, c.archivo) : null, c.resumen.deshecha ? h('span', { class: 'meta warn-text' }, `Deshecha por ${c.resumen.deshecha.por}`) : null),
          h('td', { class: 'num-col plain' }, c.resumen.nuevas ?? '—'), h('td', { class: 'num-col plain' }, c.resumen.actualizadas ?? '—'),
          h('td', { class: 'actions no-print' }, !c.resumen.deshecha && c.vigentes && (isAdmin() || (c.tipo === 'manual' && c.userId === state.user.id)) ? h('button', { class: 'link-btn', type: 'button', title: 'Borra las lecturas que siguen viniendo de esta carga',
            onclick: (e) => confirmInline(e.currentTarget, async () => { const x = await api('DELETE', `/api/conexiones/cargas/${c.id}`); toast(`Carga deshecha: ${x.lecturas} lecturas eliminadas`); refreshAll(); }) }, 'Deshacer') : null)))))) : h('p', { class: 'muted' }, 'Aún no hay cargas.'))];
  }

  /* ---------- Universo en investigación ---------- */
  function investigacionTab() {
    const rows = L(); const qn = X.plain(view.q);
    const base = casosScope();
    const list = base.filter((c) => (view.estado === 'todos' || (view.estado === 'abiertos' ? X.ESTADO[c.estado].abierto : view.estado === 'mios' ? c.ingenieroId === state.user.id && X.ESTADO[c.estado].abierto : c.estado === view.estado))
      && (!view.prioridad || c.prioridad === view.prioridad)
      && (!qn || X.plain([c.username, c.nombre, c.dispositivo, c.ap, c.causa, c.comentario].join(' ')).includes(qn)))
      .sort((a, b) => (PR_ORD[a.prioridad] ?? 3) - (PR_ORD[b.prioridad] ?? 3) || b.fecha.localeCompare(a.fecha));
    const porSede = X.SEDES.map((s) => { const t = X.totales(rows.filter((r) => r.sede === s.key)); const cs = base.filter((c) => c.sede === s.key); return { s, inv: t.inv, n: cs.length, ab: cs.filter((c) => X.ESTADO[c.estado].abierto).length, av: cs.filter((c) => c.estado !== 'nuevo').length, alta: cs.filter((c) => c.prioridad === 'alta' && X.ESTADO[c.estado].abierto).length }; }).filter((x) => x.inv || x.n);
    const fp = (k, t) => h('button', { class: 'tab' + (view.prioridad === k ? ' is-active' : ''), type: 'button', onclick: () => { view.prioridad = k; render(); } }, t);
    const f = (k, t) => h('button', { class: 'tab' + (view.estado === k ? ' is-active' : ''), type: 'button', onclick: () => { view.estado = k; render(); } }, t);
    return [h('section', { class: 'panel' }, h('h2', {}, 'Universo en investigación por sede'), h('p', { class: 'muted' }, 'Dispositivos con falla que no es ID Authentication 12303 (suma diaria) y los casos que se atienden en el portal. Avance = casos que ya pasaron de «Por analizar».'),
      porSede.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'En investigación (suma diaria)'), h('th', { class: 'num-col' }, 'Casos'), h('th', { class: 'num-col' }, 'Abiertos'), h('th', { class: 'num-col' }, 'Prioridad alta abiertos'), h('th', {}, 'Avance de los casos'))),
        h('tbody', {}, porSede.map((x) => { const c = x.n ? (x.av / x.n) * 100 : null; return h('tr', {}, h('td', {}, x.s.name), h('td', { class: 'num-col plain' }, nint(x.inv)), h('td', { class: 'num-col plain' }, nint(x.n)), h('td', { class: 'num-col plain' }, nint(x.ab)), h('td', { class: 'num-col plain' }, nint(x.alta)),
          h('td', {}, c === null ? '—' : h('div', { class: 'cx-meter' }, h('div', { class: 'cx-meter-bar' }, h('span', { style: `width:${c}%` })), h('span', {}, `${nf(c, 0)}%`)))); })))) : h('p', { class: 'empty' }, 'Sin dispositivos en investigación en el periodo.')),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Casos (${nint(list.length)})`), h('div', { class: 'tabs' }, f('abiertos', 'Abiertos'), f('mios', 'Mis casos'), f('todos', 'Todos'), ...['resuelto', 'externo'].map((k) => f(k, X.ESTADO[k].label))), h('div', { class: 'tabs cx-prio-tabs' }, h('span', { class: 'label' }, 'Prioridad'), fp('', 'Todas'), ...X.PRIORIDADES.map((x) => fp(x.key, x.label)))),
        h('div', { class: 'mon-tools no-print' }, h('input', { type: 'search', placeholder: 'Buscar usuario, MAC, AP o causa', value: view.q, 'aria-label': 'Buscar caso', oninput: (e) => { view.q = e.target.value; clearTimeout(view.t); view.t = setTimeout(() => { render(); const i = root.querySelector('.mon-tools input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }),
          canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCaso() }, 'Registrar caso') : null)),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table fw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Usuario'), h('th', {}, 'Dispositivo'), h('th', {}, 'Prioridad'), h('th', {}, 'Causa'), h('th', {}, 'Estado'), h('th', {}, 'Último comentario'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, list.map((c) => h('tr', {},
          h('td', { class: 'nowrap' }, dayMonth(c.fecha), h('span', { class: 'meta' }, sedeN(c.sede))),
          h('td', {}, h('strong', {}, c.nombre || 'Sin nombre'), h('span', { class: 'meta' }, c.username || '—')),
          h('td', {}, h('span', { class: 'mono' }, c.dispositivo || '—'), h('span', { class: 'meta' }, [c.ssid, c.ap].filter(Boolean).join(' · '))),
          h('td', {}, c.prioridad ? prPill(c.prioridad) : h('span', { class: 'muted' }, '—'), c.dias ? h('span', { class: 'meta' }, `${c.dias} ${c.dias === 1 ? 'día' : 'días'} · ${nint(c.fallos)} ${c.fallos === 1 ? 'fallo' : 'fallos'}`) : null),
          h('td', {}, c.causa || h('span', { class: 'muted' }, 'Por determinar'), c.codigo ? h('span', { class: 'meta' }, `ISE ${c.codigo}`) : null),
          h('td', {}, estPill(c.estado), h('span', { class: 'meta' }, c.ingeniero ? `Atiende: ${c.ingeniero}` : 'Sin asignar')),
          h('td', { class: 'detail-col' }, h('span', { class: 'mon-clip2' }, c.comentario || h('span', { class: 'muted' }, 'Sin comentario'))),
          h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => openSeguimiento(c) }, canWrite() ? 'Seguimiento' : 'Ver'))))))) : h('p', { class: 'empty' }, 'No hay casos con este filtro.'))];
  }

  /* ---------- detalle Abaton / ISE ---------- */
  function coberturaPanel() {
    const keys = new Map();
    const add = (sede, fecha) => { const k = `${fecha}|${sede}`; if (!keys.has(k)) keys.set(k, { sede, fecha }); return keys.get(k); };
    D.lecturas.filter((r) => inRange(r.fecha) && (!view.sede || r.sede === view.sede)).forEach((r) => { const x = add(r.sede, r.fecha); x.f = (x.f || 0) + r.fallidos; x.a = (x.a || 0) + r.auth12303; });
    (D.cobertura || []).filter((c) => inRange(c.fecha) && (!view.sede || c.sede === view.sede)).forEach((c) => { const x = add(c.sede, c.fecha); x[c.fuente] = c; });
    const rows = [...keys.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.sede.localeCompare(b.sede));
    if (!rows.some((r) => r.abaton || r.ise)) return h('section', { class: 'panel' }, h('h2', {}, 'Reportes de detalle'), h('p', { class: 'muted' }, 'Aún no hay reportes de Abaton (equipos sin conexión) ni de ISE cargados en el periodo. Con ellos el portal valida las cifras diarias, crea los casos del universo en investigación y analiza códigos, pisos y AP.'));
    const ok = (r) => (r.abaton && r.f !== undefined ? (r.abaton.n === r.f && r.abaton.a12303 === r.a ? h('span', { class: 'ok-text' }, '✓ Cuadra') : h('span', { class: 'warn-text' }, `No cuadra (${r.abaton.n}/${r.abaton.a12303} vs ${r.f}/${r.a})`)) : h('span', { class: 'muted' }, '—'));
    return h('section', { class: 'panel' }, h('h2', {}, 'Reportes de detalle por día'), h('p', { class: 'muted' }, 'Abaton = dispositivos con falla (y cuántos son 12303); se compara contra los fallidos y 12303 de la lectura diaria. ISE = eventos de autenticación fallida.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Lectura: fallidos / 12303'), h('th', { class: 'num-col' }, 'Abaton: dispositivos / 12303'), h('th', {}, 'Validación'), h('th', { class: 'num-col' }, 'ISE: eventos'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'nowrap' }, fullDate(r.fecha)), h('td', {}, sedeN(r.sede)),
          h('td', { class: 'num-col plain' }, r.f !== undefined ? `${nint(r.f)} / ${nint(r.a)}` : '—'), h('td', { class: 'num-col plain' }, r.abaton ? `${nint(r.abaton.n)} / ${nint(r.abaton.a12303)}` : '—'), h('td', {}, ok(r)),
          h('td', { class: 'num-col plain' }, r.ise ? nint(r.ise.n) : '—')))))));
  }

  function detalleSection() {
    const box = h('section', { class: 'panel mon-level cx-detalle' }, h('p', { class: 'mon-eyebrow' }, 'Análisis de detalle · Abaton e ISE'), h('p', { class: 'loading' }, 'Cargando el análisis…'));
    const tok = ++anaTok;
    const qs = new URLSearchParams(); if (view.desde) qs.set('desde', view.desde); if (view.hasta) qs.set('hasta', view.hasta); if (view.sede) qs.set('sede', view.sede);
    api('GET', '/api/conexiones/analisis?' + qs).then((A) => { if (tok === anaTok) fillDetalle(box, A); }).catch((e) => { box.querySelector('.loading').textContent = e.message; });
    return box;
  }
  function fillDetalle(box, A) {
    box.textContent = '';
    box.append(h('p', { class: 'mon-eyebrow' }, 'Análisis de detalle · Abaton e ISE'));
    if (!A.dias && !A.diasIse) { box.append(h('p', { class: 'muted' }, 'Sin reportes de detalle en el periodo. Cárgalos en Registro diario → «Cargar reportes Abaton / ISE».')); return; }
    const sum = (f) => A.disp.filter(f).reduce((a, x) => a + x.n, 0);
    const d12 = sum((x) => x.tipo === '12303'), dInv = sum((x) => x.tipo === 'investigacion'), dRec = sum((x) => x.tipo === 'investigacion' && x.recuperado);
    const cats = X.CATEGORIAS.map((c) => ({ k: c.label, n: sum((x) => x.categoria === c.key), hint: c.hint })).filter((c) => c.n);
    const rec = (t) => A.rec.find((x) => x.tipo === t) || { macs: 0, multi: 0 };
    const bars = (rows, color) => { const mx = Math.max(1, ...rows.map((r) => r.n)); return h('div', { class: 'mon-hbars' }, rows.map((r) => h('div', { class: 'mon-hrow' }, h('span', { class: 'mon-hlabel', title: r.hint || r.k }, r.k), h('div', { class: 'mon-htrack' }, h('div', { class: 'fw-bar', style: `width:${(r.n / mx) * 100}%;background:${color}` })), h('span', { class: 'mon-hnum' }, nint(r.n))))); };
    const cs = casosScope().filter((c) => c.origen === 'abaton');
    box.append(
      h('div', { class: 'cx-tiles' },
        tile('Dispositivos con falla (Abaton)', nint(d12 + dInv), `${A.dias} días-sede con detalle`),
        tile('ID Authentication 12303', nint(d12), `${nint(rec('12303').macs)} equipos distintos · ${nint(rec('12303').multi)} fallan 2 días o más`, 'fw-t-warn'),
        tile('En investigación', nint(dInv), `${nint(rec('investigacion').macs)} equipos distintos · ${nint(rec('investigacion').multi)} repiten`, 'fw-t-crit'),
        tile('Se recuperaron solos', nint(dRec), `${dInv ? nf((dRec / dInv) * 100, 0) : 0}% del universo: se conectaron después del último fallo`, 'fw-t-good')),
      h('div', { class: 'fw-grid4' },
        h('div', {}, h('h3', {}, 'Universo en investigación por causa'), cats.length ? bars(cats, COLOR.inv) : h('p', { class: 'muted' }, 'Sin dispositivos en investigación.')),
        h('div', {}, h('h3', {}, 'Casos por prioridad'), cs.length ? bars(X.PRIORIDADES.map((p) => ({ k: `${p.label} · ${p.hint.split(':')[0].split(',')[0]}`, n: cs.filter((c) => c.prioridad === p.key).length, hint: p.hint })), '#2a2b2e') : h('p', { class: 'muted' }, 'Sin casos creados desde Abaton.')),
        A.codigos.length ? h('div', {}, h('h3', {}, 'ISE: fallas por código (eventos)'), h('div', { class: 'table-wrap' }, h('table', { class: 'table cx-codes' }, h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', { class: 'num-col' }, 'Eventos'), h('th', { class: 'num-col' }, 'Equipos-día'))),
          h('tbody', {}, A.codigos.slice(0, 8).map((c) => h('tr', {}, h('td', {}, h('strong', {}, c.codigo), h('span', { class: 'meta' }, X.ISE[c.codigo] || '')), h('td', { class: 'num-col plain' }, nint(c.eventos)), h('td', { class: 'num-col plain' }, nint(c.dispositivos)))))))) : null,
        A.pisos.length ? h('div', {}, h('h3', {}, 'ISE: pisos con más fallas'), bars(A.pisos.map((p) => ({ k: `${view.sede ? '' : sedeN(p.sede) + ' · '}${p.piso || 'Sin piso'}`, n: p.eventos, hint: `${p.dispositivos} equipos-AP, ${p.d12303} con 12303` })), COLOR.auth),
          A.aps.length ? h('p', { class: 'meta' }, 'AP con más eventos: ', A.aps.slice(0, 4).map((a) => `${a.ap} (${nint(a.eventos)})`).join(', ')) : null) : null),
      h('p', { class: 'muted' }, 'Lectura: 12303 = el equipo intenta usuario y contraseña (PEAP) donde la red exige certificado; suelen ser equipos personales o sin perfil corporativo. El universo en investigación son las demás fallas; los que se recuperaron solos tienen prioridad baja.'));
  }

  function openDetalle() {
    const input = ctl('input', { type: 'file', accept: '.xlsx', multiple: true }); const out = h('div', {}); let revisados = [];
    const send = async (file, modo) => {
      const res = await fetch(`/api/conexiones/detalle?modo=${modo}&nombre=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: file });
      const r = await res.json().catch(() => ({})); if (!res.ok) throw new Error(r.error || 'No se pudo leer el archivo.'); return r;
    };
    const preview = async (btn) => {
      const files = [...input.files].filter((f) => !f.name.startsWith('~$') && !f.name.startsWith('._'));
      if (!files.length) { toast('Selecciona uno o varios archivos .xlsx.', 'error'); return; }
      btn.disabled = true; out.textContent = ''; out.append(h('p', { class: 'loading' }, `Revisando ${files.length} archivos…`)); revisados = [];
      for (const f of files) { try { revisados.push({ f, r: await send(f, 'vista') }); } catch (e) { revisados.push({ f, r: { errores: [e.message] } }); } }
      btn.disabled = false; drawPreview();
    };
    const drawPreview = () => {
      out.textContent = '';
      const okN = revisados.filter((x) => !x.r.errores.length).length;
      out.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Archivo'), h('th', {}, 'Tipo · sede · día'), h('th', {}, 'Contenido'), h('th', {}, 'Revisión'))),
        h('tbody', {}, revisados.map(({ f, r }) => h('tr', {}, h('td', {}, f.name),
          h('td', {}, r.tipo ? `${r.tipo === 'abaton' ? 'Abaton' : 'ISE'} · ${sedeN(r.sede)} · ${r.fecha ? dayMonth(r.fecha) : '—'}` : '—'),
          h('td', {}, r.tipo === 'abaton' ? `${nint(r.dispositivos)} dispositivos: ${nint(r.a12303)} de 12303 y ${nint(r.investigacion)} en investigación (${nint(r.recuperados)} se recuperaron). Casos: ${r.casosNuevos} nuevos, ${r.casosActualizados} actualizados.`
            : r.tipo === 'ise' ? `${nint(r.eventos)} eventos de ${nint(r.dispositivos)} equipos; ${Object.entries(r.codigos || {}).sort((a, b) => b[1].eventos - a[1].eventos).slice(0, 3).map(([k, v]) => `${k}: ${nint(v.eventos)}`).join(', ')}` : ''),
          h('td', {}, r.errores.length ? h('span', { class: 'warn-text' }, r.errores.join(' ')) : r.avisos.length ? h('span', { class: 'meta' }, r.avisos.join(' ')) : h('span', { class: 'ok-text' }, r.lectura ? '✓ Cuadra con la lectura diaria' : '✓ Listo'))))))),
      h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !okN, onclick: async (e) => {
        e.currentTarget.disabled = true; let n = 0; const errs = [];
        for (const { f, r } of revisados) { if (r.errores.length) continue; try { await send(f, 'guardar'); n += 1; } catch (x) { errs.push(`${f.name}: ${x.message}`); } }
        if (errs.length) toast(errs.join(' · '), 'error');
        view.tab = 'registro'; saved(`Se cargaron ${n} reportes de detalle`);
      } }, `Guardar ${okN} ${okN === 1 ? 'archivo' : 'archivos'}`)));
    };
    openDrawer('Cargar reportes Abaton / ISE', h('div', {},
      h('p', { class: 'muted' }, 'Selecciona uno o varios archivos a la vez (puedes elegir todos los de la semana). El portal reconoce el tipo de cada uno:'),
      h('ul', { class: 'muted' }, h('li', {}, 'Abaton, equipos sin conexión (Polanco_26102026.xlsx): un renglón por dispositivo con falla. Valida las cifras del día, separa 12303 del universo en investigación y crea o actualiza un caso por dispositivo.'),
        h('li', {}, 'ISE, RADIUS Authentications (REPORTE_ISE_26_Octubre_Polanco.xlsx): un renglón por evento fallido. Se resume por código, piso y AP.')),
      h('p', { class: 'muted' }, 'La sede y el día salen de los datos y del nombre del archivo. Si vuelves a cargar el mismo día y sede, se reemplaza su detalle; los casos y su seguimiento se conservan.'),
      field('Archivos .xlsx', input), h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn', type: 'button', onclick: (e) => preview(e.currentTarget) }, 'Revisar archivos')), out), true);
  }

  /* =================== panel lateral =================== */
  let drawer = null, dirty = false;
  function openDrawer(title, body, wide) {
    closeDrawer(true);
    const titleEl = h('h2', { id: 'cx-d-title' }, title);
    const panel = h('aside', { class: 'mon-drawer no-print' + (wide ? ' is-wide' : ''), role: 'dialog', 'aria-labelledby': 'cx-d-title' },
      h('header', { class: 'mon-dhead' }, titleEl, h('button', { class: 'mon-dclose', type: 'button', 'aria-label': 'Cerrar panel', onclick: () => closeDrawer() }, '✕')), h('div', { class: 'mon-dbody' }, body));
    document.body.append(panel); document.body.classList.add('mon-drawer-open');
    drawer = { panel, titleEl }; return drawer;
  }
  function refreshAll() { state.stale = true; window.Portal.route(); }
  function closeDrawer(silent) { if (!drawer) return; drawer.panel.remove(); drawer = null; document.body.classList.remove('mon-drawer-open'); if (!silent && dirty) { dirty = false; refreshAll(); } }
  const saved = (msg) => { toast(msg); dirty = true; closeDrawer(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); });
  window.addEventListener('hashchange', () => { if (drawer) closeDrawer(true); dirty = false; });
  let uid = 0;
  const ctl = (tag, attrs, ...k) => h(tag, { id: 'cx-f-' + (++uid), ...attrs }, ...k);
  const field = (label, control, extra, opt) => h('div', { class: 'field' }, h('label', { for: control.id }, label, opt ? h('span', { class: 'optional' }, ' (opcional)') : null), control, extra || null);
  const sel = (opts, value, attrs = {}) => ctl('select', attrs, h('option', { value: '' }, 'Selecciona…'), opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  const errBox = () => h('p', { class: 'form-error', role: 'alert', hidden: true });
  const showErr = (box, msg) => { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); };
  const num = (v) => ctl('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: v ?? '' });

  /* ---------- capturar un día ---------- */
  function openCaptura(pre) {
    const sede = sel(X.SEDES.map((s) => [s.key, s.name]), pre ? pre.sede : view.sede); const fecha = ctl('input', { type: 'date', value: pre ? pre.fecha : D.hoy, max: D.hoy });
    const grid = h('div', {}); const err = errBox(); const inputs = {};
    const drawGrid = () => {
      grid.textContent = '';
      for (const ssid of X.SSIDS) {
        const prev = D.lecturas.find((r) => r.sede === sede.value && r.fecha === fecha.value && r.ssid === ssid);
        const x = inputs[ssid] = { disp: num(prev ? prev.dispositivos : ''), ok: num(prev ? prev.exitosos : ''), fail: num(prev ? prev.fallidos : ''), auth: num(prev ? prev.auth12303 : '') };
        const res = h('p', { class: 'meta' });
        const calc = () => { const d = Number(x.disp.value), o = Number(x.ok.value), f = x.fail.value === '' ? d - o : Number(x.fail.value), a = Number(x.auth.value || 0);
          res.textContent = d && x.ok.value !== '' ? `${nf((o / d) * 100, 1)}% exitosos · ${f - a} en investigación (${nf(((f - a) / d) * 100, 2)}%)${o + f !== d ? ' · exitosos + fallidos no suman el total' : ''}` : ''; };
        Object.values(x).forEach((i) => i.addEventListener('input', calc)); calc();
        grid.append(h('fieldset', { class: 'mon-fs' }, h('legend', {}, ssid + (prev ? ' · ya capturado, se actualizará' : '')),
          h('div', { class: 'mon-g2' }, field('Total de dispositivos', x.disp), field('Total exitosos', x.ok)), h('div', { class: 'mon-g2' }, field('Total fallidos', x.fail, null, true), field('ID Authentication 12303', x.auth)), res));
      }
    };
    sede.addEventListener('change', drawGrid); fecha.addEventListener('change', drawGrid);
    const save = async (btn) => {
      const lecturas = X.SSIDS.map((ssid) => ({ ssid, dispositivos: inputs[ssid].disp.value, exitosos: inputs[ssid].ok.value, fallidos: inputs[ssid].fail.value, auth12303: inputs[ssid].auth.value })).filter((r) => r.dispositivos !== '' || r.exitosos !== '');
      if (!sede.value) return showErr(err, 'Selecciona la sede.');
      if (!lecturas.length) return showErr(err, 'Captura al menos un SSID.');
      btn.disabled = true;
      try { const r = await api('POST', '/api/conexiones/lecturas', { sede: sede.value, fecha: fecha.value, lecturas }); view.tab = 'registro'; saved(`Lecturas guardadas: ${r.nuevas} nuevas, ${r.actualizadas} actualizadas${r.avisos.length ? ' (fallidos recalculados)' : ''}`); } catch (e) { showErr(err, e.message); btn.disabled = false; }
    };
    openDrawer(pre ? 'Corregir lectura' : 'Capturar día', h('div', { class: 'mon-form' },
      h('p', { class: 'muted' }, 'Captura los totales del día por SSID. Si dejas fallidos vacío se calcula como total − exitosos. Investigación = fallidos − ID Authentication 12303.'),
      h('div', { class: 'mon-g2' }, field('Sede', sede), field('Fecha', fecha)), grid, err,
      h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar'), h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar'))));
    drawGrid();
  }

  /* ---------- cargar Excel ---------- */
  function openExcel() {
    const input = ctl('input', { type: 'file', accept: '.xlsx' }); const out = h('div', {});
    const send = async (modo) => {
      const f = input.files[0]; if (!f) { toast('Selecciona el archivo.', 'error'); return null; }
      const res = await fetch(`/api/conexiones/importar?modo=${modo}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: f });
      const r = await res.json().catch(() => ({})); if (!res.ok) throw new Error(r.error || 'No se pudo leer el archivo.'); return r;
    };
    const preview = async () => {
      try {
        const r = await send('vista'); if (!r) return;
        out.textContent = '';
        out.append(h('p', { class: 'notice' }, h('strong', {}, `${r.nuevas} lecturas nuevas`), `, ${r.actualizadas} que cambian y ${r.sinCambio} sin cambio. Nada se guarda hasta que confirmes.`),
          h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hoja'), h('th', {}, 'Sede · SSID'), h('th', { class: 'num-col' }, 'Días'))),
            h('tbody', {}, r.hojas.map((x) => h('tr', {}, h('td', {}, x.hoja, x.nota ? h('span', { class: 'meta' }, x.nota) : null), h('td', {}, x.sede ? `${x.sede} · ${x.ssid}` : '—'), h('td', { class: 'num-col plain' }, x.filas))))),
          r.errores.length ? h('div', { class: 'notice fw-alert' }, h('strong', {}, `${r.errores.length} errores: `), h('ul', {}, r.errores.slice(0, 20).map((e) => h('li', {}, e)))) : null,
          r.avisos.length ? h('details', { class: 'section' }, h('summary', {}, `${r.avisos.length} avisos`), h('div', { class: 'section-body' }, h('ul', {}, r.avisos.map((a) => h('li', {}, a))))) : null,
          r.cambios.length ? h('details', { class: 'section' }, h('summary', {}, 'Lecturas que cambian'), h('div', { class: 'section-body' }, h('ul', {}, r.cambios.map((a) => h('li', {}, a))))) : null,
          h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !!r.errores.length || !(r.nuevas + r.actualizadas), onclick: async (e) => { e.currentTarget.disabled = true; try { const x = await send('guardar'); view.tab = 'registro'; view.desde = null; view.hasta = null; saved(`Excel cargado: ${x.nuevas} nuevas y ${x.actualizadas} actualizadas`); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, `Guardar ${r.nuevas + r.actualizadas} lecturas`)));
      } catch (e) { toast(e.message, 'error'); }
    };
    openDrawer('Cargar Excel de conexiones', h('div', {},
      h('p', { class: 'muted' }, 'Formato del ejercicio: una hoja por sede (Reforma, Polanco…), título con el SSID y un renglón por día con Fecha, Total dispositivos, Total exitosos, Total fallidos e ID Authentication 12303. El renglón "Promedio" se ignora: el portal calcula sus propios totales.'),
      field('Archivo de Excel', input), h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn', type: 'button', onclick: preview }, 'Revisar archivo')), out), true);
  }

  /* ---------- casos ---------- */
  function openCaso(_, lect) {
    const f = { sede: sel(X.SEDES.map((s) => [s.key, s.name]), lect ? lect.sede : view.sede), fecha: ctl('input', { type: 'date', value: lect ? lect.fecha : D.hoy, max: D.hoy }), ssid: sel(X.SSIDS.map((s) => [s, s]), lect ? lect.ssid : 'BBVA_GLOBAL'),
      user: ctl('input', { placeholder: 'MI02818', autocomplete: 'off' }), nombre: ctl('input', { placeholder: 'Nombre del usuario' }), mac: ctl('input', { class: 'mono', placeholder: '58:ce:2a:b4:82:d7' }), ap: ctl('input', { placeholder: 'AP-…' }),
      causa: ctl('input', { list: 'cx-dl-causas', placeholder: 'Por determinar', autocomplete: 'off' }), codigo: ctl('input', { placeholder: 'Código RADIUS/ISE (opcional)', maxlength: 20 }),
      estado: sel(X.ESTADOS.map((e) => [e.key, e.label]), 'nuevo'), com: ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Qué se encontró o qué se hizo.' }), accion: ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Siguiente acción y responsable.' }),
      ing: isAdmin() ? sel(D.ingenieros.map((u) => [u.id, u.name]), state.user.id) : null };
    const err = errBox();
    const save = async (btn) => {
      btn.disabled = true;
      try { await api('POST', '/api/conexiones/casos', { sede: f.sede.value, fecha: f.fecha.value, ssid: f.ssid.value, username: f.user.value, nombre: f.nombre.value, dispositivo: f.mac.value, ap: f.ap.value, causa: f.causa.value, codigo: f.codigo.value, estado: f.estado.value, comentario: f.com.value, accion: f.accion.value, ingenieroId: f.ing ? f.ing.value : undefined });
        view.tab = 'investigacion'; saved('Caso registrado'); } catch (e) { showErr(err, e.message); btn.disabled = false; }
    };
    openDrawer('Registrar caso en investigación', h('div', { class: 'mon-form' },
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Conexión'), h('div', { class: 'mon-g2' }, field('Sede', f.sede), field('Fecha', f.fecha)), h('div', { class: 'mon-g2' }, field('SSID', f.ssid), field('AP', f.ap, null, true))),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Usuario o equipo'), h('div', { class: 'mon-g2' }, field('Username', f.user), field('Nombre', f.nombre, null, true)), field('MAC o equipo', f.mac)),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Investigación'), field('Causa', f.causa, h('datalist', { id: 'cx-dl-causas' }, [...new Set([...X.CAUSAS, ...D.casos.map((c) => c.causa).filter(Boolean)])].map((c) => h('option', { value: c }))), true),
        field('Código de falla', f.codigo, null, true), h('div', { class: 'mon-g2' }, field('Estado', f.estado), f.ing ? field('Ingeniero', f.ing) : h('p', { class: 'meta' }, `Atiende: ${state.user.name}`)), field('Comentario', f.com, null, true), field('Siguiente acción', f.accion, null, true)),
      err, h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar caso'), h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar'))));
  }

  function openSeguimiento(c) {
    const est = sel(X.ESTADOS.map((e) => [e.key, e.label]), c.estado); const nota = ctl('textarea', { rows: 2, maxlength: 2000, placeholder: 'Qué se hizo o qué respondió el usuario' });
    const causa = ctl('input', { list: 'cx-dl-causas2', value: c.causa || '' }); const accion = ctl('textarea', { rows: 2, maxlength: 2000 }); accion.value = c.accion || '';
    const ing = isAdmin() ? sel(D.ingenieros.map((u) => [u.id, u.name]), c.ingenieroId) : null; const err = errBox();
    const save = async (btn) => { btn.disabled = true; try { await api('PUT', `/api/conexiones/casos/${c.id}`, { estado: est.value, nota: nota.value, causa: causa.value, accion: accion.value, ...(ing ? { ingenieroId: ing.value || null } : {}) }); saved('Seguimiento guardado'); } catch (e) { showErr(err, e.message); btn.disabled = false; } };
    const tomar = !c.ingenieroId && canWrite() && !isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('PUT', `/api/conexiones/casos/${c.id}`, { ingenieroId: state.user.id }); saved('Tomaste el caso'); } catch (x) { showErr(err, x.message); } } }, 'Tomar caso') : null;
    const del = isAdmin() || c.createdBy === state.user.id ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/conexiones/casos/${c.id}`); saved('Caso eliminado'); }) }, 'Eliminar caso') : null;
    openDrawer(c.nombre || c.username || c.dispositivo || 'Caso', h('div', {},
      h('div', { class: 'mon-fsum' }, estPill(c.estado), h('span', { class: 'muted' }, `${fullDate(c.fecha)} · ${sedeN(c.sede)}`)),
      c.prioridad ? h('p', { class: 'meta' }, prPill(c.prioridad), ' ', X.PRIORIDAD[c.prioridad].hint) : null,
      h('dl', { class: 'mon-dl' }, [['Username', c.username], ['MAC o equipo', c.dispositivo], ['SSID', c.ssid], ['AP', c.ap], ['Código ISE', c.codigo ? `${c.codigo}${X.ISE[c.codigo] ? ' · ' + X.ISE[c.codigo] : ''}` : null],
        ['Días con falla', c.detalle && c.detalle.dias ? c.detalle.dias.map((d) => dayMonth(d)).join(', ') + ` (${nint(c.fallos)} ${c.fallos === 1 ? 'fallo' : 'fallos'})` : null], ['Tipos de falla', c.detalle && c.detalle.tipos], ['Motivo', c.detalle && c.detalle.motivo],
        ['Equipo', c.detalle ? [c.detalle.equipo, c.detalle.fabricante, c.detalle.so].filter(Boolean).join(' · ') : null], ['Identidad RADIUS', c.detalle && c.detalle.identidad],
        ['Última conexión exitosa', c.detalle && c.detalle.ultimaOk ? ddmm(c.detalle.ultimaOk + ':00') : null], ['AP con fallos', c.detalle && c.detalle.aps], ['Atiende', c.ingeniero || 'Sin asignar'], ['Último comentario', c.comentario]].filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      canWrite() ? h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Actualizar seguimiento'), field('Nuevo estado', est), field('Comentario', nota, null, true),
        field('Causa', causa, h('datalist', { id: 'cx-dl-causas2' }, X.CAUSAS.map((x) => h('option', { value: x }))), true), field('Siguiente acción', accion, null, true), ing ? field('Ingeniero', ing) : null, err,
        h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => save(e.currentTarget) }, 'Guardar seguimiento'), tomar, del)) : null,
      h('h3', { class: 'mon-dh3' }, 'Historial'), h('ol', { class: 'timeline mon-hist' }, c.historial.slice().reverse().map((x) => h('li', { class: 'tl-item' }, h('span', { class: 'tl-when' }, `${ddmm(x.ts)} · ${x.user}`, x.estado ? estPill(x.estado) : null), x.nota ? h('span', { class: 'tl-text' }, x.nota) : null)))), true);
  }

  // el PDF siempre es el reporte ejecutivo
  let prevTab = null;
  window.addEventListener('beforeprint', () => { if (root?.isConnected && view.tab !== 'resumen') { prevTab = view.tab; view.tab = 'resumen'; render(); } });
  window.addEventListener('afterprint', () => { if (prevTab && root?.isConnected) { view.tab = prevTab; prevTab = null; render(); } });

  window.PortalConexiones = {
    exportItems: () => [
      { label: 'Semanal por sede (Excel CSV)', hint: '% exitosos, 12303 e investigación por semana y sede', href: '/api/conexiones/export/semanal.csv' },
      { label: 'Lecturas diarias (Excel CSV)', hint: 'Un renglón por día, sede y SSID', href: '/api/conexiones/export/lecturas.csv' },
      { label: 'Casos en investigación (Excel CSV)', hint: 'Usuario, causa, estado y acción', href: '/api/conexiones/export/casos.csv' },
    ],
    async mount(el, ext) {
      root = el; EXT = { resumen: (ext?.resumen || []).filter(Boolean), acerca: (ext?.acerca || []).filter(Boolean), draw: ext?.draw };
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando el monitoreo 2.0…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    nuevo(kind) { if (!D) return; if (kind === 'excel') openExcel(); else if (kind === 'detalle') openDetalle(); else if (kind === 'caso') openCaso(); else openCaptura(); },
  };
})();
