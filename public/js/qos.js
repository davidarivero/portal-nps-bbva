'use strict';
/* Homologación de QoS WLAN: pérdida de paquetes en las interfaces de switch hacia los AP.
   Pestañas: Reporte ejecutivo · Sedes · Interfaces · Cargas de archivos · Acerca de la iniciativa. Todo entra por archivo. */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const X = window.PortalQosComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
  const nint = (v) => nf(v, 0);
  const p1 = (v) => (v === null || v === undefined ? '—' : `${nf(v, 1)}%`);
  const sedeN = (k) => (X.SEDE[k] ? X.SEDE[k].name : 'Otra sede');
  const ddmm = (ts) => `${ts.slice(0, 10).split('-').reverse().join('/')} ${ts.slice(11, 16)}`;
  const plural = (n, uno, varios) => `${nint(n)} ${n === 1 ? uno : varios}`;
  const COLOR = { ok: '#3a9a6a', bad: '#2a2b2e', red: '#c8141b', obj: '#8a8b8f' };
  const TABS = [['resumen', 'Reporte ejecutivo'], ['sedes', 'Sedes'], ['interfaces', 'Interfaces'], ['cargas', 'Cargas de archivos'], ['acerca', 'Acerca de la iniciativa']];
  const view = { tab: 'resumen', corte: null, sede: null, estado: 'mal', q: '', fsede: '', limit: 100 };
  let root = null, D = null, R = [], EXT = { resumen: [], acerca: [] };
  const rowsCache = new Map();

  const corteSel = () => D.cortes.find((c) => c.id === view.corte) || null;
  const baseCorte = () => D.cortes.find((c) => c.tipo === 'base') || null;
  const segs = () => D.cortes.filter((c) => c.tipo === 'seguimiento');
  const inicial = () => { const b = baseCorte(); return b && b.clean !== null ? b.clean : D.inicial; };
  const objFinal = () => (D.objetivos.length ? D.objetivos[D.objetivos.length - 1] : { fecha: null, valor: 100 });
  const objVigente = (fecha) => D.objetivos.find((o) => o.fecha >= fecha) || objFinal();
  const esBase = (c) => c && c.tipo === 'base';
  /** Sedes ordenadas: primero las que no tienen pérdida. */
  const sedesOrden = (c) => Object.entries(c.sedes).map(([k, a]) => ({ k, ...a })).sort((a, b) => (b.clean ?? -1) - (a.clean ?? -1) || a.bad - b.bad || sedeN(a.k).localeCompare(sedeN(b.k)));
  const foco = (r) => r.d[0] + r.d[1] + r.d[2];
  const total = (a) => a[0] + a[1] + a[2] + a[3];

  async function reload() {
    D = await api('GET', '/api/qos/datos');
    if (!corteSel()) { const s = segs(); view.corte = s.length ? s[s.length - 1].id : D.cortes.length ? D.cortes[D.cortes.length - 1].id : null; }
    await loadRows();
    render();
  }
  async function loadRows() {
    R = [];
    if (!view.corte) return;
    const key = `${D.version}:${view.corte}`;
    if (!rowsCache.has(key)) { rowsCache.clear(); rowsCache.set(key, (await api('GET', `/api/qos/cortes/${view.corte}`)).filas); }
    R = rowsCache.get(key);
  }
  async function setCorte(id) { view.corte = Number(id); view.limit = 100; await loadRows(); render(); }

  /* =================== página =================== */
  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const c = corteSel();
    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, 'Homologación de QoS WLAN · Reporte ejecutivo'),
        h('p', {}, c ? `Todas las sedes · Corte del ${fullDate(c.fecha)}` : 'Sin cortes cargados'), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));
    const mal = c ? c.bad : 0;
    push(h('div', { class: 'mon-tabbar no-print', role: 'tablist' }, TABS.map(([k, t]) => h('button', {
      class: 'mon-tab' + (view.tab === k ? ' is-active' : ''), role: 'tab', type: 'button', 'aria-selected': String(view.tab === k), onclick: () => { view.tab = k; view.limit = 100; render(); } },
    t, k === 'interfaces' && mal && !esBase(c) ? h('span', { class: 'badge' }, `${mal} con pérdida`) : null))));
    if (!D.cortes.length && view.tab !== 'acerca' && view.tab !== 'cargas') push(vacio());
    else {
      if (['resumen', 'sedes', 'interfaces'].includes(view.tab)) push(corteBar(c));
      if (view.tab === 'resumen') push(resumen(c));
      else if (view.tab === 'sedes') push(sedesTab(c));
      else if (view.tab === 'interfaces') push(interfacesTab(c));
      else if (view.tab === 'cargas') push(cargasTab());
      else push(EXT.acerca, objetivosPanel());
    }
    root.append(...kids);
  }

  const vacio = () => h('section', { class: 'panel cx-empty' }, h('h2', {}, 'Aún no hay información cargada'),
    h('p', { class: 'muted' }, 'Esta iniciativa se alimenta solo con archivos: los respaldos de los switches con los contadores de colas de cada interfaz que conecta a un AP.'),
    h('ol', {}, h('li', {}, 'Carga la línea base: los archivos tomados antes de aplicar QoS.'), h('li', {}, 'Cada semana carga el seguimiento: los archivos tomados con la política aplicada. Puedes subir el .zip completo.')),
    canWrite() ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCarga() }, 'Cargar archivos')) : h('p', { class: 'muted' }, 'Pide a un ingeniero o administrador que cargue los archivos.'));

  const corteBar = (c) => h('div', { class: 'mon-filters no-print qos-cortebar' },
    h('div', { class: 'field' }, h('label', { for: 'qos-corte' }, 'Corte'), h('select', { id: 'qos-corte', onchange: (e) => setCorte(e.target.value) },
      D.cortes.slice().reverse().map((x) => h('option', { value: x.id, selected: x.id === view.corte }, `${fullDate(x.fecha)} · ${x.tipo === 'base' ? 'Línea base (antes de QoS)' : 'Seguimiento semanal'}`)))),
    h('p', { class: 'muted mon-range' }, c ? `${plural(c.n, 'interfaz hacia AP', 'interfaces hacia AP')} · ${plural(c.switches, 'switch', 'switches')} · ${plural(Object.keys(c.sedes).length, 'sede', 'sedes')}` : ''));

  const tile = (label, num, sub, cls) => h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-num' }, num), sub ? h('span', { class: 'tile-sub' }, sub) : null);
  const meter = (v, ok) => (v === null ? '—' : h('div', { class: 'cx-meter qos-meter' }, h('div', { class: 'cx-meter-bar' }, h('span', { style: `width:${v}%;background:${ok ? COLOR.ok : COLOR.bad}` })), h('span', {}, p1(v))));
  const num0 = (v) => (v ? h('strong', {}, nint(v)) : h('span', { class: 'muted' }, '0'));
  const cellCls = (d, e, src) => h('td', { class: 'num-col plain' }, d ? X.bytes(d) : '0', h('span', { class: 'meta' }, d ? (src === 'ap' ? 'sin dato de tráfico' : X.perdida(d, e)) : (e ? `de ${X.bytes(e)}` : '')));
  const estadoPill = (r, c) => {
    if (!r.ok) return h('span', { class: 'pill pill-none fw-pill', title: r.err || '' }, 'Sin lectura');
    if (!r.mal) return h('span', { class: 'pill pill-good fw-pill' }, esBase(c) ? 'Sin drops' : 'Sin pérdida');
    const w = X.peor({ nd: r.d, ne: r.e }, c.tipo);
    return h('span', { class: `pill pill-${w.p >= 1 ? 'crit' : 'warn'} fw-pill`, title: r.src === 'ap' ? '' : `Peor clase: ${X.CLASES[w.q].name}, ${X.perdida(r.d[w.q], r.e[w.q])}` }, esBase(c) ? 'Con drops' : w.p >= 1 ? 'Pérdida crítica' : 'Con pérdida');
  };

  /* ---------- ruta de objetivos ---------- */
  function rutaChart(sel) {
    const s = segs(); const objs = D.objetivos;
    const box = h('div', { class: 'qos-ruta' });
    if (!s.length && !objs.length) return box;
    const t = (f) => Date.parse(f + 'T00:00:00Z');
    const dates = [...s.map((x) => x.fecha), ...objs.map((o) => o.fecha)].sort();
    let t0 = t(dates[0]), t1 = t(dates[dates.length - 1]); if (t1 - t0 < 14 * 864e5) { t0 -= 7 * 864e5; t1 += 7 * 864e5; }
    const vals = [...s.map((x) => x.clean), ...objs.map((o) => o.valor)].filter((v) => v !== null);
    const lo = Math.min(...vals); const span = Math.max(100 - lo, 0.5);
    const step = span <= 1 ? 0.25 : span <= 2.5 ? 0.5 : span <= 5 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10;
    const y0v = Math.max(0, Math.floor((lo - step * 0.6) / step) * step);
    const W = 1100, H = 250, x0 = 64, x1 = W - 36, yT = 26, yB = H - 40;
    const Xf = (f) => x0 + ((t(f) - t0) / (t1 - t0)) * (x1 - x0), Yf = (v) => yB - ((v - y0v) / (100 - y0v)) * (yB - yT);
    const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const dec = step < 1 ? (step < 0.5 ? 2 : 1) : 0;
    let g = '';
    for (let v = y0v; v <= 100 + 1e-9; v += step) g += `<line x1="${x0}" x2="${x1}" y1="${Yf(v)}" y2="${Yf(v)}" stroke="${Math.abs(v - y0v) < 1e-9 ? '#c9c9c5' : '#ecece9'}"/><text x="${x0 - 10}" y="${Yf(v) + 4}" text-anchor="end" class="qr-ax">${v.toFixed(dec)}%</text>`;
    // objetivos mensuales: escalón punteado (vale hasta la fecha del objetivo)
    let px = x0, d = '';
    objs.forEach((o) => { const x = Xf(o.fecha), y = Yf(o.valor); d += `M${px.toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} `; px = x; });
    if (d) g += `<path d="${d}" fill="none" stroke="${COLOR.obj}" stroke-width="2" stroke-dasharray="6 5"/>`;
    objs.forEach((o) => { const x = Xf(o.fecha), y = Yf(o.valor); g += `<circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="${COLOR.obj}" stroke-width="2"><title>Objetivo ${esc(fullDate(o.fecha))}: ${nf(o.valor, 1)}%</title></circle><text x="${Math.min(x, x1 - 4)}" y="${y - 12}" text-anchor="${x > x1 - 30 ? 'end' : 'middle'}" class="qr-obj">${nf(o.valor, 1)}%</text><text x="${Math.min(x, x1 - 4)}" y="${H - 12}" text-anchor="${x > x1 - 30 ? 'end' : 'middle'}" class="qr-ax qr-b">${esc(dayMonth(o.fecha))}</text>`; });
    // seguimiento semanal
    const pts = s.filter((x) => x.clean !== null);
    if (pts.length > 1) g += `<path d="${pts.map((x, i) => `${i ? 'L' : 'M'}${Xf(x.fecha).toFixed(1)},${Yf(x.clean).toFixed(1)}`).join(' ')}" fill="none" stroke="${COLOR.red}" stroke-width="3"/>`;
    pts.forEach((x, i) => {
      const cx = Xf(x.fecha), cy = Yf(x.clean), isSel = sel && x.id === sel.id, lab = pts.length <= 8 || i === pts.length - 1 || isSel;
      g += `<circle cx="${cx}" cy="${cy}" r="${isSel ? 8 : 6}" fill="${COLOR.red}" stroke="#fff" stroke-width="2"><title>${esc(fullDate(x.fecha))}: ${nf(x.clean, 1)}% · ${x.bad} con pérdida</title></circle>`;
      if (lab) g += cx < x0 + 44 ? `<text x="${cx + 14}" y="${cy + 5}" text-anchor="start" class="qr-val">${nf(x.clean, 1)}%</text>` : `<text x="${cx}" y="${cy + 22}" text-anchor="middle" class="qr-val">${nf(x.clean, 1)}%</text>`;
      if (!objs.some((o) => Math.abs(t(o.fecha) - t(x.fecha)) < 6 * 864e5) && (pts.length <= 8 || i === 0 || i === pts.length - 1)) g += `<text x="${Math.max(cx, x0 + 18)}" y="${H - 12}" text-anchor="middle" class="qr-ax">${esc(dayMonth(x.fecha))}</text>`;
    });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Seguimiento semanal contra los objetivos mensuales">${g}</svg>`;
    return box;
  }
  function objetivoChips() {
    const s = segs(); const last = s.length ? s[s.length - 1] : null; const b = baseCorte();
    const chips = [h('div', { class: 'qos-step is-done' }, h('span', { class: 'qs-d' }, b ? `${dayMonth(b.fecha)} · antes de QoS` : 'Antes de QoS'), h('strong', {}, p1(inicial())), h('span', { class: 'qs-l' }, 'Métrica inicial'))];
    let next = false;
    D.objetivos.forEach((o, i) => {
      const prevs = s.filter((x) => x.fecha <= o.fecha); const ev = prevs.length ? prevs[prevs.length - 1] : null;
      const vencido = D.hoy > o.fecha; let cls = '', txt = '';
      if (vencido) { const ok = ev && ev.clean >= o.valor - 1e-9; cls = ok ? 'is-ok' : 'is-miss'; txt = ok ? 'Cumplido' : ev ? `No cumplido (${p1(ev.clean)})` : 'Sin corte en el mes'; }
      else if (!next) { next = true; cls = 'is-now'; const falta = last ? o.valor - last.clean : null; txt = falta === null ? 'Objetivo en curso' : falta <= 1e-9 ? 'En curso · ya se cumple' : `En curso · faltan ${nf(falta, 1)} pts`; }
      else txt = 'Objetivo';
      if (i === D.objetivos.length - 1) cls += ' is-final';
      chips.push(h('div', { class: 'qos-step ' + cls }, h('span', { class: 'qs-d' }, fullDate(o.fecha)), h('strong', {}, `${nf(o.valor, 1)}%`), h('span', { class: 'qs-l' }, i === D.objetivos.length - 1 ? `${txt} · final` : txt)));
    });
    return h('div', { class: 'qos-steps' }, chips);
  }
  function semanalTable(sel) {
    const s = segs().slice().reverse();
    if (!s.length) return h('p', { class: 'muted' }, 'Aún no hay cortes de seguimiento.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-sem' }, h('thead', {}, h('tr', {}, h('th', {}, 'Corte semanal'), h('th', { class: 'num-col' }, '% sin pérdida'), h('th', { class: 'num-col' }, 'Con pérdida'), h('th', {}, 'Cambio'), h('th', { class: 'num-col' }, 'Objetivo del mes'), h('th', {}, 'Brecha'), h('th', { class: 'num-col' }, 'Sedes sin pérdida'))),
      h('tbody', {}, s.map((c, i) => {
        const prev = s[i + 1]; const o = objVigente(c.fecha); const gap = c.clean === null ? null : o.valor - c.clean; const dlt = prev && prev.clean !== null && c.clean !== null ? c.clean - prev.clean : null;
        const ss = Object.values(c.sedes).filter((a) => a.read);
        return h('tr', { class: sel && c.id === sel.id ? 'is-sel' : '' }, h('td', { class: 'nowrap' }, h('button', { class: 'link-btn no-print', type: 'button', onclick: () => setCorte(c.id) }, fullDate(c.fecha)), h('span', { class: 'only-print-inline' }, fullDate(c.fecha))),
          h('td', { class: 'num-col plain' }, h('strong', {}, p1(c.clean))), h('td', { class: 'num-col plain' }, nint(c.bad)),
          h('td', {}, dlt === null ? h('span', { class: 'muted' }, 'Primer seguimiento') : Math.abs(dlt) < 0.05 ? h('span', { class: 'muted' }, 'Sin cambio') : h('span', { class: dlt > 0 ? 'ok-text' : 'warn-text' }, `${dlt > 0 ? '▲' : '▼'} ${nf(Math.abs(dlt), 1)} pts`)),
          h('td', { class: 'num-col plain' }, `${nf(o.valor, 1)}%`, h('span', { class: 'meta' }, dayMonth(o.fecha))),
          h('td', {}, gap === null ? '—' : gap <= 1e-9 ? h('span', { class: 'ok-text' }, '✓ Se cumple') : h('span', { class: 'warn-text' }, `Faltan ${nf(gap, 1)} pts`)),
          h('td', { class: 'num-col plain' }, `${ss.filter((a) => !a.bad).length} de ${ss.length}`));
      }))));
  }

  /* ---------- Reporte ejecutivo ---------- */
  function resumen(c) {
    const out = [];
    const ini = inicial(), fin = objFinal(), b = baseCorte();
    const s = segs(); const last = s.length ? s[s.length - 1] : null;
    const cur = esBase(c) ? (last || c) : c;
    const item = (label, num, unit, cls) => h('div', { class: 'trio-item' + (cls ? ' ' + cls : '') }, h('span', { class: 'trio-label' }, label), h('span', { class: 'trio-num' }, num), h('span', { class: 'trio-unit' }, unit));
    const delta = cur.clean === null || esBase(cur) ? null : cur.clean - ini; const o = objVigente(cur.fecha); const falta = cur.clean === null ? null : fin.valor - cur.clean;
    out.push(h('div', { class: 'mon-trio' }, h('p', { class: 'kpi-caption' }, 'Interfaces hacia AP sin pérdida en tráfico prioritario (Voice, Video) y Signaling · Todas las sedes'),
      h('div', { class: 'trio' },
        item('Métrica inicial', p1(ini), b ? `${fullDate(b.fecha)} · antes de QoS · ${nint(b.read - b.bad)} de ${nint(b.read)} interfaces sin drops` : 'antes de aplicar QoS'),
        item('Métrica actual', esBase(cur) ? '—' : p1(cur.clean), esBase(cur) ? 'Aún no hay seguimiento con QoS aplicado' : `${fullDate(cur.fecha)} · política ${X.POLITICA} · ${nint(cur.read - cur.bad)} de ${nint(cur.read)} interfaces leídas`, 'trio-current'),
        item('Métrica objetivo', `${nf(fin.valor, fin.valor % 1 ? 1 : 0)}%`, fin.fecha ? `${fullDate(fin.fecha)} · objetivos mensuales, seguimiento semanal` : 'objetivos mensuales')),
      delta === null ? null : h('p', { class: 'facts' }, h('span', { class: `pill pill-${falta <= 1e-9 ? 'good' : delta >= 0 ? 'prog' : 'crit'} fw-pill` }, falta <= 1e-9 ? 'Objetivo cumplido' : `${delta >= 0 ? '+' : ''}${nf(delta, 1)} pts vs. inicial`),
        falta > 1e-9 ? ` ${plural(cur.bad, 'interfaz por dejar', 'interfaces por dejar')} sin pérdida. Objetivo del mes: ${nf(o.valor, 1)}% al ${fullDate(o.fecha)}${cur.clean >= o.valor - 1e-9 ? ' (ya se cumple).' : ` (faltan ${nf(o.valor - cur.clean, 1)} pts).`}` : ' Todas las interfaces leídas están sin pérdida.',
        ' Cero tolerancia: cuenta cualquier descarte en Voice, Video o Signaling.')));

    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Ruta de objetivos mensuales · seguimiento semanal'), rutaChart(c),
      h('p', { class: 'legend mon-legend' }, h('span', {}, h('i', { class: 'mon-dot', style: `background:${COLOR.red}` }), 'Resultado de cada corte semanal'), h('span', {}, h('i', { class: 'mon-dot qos-dot-obj' }), 'Objetivo mensual')),
      objetivoChips(), h('h3', { class: 'qos-h3' }, 'Seguimiento semanal'), semanalTable(c)));

    // nivel 1
    const tot = c.clases.reduce((a, x) => a + x.enq, 0);
    const clsRow = (q) => {
      const k = c.clases[q], def = X.CLASES[q];
      const lectura = esBase(c) ? null : !def.foco ? h('span', { class: 'muted' }, 'Referencia') : k.ifs === 0 ? h('span', { class: 'pill pill-good fw-pill' }, 'Sin pérdida') : h('span', { class: 'pill pill-warn fw-pill' }, 'En seguimiento');
      return h('tr', { class: esBase(c) || def.foco ? '' : 'qos-ref' }, h('td', {}, h('span', { class: 'qos-cls' }, esBase(c) ? `Cola ${q + 1}` : def.name), h('span', { class: 'meta' }, esBase(c) ? 'antes de QoS' : def.hint)),
        h('td', { class: 'num-col plain' }, X.bytes(k.enq)), h('td', { class: 'num-col plain' }, X.bytes(k.drp)), h('td', { class: 'num-col plain' }, h('strong', {}, X.perdida(k.drp, k.enq))), h('td', { class: 'num-col plain' }, nint(k.ifs)), esBase(c) ? null : h('td', {}, lectura));
    };
    const modoTxt = esBase(c) ? (c.sinClases ? `${plural(c.sinClases, 'AP solo trae', 'AP solo traen')} el total de drops, sin switch ni tráfico (se cuentan en la cola 4).` : '')
      : c.delta ? `Pérdida nueva desde la carga anterior en ${plural(c.delta, 'interfaz', 'interfaces')}; acumulada desde que se aplicó la política o se reinició el contador en ${nint(c.read - c.delta)}.` : 'Primer seguimiento: la pérdida es la acumulada desde que se aplicó la política en cada switch.';
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, esBase(c) ? 'Nivel 1 · Descarte por cola antes de QoS · todas las sedes' : 'Nivel 1 · Pérdida por clase de tráfico · todas las sedes'),
      h('div', { class: 'cx-tiles' },
        tile('Interfaces hacia AP', nint(c.n), `${plural(c.switches, 'switch', 'switches')} · ${plural(Object.keys(c.sedes).length, 'sede', 'sedes')}`),
        tile(esBase(c) ? 'Sin drops' : 'Sin pérdida prioritaria ni Signaling', nint(c.read - c.bad), `${p1(c.clean)} de las leídas`, 'fw-t-good'),
        tile(esBase(c) ? 'Con drops' : 'Con pérdida en esas clases', nint(c.bad), esBase(c) ? `${X.bytes(c.drpTotal)} descartados` : `${X.bytes(c.drpFoco)} descartados`, c.bad ? 'fw-t-warn' : ''),
        tile('Sin lectura', nint(c.sinLectura), c.sinLectura ? 'revisar el comando en esos switches' : 'todas las interfaces se leyeron')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-clases' }, h('thead', {}, h('tr', {}, h('th', {}, esBase(c) ? 'Cola' : `Clase (política ${X.POLITICA})`), h('th', { class: 'num-col' }, 'Tráfico cursado'), h('th', { class: 'num-col' }, 'Descartado'), h('th', { class: 'num-col' }, '% de pérdida'), h('th', { class: 'num-col' }, esBase(c) ? 'Interfaces con drops' : 'Interfaces con pérdida'), esBase(c) ? null : h('th', {}, 'Lectura'))),
        h('tbody', {}, [0, 1, 2, 3].map(clsRow)))),
      h('p', { class: 'muted qos-note' }, esBase(c) ? 'Antes del QoS no existían las clases de la política: el indicador inicial cuenta cualquier descarte en la interfaz. ' : 'El indicador cuenta Voice, Video y Signaling; class-default se muestra como referencia. ', modoTxt, tot ? '' : '')));

    // nivel 2
    const so = sedesOrden(c);
    out.push(h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Nivel 2 · Resultado por sede · primero las sedes sin pérdida'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-sedes' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', { class: 'num-col' }, 'Interfaces AP'),
        esBase(c) ? null : [h('th', { class: 'num-col' }, 'Voice'), h('th', { class: 'num-col' }, 'Video'), h('th', { class: 'num-col' }, 'Signaling')],
        h('th', { class: 'num-col' }, esBase(c) ? 'Con drops' : 'Con pérdida'), h('th', {}, esBase(c) ? '% sin drops' : '% sin pérdida prioritaria ni Signaling'), h('th', { class: 'num-col' }, 'Descartado'), esBase(c) ? null : h('th', { class: 'num-col' }, 'class-default (ref.)'), esBase(c) || !b ? null : h('th', { class: 'num-col' }, 'Antes de QoS'))),
      h('tbody', {}, so.map((a) => h('tr', {}, h('td', {}, h('button', { class: 'link-btn qos-sede-btn no-print', type: 'button', onclick: () => { view.sede = a.k; view.tab = 'sedes'; render(); } }, sedeN(a.k)), h('strong', { class: 'only-print-inline' }, sedeN(a.k)), h('span', { class: 'meta' }, a.switches ? plural(a.switches, 'switch', 'switches') : 'sin dato de switch')),
        h('td', { class: 'num-col plain' }, nint(a.n), a.sinLectura ? h('span', { class: 'meta warn-text' }, `${a.sinLectura} sin lectura`) : null),
        esBase(c) ? null : [0, 1, 2].map((q) => h('td', { class: 'num-col plain' }, num0(a.clases[q].ifs))),
        h('td', { class: 'num-col plain' }, h('strong', {}, nint(a.bad))), h('td', {}, meter(a.clean, a.bad === 0)), h('td', { class: 'num-col plain' }, X.bytes(esBase(c) ? a.drpTotal : a.drpFoco)),
        esBase(c) ? null : h('td', { class: 'num-col plain' }, h('span', { class: 'muted' }, nint(a.clases[3].ifs))),
        esBase(c) || !b ? null : h('td', { class: 'num-col plain' }, b.sedes[a.k] && b.sedes[a.k].clean !== null ? h('span', { class: 'muted' }, p1(b.sedes[a.k].clean)) : h('span', { class: 'muted' }, 'Sin evidencia'))))))),
      h('p', { class: 'muted qos-note' }, esBase(c) ? 'Con drops = interfaces con cualquier descarte antes de aplicar QoS.' : 'Voice, Video y Signaling = interfaces con descarte en esa clase; una interfaz puede tener pérdida en más de una. Antes de QoS = % de interfaces sin ningún drop en la línea base.')));

    // foco y hallazgos
    const malas = R.filter((r) => r.mal).sort((x, y) => (esBase(c) ? total(y.d) - total(x.d) : foco(y) - foco(x)));
    out.push(h('div', { class: 'qos-g2' },
      h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, esBase(c) ? 'Interfaces con más drops antes de QoS' : 'Foco de atención · interfaces con pérdida en tráfico prioritario o Signaling'),
        malas.length ? focoTable(malas.slice(0, 10), c) : h('p', { class: 'ok-text' }, '✓ Ninguna interfaz leída tiene pérdida en estas clases.'),
        malas.length > 10 ? h('p', { class: 'muted qos-note' }, `Se muestran 10 de ${nint(malas.length)}. `, h('button', { class: 'link-btn no-print', type: 'button', onclick: () => { view.tab = 'interfaces'; view.estado = 'mal'; view.fsede = ''; render(); } }, 'Ver todas')) : null),
      h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, 'Hallazgos'), h('ul', { class: 'qos-hall' }, hallazgos(c).map((x) => h('li', {}, h('strong', {}, x[0]), ' ', x[1]))))));
    return out;
  }
  const focoTable = (rows, c) => h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-foco' }, h('thead', {}, h('tr', {}, h('th', {}, 'Switch'), h('th', {}, 'Interfaz'),
    esBase(c) ? h('th', { class: 'num-col' }, 'Drops') : [h('th', { class: 'num-col' }, 'Voice'), h('th', { class: 'num-col' }, 'Video'), h('th', { class: 'num-col' }, 'Signaling')], h('th', { class: 'num-col' }, 'Peor % de pérdida'), h('th', {}, 'Estado'))),
  h('tbody', {}, rows.map((r) => { const w = X.peor({ nd: r.d, ne: r.e }, c.tipo); return h('tr', {}, h('td', {}, h('strong', {}, r.h), h('span', { class: 'meta' }, sedeN(r.s))), h('td', { class: 'mono' }, r.i, r.ap ? h('span', { class: 'meta' }, r.ap) : null),
    esBase(c) ? h('td', { class: 'num-col plain' }, X.bytes(total(r.d))) : [0, 1, 2].map((q) => h('td', { class: 'num-col plain' }, r.d[q] ? X.bytes(r.d[q]) : h('span', { class: 'muted' }, '0'))),
    h('td', { class: 'num-col plain' }, r.src === 'ap' ? '—' : X.perdida(r.d[w.q], r.e[w.q]), r.src === 'ap' ? null : h('span', { class: 'meta' }, esBase(c) ? `Cola ${w.q + 1}` : X.CLASES[w.q].name)), h('td', {}, estadoPill(r, c))); }))));

  function hallazgos(c) {
    const out = []; const so = sedesOrden(c).filter((a) => a.read);
    const limpias = so.filter((a) => !a.bad), conMal = so.filter((a) => a.bad).sort((x, y) => y.bad - x.bad);
    const lista = (arr) => arr.map((a) => sedeN(a.k).split(' · ')[0]).join(', ').replace(/, ([^,]*)$/, ' y $1');
    if (esBase(c)) {
      out.push(['Antes de QoS:', `${nint(c.bad)} de ${nint(c.read)} interfaces hacia AP tenían drops (${X.bytes(c.drpTotal)} descartados).`]);
      const k = c.clases.map((x, q) => ({ q, d: x.drp })).sort((x, y) => y.d - x.d)[0];
      if (c.drpTotal) out.push([`Cola ${k.q + 1}:`, `concentra ${nf((k.d / c.drpTotal) * 100, 1)}% del descarte.`]);
      if (conMal.length) out.push([`${sedeN(conMal[0].k)}:`, `${nint(conMal[0].bad)} de ${nint(conMal[0].read)} interfaces con drops.`]);
      return out;
    }
    const v = c.clases[0];
    out.push(v.ifs === 0 ? ['Voice sin pérdida:', `0 bytes descartados sobre ${X.bytes(v.enq)}.`] : ['Voice:', `${X.bytes(v.drp)} descartados sobre ${X.bytes(v.enq)}, en ${plural(v.ifs, 'interfaz', 'interfaces')}.`]);
    if (conMal.length) {
      const top = conMal[0];
      out.push([`${sedeN(top.k)} concentra el pendiente:`, `${nint(top.bad)} de sus ${nint(top.n)} interfaces (${nf((top.bad / c.bad) * 100, 0)}% de las ${nint(c.bad)} con pérdida).`]);
      const peor = R.filter((r) => r.mal && r.src !== 'ap').map((r) => ({ r, w: X.peor({ nd: r.d, ne: r.e }, c.tipo) })).sort((x, y) => y.w.p - x.w.p)[0];
      if (peor) out.push(['Interfaz más afectada:', `${peor.r.i} de ${peor.r.h} pierde ${X.perdida(peor.r.d[peor.w.q], peor.r.e[peor.w.q])} de ${X.CLASES[peor.w.q].name}.`]);
      conMal.slice(1, 3).forEach((a) => out.push([`${sedeN(a.k)}:`, `${plural(a.bad, 'interfaz', 'interfaces')} de ${nint(a.n)} con pérdida.`]));
    }
    if (limpias.length) out.push([limpias.length === so.length ? 'Todas las sedes sin pérdida.' : `Sin pérdida en estas clases (${limpias.length} de ${so.length} sedes):`, limpias.length === so.length ? '' : `${lista(limpias)}.`]);
    const s = segs(); const i = s.findIndex((x) => x.id === c.id);
    if (i > 0) { const d = c.bad - s[i - 1].bad; out.push(['Contra el corte anterior:', d === 0 ? 'mismo número de interfaces con pérdida.' : `${Math.abs(d)} ${Math.abs(d) === 1 ? 'interfaz' : 'interfaces'} ${d < 0 ? 'menos' : 'más'} con pérdida (${nint(s[i - 1].bad)} → ${nint(c.bad)}).`]); }
    if (c.sinLectura) out.push(['Sin lectura:', `${plural(c.sinLectura, 'interfaz no se pudo', 'interfaces no se pudieron')} leer; no cuentan en el indicador.`]);
    return out;
  }

  /* ---------- Sedes ---------- */
  function sedesTab(c) {
    const so = sedesOrden(c);
    if (!view.sede || !c.sedes[view.sede]) view.sede = (so.find((a) => a.bad) || so[0]).k;
    const a = { k: view.sede, ...c.sedes[view.sede] };
    const rows = R.filter((r) => r.s === view.sede).sort((x, y) => Number(y.mal) - Number(x.mal) || (esBase(c) ? total(y.d) - total(x.d) : foco(y) - foco(x)) || Number(x.ok) - Number(y.ok) || x.h.localeCompare(y.h) || x.i.localeCompare(y.i, 'es', { numeric: true }));
    const shown = rows.slice(0, view.limit);
    const b = baseCorte();
    const peorCls = [0, 1, 2].filter((q) => a.clases[q].ifs).map((q) => X.CLASES[q].name);
    const lectura = esBase(c) ? null : a.bad === 0 ? `${sedeN(a.k)} no descarta tráfico prioritario ni de Signaling en ninguna interfaz leída.`
      : `La pérdida de ${sedeN(a.k)} está en ${peorCls.join(' y ')}: ${plural(a.bad, 'interfaz', 'interfaces')} de ${nint(a.read)} leídas${a.clases[0].ifs + a.clases[1].ifs === 0 ? '; las colas de prioridad (Voice y Video) no descartan.' : '.'}`;
    return [
      h('div', { class: 'tabs qos-sedetabs no-print' }, so.map((x) => h('button', { class: 'tab' + (x.k === view.sede ? ' is-active' : ''), type: 'button', onclick: () => { view.sede = x.k; view.limit = 100; render(); } }, sedeN(x.k), x.bad ? h('span', { class: 'badge' }, x.bad) : h('span', { class: 'qos-okmark' }, '✓')))),
      h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `${sedeN(a.k)} · corte del ${fullDate(c.fecha)}`),
        h('div', { class: 'cx-tiles' },
          tile('Interfaces hacia AP', nint(a.n), a.switches ? plural(a.switches, 'switch', 'switches') : 'sin dato de switch'),
          tile(esBase(c) ? 'Sin drops' : 'Sin pérdida prioritaria ni Signaling', p1(a.clean), `${nint(a.read - a.bad)} de ${nint(a.read)} interfaces leídas`, a.bad ? '' : 'fw-t-good'),
          tile(esBase(c) ? 'Con drops' : 'Con pérdida', nint(a.bad), X.bytes(esBase(c) ? a.drpTotal : a.drpFoco) + ' descartados', a.bad ? 'fw-t-warn' : ''),
          esBase(c) ? tile('Sin lectura', nint(a.sinLectura), '') : tile('Antes de QoS', b && b.sedes[a.k] && b.sedes[a.k].clean !== null ? p1(b.sedes[a.k].clean) : '—', b && b.sedes[a.k] ? `${nint(b.sedes[a.k].bad)} de ${nint(b.sedes[a.k].read)} interfaces con drops` : 'sin evidencia previa')),
        lectura ? h('p', { class: 'qos-callout' }, h('strong', {}, 'Lectura: '), lectura) : null,
        a.sinLectura ? h('p', { class: 'muted qos-note' }, `${plural(a.sinLectura, 'interfaz sin lectura', 'interfaces sin lectura')}: no cuentan en el indicador.`) : null),
      h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, esBase(c) ? 'Interfaces hacia AP · descarte por cola' : 'Interfaces hacia AP · descarte por clase'), ifTable(shown, c, false),
        rows.length > shown.length ? h('p', { class: 'no-print' }, h('button', { class: 'btn', type: 'button', onclick: () => { view.limit += 200; render(); } }, `Mostrar más (${nint(rows.length - shown.length)} restantes)`)) : null,
        h('p', { class: 'muted qos-note' }, 'Bajo cada valor: % de pérdida de esa clase, o el tráfico cursado cuando no hay descarte. Da clic en una interfaz para ver su historial.'))];
  }
  const ifTable = (rows, c, conSede) => h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-ifs' }, h('thead', {}, h('tr', {}, h('th', {}, 'Switch · interfaz'),
    (esBase(c) ? ['Cola 1', 'Cola 2', 'Cola 3', 'Cola 4'] : ['Voice', 'Video', 'Signaling', 'class-default (ref.)']).map((t) => h('th', { class: 'num-col' }, t)), h('th', { class: 'num-col' }, 'Tráfico total'), h('th', {}, 'Estado'))),
  h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: 'qos-row', tabindex: '0', onclick: () => openHistorial(r), onkeydown: (e) => { if (e.key === 'Enter') openHistorial(r); } },
    h('td', {}, h('strong', { class: 'mono' }, r.i), h('span', { class: 'meta' }, [conSede ? sedeN(r.s) : null, r.h, r.ap].filter(Boolean).join(' · '))),
    r.ok ? [0, 1, 2, 3].map((q) => cellCls(r.d[q], r.e[q], r.src)) : h('td', { class: 'muted', colspan: '4' }, r.err || 'Sin lectura'),
    h('td', { class: 'num-col plain' }, r.ok && r.src !== 'ap' ? X.bytes(total(r.e)) : '—'), h('td', {}, estadoPill(r, c)))) : h('tr', {}, h('td', { colspan: '7', class: 'muted' }, 'Sin interfaces con ese filtro.')))));

  /* ---------- Interfaces ---------- */
  function interfacesTab(c) {
    const qn = X.plain(view.q).trim();
    const est = (r) => (!r.ok ? 'nr' : r.mal ? 'mal' : 'ok');
    const base = R.filter((r) => (!view.fsede || r.s === view.fsede) && (!qn || X.plain(`${r.h} ${r.i} ${r.ip || ''} ${r.ap || ''} ${sedeN(r.s)}`).includes(qn)));
    const cnt = { mal: 0, ok: 0, nr: 0 }; base.forEach((r) => { cnt[est(r)] += 1; });
    const rows = base.filter((r) => view.estado === 'todas' || est(r) === view.estado).sort((x, y) => (esBase(c) ? total(y.d) - total(x.d) : foco(y) - foco(x)) || total(y.d) - total(x.d) || x.h.localeCompare(y.h) || x.i.localeCompare(y.i, 'es', { numeric: true }));
    const shown = rows.slice(0, view.limit);
    const tab = (k, t, n) => h('button', { class: 'tab' + (view.estado === k ? ' is-active' : ''), type: 'button', onclick: () => { view.estado = k; view.limit = 100; render(); } }, `${t} (${nint(n)})`);
    const search = h('input', { type: 'search', id: 'qos-q', placeholder: 'Buscar switch, interfaz, IP o AP', value: view.q, 'aria-label': 'Buscar interfaz' });
    let timer = null; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { view.q = search.value; view.limit = 100; render(); const el = document.getElementById('qos-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); });
    return h('section', { class: 'panel mon-level' }, h('p', { class: 'mon-eyebrow' }, `Interfaces de switch hacia AP · corte del ${fullDate(c.fecha)}`),
      h('div', { class: 'qos-ifilters no-print' },
        h('div', { class: 'tabs' }, tab('mal', esBase(c) ? 'Con drops' : 'Con pérdida', cnt.mal), tab('ok', esBase(c) ? 'Sin drops' : 'Sin pérdida', cnt.ok), tab('nr', 'Sin lectura', cnt.nr), tab('todas', 'Todas', base.length)),
        h('select', { 'aria-label': 'Sede', onchange: (e) => { view.fsede = e.target.value; view.limit = 100; render(); } }, h('option', { value: '' }, 'Todas las sedes'), sedesOrden(c).map((a) => h('option', { value: a.k, selected: a.k === view.fsede }, sedeN(a.k)))), search),
      ifTable(shown, c, true),
      rows.length > shown.length ? h('p', { class: 'no-print' }, h('button', { class: 'btn', type: 'button', onclick: () => { view.limit += 200; render(); } }, `Mostrar más (${nint(rows.length - shown.length)} restantes)`)) : null,
      h('p', { class: 'muted qos-note' }, `${nint(rows.length)} interfaces. Da clic en una para ver su historial semana a semana.`));
  }

  /* ---------- Cargas ---------- */
  function cargasTab() {
    const admin = isAdmin();
    return [
      h('section', { class: 'panel' }, h('div', { class: 'qos-head' }, h('div', {}, h('h2', {}, 'Cortes cargados'), h('p', { class: 'muted' }, 'Un corte agrupa los archivos de una fecha. No hay captura manual: toda la información entra por archivo.')),
        canWrite() ? h('button', { class: 'btn btn-primary no-print', type: 'button', onclick: () => openCarga() }, 'Cargar archivos') : null),
      D.cortes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Corte'), h('th', {}, 'Tipo'), h('th', { class: 'num-col' }, 'Interfaces'), h('th', { class: 'num-col' }, 'Sin lectura'), h('th', { class: 'num-col' }, 'Con pérdida'), h('th', { class: 'num-col' }, '% sin pérdida'), h('th', {}, ''))),
        h('tbody', {}, D.cortes.slice().reverse().map((c) => h('tr', {}, h('td', { class: 'nowrap' }, h('strong', {}, fullDate(c.fecha))), h('td', {}, X.TIPOS[c.tipo]), h('td', { class: 'num-col plain' }, nint(c.n)), h('td', { class: 'num-col plain' }, nint(c.sinLectura)), h('td', { class: 'num-col plain' }, nint(c.bad)), h('td', { class: 'num-col plain' }, p1(c.clean)),
          h('td', { class: 'actions no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: async () => { view.tab = 'resumen'; await setCorte(c.id); } }, 'Ver'),
            admin ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/qos/cortes/${c.id}`); toast('Corte eliminado'); refreshAll(); }) }, 'Eliminar') : null)))))) : h('p', { class: 'empty' }, 'Aún no hay cortes.')),
      h('section', { class: 'panel' }, h('h2', {}, 'Archivos cargados'),
        D.cargas.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Cuándo'), h('th', {}, 'Archivo'), h('th', {}, 'Corte'), h('th', { class: 'num-col' }, 'Interfaces'), h('th', {}, 'Cargó'), h('th', {}, ''))),
          h('tbody', {}, D.cargas.map((g) => { const c = D.cortes.find((x) => x.id === g.corteId); return h('tr', {}, h('td', { class: 'nowrap' }, ddmm(g.ts.replace('T', ' '))), h('td', {}, g.archivo, h('span', { class: 'meta' }, (g.resumen.sedes || []).map((s) => `${sedeN(s.sede).split(' · ')[0]} ${s.interfaces}`).join(' · '))),
            h('td', { class: 'nowrap' }, c ? dayMonth(c.fecha) : '—'), h('td', { class: 'num-col plain' }, nint(g.resumen.interfaces), g.vigentes < g.resumen.interfaces ? h('span', { class: 'meta' }, `${nint(g.vigentes)} vigentes`) : null), h('td', {}, g.user || '—'),
            h('td', { class: 'actions no-print' }, admin ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/qos/cargas/${g.id}`); toast('Carga deshecha'); refreshAll(); }) }, 'Deshacer') : null)); })))) : h('p', { class: 'empty' }, 'Aún no se ha cargado ningún archivo.')),
      h('section', { class: 'panel' }, h('h2', {}, 'Formatos que reconoce'), h('ul', { class: 'qos-hall' },
        h('li', {}, h('strong', {}, '.zip'), ' con los respaldos de los switches (puede traer carpetas por sede y mezclar .txt y .xlsx).'),
        h('li', {}, h('strong', {}, '.txt'), ' del respaldo automático (Backup_QoS_IP_HOSTNAME.txt) o de consola, con la salida de «show platform hardware fed [switch] active qos queue stats interface X» de cada interfaz hacia AP.'),
        h('li', {}, h('strong', {}, '.xlsx'), ' con las columnas Hostname, Interfaz y Salida FED, o con una hoja por sede y las columnas AP, Puerto y Drops (solo para la línea base).')),
      h('p', { class: 'muted' }, 'La sede se identifica por el nombre del switch (TF, CO, MURANO, TOREO, Tecno, GDL, MTY, PUEBLA, LEON, TIJUANA). La fecha sugerida sale del «show clock» o del nombre del archivo.'))];
  }

  /* ---------- objetivos ---------- */
  function objetivosPanel() {
    return h('section', { class: 'panel' }, h('div', { class: 'qos-head' }, h('div', {}, h('h2', {}, 'Objetivos mensuales'), h('p', { class: 'muted' }, 'El indicador se revisa cada semana contra el objetivo del mes en curso. La métrica inicial sale de la línea base cargada.')),
      isAdmin() ? h('button', { class: 'btn no-print', type: 'button', onclick: () => openObjetivos() }, 'Editar objetivos') : null),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Fecha objetivo'), h('th', { class: 'num-col' }, '% de interfaces sin pérdida'))),
      h('tbody', {}, h('tr', {}, h('td', {}, 'Métrica inicial (antes de QoS)'), h('td', { class: 'num-col plain' }, p1(inicial()))), D.objetivos.map((o, i) => h('tr', {}, h('td', {}, fullDate(o.fecha), i === D.objetivos.length - 1 ? h('span', { class: 'meta' }, 'Objetivo final') : null), h('td', { class: 'num-col plain' }, h('strong', {}, `${nf(o.valor, 1)}%`))))))));
  }

  /* =================== panel lateral =================== */
  let drawer = null, dirty = false, uid = 0;
  function openDrawer(title, body, wide) {
    closeDrawer(true);
    const titleEl = h('h2', { id: 'qos-d-title' }, title);
    const panel = h('aside', { class: 'mon-drawer no-print' + (wide ? ' is-wide' : ''), role: 'dialog', 'aria-labelledby': 'qos-d-title' },
      h('header', { class: 'mon-dhead' }, titleEl, h('button', { class: 'mon-dclose', type: 'button', 'aria-label': 'Cerrar panel', onclick: () => closeDrawer() }, '✕')), h('div', { class: 'mon-dbody' }, body));
    document.body.append(panel); document.body.classList.add('mon-drawer-open');
    drawer = { panel, titleEl }; return drawer;
  }
  function refreshAll() { state.stale = true; window.Portal.route(); }
  function closeDrawer(silent) { if (!drawer) return; drawer.panel.remove(); drawer = null; document.body.classList.remove('mon-drawer-open'); if (!silent && dirty) { dirty = false; refreshAll(); } }
  const saved = (msg) => { toast(msg); dirty = true; closeDrawer(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); });
  window.addEventListener('hashchange', () => { if (drawer) closeDrawer(true); dirty = false; });
  const ctl = (tag, attrs, ...k) => h(tag, { id: 'qos-f-' + (++uid), ...attrs }, ...k);
  const field = (label, control, extra) => h('div', { class: 'field' }, h('label', { for: control.id }, label), control, extra || null);

  function openCarga() {
    const input = ctl('input', { type: 'file', accept: '.zip,.txt,.log,.xlsx', multiple: true }); const out = h('div', {}); let items = [];
    const send = async (file, modo, extra = '') => {
      const res = await fetch(`/api/qos/importar?modo=${modo}&nombre=${encodeURIComponent(file.name)}${extra}`, { method: 'POST', headers: { 'X-Requested-With': 'portal', 'Content-Type': 'application/octet-stream' }, body: file }).catch(() => { throw new Error('No se pudo enviar el archivo. Revisa tu conexión.'); });
      const r = await res.json().catch(() => ({})); if (!res.ok) throw new Error(r.error || 'No se pudo leer el archivo.'); return r;
    };
    const revisar = async (btn) => {
      const files = [...input.files].filter((f) => !f.name.startsWith('~$') && !f.name.startsWith('._'));
      if (!files.length) { toast('Selecciona uno o varios archivos .zip, .txt o .xlsx.', 'error'); return; }
      btn.disabled = true; out.textContent = ''; out.append(h('p', { class: 'loading' }, `Leyendo ${plural(files.length, 'archivo', 'archivos')}…`)); items = [];
      for (const f of files) { try { const r = await send(f, 'vista'); items.push({ f, r, fecha: r.fechaSugerida || D.hoy, tipo: r.tipoSugerido }); } catch (e) { items.push({ f, r: { errores: [e.message], avisos: [], hayErrores: true, sedes: [] } }); } }
      btn.disabled = false; draw();
    };
    const draw = () => {
      out.textContent = '';
      const okItems = items.filter((x) => !x.r.hayErrores);
      out.append(...items.map((x) => {
        const { f, r } = x;
        if (r.hayErrores) return h('div', { class: 'qos-file' }, h('p', {}, h('strong', {}, f.name)), h('p', { class: 'form-error' }, r.errores.join(' ')));
        const fecha = ctl('input', { type: 'date', value: x.fecha, max: D.hoy, onchange: (e) => { x.fecha = e.target.value; draw(); } });
        const tipo = ctl('select', { onchange: (e) => { x.tipo = e.target.value; draw(); } }, Object.entries(X.TIPOS).map(([k, t]) => h('option', { value: k, selected: k === x.tipo }, t)));
        const ya = D.cortes.find((c) => c.fecha === x.fecha);
        return h('div', { class: 'qos-file' }, h('p', {}, h('strong', {}, f.name)),
          h('p', { class: 'muted' }, `${plural(r.switches, 'switch', 'switches')} · `, h('strong', {}, plural(r.interfaces, 'interfaz hacia AP', 'interfaces hacia AP')), ` · ${nint(r.conFoco)} con pérdida en Voice, Video o Signaling · ${nint(r.conDrops)} con algún drop · ${nint(r.sinLectura)} sin lectura`),
          h('p', { class: 'meta' }, r.sedes.map((s) => `${sedeN(s.sede)}: ${nint(s.interfaces)}`).join(' · ')),
          r.avisos.length ? h('ul', { class: 'qos-avisos' }, r.avisos.map((a) => h('li', {}, a))) : null,
          r.errores.length ? h('p', { class: 'form-error' }, r.errores.join(' ')) : null,
          h('div', { class: 'mon-g2' }, field('Fecha de corte', fecha, r.fechas.length > 1 ? h('span', { class: 'meta' }, `El archivo trae ${r.fechas.map((d) => `${dayMonth(d.fecha)} (${d.n})`).join(' y ')}; todo se guarda en el corte elegido.`) : null), field('Tipo de carga', tipo)),
          ya ? h('p', { class: ya.tipo === x.tipo ? 'meta' : 'form-error' }, ya.tipo === x.tipo ? `Ya existe el corte del ${dayMonth(x.fecha)}: se agregan o actualizan sus interfaces.` : `El corte del ${dayMonth(x.fecha)} ya existe como «${X.TIPOS[ya.tipo]}».`) : null,
          x.tipo === 'seguimiento' && r.sinClases ? h('p', { class: 'form-error' }, 'El Excel de AP, puerto y drops no separa las clases: solo sirve para la línea base.') : null);
      }));
      out.append(h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !okItems.length, onclick: async (e) => {
        e.currentTarget.disabled = true; let n = 0; const errs = []; let lastCorte = null;
        for (const x of okItems) { try { const g = await send(x.f, 'guardar', `&fecha=${x.fecha}&tipo=${x.tipo}`); n += 1; lastCorte = g.corteId; } catch (err) { errs.push(`${x.f.name}: ${err.message}`); } }
        if (errs.length) toast(errs.join(' · '), 'error');
        if (n) { if (lastCorte) view.corte = lastCorte; view.tab = 'resumen'; saved(`Se ${n === 1 ? 'cargó 1 archivo' : `cargaron ${n} archivos`}`); } else e.currentTarget.disabled = false;
      } }, `Guardar ${plural(okItems.length, 'archivo', 'archivos')}`)));
    };
    openDrawer('Cargar archivos de QoS', h('div', {},
      h('p', { class: 'muted' }, 'Sube el .zip con los respaldos de los switches (o los .txt y .xlsx sueltos). El portal identifica cada switch, su sede y sus interfaces hacia AP, y te muestra el resumen antes de guardar.'),
      h('p', { class: 'muted' }, 'Línea base = archivos tomados antes de aplicar QoS. Seguimiento semanal = archivos tomados con la política aplicada.'),
      field('Archivos .zip, .txt o .xlsx', input), h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn', type: 'button', onclick: (e) => revisar(e.currentTarget) }, 'Revisar archivos')), out), true);
  }

  async function openHistorial(r) {
    const body = h('div', {}, h('p', { class: 'loading' }, 'Cargando el historial…'));
    openDrawer(`${r.i} · ${r.h}`, body, true);
    try {
      const H = await api('GET', `/api/qos/interfaz?host=${encodeURIComponent(r.h)}&intf=${encodeURIComponent(r.i)}`);
      body.textContent = '';
      body.append(h('dl', { class: 'mon-dl' }, [['Sede', sedeN(r.s)], ['Switch', r.h], ['IP', r.ip], ['Interfaz', r.i], ['Detalle', r.ap]].filter((x) => x[1]).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        h('h3', { class: 'mon-dh3' }, 'Historial por corte'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table qos-hist' }, h('thead', {}, h('tr', {}, h('th', {}, 'Corte'), ['Voice', 'Video', 'Signaling', 'class-default'].map((t) => h('th', { class: 'num-col' }, t)), h('th', {}, 'Estado'))),
          h('tbody', {}, H.historial.slice().reverse().map((x) => { const c = { tipo: x.tipo }; return h('tr', {}, h('td', { class: 'nowrap' }, h('strong', {}, dayMonth(x.fecha)), h('span', { class: 'meta' }, x.tipo === 'base' ? 'Antes de QoS' : x.modo === 'delta' ? 'Desde la carga anterior' : x.modo === 'reinicio' ? 'Contador reiniciado' : 'Acumulado'),
            ), x.ok ? [0, 1, 2, 3].map((q) => cellCls(x.d[q], x.e[q], r.src)) : h('td', { class: 'muted', colspan: '4' }, x.err || 'Sin lectura'), h('td', {}, estadoPill({ ...x, src: r.src }, c))); })))),
        h('p', { class: 'muted qos-note' }, 'En la línea base las columnas son las colas 1 a 4 (antes de QoS no existían las clases). En cada seguimiento se muestra la pérdida nueva desde la carga anterior; si el switch reinició el contador, la acumulada desde el reinicio.'));
    } catch (err) { body.textContent = ''; body.append(h('p', { class: 'form-error' }, err.message)); }
  }

  function openObjetivos() {
    let rows = D.objetivos.map((o) => ({ ...o })); const list = h('div', {}); const msg = h('p', { class: 'form-error', hidden: true });
    const draw = () => {
      list.textContent = '';
      list.append(...rows.map((o, i) => h('div', { class: 'qos-objrow' },
        h('input', { type: 'date', value: o.fecha, 'aria-label': `Fecha del objetivo ${i + 1}`, onchange: (e) => { o.fecha = e.target.value; } }),
        h('input', { type: 'number', min: '0', max: '100', step: '0.1', value: o.valor, 'aria-label': `Valor del objetivo ${i + 1} en porcentaje`, onchange: (e) => { o.valor = e.target.value; } }), h('span', {}, '%'),
        h('button', { class: 'link-btn', type: 'button', disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); draw(); } }, 'Quitar'))));
    };
    draw();
    openDrawer('Objetivos mensuales', h('div', {},
      h('p', { class: 'muted' }, 'Un objetivo por mes: la fecha límite y el porcentaje de interfaces hacia AP sin pérdida que debe alcanzarse. El último es el objetivo final.'),
      list, h('p', {}, h('button', { class: 'btn', type: 'button', onclick: () => { const last = rows[rows.length - 1]; const d = new Date(last.fecha + 'T00:00:00Z'); const nx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)); rows.push({ fecha: nx.toISOString().slice(0, 10), valor: last.valor }); draw(); } }, 'Agregar mes')), msg,
      h('div', { class: 'mon-dfoot' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true; msg.hidden = true;
        try { await api('PUT', '/api/qos/objetivos', { objetivos: rows.map((o) => ({ fecha: o.fecha, valor: Number(o.valor) })) }); saved('Objetivos guardados'); } catch (err) { msg.textContent = err.message; msg.hidden = false; e.currentTarget.disabled = false; }
      } }, 'Guardar objetivos'), h('button', { class: 'btn', type: 'button', onclick: () => closeDrawer() }, 'Cancelar'))));
  }

  // el PDF siempre es el reporte ejecutivo
  let prevTab = null;
  window.addEventListener('beforeprint', () => { if (root?.isConnected && !document.body.classList.contains('qos-deck-print') && view.tab !== 'resumen') { prevTab = view.tab; view.tab = 'resumen'; render(); } });
  window.addEventListener('afterprint', () => { if (prevTab && root?.isConnected) { view.tab = prevTab; prevTab = null; render(); } });

  window.PortalQos = {
    exportItems: () => [
      { label: 'Presentación ejecutiva (PPTX)', hint: 'PowerPoint con el corte seleccionado', onClick: () => window.PortalQosDeck?.pptx(deckData()) },
      { label: 'Presentación ejecutiva (PDF)', hint: 'Las mismas láminas, listas para enviar', onClick: () => window.PortalQosDeck?.pdf(deckData()) },
      { label: 'Semanal por sede (Excel CSV)', hint: 'Cada corte: % sin pérdida y clases por sede', href: '/api/qos/export/semanal.csv' },
      { label: 'Interfaces del corte (Excel CSV)', hint: 'Una fila por interfaz hacia AP', href: `/api/qos/export/interfaces.csv${view.corte ? `?corte=${view.corte}` : ''}` },
    ],
    async mount(el, ext) {
      root = el; EXT = { resumen: (ext?.resumen || []).filter(Boolean), acerca: (ext?.acerca || []).filter(Boolean) };
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando la homologación de QoS…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    nuevo() { if (D) openCarga(); },
  };
  /** Datos del corte seleccionado para la presentación ejecutiva. */
  function deckData() {
    const c = corteSel(); if (!c) { toast('Aún no hay cortes cargados.', 'error'); return null; }
    return { c, base: baseCorte(), segs: segs(), objetivos: D.objetivos, inicial: inicial(), fin: objFinal(), obj: objVigente(c.fecha), sedes: sedesOrden(c), esBase: esBase(c), hoy: D.hoy,
      malas: R.filter((r) => r.mal).sort((x, y) => (esBase(c) ? total(y.d) - total(x.d) : foco(y) - foco(x))), hallazgos: hallazgos(c), chart: rutaChart(c).innerHTML,
      cliente: state.data.program.client, autor: state.user.name, h: { nf, nint, p1, sedeN, plural, fullDate, dayMonth, total, foco } };
  }
})();
