'use strict';
/* Monitoreo proactivo de indicadores clave.
   Página por pestañas (Resumen para BBVA · Casos · Pendientes · Acerca de la iniciativa) y captura en un panel lateral, un caso a la vez. */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const M = window.PortalMonitoreoComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const FILL = { exito: '#3a9a6a', cita: '#3f74c0', sin_respuesta: '#d9a23a', sin_datos: '#a9aaae', no_identificado: '#c5c6c9', pendiente: '#dcdcd8' };
  const TABS = [['resumen', 'Resumen para BBVA'], ['casos', 'Casos'], ['pendientes', 'Pendientes de seguimiento'], ['acerca', 'Acerca de la iniciativa']];
  const view = { desde: null, hasta: null, sede: '', estado: '', q: '', limit: 50, tab: 'resumen', quien: null };
  let root = null, CAT = null, DATA = null, PEND = null, EXT = { resumen: [], acerca: [] };

  const estadoPill = (k) => h('span', { class: 'pill pill-' + M.ESTADO[k].cls + ' mon-pill' }, h('i', { class: 'mon-dot', style: `background:${FILL[k]}` }), M.ESTADO[k].short);
  const short = (s) => String(s || '').replace(/^BBVA\s+/i, '');
  const fallaCorta = (k) => String(k || '').replace('RADIUS authentication rejected by server', 'RADIUS: autenticación rechazada').replace('EAPOL: Timeout waiting for client EAP response', 'EAPOL: el cliente no responde').replace('Previous authentication no longer valid', 'Autenticación previa vencida');
  const stack = (counts, total) => h('div', { class: 'mon-stack', role: 'img', 'aria-label': M.ESTADOS.map((e) => `${e.short}: ${counts[e.key] || 0}`).join(', ') },
    M.ESTADOS.map((e) => (counts[e.key] ? h('span', { style: `flex:${counts[e.key]};background:${FILL[e.key]}`, title: `${e.label}: ${counts[e.key]} (${pct(counts[e.key], total)}%)` }) : null)));
  const tally = (list) => { const c = Object.fromEntries(M.ESTADOS.map((e) => [e.key, 0])); list.forEach((x) => { c[x.estado] += 1; }); return c; };
  const ddmm = (ts) => `${ts.slice(0, 10).split('-').reverse().join('/')} ${ts.slice(11, 16)}`;

  async function reload() {
    if (!CAT) CAT = await api('GET', '/api/monitoreo/catalogo');
    if (!view.hasta) { view.hasta = todayStr(); view.desde = addDays(view.hasta, -27); }
    [DATA, PEND] = await Promise.all([api('GET', `/api/monitoreo/casos?desde=${view.desde}&hasta=${view.hasta}`), api('GET', '/api/monitoreo/pendientes')]);
    render();
  }

  /* =================== página =================== */
  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const all = DATA.casos.filter((c) => !view.sede || String(c.sedeId) === view.sede);
    const sedeName = view.sede ? short(CAT.sedes.find((s) => String(s.id) === view.sede)?.name) : 'Todas las sedes';

    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, `Monitoreo proactivo · ${sedeName}`), h('p', {}, `Periodo: ${fullDate(view.desde)} – ${fullDate(view.hasta)}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));

    // pestañas
    const mine = PEND.casos.filter((c) => c.ingenieroId === state.user.id).length;
    const count = { casos: all.length, pendientes: PEND.casos.filter((c) => !view.sede || String(c.sedeId) === view.sede).length };
    push(h('div', { class: 'mon-tabbar no-print', role: 'tablist' }, TABS.map(([k, t]) => h('button', {
      class: 'mon-tab' + (view.tab === k ? ' is-active' : ''), role: 'tab', type: 'button', 'aria-selected': String(view.tab === k),
      onclick: () => { view.tab = k; render(); } }, t, count[k] !== undefined ? h('span', { class: 'mon-tcount' }, nf(count[k])) : null,
      k === 'pendientes' && mine ? h('span', { class: 'badge' }, `${mine} míos`) : null))));

    // filtros (no aplican a "Acerca de")
    if (view.tab !== 'acerca') {
      const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key], max: todayStr(), onchange: (e) => { if (!e.target.value) return; view[key] = e.target.value; if (view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; reload(); } }));
      const rapido = [['Esta semana', 'w'], ['4 semanas', 28], ['3 meses', 90], ['Todo', 0]];
      push(h('div', { class: 'mon-filters no-print' },
        view.tab !== 'pendientes' ? [dateInput('mon-desde', 'Desde', 'desde'), dateInput('mon-hasta', 'Hasta', 'hasta'),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' }, rapido.map(([t, n]) => h('button', { class: 'tab', type: 'button', onclick: () => { view.hasta = todayStr(); view.desde = n === 'w' ? mondayOf(view.hasta) : n ? addDays(view.hasta, -(n - 1)) : (CAT.rango.min || view.hasta); reload(); } }, t))))] : null,
        h('div', { class: 'field' }, h('label', { for: 'mon-sede' }, 'Sede'), h('select', { id: 'mon-sede', onchange: (e) => { view.sede = e.target.value; view.limit = 50; render(); } }, h('option', { value: '' }, 'Todas las sedes'), CAT.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === view.sede }, short(s.name))))),
        h('p', { class: 'muted mon-range' }, view.tab === 'pendientes' ? 'Los pendientes incluyen casos de cualquier fecha.' : CAT.rango.n ? `${nf(CAT.rango.n)} casos registrados en total, del ${dayMonth(CAT.rango.min)} al ${fullDate(CAT.rango.max)}.` : 'Aún no hay casos registrados.')));
    }

    if (view.tab === 'resumen') push(resumen(all, sedeName));
    else if (view.tab === 'casos') push(casosTab(all));
    else if (view.tab === 'pendientes') push(pendingPanel());
    else push(EXT.acerca);
    root.append(...kids);
    if (view.tab === 'resumen' && EXT.draw) EXT.draw();
  }

  /* ---------- Resumen para BBVA ---------- */
  /* Métrica del periodo: sale de los mismos casos que el embudo, con las mismas fechas y sede. */
  function periodoTrio(all, sedeName) {
    const T = tally(all);
    const contactados = T.exito + T.cita + T.sin_respuesta;
    const k = (state.data.initiatives.find((i) => i.slug === 'monitoreo')?.kpis || []).find((x) => x.key === 'contactados') || {};
    const porSemana = Number.isFinite(k.target) ? k.target : 25;
    const semanas = Math.round((Date.parse(mondayOf(view.hasta)) - Date.parse(mondayOf(view.desde))) / (7 * 864e5)) + 1;
    const meta = porSemana * semanas;
    const ok = contactados >= meta;
    const periodo = view.desde === view.hasta ? fullDate(view.desde) : `${dayMonth(view.desde)} – ${fullDate(view.hasta)}`;
    const item = (label, num, unit, cls) => h('div', { class: 'trio-item' + (cls ? ' ' + cls : '') }, h('span', { class: 'trio-label' }, label), h('span', { class: 'trio-num' }, num), h('span', { class: 'trio-unit' }, unit));
    return h('div', { class: 'mon-trio' },
      h('p', { class: 'kpi-caption' }, `Usuarios contactados en el periodo · ${sedeName}`),
      h('div', { class: 'trio' },
        item('Métrica inicial', nf(k.baseline ?? 0), 'usuarios contactados por semana al inicio del programa'),
        item('Métrica actual', nf(contactados), `usuarios contactados · ${periodo}`, 'trio-current'),
        item('Métrica objetivo', nf(meta), `${nf(porSemana)} por semana × ${semanas} ${semanas === 1 ? 'semana' : 'semanas'}`)),
      h('p', { class: 'facts' }, h('span', { class: 'pill pill-' + (ok ? 'good' : 'warn') }, ok ? 'Meta del periodo cumplida' : `Faltan ${nf(meta - contactados)} para la meta del periodo`),
        ' Contactados = atendidos con éxito + cita agendada + sin respuesta. Son los mismos casos del nivel 1.'),
      h('div', { class: 'others' },
        h('div', { class: 'other' }, h('span', { class: 'other-label' }, 'Atendidos con éxito'), h('span', { class: 'other-num' }, `${nf(T.exito)} usuarios`)),
        h('div', { class: 'other' }, h('span', { class: 'other-label' }, 'En espera (cita o sin respuesta)'), h('span', { class: 'other-num' }, `${nf(T.cita + T.sin_respuesta)} usuarios`))));
  }

  function resumen(all, sedeName) {
    const out = [periodoTrio(all, sedeName)];
    if (!all.length) {
      out.push(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No hay casos en este periodo. Amplía las fechas o registra un caso.')));
      out.push(...EXT.resumen.slice(1));
      return out;
    }
    // nivel 1: resultado del periodo
    const T = tally(all), N = all.length;
    const identificados = N - T.sin_datos - T.no_identificado, contactados = T.exito + T.cita + T.sin_respuesta;
    const funnel = [['Usuarios revisados', N, 'Detectados en Meraki con intentos fallidos'], ['Con datos de contacto', identificados, `${nf(T.sin_datos)} sin datos para contactar · ${nf(T.no_identificado)} no identificados`],
      ['Contactados', contactados, `${nf(T.pendiente)} por contactar`], ['Atendidos con éxito', T.exito, `${nf(T.cita)} con cita · ${nf(T.sin_respuesta)} sin respuesta`]];
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Nivel 1 · Resultado del periodo · ${sedeName}`),
      h('div', { class: 'mon-l1' },
        h('div', { class: 'mon-funnel' }, funnel.map(([t, v, sub], i) => h('div', { class: 'mon-fstep' },
          h('div', { class: 'mon-fhead' }, h('span', { class: 'mon-flabel' }, t), h('span', { class: 'mon-fnum' }, nf(v)), i ? h('span', { class: 'mon-fpct' }, `${pct(v, N)}%`) : null),
          h('div', { class: 'mon-fbar' }, h('span', { style: `width:${Math.max(2, (v / N) * 100)}%;background:${['#2a2b2e', '#505155', '#3f74c0', '#3a9a6a'][i]}` })),
          h('span', { class: 'mon-fsub' }, sub)))),
        h('div', { class: 'mon-kpis' },
          h('div', { class: 'tile mon-kpi-main' }, h('span', { class: 'tile-label' }, 'Efectividad'), h('span', { class: 'tile-num' }, contactados ? `${pct(T.exito, contactados)}%` : '—'), h('span', { class: 'tile-sub' }, `de los contactados quedaron atendidos con éxito (${nf(T.exito)} de ${nf(contactados)})`)),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Requieren seguimiento'), h('span', { class: 'tile-num' }, nf(T.cita + T.sin_respuesta + T.pendiente)), h('span', { class: 'tile-sub' }, `${nf(T.cita)} con cita, ${nf(T.sin_respuesta)} sin respuesta y ${nf(T.pendiente)} por contactar`)))),
      h('p', { class: 'legend mon-legend' }, M.ESTADOS.map((e) => h('span', {}, h('i', { class: 'mon-dot', style: `background:${FILL[e.key]}` }), `${e.label}: ${nf(T[e.key])}`)))));

    // nivel 2: por sede
    const bySede = CAT.sedes.map((s) => { const l = DATA.casos.filter((c) => c.sedeId === s.id); const t = tally(l); const ct = t.exito + t.cita + t.sin_respuesta; return { s, n: l.length, t, ct }; }).filter((x) => x.n).sort((a, b) => b.n - a.n);
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 2 · Por sede'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-sedes' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Revisados'), h('th', { class: 'num-col' }, 'Contactados'), h('th', { class: 'num-col' }, 'Éxito'), h('th', { class: 'num-col' }, 'Efectividad'), h('th', { class: 'mon-col-stack' }, 'Estado de los casos'))),
        h('tbody', {}, bySede.map(({ s, n, t, ct }) => h('tr', { class: String(s.id) === view.sede ? 'is-selected' : '' },
          h('td', {}, h('button', { class: 'link-btn mon-sede-btn', type: 'button', title: 'Ver solo esta sede', onclick: () => { view.sede = String(s.id) === view.sede ? '' : String(s.id); render(); } }, short(s.name))),
          h('td', { class: 'num-col plain' }, nf(n)), h('td', { class: 'num-col plain' }, nf(ct)), h('td', { class: 'num-col plain' }, nf(t.exito)),
          h('td', { class: 'num-col plain' }, ct ? `${pct(t.exito, ct)}%` : '—'), h('td', { class: 'mon-col-stack' }, stack(t, n)))))))));

    // nivel 3: causas, AP y reincidencias
    const group = (key) => { const m = new Map(); all.forEach((c) => { const k = c[key] || 'Sin dato'; const x = m.get(k) || { k, n: 0, list: [] }; x.n += 1; x.list.push(c); m.set(k, x); }); return [...m.values()].sort((a, b) => b.n - a.n); };
    const causas = group('falla').slice(0, 8), aps = group('ap').slice(0, 8);
    const maxC = Math.max(...causas.map((c) => c.n)), maxA = Math.max(...aps.map((c) => c.n));
    const hbar = (rows, max, label) => h('div', { class: 'mon-hbars' }, rows.map((r) => h('div', { class: 'mon-hrow' },
      h('span', { class: 'mon-hlabel', title: r.k }, label(r.k)), h('div', { class: 'mon-htrack' }, h('div', { style: `width:${(r.n / max) * 100}%` }, stack(tally(r.list), r.n))), h('span', { class: 'mon-hnum' }, nf(r.n)))));
    const who = (c) => (c.nombre ? M.nameKey(c.nombre) : '') || c.username || c.dispositivo;
    const reinc = all.filter((c) => c.otros > 0 && !/anonymous/i.test(`${c.nombre || ''} ${c.username || ''}`));
    const reincUsers = [...new Map(reinc.map((c) => [who(c), c])).values()].sort((a, b) => b.otros - a.otros).slice(0, 8);
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Nivel 3 · Causas y puntos de atención · ${sedeName}`),
      h('div', { class: 'mon-l3' },
        h('div', {}, h('h3', {}, 'Tipo de falla detectada'), hbar(causas, maxC, fallaCorta)),
        h('div', {}, h('h3', {}, 'AP con más casos'), hbar(aps, maxA, (k) => k)),
        h('div', {}, h('h3', {}, `Usuarios reincidentes (${nf(new Set(reinc.map(who)).size)})`),
          reincUsers.length ? h('ul', { class: 'mon-reinc' }, reincUsers.map((c) => h('li', {}, h('strong', {}, c.nombre || c.username || c.dispositivo), h('span', { class: 'muted' }, ` · ${c.otros + 1} casos · ${short(c.sede)}`)))) : h('p', { class: 'muted' }, 'Ningún usuario se repite en el periodo.'))),
      h('p', { class: 'legend' }, h('span', { class: 'muted' }, 'Los colores de las barras son el estado de los casos, igual que en el nivel 1.'))));
    out.push(...EXT.resumen.slice(1));
    return out;
  }

  /* ---------- Casos ---------- */
  function casosTab(all) {
    const T = tally(all);
    const q = M.plain(view.q);
    const list = all.filter((c) => (!view.estado || c.estado === view.estado) && (!q || M.plain([c.username, c.nombre, c.dispositivo, c.ap, c.comentario, c.falla].join(' ')).includes(q)));
    const tbody = h('tbody', {}, list.slice(0, view.limit).map((c) => caseRow(c)));
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, `Casos del periodo (${nf(list.length)})`),
        h('div', { class: 'mon-tools no-print' },
          h('input', { type: 'search', placeholder: 'Buscar usuario, MAC, AP, falla o comentario', value: view.q, 'aria-label': 'Buscar caso', oninput: (e) => { view.q = e.target.value; clearTimeout(view.t); view.t = setTimeout(() => { render(); const i = root.querySelector('.mon-tools input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }),
          h('select', { 'aria-label': 'Filtrar por estado', onchange: (e) => { view.estado = e.target.value; render(); } }, h('option', { value: '' }, 'Todos los estados'), M.ESTADOS.map((e) => h('option', { value: e.key, selected: view.estado === e.key }, `${e.label} (${T[e.key]})`))))),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-casos' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Usuario'), h('th', {}, 'Dispositivo y falla'), h('th', {}, 'AP'), h('th', {}, 'Estado'), h('th', {}, 'Último comentario'), h('th', { class: 'no-print' }, ''))), tbody))
        : h('p', { class: 'empty' }, 'Ningún caso coincide con la búsqueda.'),
      list.length > view.limit ? h('button', { class: 'btn no-print', type: 'button', onclick: () => { view.limit += 100; render(); } }, `Ver ${Math.min(100, list.length - view.limit)} casos más`) : null);
  }

  function caseRow(c) {
    return h('tr', {},
      h('td', { class: 'nowrap' }, h('strong', {}, dayMonth(c.fecha)), h('span', { class: 'meta' }, short(c.sede))),
      h('td', { class: 'mon-c-user' }, h('strong', {}, c.nombre || 'Sin nombre'), h('span', { class: 'meta' }, c.username || '—', c.otros ? h('span', { class: 'tag mon-tag' }, `${c.otros + 1} casos`) : null)),
      h('td', {}, h('span', { class: 'mono' }, c.dispositivo || '—'), h('span', { class: 'meta mon-clip', title: c.falla || '' }, `${c.falla ? fallaCorta(c.falla) : 'Falla sin dato'}${c.intentos ? ` · ${nf(c.intentos)} int.` : ''}`)),
      h('td', { class: 'nowrap' }, c.ap || '—', c.evento ? h('span', { class: 'meta' }, `${dayMonth(c.evento.slice(0, 10))} ${c.evento.slice(11, 16)}`) : null),
      h('td', {}, estadoPill(c.estado)),
      h('td', { class: 'detail-col' }, h('span', { class: 'mon-clip2' }, c.comentario || h('span', { class: 'muted' }, 'Sin comentario')), h('span', { class: 'meta' }, c.ingeniero ? `Atiende: ${c.ingeniero}` : c.origen === 'historico' ? 'Histórico del Excel' : '')),
      h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => openFollow(c) }, canWrite() ? 'Seguimiento' : 'Ver')));
  }

  /* ---------- Pendientes ---------- */
  function pendingPanel() {
    if (view.quien === null) view.quien = isAdmin() ? 'todos' : 'mios';
    const dias = (c) => Math.max(0, Math.round((Date.parse(todayStr()) - Date.parse(c.fecha)) / 864e5));
    const base = PEND.casos.filter((c) => !view.sede || String(c.sedeId) === view.sede);
    let list = base;
    if (view.quien === 'mios') list = list.filter((c) => c.ingenieroId === state.user.id);
    if (view.quien === 'libres') list = list.filter((c) => !c.ingenieroId);
    const T = tally(list);
    const groups = new Map();
    list.forEach((c) => { const k = c.ingeniero || 'Sin asignar'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    const order = [...groups.keys()].sort((a, b) => (a === 'Sin asignar') - (b === 'Sin asignar') || groups.get(b).length - groups.get(a).length);
    const assign = (c, to) => api('PUT', `/api/monitoreo/casos/${c.id}`, { ingenieroId: to }).then(() => { toast(to ? 'Caso asignado' : 'Caso liberado'); return reload(); }).catch((e) => toast(e.message, 'error'));
    const row = (c) => {
      const d = dias(c);
      return h('tr', {},
        h('td', { class: 'num-col' }, h('span', { class: 'mon-age ' + (d > 14 ? 'is-crit' : d > 7 ? 'is-warn' : '') }, `${d} d`)),
        h('td', { class: 'nowrap' }, dayMonth(c.fecha), h('span', { class: 'meta' }, short(c.sede))),
        h('td', { class: 'mon-c-user' }, h('strong', {}, c.nombre || 'Sin nombre'), h('span', { class: 'meta' }, c.username || c.dispositivo || '—', c.otros ? h('span', { class: 'tag mon-tag' }, `${c.otros + 1} casos`) : null)),
        h('td', {}, estadoPill(c.estado), h('span', { class: 'meta mon-clip' }, fallaCorta(c.falla))),
        h('td', { class: 'detail-col' }, h('span', { class: 'mon-clip2' }, c.comentario || h('span', { class: 'muted' }, 'Sin comentario')), h('span', { class: 'meta' }, c.ultimo ? `Último movimiento: ${c.ultimo.slice(0, 10).split('-').reverse().join('/')}` : '')),
        h('td', { class: 'actions no-print' },
          canWrite() ? h('button', { class: 'link-btn', type: 'button', onclick: () => openFollow(c) }, 'Seguimiento') : null,
          !c.ingenieroId && canWrite() && !isAdmin() ? h('button', { class: 'link-btn', type: 'button', onclick: () => assign(c, state.user.id) }, 'Tomar caso') : null,
          isAdmin() ? h('select', { class: 'mon-assign', 'aria-label': 'Asignar a', onchange: (e) => assign(c, e.target.value ? Number(e.target.value) : null) },
            h('option', { value: '' }, 'Sin asignar'), CAT.ingenieros.map((u) => h('option', { value: u.id, selected: u.id === c.ingenieroId }, u.name))) : null));
    };
    const quien = (k, t) => h('button', { class: 'tab' + (view.quien === k ? ' is-active' : ''), type: 'button', onclick: () => { view.quien = k; render(); } }, t);
    return h('section', { class: 'panel mon-level' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Pendientes de seguimiento (${nf(list.length)})`),
        h('p', { class: 'muted' }, 'Casos por contactar, con cita o sin respuesta. Los más antiguos primero. Los casos sin datos o no identificados no se listan.')),
        h('div', { class: 'tabs' }, quien('mios', `Mis casos (${base.filter((c) => c.ingenieroId === state.user.id).length})`), quien('libres', `Sin asignar (${base.filter((c) => !c.ingenieroId).length})`), quien('todos', `Todos (${base.length})`))),
      h('p', { class: 'legend mon-legend' }, ['pendiente', 'cita', 'sin_respuesta'].map((k) => h('span', {}, h('i', { class: 'mon-dot', style: `background:${FILL[k]}` }), `${M.ESTADO[k].label}: ${nf(T[k])}`)), h('span', { class: 'muted' }, 'Días desde la revisión: ámbar más de 7, rojo más de 14.')),
      list.length ? order.map((g) => h('div', { class: 'mon-group' }, h('h3', {}, `${g} · ${groups.get(g).length}`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-casos' }, h('thead', {}, h('tr', {}, h('th', { class: 'num-col' }, 'Abierto'), h('th', {}, 'Fecha'), h('th', {}, 'Usuario'), h('th', {}, 'Estado y falla'), h('th', {}, 'Último comentario'), h('th', { class: 'no-print' }, ''))),
          h('tbody', {}, groups.get(g).map(row))))))
        : h('p', { class: 'empty' }, view.quien === 'mios' ? 'No tienes casos pendientes asignados. Revisa la pestaña "Sin asignar".' : 'No hay casos pendientes.'));
  }

  /* =================== panel lateral =================== */
  let drawer = null, dirty = false;
  function openDrawer(title, body, wide) {
    closeDrawer(true);
    const titleEl = h('h2', { id: 'mon-d-title' }, title);
    const panel = h('aside', { class: 'mon-drawer no-print' + (wide ? ' is-wide' : ''), role: 'dialog', 'aria-labelledby': 'mon-d-title' },
      h('header', { class: 'mon-dhead' }, titleEl, h('button', { class: 'mon-dclose', type: 'button', 'aria-label': 'Cerrar panel', onclick: () => closeDrawer() }, '✕')),
      h('div', { class: 'mon-dbody' }, body));
    document.body.append(panel); document.body.classList.add('mon-drawer-open');
    drawer = { panel, titleEl };
    return drawer;
  }
  // vuelve a pedir los totales semanales y el estado de la iniciativa para que todo coincida
  function refreshAll() { CAT = null; state.stale = true; window.Portal.route(); }
  function closeDrawer(silent) {
    if (!drawer) return;
    drawer.panel.remove(); drawer = null; document.body.classList.remove('mon-drawer-open');
    if (!silent && dirty) { dirty = false; refreshAll(); }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer && !e.target.closest?.('.menu')) closeDrawer(); });
  window.addEventListener('hashchange', () => { if (drawer) closeDrawer(true); dirty = false; });

  const field = (label, control, extra) => h('div', { class: 'field' }, h('label', { for: control.id }, label), control, extra || null);

  /* ---------- nuevo caso, uno a la vez ---------- */
  const ctx = { sedeId: '', fecha: '', ingenieroId: '', ssid: 'BBVA_GLOBAL' };
  let queue = [], session = [];
  const blank = () => ({ username: '', nombre: '', mac: '', falla: '', intentos: '', ssid: ctx.ssid, ap: '', evento: '', estado: 'pendiente', comentario: '', auto: true });

  function openNuevo() {
    if (!ctx.fecha) ctx.fecha = todayStr();
    if (!ctx.sedeId) ctx.sedeId = view.sede || '';
    session = []; queue = [];
    const d = openDrawer('Nuevo caso', h('div', {}));
    drawForm(d, blank());
  }

  function drawForm(d, r) {
    const body = d.panel.querySelector('.mon-dbody');
    body.textContent = '';
    const done = session.filter((s) => s.q).length;
    d.titleEl.textContent = r.q ? `Caso pegado ${done + 1} de ${done + 1 + queue.length}` : 'Nuevo caso';
    const known = new Map(DATA.casos.filter((c) => c.dispositivo).map((c) => [c.dispositivo.toLowerCase(), c]));
    const id = (k) => 'mon-n-' + k;

    // revisión (se conserva entre casos)
    const sede = h('select', { id: id('sede'), onchange: (e) => { ctx.sedeId = e.target.value; apList(); } }, h('option', { value: '' }, 'Selecciona…'), CAT.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === String(ctx.sedeId) }, short(s.name))));
    const fecha = h('input', { id: id('fecha'), type: 'date', value: r.fecha || ctx.fecha, max: todayStr(), onchange: (e) => { ctx.fecha = e.target.value; r.fecha = e.target.value; } });
    const ing = isAdmin() ? h('select', { id: id('ing'), onchange: (e) => { ctx.ingenieroId = e.target.value; } }, CAT.ingenieros.map((u) => h('option', { value: u.id, selected: String(u.id) === String(ctx.ingenieroId || state.user.id) }, u.name))) : null;

    // dispositivo
    const apDl = h('datalist', { id: id('dl-ap') });
    const apList = () => { apDl.textContent = ''; CAT.aps.filter((a) => !ctx.sedeId || String(a.sedeId) === String(ctx.sedeId)).forEach((a) => apDl.append(h('option', { value: a.ap }))); };
    apList();
    const macHint = h('div', {});
    const macCheck = () => { macHint.textContent = ''; const p = r.mac && known.get(r.mac.trim().toLowerCase()); if (p) macHint.append(h('span', { class: 'meta warn-text' }, `Este equipo ya tuvo caso el ${dayMonth(p.fecha)} (${M.ESTADO[p.estado].short}).`)); };
    const mac = h('input', { id: id('mac'), class: 'mono', value: r.mac, placeholder: '58:ce:2a:b4:82:d7 o nombre del equipo', autocomplete: 'off', spellcheck: 'false', oninput: (e) => { r.mac = e.target.value; }, onchange: macCheck });
    const fallas = CAT.fallas.map((f) => f.k);
    const otra = r.falla && !fallas.includes(r.falla);
    const fallaTxt = h('input', { id: id('falla-txt'), value: otra ? r.falla : '', placeholder: 'Escribe la falla', hidden: !otra, oninput: (e) => { r.falla = e.target.value; } });
    const falla = h('select', { id: id('falla'), onchange: (e) => { const v = e.target.value; if (v === '__otra') { r.falla = ''; fallaTxt.hidden = false; fallaTxt.value = ''; fallaTxt.focus(); } else { r.falla = v; fallaTxt.hidden = true; } } },
      h('option', { value: '', selected: !r.falla }, 'Selecciona…'),
      CAT.fallas.map((f) => h('option', { value: f.k, selected: f.k === r.falla }, f.n ? `${fallaCorta(f.k)} (${f.n})` : fallaCorta(f.k))),
      h('option', { value: '__otra', selected: otra }, 'Otra falla (escribir)…'));
    const intentos = h('input', { id: id('int'), type: 'number', min: 0, step: 1, inputmode: 'numeric', value: r.intentos ?? '', oninput: (e) => { r.intentos = e.target.value; } });
    const ssid = h('select', { id: id('ssid'), onchange: (e) => { r.ssid = e.target.value; ctx.ssid = e.target.value; } }, CAT.ssids.map((s) => h('option', { value: s, selected: s === (r.ssid || ctx.ssid) }, s)));
    const ap = h('input', { id: id('ap'), list: id('dl-ap'), value: r.ap, placeholder: 'AP-…', autocomplete: 'off', oninput: (e) => { r.ap = e.target.value; } });
    const evento = h('input', { id: id('ev'), type: 'datetime-local', value: r.evento || '', oninput: (e) => { r.evento = e.target.value; } });

    // usuario
    const userHint = h('div', {}), nameHint = h('div', {});
    const nombre = h('input', { id: id('nombre'), value: r.nombre, placeholder: 'Nombre del usuario', oninput: (e) => { r.nombre = e.target.value; }, onchange: () => checkName() });
    const username = h('input', { id: id('user'), value: r.username, placeholder: 'MI02818', autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => { r.username = e.target.value; }, onchange: (e) => { r.username = e.target.value.toUpperCase().replace(/\s+/g, ''); e.target.value = r.username; checkUser(); } });
    const useUser = (x) => { r.username = x.u; username.value = x.u; if (x.nombre && !r.nombre) { r.nombre = x.nombre; nombre.value = x.nombre; } checkUser(); nameHint.textContent = ''; };
    function checkUser() {
      userHint.textContent = '';
      const cands = M.similares(r.username, CAT.usuarios, r.nombre);
      const exact = cands.find((x) => x.exacto);
      if (exact) {
        if (r.username !== exact.u) { r.username = exact.u; username.value = exact.u; }
        if (!r.nombre && exact.nombre) { r.nombre = exact.nombre; nombre.value = exact.nombre; }
        userHint.append(h('span', { class: 'meta ok-text' }, `Usuario conocido · ${exact.n} ${exact.n === 1 ? 'caso' : 'casos'} antes`));
        return;
      }
      for (const x of cands) userHint.append(h('span', { class: 'meta warn-text' }, `¿Es ${x.u}${x.nombre ? ' · ' + x.nombre : ''}? (${x.why}) `, h('button', { class: 'link-btn', type: 'button', onclick: () => useUser(x) }, 'Usar')));
      if (r.username && !cands.length && M.userKey(r.username).length >= 4) userHint.append(h('span', { class: 'meta' }, 'Usuario nuevo'));
    }
    function checkName() {
      nameHint.textContent = ''; r.nombre = nombre.value.trim();
      const nk = M.nameKey(r.nombre); if (!nk) return;
      CAT.usuarios.filter((x) => x.nombre && M.nameKey(x.nombre) === nk && M.userKey(x.u) !== M.userKey(r.username)).slice(0, 2)
        .forEach((x) => nameHint.append(h('span', { class: 'meta warn-text' }, `Este nombre ya está como ${x.u} `, h('button', { class: 'link-btn', type: 'button', onclick: () => useUser(x) }, 'Usar'))));
    }

    // seguimiento
    const estado = h('select', { id: id('estado'), onchange: (e) => { r.estado = e.target.value; r.auto = false; autoNote.hidden = true; } }, M.ESTADOS.map((e) => h('option', { value: e.key, selected: e.key === r.estado }, e.label)));
    const autoNote = h('span', { class: 'meta', hidden: !r.auto || !r.comentario }, 'Propuesto según el comentario; puedes cambiarlo.');
    const setCom = (t) => { r.comentario = t; comentario.value = t; if (r.auto) { r.estado = M.estadoDe(t); estado.value = r.estado; autoNote.hidden = !t.trim(); } };
    const comentario = h('textarea', { id: id('com'), rows: 3, maxlength: 1000, placeholder: 'Qué se hizo o qué respondió el usuario. Vacío = Por contactar.', oninput: (e) => setCom(e.target.value) });
    comentario.value = r.comentario || '';
    if (r.comentario && r.auto) { r.estado = M.estadoDe(r.comentario); estado.value = r.estado; }

    const save = async (btn, next) => {
      if (!ctx.sedeId) { toast('Selecciona la sede.', 'error'); sede.focus(); return; }
      if (!String(r.mac || '').trim() && !String(r.username || '').trim()) { toast('Escribe la MAC del equipo o el username.', 'error'); mac.focus(); return; }
      btn.disabled = true;
      try {
        const x = await api('POST', '/api/monitoreo/casos', { sedeId: ctx.sedeId, fecha: r.fecha || ctx.fecha, ingenieroId: ctx.ingenieroId || undefined, casos: [r] });
        if (x.repetidos.length) toast('Ese caso ya estaba registrado en esa sede y fecha; no se duplicó.', 'error');
        else toast(`Caso guardado${x.unificados ? ' · el username se ajustó al ya registrado' : ''}`);
        if (x.nuevos) { session.push({ label: r.username || r.mac, estado: r.estado, q: !!r.q }); dirty = true; }
        else if (r.q) session.push({ label: r.username || r.mac, estado: r.estado, q: true, rep: true });
        CAT = await api('GET', '/api/monitoreo/catalogo');
        if (next === 'cerrar') { closeDrawer(); return; }
        if (!x.nuevos && !r.q) { btn.disabled = false; return; }
        nextCase(d);
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };

    const saveAll = async (btn) => {
      const rows = [r, ...queue];
      if (!ctx.sedeId) { toast('Selecciona la sede.', 'error'); sede.focus(); return; }
      btn.disabled = true;
      const byFecha = new Map(); rows.forEach((x) => { const f = x.fecha && x.fecha <= todayStr() ? x.fecha : ctx.fecha; if (!byFecha.has(f)) byFecha.set(f, []); byFecha.get(f).push(x); });
      let nuevos = 0, rep = 0;
      try {
        for (const [f, l] of byFecha) for (let i = 0; i < l.length; i += 300) {
          const x = await api('POST', '/api/monitoreo/casos', { sedeId: ctx.sedeId, fecha: f, ingenieroId: ctx.ingenieroId || undefined, casos: l.slice(i, i + 300) });
          nuevos += x.nuevos; rep += x.repetidos.length;
        }
        toast(`Se guardaron ${nuevos} casos${rep ? `; ${rep} ya estaban registrados` : ''}`);
        if (nuevos) dirty = true;
        queue = []; closeDrawer();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };

    const primary = h('button', { class: 'btn btn-primary', type: 'submit' }, r.q ? (queue.length ? 'Guardar y seguir' : 'Guardar el último') : 'Guardar y capturar otro');
    const form = h('form', { class: 'mon-form', onsubmit: (e) => { e.preventDefault(); save(primary, 'otro'); } },
      queue.length ? h('div', { class: 'notice mon-queue' }, h('span', {}, `Faltan ${queue.length} después de este. Revisa y guarda uno por uno, o guarda todos como vienen.`),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => saveAll(e.currentTarget) }, `Guardar los ${queue.length + 1} como vienen`),
          h('button', { class: 'link-btn', type: 'button', onclick: () => nextCase(d) }, 'Saltar este'))) : null,
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Revisión'),
        h('div', { class: 'mon-g2' }, field('Sede', sede), field('Fecha de la revisión', fecha)),
        ing ? field('Ingeniero que atiende', ing) : h('p', { class: 'meta' }, `Atiende: ${state.user.name}`)),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Dispositivo'),
        field('MAC o equipo', mac, macHint),
        field('Falla (log de Meraki)', falla, fallaTxt),
        h('div', { class: 'mon-g2' }, field('Intentos fallidos', intentos), field('SSID', ssid)),
        h('div', { class: 'mon-g2' }, field('AP', ap, apDl), field('Último intento', evento))),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Usuario'),
        h('div', { class: 'mon-g2' }, field('Username', username, userHint), field('Nombre', nombre, nameHint))),
      h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Seguimiento'),
        field('Comentario', comentario, h('div', { class: 'mon-chips' }, M.COMENTARIOS.map((t) => h('button', { class: 'chip', type: 'button', title: t, onclick: () => setCom(t) }, t.length > 40 ? t.slice(0, 38) + '…' : t)))),
        field('Estado', estado, autoNote)),
      h('div', { class: 'mon-dfoot' }, primary,
        h('button', { class: 'btn', type: 'button', onclick: (e) => save(e.currentTarget, 'cerrar') }, 'Guardar y cerrar'),
        h('button', { class: 'link-btn', type: 'button', onclick: () => closeDrawer() }, r.q ? 'Terminar' : 'Cancelar')));

    const saved = session.filter((s) => !s.rep);
    body.append(
      queue.length ? null : h('div', { class: 'mon-dtop' },
        h('button', { class: 'link-btn', type: 'button', onclick: () => pasteView(d) }, '¿Tienes varios? Pega los renglones de Meraki, el Excel o el chat'),
        saved.length ? h('details', { class: 'mon-session' }, h('summary', {}, `${saved.length} ${saved.length === 1 ? 'caso guardado' : 'casos guardados'} en esta sesión`),
          h('ul', {}, saved.slice().reverse().map((s) => h('li', {}, estadoPill(s.estado), ' ', s.label)))) : null),
      form);
    if (r.username) checkUser();
    if (r.mac) macCheck();
    setTimeout(() => (queue.length || r.mac ? comentario : ctx.sedeId ? mac : sede).focus(), 30);
  }

  function nextCase(d) {
    if (queue.length) { const n = queue.shift(); drawForm(d, n); return; }
    const pegados = session.filter((s) => s.q);
    if (pegados.length) toast(`Terminaste los renglones pegados: ${pegados.filter((s) => !s.rep).length} guardados.`);
    session.forEach((s) => { s.q = false; });
    drawForm(d, blank());
  }

  function pasteView(d) {
    const body = d.panel.querySelector('.mon-dbody');
    body.textContent = '';
    d.titleEl.textContent = 'Pegar varios casos';
    const ta = h('textarea', { id: 'mon-p-txt', rows: 10, class: 'mono', placeholder: 'Copia los renglones de Meraki (Failed connections), del Excel o del chat y pégalos aquí.\n\nEjemplo:\n19/10/2026 MI02818 JORGE ALAN VARGAS REYES 58:ce:2a:b4:82:d7 EAPOL: Timeout waiting for client EAP response 14 BBVA_GLOBAL AP-TM-13-MR56-01 oct 19 2026 13:01 Se contacta a usuario…' });
    const msg = h('p', { class: 'muted', role: 'status' });
    const go = () => {
      const { rows, omitidos } = M.parsePegado(ta.value);
      if (!rows.length) { msg.textContent = 'No se reconoció ningún renglón. Cada caso necesita la MAC o el username, la falla, los intentos, el SSID y el AP.'; return; }
      if (omitidos.length) toast(`${omitidos.length} líneas no se reconocieron y no se agregaron.`, 'error');
      queue = rows.map((x) => ({ ...blank(), ...x, intentos: x.intentos ?? '', evento: x.evento || '', ssid: x.ssid || ctx.ssid, fecha: x.fecha && x.fecha <= todayStr() ? x.fecha : '', estado: M.estadoDe(x.comentario), auto: true, q: true }));
      session.forEach((s) => { s.q = false; });
      drawForm(d, queue.shift());
    };
    body.append(h('p', { class: 'muted' }, 'El portal separa cada renglón en sus datos y te los presenta uno por uno para que revises username, estado y comentario antes de guardar.'),
      field('Renglones copiados', ta), msg,
      h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: go }, 'Revisar renglones'),
        h('button', { class: 'link-btn', type: 'button', onclick: () => drawForm(d, blank()) }, 'Volver a un caso')));
    setTimeout(() => ta.focus(), 30);
  }

  /* ---------- seguimiento de un caso ---------- */
  function openFollow(c) {
    const can = canWrite();
    const estado = h('select', { id: 'mon-f-estado' }, M.ESTADOS.map((e) => h('option', { value: e.key, selected: e.key === c.estado }, e.label)));
    const nota = h('textarea', { id: 'mon-f-nota', rows: 3, maxlength: 1000, placeholder: 'Qué se hizo o qué respondió el usuario' });
    nota.addEventListener('input', () => { if (nota.value.trim().length > 8) estado.value = M.estadoDe(nota.value); });
    const hist = h('ol', { class: 'timeline mon-hist' }, h('li', { class: 'muted' }, 'Cargando historial…'));
    api('GET', `/api/monitoreo/casos/${c.id}/seguimiento`).then(({ historial }) => {
      hist.textContent = '';
      historial.slice().reverse().forEach((x) => hist.append(h('li', { class: 'tl-item' }, h('span', { class: 'tl-when' }, `${ddmm(x.ts)} · ${x.user}`, x.estado ? estadoPill(x.estado) : null), x.nota ? h('span', { class: 'tl-text' }, x.nota) : null)));
      if (!historial.length) hist.append(h('li', { class: 'muted' }, 'Sin movimientos.'));
    }).catch(() => {});
    const save = async (e) => {
      e.currentTarget.disabled = true;
      try { await api('PUT', `/api/monitoreo/casos/${c.id}`, { estado: estado.value, nota: nota.value }); toast('Seguimiento guardado'); dirty = true; closeDrawer(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
    };
    const del = isAdmin() || c.createdBy === state.user.id ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/monitoreo/casos/${c.id}`); toast('Caso eliminado'); dirty = true; closeDrawer(); }) }, 'Eliminar caso') : null;
    const dl = (pairs) => h('dl', { class: 'mon-dl' }, pairs.filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    openDrawer(c.nombre || c.username || c.dispositivo || 'Caso', h('div', {},
      h('div', { class: 'mon-fsum' }, estadoPill(c.estado), h('span', { class: 'muted' }, `${fullDate(c.fecha)} · ${short(c.sede)}`)),
      dl([['Username', c.username], ['MAC o equipo', c.dispositivo && h('span', { class: 'mono' }, c.dispositivo)], ['Falla', c.falla && fallaCorta(c.falla)], ['Intentos', c.intentos && nf(c.intentos)],
        ['SSID', c.ssid], ['AP', c.ap], ['Último intento', c.evento && `${dayMonth(c.evento.slice(0, 10))} ${c.evento.slice(11, 16)}`], ['Atiende', c.ingeniero || 'Sin asignar'], ['Último comentario', c.comentario], ['Casos del mismo usuario', c.otros ? `${c.otros + 1}` : null]]),
      can ? h('fieldset', { class: 'mon-fs' }, h('legend', {}, 'Actualizar seguimiento'),
        field('Comentario', nota, h('div', { class: 'mon-chips' }, M.COMENTARIOS.map((t) => h('button', { class: 'chip', type: 'button', title: t, onclick: () => { nota.value = t; estado.value = M.estadoDe(t); } }, t.length > 40 ? t.slice(0, 38) + '…' : t)))),
        field('Nuevo estado', estado),
        h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Guardar seguimiento'), del)) : null,
      h('h3', { class: 'mon-dh3' }, 'Historial del caso'), hist));
    if (can) setTimeout(() => nota.focus(), 30);
  }

  /* ---------- importación única del histórico (administrador) ---------- */
  function openHistorico() {
    const out = h('div', {});
    const input = h('input', { type: 'file', accept: '.xlsx', id: 'mon-h-file' });
    const send = async (modo) => {
      const f = input.files[0]; if (!f) { toast('Selecciona el archivo.', 'error'); return null; }
      const res = await fetch(`/api/monitoreo/historico?modo=${modo}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: f });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'No se pudo leer el archivo.');
      return r;
    };
    const preview = async () => {
      try {
        const r = await send('vista'); if (!r) return;
        out.textContent = '';
        out.append(h('p', { class: 'notice' }, h('strong', {}, `${r.nuevos} casos nuevos`), `, ${r.repetidos} repetidos que se omiten. Nada se guarda hasta que confirmes.`),
          h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hoja'), h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Casos'))),
            h('tbody', {}, r.hojas.map((x) => h('tr', {}, h('td', {}, x.hoja, x.nota ? h('span', { class: 'meta' }, x.nota) : null), h('td', {}, x.sede ? short(x.sede) : '—'), h('td', { class: 'num-col plain' }, x.casos))))),
          h('p', {}, 'Estados propuestos: ', M.ESTADOS.map((e) => `${e.short} ${r.porEstado[e.key]}`).join(' · '), '.'),
          r.totalAvisos ? h('details', { class: 'section' }, h('summary', {}, `${r.totalAvisos} avisos de fechas corregidas`), h('div', { class: 'section-body' }, h('ul', {}, r.avisos.map((a) => h('li', {}, a))))) : null,
          h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !r.nuevos, onclick: async (e) => { e.currentTarget.disabled = true; try { const x = await send('guardar'); toast(`Se importaron ${x.nuevos} casos`); closeDrawer(true); const cat = await api('GET', '/api/monitoreo/catalogo'); view.hasta = todayStr(); view.desde = cat.rango.min || view.hasta; refreshAll(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, `Importar ${r.nuevos} casos`)));
      } catch (err) { toast(err.message, 'error'); }
    };
    openDrawer('Importar histórico', h('div', {},
      h('p', { class: 'muted' }, 'Para pasar una sola vez el Excel de seguimiento (una hoja por sede). Las hojas con nombre de fecha y las ocultas se omiten porque repiten casos. Si lo vuelves a subir, no se duplica nada.'),
      field('Archivo de Excel', input), h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn', type: 'button', onclick: preview }, 'Revisar archivo')), out), true);
  }

  // el PDF siempre sale con el resumen para BBVA
  let prevTab = null;
  window.addEventListener('beforeprint', () => { if (root?.isConnected && view.tab !== 'resumen' && !document.body.classList.contains('rd-sede-report')) { prevTab = view.tab; view.tab = 'resumen'; render(); } });
  window.addEventListener('afterprint', () => { if (prevTab && root?.isConnected) { view.tab = prevTab; prevTab = null; render(); } });

  window.PortalMonitoreo = {
    exportItems: () => (view.desde ? [{ label: 'Excel (CSV) de casos', hint: `Casos del ${dayMonth(view.desde)} al ${dayMonth(view.hasta)}`, href: `/api/monitoreo/export.csv?desde=${view.desde}&hasta=${view.hasta}` }] : []),
    async mount(el, ext) {
      root = el; CAT = null; EXT = { resumen: (ext?.resumen || []).filter(Boolean), acerca: (ext?.acerca || []).filter(Boolean), draw: ext?.draw };
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando el monitoreo…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    open() { if (CAT) openNuevo(); },
    importar() { if (CAT) openHistorico(); },
  };
})();
