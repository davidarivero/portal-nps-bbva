'use strict';
/* Recorridos proactivos: tablero diario, captura con evidencias y OCR, y reporte para imprimir en PDF. */
(() => {
  const { h, add, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr, MONTHS } = window.Portal;
  const P = window.Pruebas;
  const nf = (v, d = 2) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v);
  const LV = { good: 'Bueno', regular: 'Regular', alarm: 'Alarmante' };
  const SRC = { ocr: 'Leído por OCR', ocr_editado: 'OCR corregido a mano', manual: 'Captura manual' };
  const shortSede = (s) => s.replace(/^BBVA\s+/i, '');
  const localStamp = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lvCell = (level) => (level ? ' lv lv-' + level : '');
  let catalog = null;
  const loadCatalog = async (force) => { if (!catalog || force) catalog = await api('GET', '/api/recorridos/catalogo'); return catalog; };
  const filters = { desde: null, hasta: null, sede: '', ssid: '' };

  const mayEdit = (w) => isAdmin() || (state.user.role === 'ingeniero' && w.ejecutorId === state.user.id);
  const walkLevel = (w) => P.worst(P.TESTS.flatMap((t) => { const p = w.pruebas[t.key]; return p && !p.na ? P.evaluate(t, p.values).map((e) => e.level) : []; }));
  const doneCount = (w) => P.TESTS.filter((t) => { const p = w.pruebas[t.key]; return p && (p.na || (p.hasEvidence && P.hasRequired(t, p.values) && !p.review)); }).length;
  const levelPill = (level) => (level ? h('span', { class: 'pill lvp lvp-' + level }, h('span', { class: 'pill-icon', 'aria-hidden': 'true' }, level === 'good' ? '✓' : level === 'regular' ? '!' : '▲'), LV[level]) : h('span', { class: 'muted' }, 'Sin resultados'));

  /* =========================================================
   * Tablero de recorridos
   * ========================================================= */
  async function viewDashboard() {
    await loadCatalog();
    if (!filters.hasta) { filters.hasta = todayStr(); filters.desde = addDays(filters.hasta, -29); }
    const { recorridos: all } = await api('GET', `/api/recorridos?desde=${filters.desde}&hasta=${filters.hasta}`);
    const walks = all.filter((w) => (!filters.sede || String(w.sedeId) === filters.sede) && (!filters.ssid || w.ssid === filters.ssid));
    const completos = walks.filter((w) => w.status === 'completo');

    // conteo de resultados por nivel y estadísticas por indicador
    const tally = { good: 0, regular: 0, alarm: 0 };
    const stats = P.INDICATORS.map((ind) => ({ ...ind, values: [] }));
    for (const w of walks) {
      for (const t of P.TESTS) {
        const p = w.pruebas[t.key];
        if (!p || p.na) continue;
        for (const e of P.evaluate(t, p.values)) {
          if (e.level) tally[e.level] += 1;
          const st = stats.find((s) => s.test === t.key && s.key === e.key);
          if (st) st.values.push(e.value);
        }
      }
    }
    const total = tally.good + tally.regular + tally.alarm;
    const days = new Set(walks.map((w) => w.fecha)).size;

    const onFilter = () => { window.Portal.route(); };
    const sel = (id, label, value, options, on) => h('div', { class: 'field' }, h('label', { for: id }, label),
      h('select', { id, onchange: (e) => { on(e.target.value); onFilter(); } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))));
    const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label),
      h('input', { id, type: 'date', value: filters[key], max: todayStr(), onchange: (e) => { if (e.target.value) { filters[key] = e.target.value; if (filters.desde > filters.hasta) filters[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; onFilter(); } } }));

    const periodText = `${fullDate(filters.desde)} – ${fullDate(filters.hasta)}`;
    const scopeText = [filters.sede ? catalog.sedes.find((s) => String(s.id) === filters.sede)?.name : 'Todas las sedes', filters.ssid || 'Todos los SSID'].join(' · ');

    add(
      h('div', { class: 'print-head only-print' },
        h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
        h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, 'Reporte de recorridos proactivos'),
          h('p', {}, `Periodo: ${periodText} · ${scopeText}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))),
      h('header', { class: 'page-head rec-head no-print' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Salud del entorno Wi-Fi'), h('h1', {}, 'Recorridos proactivos'), h('p', { class: 'muted' }, 'Avance diario y resultados de las pruebas de cada recorrido.')),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Exportar a PDF'),
          h('a', { class: 'btn', href: `/api/recorridos/export.csv?desde=${filters.desde}&hasta=${filters.hasta}` }, 'Descargar Excel (CSV)'),
          canWrite() ? h('a', { class: 'btn btn-primary', href: '#/recorrido/nuevo' }, 'Nuevo recorrido') : null)),
      h('section', { class: 'filters no-print' },
        dateInput('rf-desde', 'Desde', 'desde'), dateInput('rf-hasta', 'Hasta', 'hasta'),
        sel('rf-sede', 'Sede', filters.sede, [['', 'Todas'], ...catalog.sedes.map((s) => [s.id, s.name])], (v) => { filters.sede = v; }),
        sel('rf-ssid', 'SSID', filters.ssid, [['', 'Todos'], ...catalog.ssids.map((s) => [s, s])], (v) => { filters.ssid = v; })),
    );

    if (!walks.length) {
      add(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No hay recorridos en este periodo. ',
        canWrite() ? h('a', { href: '#/recorrido/nuevo' }, 'Registrar el primero') : null)));
      return;
    }

    const seg = (k) => (tally[k] ? h('div', { class: 'mix-seg lv-' + k, style: `flex:${tally[k]}`, title: `${LV[k]}: ${tally[k]}` }) : null);
    add(h('section', { class: 'rec-tiles' },
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Recorridos completos'), h('span', { class: 'tile-num' }, completos.length),
        h('span', { class: 'tile-sub' }, `${walks.length - completos.length} en curso · ${days} ${days === 1 ? 'día' : 'días'} con recorridos`)),
      h('div', { class: 'tile tile-wide' }, h('span', { class: 'tile-label' }, `Resultados medidos (${total})`),
        total ? h('div', { class: 'mix', role: 'img', 'aria-label': `Buenos ${tally.good}, regulares ${tally.regular}, alarmantes ${tally.alarm}` }, seg('good'), seg('regular'), seg('alarm')) : h('span', { class: 'muted' }, 'Aún no hay resultados capturados'),
        h('div', { class: 'mix-legend' }, ['good', 'regular', 'alarm'].map((k) => h('span', {}, h('i', { class: 'sw lv-' + k }), `${LV[k]}: ${tally[k]}${total ? ` (${Math.round((tally[k] / total) * 100)}%)` : ''}`)))),
    ));

    // avance diario
    const span = Math.round((new Date(filters.hasta) - new Date(filters.desde)) / 864e5) + 1;
    const dayList = span <= 62 ? Array.from({ length: span }, (_, i) => addDays(filters.desde, i)) : [...new Set(walks.map((w) => w.fecha))].sort();
    const perDay = dayList.map((d) => ({ d, done: walks.filter((w) => w.fecha === d && w.status === 'completo').length, open: walks.filter((w) => w.fecha === d && w.status !== 'completo').length }));
    const chart = h('div', { class: 'chart daily' });
    add(h('section', { class: 'panel' }, h('h2', {}, 'Avance diario'), chart,
      h('p', { class: 'legend' }, h('span', { class: 'lg lg-bar' }, 'Recorridos completos'), h('span', { class: 'lg lg-bar-open' }, 'En curso'))));
    drawDaily(chart, perDay);

    // mínimos, promedios y máximos
    const statRows = [];
    for (const g of P.GROUPS) {
      const inds = stats.filter((s) => P.BY_KEY[s.test].group === g.key && s.values.length);
      if (!inds.length) continue;
      statRows.push(h('tr', { class: 'group-row' }, h('th', { colspan: 6 }, g.label)));
      for (const s of inds) {
        const min = Math.min(...s.values), max = Math.max(...s.values), avg = s.values.reduce((a, b) => a + b, 0) / s.values.length;
        const cell = (v) => h('td', { class: 'num-col' + lvCell(P.level(v, s.th)) }, nf(v), s.unit === '%' ? '%' : '');
        statRows.push(h('tr', {}, h('td', {}, s.label, s.unit && s.unit !== '%' ? h('span', { class: 'muted' }, ` (${s.unit})`) : null),
          h('td', { class: 'muted th-text' }, P.thText(s.th)), h('td', { class: 'num-col plain' }, s.values.length), cell(min), cell(avg), cell(max)));
      }
    }
    add(h('section', { class: 'panel' }, h('h2', {}, 'Valores mínimos, promedio y máximos del periodo'),
      statRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table stats' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Indicador'), h('th', {}, 'Umbrales'), h('th', { class: 'num-col' }, 'Mediciones'), h('th', { class: 'num-col' }, 'Mínimo'), h('th', { class: 'num-col' }, 'Promedio'), h('th', { class: 'num-col' }, 'Máximo'))),
        h('tbody', {}, statRows))) : h('p', { class: 'empty' }, 'Aún no hay resultados medidos en este periodo.')));

    // matriz de recorridos, como la hoja de cálculo de seguimiento
    const pings = P.TESTS.filter((t) => t.type === 'ping');
    const val = (w, t, key) => { const p = w.pruebas[t.key]; if (!p) return h('td', { class: 'num-col empty-cell' }, ''); if (p.na) return h('td', { class: 'num-col empty-cell', title: 'No aplica' }, 'N/A');
      const e = P.evaluate(t, p.values).find((x) => x.key === key); return e ? h('td', { class: 'num-col' + lvCell(e.level), title: `${t.label} · ${e.label}` }, nf(e.value)) : h('td', { class: 'num-col empty-cell' }, ''); };
    const st1 = P.BY_KEY.speedtest1, st2 = P.BY_KEY.speedtest2, meet = P.BY_KEY.meet;
    const matrix = h('table', { class: 'table matrix' },
      h('thead', {},
        h('tr', {}, h('th', { rowspan: 2 }, 'Fecha'), h('th', { rowspan: 2 }, 'Sede · piso'), h('th', { rowspan: 2 }, 'Área'), h('th', { rowspan: 2 }, 'SSID'), h('th', { rowspan: 2 }, 'Ejecutor'),
          pings.map((t) => h('th', { colspan: 2, class: 'grp' }, t.short)), h('th', { colspan: 3, class: 'grp' }, st1.short), h('th', { colspan: 3, class: 'grp' }, st2.short), h('th', { rowspan: 2, class: 'grp' }, 'Meet ms'), h('th', { rowspan: 2 }, 'Estado')),
        h('tr', {}, pings.map(() => [h('th', { class: 'sub' }, 'ms'), h('th', { class: 'sub' }, '%')]), [1, 2].map(() => [h('th', { class: 'sub' }, '↓'), h('th', { class: 'sub' }, '↑'), h('th', { class: 'sub' }, 'ms')]))),
      h('tbody', {}, walks.map((w) => h('tr', {},
        h('td', { class: 'nowrap' }, h('a', { href: '#/recorrido/' + w.id }, dayMonth(w.fecha)), ' ', h('span', { class: 'muted' }, w.hora)),
        h('td', { class: 'nowrap' }, shortSede(w.sede), ' · ', w.piso), h('td', {}, w.area), h('td', { class: 'nowrap' }, w.ssid), h('td', { class: 'nowrap' }, w.ejecutor),
        pings.map((t) => [val(w, t, 'lat'), val(w, t, 'perdida')]),
        [st1, st2].map((t) => [val(w, t, 'descarga'), val(w, t, 'carga'), val(w, t, 'latencia')]), val(w, meet, 'retraso'),
        h('td', { class: 'nowrap' }, w.status === 'completo' ? 'Completo' : `En curso ${doneCount(w)}/${P.TESTS.length}`)))));
    add(h('section', { class: 'panel' }, h('h2', {}, `Recorridos del periodo (${walks.length})`),
      h('p', { class: 'legend' }, ['good', 'regular', 'alarm'].map((k) => h('span', {}, h('i', { class: 'sw lv-' + k }), LV[k])), h('span', { class: 'muted' }, 'ms = latencia promedio · % = pérdida de paquetes · ↓ ↑ = Mb/s')),
      h('div', { class: 'table-wrap' }, matrix)));

    if (catalog.storage) add(h('p', { class: 'muted no-print storage' }, `Evidencias guardadas: ${catalog.storage.files} archivos, ${nf(catalog.storage.bytes / 1048576, 1)} MB en el disco del servidor.`));
  }

  function drawDaily(box, perDay) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a, txt) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (txt !== undefined) n.textContent = txt; return n; };
    const W = Math.max(320, box.clientWidth || 900), H = 220, m = { t: 14, r: 12, b: 38, l: 34 };
    const max = Math.max(1, ...perDay.map((d) => d.done + d.open));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / perDay.length;
    const bw = Math.max(3, Math.min(26, band - 4));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Recorridos por día' });
    for (let v = 0; v <= top; v += step) { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? 'ch-grid' : 'ch-axis' })); svg.append(el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ch-tick' }, v)); }
    const every = Math.ceil(perDay.length / Math.max(4, Math.floor((W - m.l - m.r) / 54)));
    const tip = document.createElement('div'); tip.className = 'ch-tip'; tip.hidden = true;
    perDay.forEach((d, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      const rect = (v0, v1, cls) => { const hh = y(v0) - y(v1); if (hh <= 0) return; const r = Math.min(3, hh / 2); const yy = y(v1);
        svg.append(el('path', { d: `M${x},${yy + hh} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${yy + hh} Z`, class: cls })); };
      rect(0, d.done, 'bar-done');
      if (d.open) rect(d.done, d.done + d.open, 'bar-open');
      if (d.done + d.open > 0 && bw >= 12) svg.append(el('text', { x: x + bw / 2, y: y(d.done + d.open) - 4, 'text-anchor': 'middle', class: 'ch-value' }, d.done + d.open));
      if (i % every === 0) svg.append(el('text', { x: x + bw / 2, y: H - m.b + 16, 'text-anchor': 'middle', class: 'ch-xsub' }, dayMonth(d.d)));
      const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => { tip.textContent = ''; const s = document.createElement('strong'); s.textContent = dayMonth(d.d); const a = document.createElement('span'); a.textContent = `Completos: ${d.done}`; const b = document.createElement('span'); b.textContent = `En curso: ${d.open}`; tip.append(s, a, b); tip.hidden = false; tip.style.left = Math.min(W - 150, Math.max(4, x + bw + 8)) + 'px'; tip.style.top = '20px'; });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.append(hit);
    });
    box.textContent = ''; box.append(svg, tip);
  }

  /* =========================================================
   * Alta y edición de los datos del recorrido
   * ========================================================= */
  function headerForm(w, onSaved) {
    const c = catalog;
    const now = new Date();
    const sedeSel = h('select', { id: 'r-sede', required: true });
    const pisoSel = h('select', { id: 'r-piso', required: true });
    const fillSedes = (selected) => { sedeSel.textContent = ''; c.sedes.forEach((s) => sedeSel.append(h('option', { value: s.id, selected: String(s.id) === String(selected) }, s.name))); };
    const fillPisos = (selected) => { pisoSel.textContent = ''; const s = c.sedes.find((x) => String(x.id) === sedeSel.value); (s ? s.pisos : []).forEach((p) => pisoSel.append(h('option', { value: p.id, selected: String(p.id) === String(selected) }, p.name))); };
    fillSedes(w ? w.sedeId : c.sedes[0]?.id); fillPisos(w ? w.pisoId : null);
    sedeSel.addEventListener('change', () => fillPisos(null));

    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const similarBox = h('div', { class: 'notice', hidden: true });
    const area = h('input', { id: 'r-area', type: 'text', maxlength: 80, list: 'r-areas', required: true, value: w ? w.area : '', placeholder: 'Ej. BR, Lobby, Multiasistencia', autocomplete: 'off' });
    const areaHint = h('span', { class: 'hint' }, 'Si el área ya existe, elígela de la lista para no duplicarla.');
    area.addEventListener('input', () => {
      const k = P.plain(area.value).replace(/[^a-z0-9]/g, '');
      const hit = k ? c.areas.find((a) => P.plain(a.name).replace(/[^a-z0-9]/g, '') === k) : null;
      areaHint.textContent = hit && hit.name !== area.value.trim() ? `Se registrará como "${hit.name}", que ya existe.` : 'Si el área ya existe, elígela de la lista para no duplicarla.';
    });

    // agregar sede o piso sin duplicar
    const adder = (kind, label, post) => {
      const input = h('input', { type: 'text', maxlength: 60, 'aria-label': `Nombre de ${label}`, id: `r-new-${kind}`, placeholder: `Nombre de ${label}` });
      const out = h('span', { class: 'hint' });
      const row = h('div', { class: 'adder', hidden: true }, input,
        h('button', { class: 'btn', type: 'button', onclick: () => send(false) }, 'Agregar'), out);
      const send = async (confirm) => {
        out.textContent = '';
        try {
          const r = await post(input.value, confirm);
          await loadCatalog(true); Object.assign(c, catalog);
          r.apply();
          toast(r.existed ? `Ya existía "${r.name}": se seleccionó.` : `Se agregó "${r.name}".`);
          row.hidden = true; input.value = '';
        } catch (err) {
          if (err.code === 'similar') {
            out.textContent = '';
            out.append(`Ya existe un nombre parecido: ${err.suggestions.map((s) => s.name).join(', ')}. Elígelo de la lista, o `,
              h('button', { class: 'link-btn', type: 'button', onclick: () => send(true) }, 'créalo de todas formas'), '.');
          } else out.textContent = err.message;
        }
      };
      const toggle = h('button', { class: 'link-btn', type: 'button', onclick: () => { row.hidden = !row.hidden; if (!row.hidden) input.focus(); } }, `Agregar ${label}`);
      return { row, toggle };
    };
    const addSede = adder('sede', 'sede', async (name, confirm) => { const r = await apiX('POST', '/api/sedes', { name, confirm }); return { existed: r.existed, name: r.sede.name, apply: () => { fillSedes(r.sede.id); fillPisos(null); } }; });
    const addPiso = adder('piso', 'piso', async (name) => { const r = await apiX('POST', '/api/pisos', { sedeId: sedeSel.value, name }); return { existed: r.existed, name: r.piso.name, apply: () => fillPisos(r.piso.id) }; });

    const ejecutor = isAdmin()
      ? h('select', { id: 'r-ejecutor' }, c.ingenieros.map((u) => h('option', { value: u.id, selected: u.id === (w ? w.ejecutorId : state.user.id) }, u.name)))
      : h('p', { class: 'static' }, w ? w.ejecutor : state.user.name);
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, w ? 'Guardar datos' : 'Crear recorrido y cargar pruebas');

    const form = h('form', { class: 'panel form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(false); } },
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'r-fecha' }, 'Fecha del recorrido'), h('input', { id: 'r-fecha', type: 'date', max: todayStr(), value: w ? w.fecha : todayStr(), required: true })),
        h('div', { class: 'field' }, h('label', { for: 'r-hora' }, 'Hora'), h('input', { id: 'r-hora', type: 'time', value: w ? w.hora : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, required: true }),
          h('span', { class: 'hint' }, 'Se llena con la hora actual; puedes corregirla.')),
        h('div', { class: 'field' }, h('label', { for: 'r-sede' }, 'Sede'), sedeSel, addSede.toggle, addSede.row),
        h('div', { class: 'field' }, h('label', { for: 'r-piso' }, 'Piso'), pisoSel, addPiso.toggle, addPiso.row),
        h('div', { class: 'field' }, h('label', { for: 'r-area' }, 'Área'), area, h('datalist', { id: 'r-areas' }, c.areas.map((a) => h('option', { value: a.name }))), areaHint),
        h('fieldset', { class: 'field radios' }, h('legend', {}, 'SSID'), c.ssids.map((s, i) => h('label', { class: 'radio', for: 'r-ssid-' + i },
          h('input', { type: 'radio', name: 'ssid', id: 'r-ssid-' + i, value: s, checked: w ? w.ssid === s : i === 0 }), s))),
        h('div', { class: 'field' }, h('label', { for: isAdmin() ? 'r-ejecutor' : null }, 'Ejecutor'), ejecutor,
          h('span', { class: 'hint' }, isAdmin() ? 'Como administrador puedes asignar o reasignar el recorrido; el cambio queda en la trazabilidad.' : 'Es el usuario con el que iniciaste sesión.')),
        h('div', { class: 'field' }, h('label', { for: 'r-notas' }, 'Notas', h('span', { class: 'optional' }, ' (opcional)')), h('input', { id: 'r-notas', type: 'text', maxlength: 1000, value: w?.notas || '' }))),
      similarBox, error,
      h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn', href: w ? '#/recorrido/' + w.id : '#/recorridos', onclick: w ? (e) => { e.preventDefault(); onSaved(null); } : null }, 'Cancelar')));
    form.querySelectorAll('input[type=radio]').forEach((r) => { if (r.getAttribute('checked') !== null) r.checked = true; });

    async function save(areaConfirm, areaOverride) {
      error.hidden = true; similarBox.hidden = true;
      const body = {
        fecha: form.querySelector('#r-fecha').value, hora: form.querySelector('#r-hora').value, sedeId: sedeSel.value, pisoId: pisoSel.value,
        area: areaOverride || area.value, areaConfirm, ssid: (form.querySelector('input[name=ssid]:checked') || {}).value,
        notas: form.querySelector('#r-notas').value, ...(isAdmin() ? { ejecutorId: Number(ejecutor.value) } : {}),
      };
      if (!body.area.trim()) { error.textContent = 'Escribe el área donde se realiza la prueba.'; error.hidden = false; area.focus(); return; }
      submit.disabled = true;
      try {
        const r = w ? await apiX('PUT', '/api/recorridos/' + w.id, body) : await apiX('POST', '/api/recorridos', body);
        await loadCatalog(true);
        onSaved(w ? w.id : r.id);
      } catch (err) {
        if (err.code === 'similar') {
          similarBox.textContent = '';
          similarBox.append(`Ya existe un área con nombre parecido a "${body.area.trim()}". `,
            err.suggestions.map((s) => h('button', { class: 'btn', type: 'button', onclick: () => { area.value = s.name; save(false, s.name); } }, `Usar "${s.name}"`)),
            h('button', { class: 'link-btn', type: 'button', onclick: () => save(true) }, 'Es un área distinta: crearla'));
          similarBox.hidden = false;
        } else { error.textContent = err.message; error.hidden = false; }
        submit.disabled = false;
      }
    }
    return form;
  }
  /** Igual que api(), pero conserva los datos extra del error (sugerencias, faltantes). */
  async function apiX(method, url, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portal' }, body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error('No hay conexión con el servidor.'); });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'no_session') { window.location.assign('/login'); throw new Error(data.error); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la acción.'), data);
    return data;
  }

  async function viewNew() {
    if (!canWrite()) return add(h('p', { class: 'empty' }, 'Tu usuario es de consulta: no puede registrar recorridos.'));
    await loadCatalog(true);
    add(h('nav', { class: 'crumb' }, h('a', { href: '#/recorridos' }, '← Recorridos')),
      h('header', { class: 'page-head' }, h('h1', {}, 'Nuevo recorrido'), h('p', { class: 'muted' }, 'Primero los datos del recorrido; en el siguiente paso subes la evidencia de cada prueba.')),
      headerForm(null, (id) => { window.location.hash = '#/recorrido/' + id; }));
  }

  /* =========================================================
   * Detalle del recorrido: pruebas, evidencias y trazabilidad
   * ========================================================= */
  async function prepareImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const longest = Math.max(bmp.width, bmp.height);
      const scale = longest > 1800 ? 1800 / longest : longest < 1300 ? Math.min(2.5, 1600 / longest) : 1;
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.74));
      if (blob) return blob;
    } catch { /* se envía el archivo original */ }
    if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    throw new Error(`"${file.name}" no es una imagen compatible. Usa JPG o PNG.`);
  }
  async function upload(id, file, testKey) {
    const blob = await prepareImage(file);
    const res = await fetch(`/api/recorridos/${id}/evidencias${testKey ? '?test=' + testKey : ''}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-Requested-With': 'portal' }, body: blob })
      .catch(() => { throw new Error('No hay conexión con el servidor.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir la evidencia.');
    return data;
  }

  const LOG = {
    creado: (d) => `Creó el recorrido${d?.enNombreDeOtro ? ` a nombre de ${d.ejecutor}` : ''}`,
    reasignado: (d) => `Reasignó el recorrido de ${d.de} a ${d.a}`,
    datos_editados: (d) => `Editó los datos: ${d.cambios.map((c) => `${c.campo} (${c.antes} → ${c.despues})`).join(', ')}`,
    evidencia_cargada: (d) => `${d.reemplazo ? 'Reemplazó' : 'Cargó'} la evidencia de ${d.prueba} (${d.lectura})`,
    resultado_capturado: (d) => `Capturó el resultado de ${d.prueba} (${d.captura})`,
    lectura_confirmada: (d) => `Confirmó la lectura del OCR de ${d.prueba}`,
    prueba_no_aplica: (d) => `Marcó ${d.prueba} como no aplica: ${d.motivo}`,
    prueba_borrada: (d) => `Borró la evidencia y el resultado de ${d.prueba}`,
    completado: () => 'Marcó el recorrido como completo',
    reabierto: () => 'Reabrió el recorrido',
  };

  async function viewDetail(id, keepScroll) {
    await loadCatalog();
    const { recorrido: w, faltantes } = await api('GET', '/api/recorridos/' + id);
    const editable = mayEdit(w) && w.status !== 'completo';
    const refresh = async () => { const y = window.scrollY; window.Portal.view.textContent = ''; await viewDetail(id, y); };
    const done = P.TESTS.length - faltantes.length;
    let editing = false;

    const headBox = h('div', {});
    const renderHead = () => {
      headBox.textContent = '';
      if (editing) { headBox.append(headerForm(w, async (saved) => { editing = false; if (saved) { toast('Datos del recorrido actualizados'); await refresh(); } else renderHead(); })); return; }
      headBox.append(h('dl', { class: 'meta-grid' },
        [['Fecha', `${fullDate(w.fecha)} · ${w.hora}`], ['Sede', w.sede], ['Piso', w.piso], ['Área', w.area], ['SSID', w.ssid], ['Ejecutor', w.ejecutor]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
        w.notas ? h('div', { class: 'meta-wide' }, h('dt', {}, 'Notas'), h('dd', {}, w.notas)) : null));
    };
    renderHead();

    const missBox = h('div', { class: 'form-error', hidden: true });
    const actions = h('div', { class: 'form-actions no-print' },
      editable ? h('button', { class: 'btn', type: 'button', onclick: () => { editing = !editing; renderHead(); } }, isAdmin() ? 'Editar datos o reasignar' : 'Editar datos') : null,
      editable ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { await apiX('POST', `/api/recorridos/${id}/completar`, {}); toast('Recorrido completo'); await refresh(); }
        catch (err) { missBox.textContent = ''; missBox.append(err.message, err.faltantes ? h('ul', {}, err.faltantes.map((f) => h('li', {}, `${f.label}: ${f.reason}`))) : null); missBox.hidden = false; }
      } }, 'Marcar como completo') : null,
      mayEdit(w) && w.status === 'completo' ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await apiX('POST', `/api/recorridos/${id}/reabrir`, {}); toast('Recorrido reabierto'); await refresh(); } catch (err) { toast(err.message, 'error'); } } }, 'Reabrir para corregir') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Exportar a PDF'),
      isAdmin() || editable ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', '/api/recorridos/' + id); toast('Recorrido eliminado'); window.location.hash = '#/recorridos'; }) }, 'Eliminar recorrido') : null);

    add(
      h('nav', { class: 'crumb no-print' }, h('a', { href: '#/recorridos' }, '← Recorridos')),
      h('header', { class: 'detail-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Recorrido proactivo'), h('h1', {}, `${shortSede(w.sede)} · ${w.piso} · ${w.area}`),
          h('div', { class: 'pills' }, h('span', { class: 'pill ' + (w.status === 'completo' ? 'pill-good' : 'pill-prog') }, h('span', { class: 'pill-icon', 'aria-hidden': 'true' }, w.status === 'completo' ? '✓' : '→'), w.status === 'completo' ? 'Completo' : 'En curso'), levelPill(walkLevel(w)))),
        actions),
      headBox,
      h('div', { class: 'bar progress', role: 'img', 'aria-label': `${done} de ${P.TESTS.length} pruebas listas` }, h('div', { class: 'bar-fill', style: `width:${Math.round((done / P.TESTS.length) * 100)}%` }), h('span', { class: 'bar-label' }, `${done} de ${P.TESTS.length} pruebas listas`)),
      missBox,
    );
    if (!mayEdit(w) && canWrite()) add(h('p', { class: 'notice no-print' }, `Este recorrido es de ${w.ejecutor}. Solo esa persona o un administrador puede modificarlo.`));

    // carga rápida: varias fotos, el portal identifica cada prueba
    if (editable) {
      const list = h('ul', { class: 'quick-list' });
      const input = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'quick-files', class: 'sr-only' });
      const pending = [];
      const emptyTests = () => P.TESTS.filter((t) => !(w.pruebas[t.key] && (w.pruebas[t.key].hasEvidence || w.pruebas[t.key].na)));
      input.addEventListener('change', async () => {
        const files = [...input.files]; input.value = '';
        let ok = 0;
        for (const f of files) {
          const li = h('li', {}, h('strong', {}, f.name), ' ', h('span', { class: 'muted' }, 'analizando…'));
          list.append(li);
          try {
            const r = await upload(id, f, null);
            li.lastChild.remove();
            if (r.unclassified) {
              const selT = h('select', { 'aria-label': 'Prueba a la que corresponde ' + f.name }, h('option', { value: '' }, 'Elige la prueba…'), emptyTests().map((t) => h('option', { value: t.key }, t.label)));
              li.append(h('span', { class: 'warn-text' }, catalog.ocr ? 'No se pudo identificar la prueba.' : 'El OCR no está disponible en el servidor.'), ' ', selT,
                h('button', { class: 'btn', type: 'button', onclick: async (e) => { if (!selT.value) return; e.currentTarget.disabled = true; try { await upload(id, f, selT.value); toast('Evidencia asignada'); await refresh(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, 'Asignar'));
              pending.push(f);
            } else {
              ok += 1;
              const t = P.BY_KEY[r.test];
              w.pruebas[r.test] = { ...(w.pruebas[r.test] || {}), hasEvidence: true };
              li.append(h('span', {}, `→ ${t.label}: `), h('span', { class: r.notes.length ? 'warn-text' : 'ok-text' }, t.type === 'evidence' ? 'evidencia guardada' : r.read ? (r.notes.length ? 'leído por OCR, revisa los valores' : 'leído por OCR') : 'evidencia guardada; captura el resultado a mano'));
            }
          } catch (err) { li.lastChild.remove(); li.append(h('span', { class: 'warn-text' }, err.message)); }
        }
        if (ok && !pending.length) { toast(`${ok} ${ok === 1 ? 'evidencia cargada' : 'evidencias cargadas'}`); await refresh(); }
        else if (ok) list.append(h('li', {}, h('button', { class: 'btn', type: 'button', onclick: refresh }, 'Ver las pruebas actualizadas')));
      });
      add(h('section', { class: 'panel quick no-print' },
        h('h2', {}, 'Carga rápida de evidencias'),
        h('p', { class: 'muted' }, catalog.ocr
          ? 'Sube varias fotos o capturas a la vez. El portal lee cada imagen, identifica a qué prueba corresponde y carga sus resultados. Las que no pueda identificar te las pregunta.'
          : 'El OCR no está instalado en este servidor: sube la evidencia en cada prueba y captura el resultado a mano.'),
        h('label', { class: 'btn btn-primary', for: 'quick-files' }, 'Elegir fotos'), input, list));
    }

    for (const g of P.GROUPS) {
      add(h('section', { class: 'tests' }, h('h2', {}, g.label),
        h('div', { class: 'test-grid' }, P.TESTS.filter((t) => t.group === g.key).map((t) => testCard(w, t, editable, refresh)))));
    }

    add(h('section', { class: 'panel' }, h('h2', {}, 'Trazabilidad'),
      h('ol', { class: 'trace' }, w.log.map((l) => h('li', {}, h('span', { class: 'trace-when' }, localStamp(l.ts)), h('span', {}, h('strong', {}, l.user), ' · ', (LOG[l.action] || (() => l.action))(l.detail || {}))))) ));
    if (keepScroll) window.scrollTo(0, keepScroll);
  }

  function testCard(w, t, editable, refresh) {
    const p = w.pruebas[t.key];
    const fields = P.fieldsOf(t);
    const evals = p && !p.na ? P.evaluate(t, p.values) : [];
    const lvl = P.worst(evals.map((e) => e.level));
    const ready = p && (p.na || (p.hasEvidence && P.hasRequired(t, p.values) && !p.review));
    const card = h('article', { class: 'test' + (ready ? ' is-ready' : '') + (p && p.review ? ' is-review' : '') });
    const stateTag = p && p.na ? h('span', { class: 'tag tag-none' }, 'No aplica')
      : ready ? h('span', { class: 'tag tag-ok' }, 'Lista') : p && p.review ? h('span', { class: 'tag tag-warn' }, 'Revisar lectura') : h('span', { class: 'tag tag-pend' }, 'Pendiente');
    card.append(h('header', { class: 'test-head' }, h('div', {}, h('h3', {}, t.label), h('p', { class: 'test-hint' }, t.hint)), stateTag));

    if (p && p.na) {
      card.append(h('p', {}, h('strong', {}, 'Motivo: '), p.naMotivo),
        editable ? h('button', { class: 'link-btn no-print', type: 'button', onclick: async () => { try { await api('DELETE', `/api/recorridos/${w.id}/pruebas/${t.key}`); await refresh(); } catch (err) { toast(err.message, 'error'); } } }, 'Quitar "no aplica"') : null);
      return card;
    }

    // evidencia
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: `ev-${t.key}` });
    const upBtn = h('label', { class: 'btn' + (p && p.hasEvidence ? '' : ' btn-primary'), for: `ev-${t.key}` }, p && p.hasEvidence ? 'Reemplazar evidencia' : 'Subir evidencia');
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      upBtn.textContent = t.type === 'evidence' ? 'Subiendo…' : 'Subiendo y leyendo…';
      try { const r = await upload(w.id, f, t.key); toast(t.type === 'evidence' ? 'Evidencia guardada' : r.read ? (r.notes.length ? 'Leído por OCR: revisa los valores' : 'Resultado leído por OCR') : 'Evidencia guardada. Captura el resultado a mano.', r.notes.length ? 'error' : 'ok'); await refresh(); }
      catch (err) { toast(err.message, 'error'); upBtn.textContent = 'Subir evidencia'; }
    });
    const src = p && p.hasEvidence ? `/api/evidencias/${p.id}?v=${encodeURIComponent(p.updatedAt)}` : null;
    card.append(h('div', { class: 'evidence' },
      src ? h('a', { href: src, target: '_blank', rel: 'noopener', class: 'thumb' }, h('img', { src, alt: `Evidencia de ${t.label}`, loading: 'lazy' }))
        : h('div', { class: 'thumb thumb-empty' }, 'Sin evidencia'),
      editable ? h('div', { class: 'no-print' }, upBtn, file) : null));

    // resultados
    if (fields.length) {
      const inputs = {};
      const chips = h('div', { class: 'chips' });
      const drawChips = (vals) => {
        chips.textContent = '';
        for (const e of P.evaluate(t, vals)) if (e.th) chips.append(h('span', { class: 'chip lv lv-' + e.level, title: P.thText(e.th) }, `${e.label}: ${nf(e.value)}${e.unit === '%' ? '%' : ' ' + e.unit} · ${LV[e.level]}`));
      };
      const read = () => Object.fromEntries(fields.map((f) => [f.key, inputs[f.key].value === '' ? undefined : Number(inputs[f.key].value)]).filter(([, v]) => v !== undefined && Number.isFinite(v)));
      const grid = h('div', { class: 'vals' }, fields.map((f) => {
        inputs[f.key] = h('input', { type: 'number', inputmode: 'decimal', step: f.integer ? 1 : 'any', min: 0, id: `v-${t.key}-${f.key}`, value: p && p.values[f.key] !== undefined ? p.values[f.key] : '', disabled: !editable, oninput: () => drawChips(read()) });
        return h('div', { class: 'field' }, h('label', { for: `v-${t.key}-${f.key}` }, f.label, f.unit ? ` (${f.unit})` : '', f.required ? null : h('span', { class: 'optional' }, ' opc.')), inputs[f.key]);
      }));
      drawChips(p ? p.values : {});
      card.append(grid, chips);
      if (p && p.review && p.ocrNotes.length) card.append(h('p', { class: 'warn-box' }, 'Revisa contra la evidencia: ', p.ocrNotes.join('; '), '.'));
      if (editable) {
        card.append(h('div', { class: 'form-actions no-print' }, h('button', { class: 'btn' + (p && p.review ? ' btn-primary' : ''), type: 'button', onclick: async () => {
          try { await api('PUT', `/api/recorridos/${w.id}/pruebas/${t.key}`, { values: read() }); toast(p && p.review ? 'Lectura confirmada' : 'Resultado guardado'); await refresh(); } catch (err) { toast(err.message, 'error'); }
        } }, p && p.review ? 'Confirmar valores' : 'Guardar resultado')));
      }
    }
    const foot = [];
    if (p && p.source && fields.length) foot.push(SRC[p.source] + (p.source !== 'manual' && p.ocrConf ? ` (confianza ${Math.round(p.ocrConf)}%)` : ''));
    if (p && p.updatedBy) foot.push(`${p.updatedBy} · ${localStamp(p.updatedAt)}`);
    if (foot.length) card.append(h('p', { class: 'test-foot' }, foot.join(' · ')));
    if (lvl) card.classList.add('edge-' + lvl);

    if (editable) {
      const motivo = h('input', { type: 'text', maxlength: 200, placeholder: 'Motivo (obligatorio)', 'aria-label': `Motivo por el que no aplica ${t.label}`, id: `na-${t.key}` });
      const naRow = h('div', { class: 'adder', hidden: true }, motivo, h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await api('PUT', `/api/recorridos/${w.id}/pruebas/${t.key}`, { na: true, naMotivo: motivo.value }); await refresh(); } catch (err) { toast(err.message, 'error'); } } }, 'Confirmar'));
      card.append(h('div', { class: 'test-links no-print' },
        h('button', { class: 'link-btn', type: 'button', onclick: () => { naRow.hidden = !naRow.hidden; if (!naRow.hidden) motivo.focus(); } }, 'No aplica'),
        p ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', `/api/recorridos/${w.id}/pruebas/${t.key}`); await refresh(); }) }, 'Borrar') : null), naRow);
    }
    return card;
  }

  window.PortalRoutes = {
    recorridos: () => viewDashboard(),
    recorrido: (parts) => (parts[1] === 'nuevo' ? viewNew() : /^\d+$/.test(parts[1] || '') ? viewDetail(parts[1]) : add(h('p', { class: 'empty' }, 'El recorrido no existe.'))),
  };
})();
