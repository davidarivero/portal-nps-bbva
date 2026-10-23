'use strict';
/* Monitoreo proactivo de indicadores clave: registro de casos en el portal y tablero jerárquico (programa → sede → causa y AP → caso). */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const M = window.PortalMonitoreoComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const FILL = { exito: '#3a9a6a', cita: '#3f74c0', sin_respuesta: '#d9a23a', sin_datos: '#a9aaae', no_identificado: '#c5c6c9', pendiente: '#dcdcd8' };
  const view = { desde: null, hasta: null, sede: '', estado: '', q: '', panel: null, limit: 40, open: null, tab: 'tablero', quien: null };
  let root = null, CAT = null, DATA = null, PEND = null;

  const estadoPill = (k) => h('span', { class: 'pill pill-' + M.ESTADO[k].cls + ' mon-pill' }, h('i', { class: 'mon-dot', style: `background:${FILL[k]}` }), M.ESTADO[k].short);
  const short = (s) => String(s || '').replace(/^BBVA\s+/i, '');
  const fallaCorta = (k) => String(k || '').replace('RADIUS authentication rejected by server', 'RADIUS: autenticación rechazada').replace('EAPOL: Timeout waiting for client EAP response', 'EAPOL: el cliente no responde').replace('Previous authentication no longer valid', 'Autenticación previa vencida');
  const stack = (counts, total, tall) => h('div', { class: 'mon-stack' + (tall ? ' is-tall' : ''), role: 'img', 'aria-label': M.ESTADOS.map((e) => `${e.short}: ${counts[e.key] || 0}`).join(', ') },
    M.ESTADOS.map((e) => (counts[e.key] ? h('span', { style: `flex:${counts[e.key]};background:${FILL[e.key]}`, title: `${e.label}: ${counts[e.key]} (${pct(counts[e.key], total)}%)` }, tall && counts[e.key] / total >= 0.07 ? String(counts[e.key]) : '') : null)));
  const tally = (list) => { const c = Object.fromEntries(M.ESTADOS.map((e) => [e.key, 0])); list.forEach((x) => { c[x.estado] += 1; }); return c; };

  async function reload() {
    if (!CAT) CAT = await api('GET', '/api/monitoreo/catalogo');
    if (!view.hasta) { view.hasta = todayStr(); view.desde = addDays(view.hasta, -27); }
    [DATA, PEND] = await Promise.all([api('GET', `/api/monitoreo/casos?desde=${view.desde}&hasta=${view.hasta}`), api('GET', '/api/monitoreo/pendientes')]);
    render();
  }

  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const all = DATA.casos.filter((c) => !view.sede || String(c.sedeId) === view.sede);
    const sedeName = view.sede ? short(CAT.sedes.find((s) => String(s.id) === view.sede)?.name) : 'Todas las sedes';

    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, `Monitoreo proactivo · ${sedeName}`), h('p', {}, `Periodo: ${fullDate(view.desde)} – ${fullDate(view.hasta)}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));

    // barra de acciones y filtros
    const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key], max: todayStr(), onchange: (e) => { if (!e.target.value) return; view[key] = e.target.value; if (view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; reload(); } }));
    push(h('section', { class: 'panel no-print' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, 'Usuarios con intentos fallidos'), h('p', { class: 'muted' }, CAT.rango.n ? `${nf(CAT.rango.n)} casos registrados del ${fullDate(CAT.rango.min)} al ${fullDate(CAT.rango.max)}.` : 'Aún no hay casos registrados.')),
        h('div', { class: 'form-actions' },
          canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { view.panel = view.panel === 'nuevo' ? null : 'nuevo'; render(); } }, 'Registrar revisión') : null,
          isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: () => { view.panel = view.panel === 'historico' ? null : 'historico'; render(); } }, 'Importar histórico') : null)),
      h('div', { class: 'rd-filters' }, dateInput('mon-desde', 'Desde', 'desde'), dateInput('mon-hasta', 'Hasta', 'hasta'),
        h('div', { class: 'field' }, h('label', { for: 'mon-sede' }, 'Sede'), h('select', { id: 'mon-sede', onchange: (e) => { view.sede = e.target.value; view.limit = 40; render(); } }, h('option', { value: '' }, 'Todas las sedes'), CAT.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === view.sede }, short(s.name))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' }, [['Esta semana', 'w'], ['4 semanas', 28], ['3 meses', 90], ['Todo', 0]].map(([t, n]) => h('button', { class: 'tab', type: 'button', onclick: () => { view.hasta = todayStr(); view.desde = n === 'w' ? mondayOf(view.hasta) : n ? addDays(view.hasta, -(n - 1)) : (CAT.rango.min || view.hasta); reload(); } }, t)))))));
    if (view.panel === 'nuevo') push(capturePanel());
    if (view.panel === 'historico') push(historicPanel());
    const mine = PEND.casos.filter((c) => c.ingenieroId === state.user.id).length;
    push(h('div', { class: 'tabs mon-tabs no-print', role: 'tablist' },
      h('button', { class: 'tab' + (view.tab === 'tablero' ? ' is-active' : ''), role: 'tab', 'aria-selected': String(view.tab === 'tablero'), type: 'button', onclick: () => { view.tab = 'tablero'; render(); } }, 'Tablero ejecutivo'),
      h('button', { class: 'tab' + (view.tab === 'pendientes' ? ' is-active' : ''), role: 'tab', 'aria-selected': String(view.tab === 'pendientes'), type: 'button', onclick: () => { view.tab = 'pendientes'; view.open = null; render(); } },
        `Pendientes de seguimiento (${PEND.casos.length})`, mine ? h('span', { class: 'badge' }, `${mine} míos`) : null)));
    if (view.tab === 'pendientes') { push(pendingPanel()); root.append(...kids); return; }

    if (!all.length) { push(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No hay casos en este periodo. Amplía las fechas o registra una revisión.'))); root.append(...kids); return; }

    // ---------- nivel 1: resultado del periodo ----------
    const T = tally(all), N = all.length;
    const identificados = N - T.sin_datos - T.no_identificado, contactados = T.exito + T.cita + T.sin_respuesta;
    const funnel = [['Usuarios revisados', N, 'Detectados en Meraki con intentos fallidos'], ['Con datos de contacto', identificados, `${nf(T.sin_datos)} sin datos para contactar · ${nf(T.no_identificado)} no identificados`],
      ['Contactados', contactados, `${nf(T.pendiente)} por contactar`], ['Atendidos con éxito', T.exito, `${nf(T.cita)} con cita · ${nf(T.sin_respuesta)} sin respuesta`]];
    push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 1 · Resultado del periodo'),
      h('div', { class: 'mon-l1' },
        h('div', { class: 'mon-funnel' }, funnel.map(([t, v, sub], i) => h('div', { class: 'mon-fstep' },
          h('div', { class: 'mon-fhead' }, h('span', { class: 'mon-flabel' }, t), h('span', { class: 'mon-fnum' }, nf(v)), i ? h('span', { class: 'mon-fpct' }, `${pct(v, N)}%`) : null),
          h('div', { class: 'mon-fbar' }, h('span', { style: `width:${Math.max(2, (v / N) * 100)}%;background:${['#2a2b2e', '#505155', '#3f74c0', '#3a9a6a'][i]}` })),
          h('span', { class: 'mon-fsub' }, sub)))),
        h('div', { class: 'mon-kpis' },
          h('div', { class: 'tile mon-kpi-main' }, h('span', { class: 'tile-label' }, 'Efectividad'), h('span', { class: 'tile-num' }, contactados ? `${pct(T.exito, contactados)}%` : '—'), h('span', { class: 'tile-sub' }, `de los contactados quedaron atendidos con éxito (${nf(T.exito)} de ${nf(contactados)})`)),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Requieren seguimiento'), h('span', { class: 'tile-num' }, nf(T.cita + T.sin_respuesta + T.pendiente)), h('span', { class: 'tile-sub' }, `${nf(T.cita)} con cita, ${nf(T.sin_respuesta)} sin respuesta y ${nf(T.pendiente)} por contactar`)))),
      h('p', { class: 'legend mon-legend' }, M.ESTADOS.map((e) => h('span', {}, h('i', { class: 'mon-dot', style: `background:${FILL[e.key]}` }), `${e.label}: ${nf(T[e.key])}`)))));

    // ---------- nivel 2: por sede ----------
    const bySede = CAT.sedes.map((s) => { const l = DATA.casos.filter((c) => c.sedeId === s.id); const t = tally(l); const ct = t.exito + t.cita + t.sin_respuesta; return { s, n: l.length, t, ct }; }).filter((x) => x.n).sort((a, b) => b.n - a.n);
    push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 2 · Por sede'), h('h2', {}, 'Resultado por sede'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-sedes' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Revisados'), h('th', { class: 'num-col' }, 'Contactados'), h('th', { class: 'num-col' }, 'Éxito'), h('th', { class: 'num-col' }, 'Efectividad'), h('th', { class: 'mon-col-stack' }, 'Estado de los casos'))),
        h('tbody', {}, bySede.map(({ s, n, t, ct }) => h('tr', { class: String(s.id) === view.sede ? 'is-selected' : '' },
          h('td', {}, h('button', { class: 'link-btn mon-sede-btn', type: 'button', onclick: () => { view.sede = String(s.id) === view.sede ? '' : String(s.id); view.limit = 40; render(); } }, short(s.name))),
          h('td', { class: 'num-col plain' }, nf(n)), h('td', { class: 'num-col plain' }, nf(ct)), h('td', { class: 'num-col plain' }, nf(t.exito)),
          h('td', { class: 'num-col plain' }, ct ? `${pct(t.exito, ct)}%` : '—'), h('td', { class: 'mon-col-stack' }, stack(t, n)))))))));

    // ---------- nivel 3: causas, AP y reincidencias ----------
    const group = (key) => { const m = new Map(); all.forEach((c) => { const k = c[key] || 'Sin dato'; const x = m.get(k) || { k, n: 0, exito: 0, list: [] }; x.n += 1; if (c.estado === 'exito') x.exito += 1; x.list.push(c); m.set(k, x); }); return [...m.values()].sort((a, b) => b.n - a.n); };
    const causas = group('falla'), aps = group('ap').slice(0, 8);
    const maxC = Math.max(...causas.map((c) => c.n)), maxA = Math.max(...aps.map((c) => c.n));
    const hbar = (rows, max, label) => h('div', { class: 'mon-hbars' }, rows.map((r) => h('div', { class: 'mon-hrow' },
      h('span', { class: 'mon-hlabel', title: r.k }, label(r.k)), h('div', { class: 'mon-htrack' }, h('div', { style: `width:${(r.n / max) * 100}%` }, stack(tally(r.list), r.n))), h('span', { class: 'mon-hnum' }, nf(r.n)))));
    const reinc = all.filter((c) => c.otros > 0);
    const reincUsers = [...new Map(reinc.map((c) => [c.dispositivo || c.username, c])).values()].sort((a, b) => b.otros - a.otros).slice(0, 8);
    push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Nivel 3 · Causas y puntos de atención · ${sedeName}`),
      h('div', { class: 'mon-l3' },
        h('div', {}, h('h3', {}, 'Tipo de falla detectada'), hbar(causas, maxC, fallaCorta)),
        h('div', {}, h('h3', {}, 'AP con más casos'), hbar(aps, maxA, (k) => k)),
        h('div', {}, h('h3', {}, `Usuarios reincidentes (${nf(new Set(reinc.map((c) => c.dispositivo || c.username)).size)})`),
          reincUsers.length ? h('ul', { class: 'mon-reinc' }, reincUsers.map((c) => h('li', {}, h('strong', {}, c.nombre || c.username || c.dispositivo), h('span', { class: 'muted' }, ` · ${c.otros + 1} casos en total · ${short(c.sede)}`)))) : h('p', { class: 'muted' }, 'Ningún usuario se repite en el periodo.'))),
      h('p', { class: 'legend' }, h('span', { class: 'muted' }, 'Los colores de las barras son el estado de los casos, igual que en el nivel 1.'))));

    // tendencia semanal
    const weeks = [...new Set(all.map((c) => mondayOf(c.fecha)))].sort();
    if (weeks.length > 1) {
      const wmax = Math.max(...weeks.map((w) => all.filter((c) => mondayOf(c.fecha) === w).length));
      push(h('section', { class: 'panel' }, h('h2', {}, 'Casos por semana'),
        h('div', { class: 'mon-weeks' }, weeks.map((w) => { const l = all.filter((c) => mondayOf(c.fecha) === w); const t = tally(l); return h('div', { class: 'mon-week' },
          h('span', { class: 'mon-wnum' }, nf(l.length)),
          h('div', { class: 'mon-wcol', style: `height:${Math.max(4, (l.length / wmax) * 160)}px` }, M.ESTADOS.slice().reverse().map((e) => (t[e.key] ? h('span', { style: `flex:${t[e.key]};background:${FILL[e.key]}`, title: `${e.label}: ${t[e.key]}` }) : null))),
          h('span', { class: 'mon-wlabel' }, dayMonth(w))); })),
        h('p', { class: 'legend mon-legend' }, M.ESTADOS.map((e) => h('span', {}, h('i', { class: 'mon-dot', style: `background:${FILL[e.key]}` }), e.short)), h('span', { class: 'muted' }, 'Semana que inicia el lunes indicado.'))));
    }

    // ---------- nivel 4: casos ----------
    const q = M.plain(view.q);
    const list = all.filter((c) => (!view.estado || c.estado === view.estado) && (!q || M.plain([c.username, c.nombre, c.dispositivo, c.ap, c.comentario].join(' ')).includes(q)));
    const tbody = h('tbody', {});
    list.slice(0, view.limit).forEach((c) => { tbody.append(caseRow(c)); if (view.open === c.id) tbody.append(followRow(c)); });
    push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 4 · Detalle y seguimiento de casos'),
      h('div', { class: 'panel-head' }, h('h2', {}, `Casos (${nf(list.length)})`),
        h('div', { class: 'mon-tools no-print' },
          h('input', { type: 'search', placeholder: 'Buscar usuario, MAC, AP o comentario', value: view.q, 'aria-label': 'Buscar caso', oninput: (e) => { view.q = e.target.value; clearTimeout(view.t); view.t = setTimeout(() => { render(); const i = root.querySelector('.mon-tools input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }),
          h('select', { 'aria-label': 'Filtrar por estado', onchange: (e) => { view.estado = e.target.value; render(); } }, h('option', { value: '' }, 'Todos los estados'), M.ESTADOS.map((e) => h('option', { value: e.key, selected: view.estado === e.key }, `${e.label} (${T[e.key]})`))))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-casos' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Usuario'), h('th', {}, 'Dispositivo y falla'), h('th', {}, 'AP'), h('th', {}, 'Estado'), h('th', {}, 'Último comentario'), h('th', { class: 'no-print' }, ''))), tbody)),
      list.length > view.limit ? h('button', { class: 'btn no-print', type: 'button', onclick: () => { view.limit += 60; render(); } }, `Ver ${Math.min(60, list.length - view.limit)} casos más`) : null));
    root.append(...kids);
  }

  function caseRow(c) {
    return h('tr', { class: view.open === c.id ? 'is-open' : '' },
      h('td', { class: 'nowrap' }, h('strong', {}, dayMonth(c.fecha)), h('br'), h('span', { class: 'muted' }, short(c.sede))),
      h('td', {}, h('strong', {}, c.nombre || 'Sin nombre'), h('br'), h('span', { class: 'muted' }, c.username || '—'), c.otros ? h('span', { class: 'tag mon-tag' }, `${c.otros + 1} casos`) : null),
      h('td', {}, h('span', { class: 'mono' }, c.dispositivo || '—'), h('br'), h('span', { class: 'muted' }, `${c.falla ? fallaCorta(c.falla) : 'Falla sin dato'}${c.intentos ? ` · ${nf(c.intentos)} intentos` : ''}${c.ssid ? ` · ${c.ssid}` : ''}`)),
      h('td', { class: 'nowrap' }, c.ap || '—', c.evento ? h('span', { class: 'meta' }, `${dayMonth(c.evento.slice(0, 10))} ${c.evento.slice(11, 16)}`) : null),
      h('td', {}, estadoPill(c.estado)),
      h('td', { class: 'detail-col' }, c.comentario || h('span', { class: 'muted' }, 'Sin comentario'), h('span', { class: 'meta' }, c.ingeniero ? `Atiende: ${c.ingeniero}` : c.origen === 'historico' ? 'Histórico del Excel' : '')),
      h('td', { class: 'actions no-print' }, canWrite() ? h('button', { class: 'link-btn', type: 'button', onclick: () => { view.open = view.open === c.id ? null : c.id; render(); } }, view.open === c.id ? 'Cerrar' : 'Seguimiento') : null));
  }

  function followRow(c) {
    const estado = h('select', { id: 'mon-f-estado' }, M.ESTADOS.map((e) => h('option', { value: e.key, selected: e.key === c.estado }, e.label)));
    const nota = h('textarea', { id: 'mon-f-nota', rows: 2, maxlength: 1000, placeholder: 'Qué se hizo o qué respondió el usuario' });
    const hist = h('ol', { class: 'timeline mon-hist' }, h('li', { class: 'muted' }, 'Cargando historial…'));
    api('GET', `/api/monitoreo/casos/${c.id}/seguimiento`).then(({ historial }) => { hist.textContent = ''; historial.forEach((x) => hist.append(h('li', { class: 'tl-item' }, h('span', { class: 'tl-when' }, `${x.ts.slice(0, 10).split('-').reverse().join('/')} ${x.ts.slice(11, 16)} · ${x.user}`, x.estado ? estadoPill(x.estado) : null), x.nota ? h('span', { class: 'tl-text' }, x.nota) : null))); if (!historial.length) hist.append(h('li', { class: 'muted' }, 'Sin movimientos.')); }).catch(() => {});
    const save = async (e) => {
      e.currentTarget.disabled = true;
      try { await api('PUT', `/api/monitoreo/casos/${c.id}`, { estado: estado.value, nota: nota.value }); toast('Seguimiento guardado'); view.open = null; await reload(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
    };
    const del = isAdmin() || c.createdBy === state.user.id ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/monitoreo/casos/${c.id}`); toast('Caso eliminado'); view.open = null; await reload(); }) }, 'Eliminar caso') : null;
    nota.addEventListener('input', () => { const s = M.estadoDe(nota.value); if (nota.value.trim().length > 8) estado.value = s; });
    return h('tr', { class: 'mon-follow' }, h('td', { colspan: 7 },
      h('div', { class: 'mon-follow-grid' },
        h('div', {}, h('h3', {}, 'Actualizar seguimiento'),
          h('div', { class: 'field' }, h('label', { for: 'mon-f-estado' }, 'Estado'), estado),
          h('div', { class: 'field' }, h('label', { for: 'mon-f-nota' }, 'Comentario'), nota, h('div', { class: 'mon-chips' }, M.COMENTARIOS.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => { nota.value = t; estado.value = M.estadoDe(t); } }, t.length > 46 ? t.slice(0, 44) + '…' : t)))),
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Guardar seguimiento'), del)),
        h('div', {}, h('h3', {}, 'Historial del caso'), hist))));
  }

  /* ---------- pendientes: todo lo no resuelto, sin importar la fecha ---------- */
  function pendingPanel() {
    if (view.quien === null) view.quien = isAdmin() ? 'todos' : 'mios';
    const dias = (c) => Math.max(0, Math.round((Date.parse(todayStr()) - Date.parse(c.fecha)) / 864e5));
    let list = PEND.casos.filter((c) => !view.sede || String(c.sedeId) === view.sede);
    if (view.quien === 'mios') list = list.filter((c) => c.ingenieroId === state.user.id);
    if (view.quien === 'libres') list = list.filter((c) => !c.ingenieroId);
    const T = tally(list);
    const groups = new Map();
    list.forEach((c) => { const k = c.ingeniero || 'Sin asignar'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    const order = [...groups.keys()].sort((a, b) => (a === 'Sin asignar') - (b === 'Sin asignar') || groups.get(b).length - groups.get(a).length);
    const assign = (c, to) => api('PUT', `/api/monitoreo/casos/${c.id}`, { ingenieroId: to }).then(() => { toast(to ? 'Caso asignado' : 'Caso liberado'); return reload(); }).catch((e) => toast(e.message, 'error'));
    const row = (c) => {
      const d = dias(c);
      return h('tr', { class: view.open === c.id ? 'is-open' : '' },
        h('td', { class: 'num-col' }, h('span', { class: 'mon-age ' + (d > 14 ? 'is-crit' : d > 7 ? 'is-warn' : '') }, `${d} d`)),
        h('td', { class: 'nowrap' }, dayMonth(c.fecha), h('br'), h('span', { class: 'muted' }, short(c.sede))),
        h('td', {}, h('strong', {}, c.nombre || 'Sin nombre'), h('br'), h('span', { class: 'muted' }, c.username || c.dispositivo || '—'), c.otros ? h('span', { class: 'tag mon-tag' }, `${c.otros + 1} casos`) : null),
        h('td', {}, estadoPill(c.estado), h('span', { class: 'meta' }, fallaCorta(c.falla))),
        h('td', { class: 'detail-col' }, c.comentario || h('span', { class: 'muted' }, 'Sin comentario'), h('span', { class: 'meta' }, c.ultimo ? `Último movimiento: ${c.ultimo.slice(0, 10).split('-').reverse().join('/')}` : '')),
        h('td', { class: 'actions no-print' },
          canWrite() ? h('button', { class: 'link-btn', type: 'button', onclick: () => { view.open = view.open === c.id ? null : c.id; render(); } }, view.open === c.id ? 'Cerrar' : 'Seguimiento') : null,
          !c.ingenieroId && canWrite() && !isAdmin() ? h('button', { class: 'link-btn', type: 'button', onclick: () => assign(c, state.user.id) }, 'Tomar caso') : null,
          isAdmin() ? h('select', { class: 'mon-assign', 'aria-label': 'Asignar a', onchange: (e) => assign(c, e.target.value ? Number(e.target.value) : null) },
            h('option', { value: '' }, 'Sin asignar'), CAT.ingenieros.map((u) => h('option', { value: u.id, selected: u.id === c.ingenieroId }, u.name))) : null));
    };
    const quien = (k, t) => h('button', { class: 'tab' + (view.quien === k ? ' is-active' : ''), type: 'button', onclick: () => { view.quien = k; view.open = null; render(); } }, t);
    return h('section', { class: 'panel mon-level' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, `Pendientes de seguimiento (${nf(list.length)})`),
        h('p', { class: 'muted' }, 'Casos por contactar, con cita o sin respuesta, de cualquier fecha. Los más antiguos primero. Los casos sin datos para contactar no se listan.')),
        h('div', { class: 'tabs' }, quien('mios', `Mis casos (${PEND.casos.filter((c) => c.ingenieroId === state.user.id).length})`), quien('libres', `Sin asignar (${PEND.casos.filter((c) => !c.ingenieroId).length})`), quien('todos', `Todos (${PEND.casos.length})`))),
      h('p', { class: 'legend mon-legend' }, ['pendiente', 'cita', 'sin_respuesta'].map((k) => h('span', {}, h('i', { class: 'mon-dot', style: `background:${FILL[k]}` }), `${M.ESTADO[k].label}: ${nf(T[k])}`)), h('span', { class: 'muted' }, 'Días = desde la fecha de revisión; ámbar más de 7, rojo más de 14.')),
      list.length ? order.map((g) => {
        const tb = h('tbody', {});
        groups.get(g).forEach((c) => { tb.append(row(c)); if (view.open === c.id) tb.append(followRow(c)); });
        return h('div', { class: 'mon-group' }, h('h3', {}, `${g} · ${groups.get(g).length}`),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-casos' }, h('thead', {}, h('tr', {}, h('th', { class: 'num-col' }, 'Abierto'), h('th', {}, 'Fecha'), h('th', {}, 'Usuario'), h('th', {}, 'Estado y falla'), h('th', {}, 'Último comentario'), h('th', { class: 'no-print' }, ''))), tb)));
      }) : h('p', { class: 'empty' }, view.quien === 'mios' ? 'No tienes casos pendientes asignados. Revisa la pestaña "Sin asignar".' : 'No hay casos pendientes.'));
  }

  /* ---------- registro de una revisión ---------- */
  const draft = { rows: [], sedeId: '', fecha: '', ingenieroId: '', ssid: 'BBVA_GLOBAL' };
  const blank = () => ({ username: '', nombre: '', mac: '', falla: '', intentos: '', ssid: draft.ssid, ap: '', evento: '', estado: 'pendiente', comentario: '', auto: true });
  function capturePanel() {
    if (!draft.rows.length) draft.rows.push(blank());
    if (!draft.fecha) draft.fecha = todayStr();
    if (!draft.sedeId) draft.sedeId = view.sede || '';
    const known = new Map(DATA.casos.map((c) => [c.dispositivo || '', c]));
    const tbody = h('tbody', {});
    const dl = h('div', {},
      h('datalist', { id: 'mon-dl-ap' }, CAT.aps.filter((a) => !draft.sedeId || String(a.sedeId) === String(draft.sedeId)).map((a) => h('option', { value: a.ap }))),
      h('datalist', { id: 'mon-dl-com' }, M.COMENTARIOS.map((t) => h('option', { value: t }))));
    const cell = (r, key, { label, after, ...attrs }) => h('td', {}, h('input', { value: r[key] ?? '', 'aria-label': label, ...attrs, oninput: (e) => { r[key] = e.target.value; if (after) after(e); } }));
    // username: se compara contra los ya registrados para no duplicar a la misma persona escrita distinto
    const hintFor = (r, box, nameInput) => {
      box.textContent = '';
      const cands = M.similares(r.username, CAT.usuarios, r.nombre);
      const exact = cands.find((x) => x.exacto);
      const use = (x) => { r.username = x.u; if (!r.nombre && x.nombre) r.nombre = x.nombre; draw(); };
      if (exact) {
        if (r.username !== exact.u) r.username = exact.u;
        if (!r.nombre && exact.nombre) { r.nombre = exact.nombre; if (nameInput) nameInput.value = exact.nombre; }
        box.append(h('span', { class: 'meta ok-text' }, `Usuario conocido · ${exact.n} ${exact.n === 1 ? 'caso' : 'casos'} antes`));
        return;
      }
      for (const x of cands) box.append(h('span', { class: 'meta warn-text' }, `¿Es ${x.u}${x.nombre ? ' · ' + x.nombre : ''}? (${x.why}) `, h('button', { class: 'link-btn', type: 'button', onclick: () => use(x) }, 'Usar')));
      if (r.username && !cands.length && M.userKey(r.username).length >= 4) box.append(h('span', { class: 'meta' }, 'Usuario nuevo'));
    };
    const userCell = (r) => {
      const box = h('div', {});
      const inp = h('input', { value: r.username, 'aria-label': 'Username', placeholder: 'Username', class: 'w-user', autocomplete: 'off', spellcheck: 'false',
        oninput: (e) => { r.username = e.target.value; },
        onchange: (e) => { r.username = e.target.value.toUpperCase().replace(/\s+/g, ''); e.target.value = r.username; hintFor(r, box, e.target.closest('tr')?.querySelector('.w-name')); e.target.value = r.username; } });
      if (r.username) setTimeout(() => hintFor(r, box, null), 0);
      return h('td', {}, inp, box);
    };
    const nameCell = (r) => {
      const box = h('div', {});
      const inp = h('input', { value: r.nombre, 'aria-label': 'Nombre', placeholder: 'Nombre del usuario', class: 'w-name',
        oninput: (e) => { r.nombre = e.target.value; },
        onchange: (e) => {
          box.textContent = ''; r.nombre = e.target.value.trim();
          const nk = M.nameKey(r.nombre); if (!nk) return;
          const same = CAT.usuarios.filter((x) => x.nombre && M.nameKey(x.nombre) === nk && M.userKey(x.u) !== M.userKey(r.username));
          for (const x of same.slice(0, 2)) box.append(h('span', { class: 'meta warn-text' }, `Este nombre ya está como ${x.u} `, h('button', { class: 'link-btn', type: 'button', onclick: () => { r.username = x.u; r.nombre = x.nombre; draw(); } }, 'Usar')));
        } });
      return h('td', {}, inp, box);
    };
    // falla: lista de las más recurrentes, con opción de escribir una nueva
    const fallaCell = (r) => {
      const list = CAT.fallas.map((f) => f.k);
      const otra = r.falla && !list.includes(r.falla);
      const txt = h('input', { value: otra ? r.falla : '', 'aria-label': 'Nueva falla', placeholder: 'Escribe la falla', class: 'w-falla', hidden: !otra, oninput: (e) => { r.falla = e.target.value; } });
      const sel = h('select', { 'aria-label': 'Falla', class: 'w-falla', onchange: (e) => { const v = e.target.value; if (v === '__otra') { r.falla = ''; txt.hidden = false; txt.value = ''; txt.focus(); } else { r.falla = v; txt.hidden = true; } } },
        h('option', { value: '', selected: !r.falla }, 'Selecciona…'),
        CAT.fallas.map((f) => h('option', { value: f.k, selected: f.k === r.falla }, f.n ? `${f.k} (${f.n})` : f.k)),
        h('option', { value: '__otra', selected: otra }, 'Otra falla (escribir)…'));
      return h('td', {}, sel, txt);
    };
    const draw = () => {
      tbody.textContent = '';
      draft.rows.forEach((r, i) => {
        const st = h('select', { 'aria-label': 'Estado', onchange: (e) => { r.estado = e.target.value; r.auto = false; } }, M.ESTADOS.map((e) => h('option', { value: e.key, selected: e.key === r.estado }, e.short)));
        const prev = r.mac && known.get(r.mac.toLowerCase());
        tbody.append(h('tr', {},
          h('td', { class: 'mon-n' }, i + 1),
          userCell(r), nameCell(r),
          h('td', {}, h('input', { value: r.mac, 'aria-label': 'MAC', placeholder: 'MAC o equipo', class: 'mono w-mac', oninput: (e) => { r.mac = e.target.value; } }), prev ? h('span', { class: 'meta warn-text' }, `Ya tuvo caso el ${dayMonth(prev.fecha)}`) : null),
          fallaCell(r),
          cell(r, 'intentos', { label: 'Intentos fallidos', type: 'number', min: 0, step: 1, class: 'mon-int' }),
          h('td', {}, h('select', { 'aria-label': 'SSID', onchange: (e) => { r.ssid = e.target.value; } }, CAT.ssids.map((s) => h('option', { value: s, selected: s === r.ssid }, s)))),
          cell(r, 'ap', { label: 'AP', list: 'mon-dl-ap', placeholder: 'AP-…', class: 'w-ap' }),
          cell(r, 'evento', { label: 'Último intento', type: 'datetime-local', class: 'w-ev' }),
          h('td', {}, st),
          cell(r, 'comentario', { label: 'Comentario', list: 'mon-dl-com', placeholder: 'Qué se hizo', class: 'w-com', after: () => { if (r.auto) { r.estado = M.estadoDe(r.comentario); st.value = r.estado; } } }),
          h('td', { class: 'no-print' }, h('button', { class: 'link-btn', type: 'button', 'aria-label': `Quitar renglón ${i + 1}`, onclick: () => { draft.rows.splice(i, 1); if (!draft.rows.length) draft.rows.push(blank()); draw(); } }, '✕'))));
      });
    };
    draw();
    const paste = h('textarea', { rows: 5, placeholder: 'Pega aquí los renglones copiados de Meraki (Failed connections), del Excel o del chat. Ejemplo:\n19/10/2026 MI02818 JORGE ALAN VARGAS REYES 58:ce:2a:b4:82:d7 EAPOL: Timeout waiting for client EAP response 14 BBVA_GLOBAL AP-TM-13-MR56-01 oct 19 2026 13:01 Se contacta a usuario…' });
    const pasteMsg = h('p', { class: 'muted', role: 'status' });
    const doPaste = () => {
      const { rows, omitidos } = M.parsePegado(paste.value);
      if (!rows.length) { pasteMsg.textContent = 'No se reconoció ningún renglón. Revisa que cada caso tenga la MAC o el username, la falla, los intentos, el SSID y el AP.'; return; }
      draft.rows = draft.rows.filter((r) => r.mac || r.username || r.ap);
      rows.forEach((x) => draft.rows.push({ ...blank(), ...x, intentos: x.intentos ?? '', evento: x.evento || '', ssid: x.ssid || draft.ssid, estado: M.estadoDe(x.comentario), auto: true }));
      const f = rows.find((x) => x.fecha); if (f && f.fecha <= todayStr()) { draft.fecha = f.fecha; fecha.value = f.fecha; }
      paste.value = ''; draw();
      pasteMsg.textContent = `Se agregaron ${rows.length} renglones.${omitidos.length ? ` ${omitidos.length} líneas no se reconocieron y no se agregaron.` : ''} Revisa y completa antes de guardar.`;
    };
    const fecha = h('input', { id: 'mon-c-fecha', type: 'date', value: draft.fecha, max: todayStr(), onchange: (e) => { draft.fecha = e.target.value; } });
    const save = async (e) => {
      const rows = draft.rows.filter((r) => r.mac || r.username || r.ap || r.comentario);
      if (!draft.sedeId) { toast('Selecciona la sede.', 'error'); return; }
      if (!rows.length) { toast('Agrega al menos un caso.', 'error'); return; }
      e.currentTarget.disabled = true;
      try {
        const r = await api('POST', '/api/monitoreo/casos', { sedeId: draft.sedeId, fecha: draft.fecha, ingenieroId: draft.ingenieroId || undefined, casos: rows });
        toast(`Se registraron ${r.nuevos} casos${r.repetidos.length ? `; ${r.repetidos.length} ya estaban registrados ese día` : ''}${r.unificados ? `; ${r.unificados} usernames se ajustaron al ya registrado` : ''}`);
        draft.rows = []; view.panel = null; view.sede = String(draft.sedeId); CAT = null; await reload();
      } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
    };
    return h('section', { class: 'panel no-print mon-capture' }, h('h2', {}, 'Registrar revisión'),
      h('p', { class: 'muted' }, 'Un renglón por usuario o dispositivo revisado. Puedes pegar varios renglones a la vez desde Meraki, el Excel o el chat, y completar aquí lo que falte. El estado se propone solo según el comentario; puedes cambiarlo.'),
      h('div', { class: 'rd-filters' },
        h('div', { class: 'field' }, h('label', { for: 'mon-c-sede' }, 'Sede'), h('select', { id: 'mon-c-sede', onchange: (e) => { draft.sedeId = e.target.value; } }, h('option', { value: '' }, 'Selecciona…'), CAT.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === String(draft.sedeId) }, short(s.name))))),
        h('div', { class: 'field' }, h('label', { for: 'mon-c-fecha' }, 'Fecha de la revisión'), fecha),
        isAdmin() ? h('div', { class: 'field' }, h('label', { for: 'mon-c-ing' }, 'Ingeniero que atiende'), h('select', { id: 'mon-c-ing', onchange: (e) => { draft.ingenieroId = e.target.value; } }, CAT.ingenieros.map((u) => h('option', { value: u.id, selected: String(u.id) === String(draft.ingenieroId || state.user.id) }, u.name))))
          : h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ingeniero que atiende'), h('p', {}, h('strong', {}, state.user.name))),
        h('div', { class: 'field' }, h('label', { for: 'mon-c-ssid' }, 'SSID para renglones nuevos'), h('select', { id: 'mon-c-ssid', onchange: (e) => { draft.ssid = e.target.value; } }, CAT.ssids.map((s) => h('option', { value: s, selected: s === draft.ssid }, s))))),
      h('details', { class: 'section mon-paste', open: draft.rows.length <= 1 && !draft.rows[0].mac },
        h('summary', {}, 'Pegar varios renglones'),
        h('div', { class: 'section-body' }, paste, h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', onclick: doPaste }, 'Agregar a la tabla')), pasteMsg)),
      dl,
      h('div', { class: 'table-wrap' }, h('table', { class: 'table mon-grid' },
        h('thead', {}, h('tr', {}, ['#', 'Username', 'Nombre', 'MAC', 'Falla (log)', 'Intentos', 'SSID', 'AP', 'Último intento', 'Estado', 'Comentario', ''].map((t) => h('th', {}, t)))), tbody)),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { draft.rows.push(blank()); draw(); tbody.lastChild?.querySelector('input')?.focus(); } }, '+ Agregar renglón'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Guardar casos'),
        h('button', { class: 'btn', type: 'button', onclick: () => { view.panel = null; render(); } }, 'Cancelar')));
  }

  /* ---------- importación única del histórico (administrador) ---------- */
  function historicPanel() {
    const out = h('div', {});
    const input = h('input', { type: 'file', accept: '.xlsx', id: 'mon-h-file' });
    const send = async (modo) => {
      const f = input.files[0]; if (!f) { toast('Selecciona el archivo.', 'error'); return; }
      const res = await fetch(`/api/monitoreo/historico?modo=${modo}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: f });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'No se pudo leer el archivo.');
      return r;
    };
    const preview = async () => {
      try {
        const r = await send('vista');
        out.textContent = '';
        out.append(h('p', { class: 'notice' }, h('strong', {}, `${r.nuevos} casos nuevos`), `, ${r.repetidos} repetidos que se omiten. Nada se guarda hasta que confirmes.`),
          h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hoja'), h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Casos'), h('th', {}, 'Nota'))),
            h('tbody', {}, r.hojas.map((x) => h('tr', {}, h('td', {}, x.hoja), h('td', {}, x.sede ? short(x.sede) : '—'), h('td', { class: 'num-col plain' }, x.casos), h('td', { class: 'muted' }, x.nota || ''))))),
          h('p', {}, 'Estados propuestos por el comentario: ', M.ESTADOS.map((e) => `${e.short} ${r.porEstado[e.key]}`).join(' · '), '.'),
          r.totalAvisos ? h('details', { class: 'section' }, h('summary', {}, `${r.totalAvisos} avisos de fechas corregidas`), h('div', { class: 'section-body' }, h('ul', {}, r.avisos.map((a) => h('li', {}, a))))) : null,
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !r.nuevos, onclick: async (e) => { e.currentTarget.disabled = true; try { const x = await send('guardar'); toast(`Se importaron ${x.nuevos} casos`); view.panel = null; CAT = null; view.desde = null; view.hasta = null; await reload(); view.hasta = todayStr(); view.desde = CAT.rango.min || view.desde; await reload(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, `Importar ${r.nuevos} casos`)));
      } catch (err) { toast(err.message, 'error'); }
    };
    return h('section', { class: 'panel no-print' }, h('h2', {}, 'Importar histórico'),
      h('p', { class: 'muted' }, 'Para pasar una sola vez el Excel de seguimiento que se usaba antes (una hoja por sede). Las hojas con nombre de fecha se omiten porque repiten los casos de las hojas por sede. Desde ahora, los casos se registran en "Registrar revisión".'),
      h('div', { class: 'form-actions' }, input, h('button', { class: 'btn', type: 'button', onclick: preview }, 'Revisar archivo')), out);
  }

  window.PortalMonitoreo = {
    exportItems: () => (view.desde ? [{ label: 'Excel (CSV) de casos', hint: `Casos del ${dayMonth(view.desde)} al ${dayMonth(view.hasta)}`, href: `/api/monitoreo/export.csv?desde=${view.desde}&hasta=${view.hasta}` }] : []),
    async mount(el) {
      root = el; CAT = null; view.panel = null; view.open = null;
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando el monitoreo…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    open() { view.panel = 'nuevo'; render(); root?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  };
})();
