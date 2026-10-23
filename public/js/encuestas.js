'use strict';
/* Encuestas a usuarios finales: captura guiada (speech + preguntas + postal) y tablero ejecutivo con reportes para BBVA. */
(() => {
  const { h, add, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr } = window.Portal;
  const E = window.PortalEncuestasComun;
  const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const short = (s) => String(s || '').replace(/^BBVA\s+/i, '');
  const lab = (arr, k) => (arr.find((x) => x.key === k) || {}).label || '—';
  const COL = { sede0: '#2a2b2e', sede1: '#9a9b9f', si: '#3a9a6a', no: '#c8141b' };
  const view = { desde: null, hasta: null, sede: '', limit: 30 };
  let CAT = null, DATA = null, root = null;
  // Al imprimir desde la iniciativa sale solo el reporte de encuestas (sin los bloques generales ni el registro detallado, que va en CSV).
  window.addEventListener('beforeprint', () => document.body.classList.toggle('enc-report', !!(root && root.isConnected)));
  window.addEventListener('afterprint', () => document.body.classList.remove('enc-report'));

  async function loadCat() { CAT = await api('GET', '/api/encuestas/catalogo'); return CAT; }

  /* =========================================================
   * Tablero ejecutivo (dentro de la página de la iniciativa)
   * ========================================================= */
  async function reload() {
    await loadCat();
    const c = CAT.config;
    if (!view.hasta) { view.hasta = CAT.hoy; view.desde = c.inicio && c.inicio <= CAT.hoy ? c.inicio : CAT.hoy; }
    DATA = await api('GET', `/api/encuestas?desde=${view.desde}&hasta=${view.hasta}`);
    render();
  }

  const hbars = (rows, total, color) => h('div', { class: 'enc-hbars' }, rows.map((r) => h('div', { class: 'enc-hrow' },
    h('span', { class: 'enc-hlabel' }, r.label), h('div', { class: 'enc-htrack' }, h('span', { style: `width:${total ? Math.max(1, (r.n / total) * 100) : 0}%;background:${color}` })),
    h('span', { class: 'enc-hnum' }, `${nf(r.n)}`, h('small', {}, total ? ` ${pct(r.n, total)}%` : '')))));

  function dailyChart(days, S, list, meta = E.META.porDia) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a, txt) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (txt !== undefined) n.textContent = txt; return n; };
    const W = 1100, H = 260, m = { t: 18, r: 12, b: 40, l: 36 };
    const per = days.map((d) => S.map((s) => list.filter((e) => e.fecha === d && e.sedeId === s.id).length));
    const top = Math.max(meta * 1.2, ...per.map((x) => x.reduce((a, b) => a + b, 0))) ;
    const y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / Math.max(1, days.length), bw = Math.min(42, band * 0.7);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'enc-svg', role: 'img', 'aria-label': 'Encuestas por día y sede contra la meta de 100' });
    for (let v = 0; v <= top; v += top > 80 ? 25 : 10) { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? 'ch-grid' : 'ch-axis' })); svg.append(el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ch-tick' }, v)); }
    days.forEach((d, i) => {
      const x = m.l + band * i + (band - bw) / 2; let acc = 0;
      S.forEach((s, k) => { const n = per[i][k]; if (!n) return; svg.append(el('rect', { x, y: y(acc + n), width: bw, height: y(acc) - y(acc + n), fill: k ? COL.sede1 : COL.sede0 })); acc += n; });
      if (acc) svg.append(el('text', { x: x + bw / 2, y: y(acc) - 5, 'text-anchor': 'middle', class: 'ch-value' }, acc));
      if (days.length <= 25 || i % 2 === 0) svg.append(el('text', { x: x + bw / 2, y: H - m.b + 16, 'text-anchor': 'middle', class: 'ch-xsub' }, dayMonth(d)));
    });
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(meta), y2: y(meta), class: 'ch-ref ch-ref-target' }));
    svg.append(el('text', { x: W - m.r, y: y(meta) - 6, 'text-anchor': 'end', class: 'ch-ref-label' }, S.length > 1 ? `Meta diaria: ${meta} (${E.META.porSede} por sede)` : `Meta diaria de la sede: ${meta}`));
    return svg;
  }

  function render() {
    if (!root || !root.isConnected) return;
    root.textContent = '';
    const kids = []; const push = (...n) => kids.push(...n.flat().filter(Boolean));
    const c = CAT.config, S = CAT.sedes;
    const scope = view.sede ? S.filter((s) => String(s.id) === view.sede) : S;
    const all = DATA.encuestas.filter((e) => scope.some((s) => s.id === e.sedeId));
    const done = all.filter((e) => e.resultado === 'completa');
    const metaDia = E.META.porSede * scope.length, metaTotal = metaDia * E.META.diasHabiles;
    const diasLev = c.inicio ? E.diasHabiles(c.inicio, c.fin) : [];
    const transcurridos = diasLev.filter((d) => d <= CAT.hoy).length;
    const diasPeriodo = E.diasHabiles(view.desde, view.hasta);
    const esperado = diasPeriodo.length * metaDia;
    const hoyList = done.filter((e) => e.fecha === CAT.hoy);
    const si = done.filter((e) => e.cumple).length, no = done.length - si;
    const contactos = all.length, rechazos = all.filter((e) => e.resultado === 'rechazo').length, ocupados = all.filter((e) => e.resultado === 'ocupado').length;
    const scopeName = view.sede ? short(scope[0].name) : 'Polanco y Reforma';

    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, `Encuestas a usuarios finales · ${scopeName}`),
        h('p', {}, `Periodo: ${fullDate(view.desde)} – ${fullDate(view.hasta)}`), h('p', { class: 'muted' }, `Generado el ${fullDate(todayStr())} por ${state.user.name}`))));

    const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key], max: CAT.hoy, onchange: (e) => { if (!e.target.value) return; view[key] = e.target.value; if (view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; reload(); } }));
    push(h('section', { class: 'panel no-print' },
      h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, 'Levantamiento de encuestas'),
        h('p', { class: 'muted' }, c.inicio ? `Del ${fullDate(c.inicio)} al ${fullDate(c.fin)} · ${E.META.diasHabiles} días hábiles · ${transcurridos <= E.META.diasHabiles ? `día ${transcurridos} de ${E.META.diasHabiles}` : 'terminado'}` : 'Inicia con la primera encuesta registrada (o con la fecha que defina el administrador).')),
        h('div', { class: 'form-actions' }, canWrite() ? h('a', { class: 'btn btn-primary', href: '#/encuesta/nueva' }, 'Nueva encuesta') : null,
          isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: (e) => configInicio(e.currentTarget) }, 'Fecha de inicio') : null)),
      h('div', { class: 'rd-filters' }, dateInput('enc-desde', 'Desde', 'desde'), dateInput('enc-hasta', 'Hasta', 'hasta'),
        h('div', { class: 'field' }, h('label', { for: 'enc-sede' }, 'Sede'), h('select', { id: 'enc-sede', onchange: (e) => { view.sede = e.target.value; render(); } }, h('option', { value: '' }, 'Polanco y Reforma'), S.map((s) => h('option', { value: s.id, selected: String(s.id) === view.sede }, short(s.name))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' },
          h('button', { class: 'tab', type: 'button', onclick: () => { view.desde = view.hasta = CAT.hoy; reload(); } }, 'Hoy'),
          h('button', { class: 'tab', type: 'button', onclick: () => { view.hasta = CAT.hoy; view.desde = E.addDays(CAT.hoy, -((new Date(CAT.hoy + 'T00:00:00Z').getUTCDay() + 6) % 7)); reload(); } }, 'Esta semana'),
          c.inicio ? h('button', { class: 'tab', type: 'button', onclick: () => { view.desde = c.inicio; view.hasta = CAT.hoy < c.fin ? CAT.hoy : c.fin; reload(); } }, 'Todo el levantamiento') : null)))));

    if (view.sede) push(h('div', { class: 'rd-scope no-print', role: 'status' },
      h('button', { class: 'btn', type: 'button', onclick: () => { view.sede = ''; render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '← Volver a ambas sedes'),
      h('span', {}, 'Estás viendo solo ', h('strong', {}, scopeName), '. El avance, las gráficas y los reportes corresponden a esta sede.')));

    // ---------- nivel 1: avance contra la meta ----------
    const bar = (n, meta, color) => h('div', { class: 'enc-bar' }, h('span', { style: `width:${Math.min(100, meta ? (n / meta) * 100 : 0)}%;background:${color}` }));
    push(h('section', { class: 'panel enc-level' }, h('p', { class: 'enc-eyebrow' }, `Avance contra la meta · ${scopeName}`),
      h('div', { class: 'enc-l1' },
        h('div', { class: 'enc-big' },
          h('span', { class: 'tile-label' }, 'Encuestas del periodo'),
          h('span', { class: 'enc-bignum' }, nf(done.length), h('small', {}, ` de ${nf(esperado)} esperadas`)),
          bar(done.length, esperado, done.length >= esperado ? '#3a9a6a' : '#c8141b'),
          h('span', { class: 'tile-sub' }, `${pct(done.length, esperado) ?? 0}% de cumplimiento · ${diasPeriodo.length} días hábiles × ${metaDia} por día. Meta del levantamiento: ${nf(metaTotal)}.`)),
        h('div', { class: 'enc-tiles' },
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Hoy'), h('span', { class: 'tile-num' }, nf(hoyList.length), h('small', {}, ` / ${metaDia}`)),
            h('span', { class: 'tile-sub' }, scope.map((s) => `${short(s.name)} ${hoyList.filter((e) => e.sedeId === s.id).length}/${E.META.porSede}`).join(' · '))),
          h('div', { class: 'tile enc-sat' }, h('span', { class: 'tile-label' }, 'El WiFi cumple sus expectativas'), h('span', { class: 'tile-num' }, done.length ? `${pct(si, done.length)}%` : '—'), h('span', { class: 'tile-sub' }, `${nf(si)} sí · ${nf(no)} no`)),
          h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Aceptación'), h('span', { class: 'tile-num' }, contactos ? `${pct(done.length, contactos)}%` : '—'), h('span', { class: 'tile-sub' }, `${nf(contactos)} abordados · ${nf(ocupados)} ocupados · ${nf(rechazos)} no quisieron`))))));

    // por sede
    if (!view.sede) push(h('section', { class: 'panel enc-level' }, h('p', { class: 'enc-eyebrow' }, 'Por sede'),
      h('div', { class: 'enc-sedes' }, S.map((s, k) => {
        const l = done.filter((e) => e.sedeId === s.id), hoyS = hoyList.filter((e) => e.sedeId === s.id).length, esp = diasPeriodo.length * E.META.porSede, sis = l.filter((e) => e.cumple).length;
        return h('article', { class: 'enc-sede' }, h('header', {}, h('h3', {}, short(s.name)), h('button', { class: 'link-btn no-print', type: 'button', onclick: () => { view.sede = String(s.id); render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Ver solo esta sede')),
          h('div', { class: 'enc-row' }, h('span', {}, 'Periodo'), h('strong', {}, `${nf(l.length)} / ${nf(esp)}`), bar(l.length, esp, k ? COL.sede1 : COL.sede0)),
          h('div', { class: 'enc-row' }, h('span', {}, 'Hoy'), h('strong', {}, `${hoyS} / ${E.META.porSede}`), bar(hoyS, E.META.porSede, k ? COL.sede1 : COL.sede0)),
          h('div', { class: 'enc-row' }, h('span', {}, 'Satisfechos'), h('strong', {}, l.length ? `${pct(sis, l.length)}%` : '—'), h('div', { class: 'enc-bar enc-split' }, h('span', { style: `width:${l.length ? (sis / l.length) * 100 : 0}%;background:${COL.si}` }), h('span', { style: `width:${l.length ? ((l.length - sis) / l.length) * 100 : 0}%;background:${COL.no}` }))));
      }))));

    if (!done.length) { push(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'Aún no hay encuestas en este periodo.'))); root.append(...kids); return; }

    // avance diario
    push(h('section', { class: 'panel' }, h('h2', {}, 'Encuestas por día'), h('div', { class: 'chart' }, dailyChart(diasPeriodo, scope, done, metaDia)),
      h('p', { class: 'legend' }, scope.map((s, k) => h('span', {}, h('i', { class: 'enc-dot', style: `background:${k ? COL.sede1 : COL.sede0}` }), short(s.name))), h('span', { class: 'lg lg-target' }, 'Meta diaria'))));

    // ---------- resultados ----------
    const nos = done.filter((e) => !e.cumple);
    const count = (arr, key, opts, keep) => { const r = opts.map((o) => ({ label: o.label, n: arr.filter((e) => e[key] === o.key).length })); return keep ? r : r.sort((a, b) => b.n - a.n); };
    push(h('section', { class: 'panel enc-level' }, h('p', { class: 'enc-eyebrow' }, 'Resultados de la encuesta'),
      h('div', { class: 'enc-q1' }, h('h3', {}, E.PREGUNTAS.q1),
        h('div', { class: 'enc-bar enc-split enc-tall' }, h('span', { style: `width:${pct(si, done.length)}%;background:${COL.si}` }, `Sí ${pct(si, done.length)}%`), no ? h('span', { style: `width:${pct(no, done.length)}%;background:${COL.no}` }, `No ${pct(no, done.length)}%`) : null)),
      nos.length ? h('div', { class: 'enc-l3' },
        h('div', {}, h('h3', {}, 'Principal inconveniente'), hbars(count(nos, 'inconveniente', E.INCONVENIENTES), nos.length, COL.no)),
        h('div', {}, h('h3', {}, 'Frecuencia'), hbars(count(nos, 'frecuencia', E.FRECUENCIAS, true), nos.length, '#d9a23a')),
        h('div', {}, h('h3', {}, 'Actividad más afectada'), hbars(count(nos, 'actividad', E.ACTIVIDADES), nos.length, '#3f74c0'))) : h('p', { class: 'muted' }, 'Nadie respondió "No" en este periodo.'),
      h('p', { class: 'muted' }, `Las tres gráficas consideran solo a quienes respondieron "No" (${nf(nos.length)} usuarios).`)));

    // pisos y comentarios
    const pisos = new Map();
    done.forEach((e) => { const k = `${e.sedeId}|${e.piso}`; const x = pisos.get(k) || { sede: short(e.sede), piso: e.piso || '—', n: 0, no: 0 }; x.n += 1; if (!e.cumple) x.no += 1; pisos.set(k, x); });
    const topPisos = [...pisos.values()].filter((x) => x.no).sort((a, b) => b.no - a.no || b.no / b.n - a.no / a.n).slice(0, 8);
    const coms = done.filter((e) => e.comentario || e.inconvenienteOtro).slice(-8).reverse();
    push(h('div', { class: 'two' },
      h('section', { class: 'panel' }, h('h2', {}, 'Pisos con más usuarios insatisfechos'),
        topPisos.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sede'), h('th', {}, 'Piso'), h('th', { class: 'num-col' }, 'Encuestas'), h('th', { class: 'num-col' }, 'Dicen "No"'), h('th', { class: 'num-col' }, '%'))),
          h('tbody', {}, topPisos.map((x) => h('tr', {}, h('td', {}, x.sede), h('td', {}, x.piso), h('td', { class: 'num-col plain' }, x.n), h('td', { class: 'num-col plain' }, x.no), h('td', { class: 'num-col plain' }, `${pct(x.no, x.n)}%`))))) : h('p', { class: 'muted' }, 'Sin pisos con respuestas negativas.')),
      h('section', { class: 'panel' }, h('h2', {}, 'Comentarios recientes'),
        coms.length ? h('ul', { class: 'enc-coms' }, coms.map((e) => h('li', {}, h('p', {}, `“${e.comentario || e.inconvenienteOtro}”`), h('span', { class: 'meta' }, `${dayMonth(e.fecha)} · ${short(e.sede)} · ${e.piso || ''} · ${e.cumple ? 'Sí cumple' : 'No cumple'}`)))) : h('p', { class: 'muted' }, 'Sin comentarios en el periodo.'))));

    // reportes
    push(reportsPanel(scope));

    // detalle
    const rows = all.slice().reverse();
    push(h('section', { class: 'panel enc-registro' }, h('h2', {}, `Registro de encuestas (${nf(rows.length)})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Sede y piso'), h('th', {}, 'Encuestador'), h('th', {}, 'Resultado'), h('th', {}, 'Respuestas'), h('th', {}, 'Comentario'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, rows.slice(0, view.limit).map((e) => h('tr', {},
          h('td', { class: 'nowrap' }, dayMonth(e.fecha), h('br'), h('span', { class: 'muted' }, e.hora || '')),
          h('td', {}, short(e.sede), h('br'), h('span', { class: 'muted' }, [e.piso, e.referencia].filter(Boolean).join(' · '))),
          h('td', {}, e.encuestador || '—'),
          h('td', {}, e.resultado === 'completa' ? h('span', { class: 'pill ' + (e.cumple ? 'pill-good' : 'pill-crit') }, e.cumple ? 'Sí cumple' : 'No cumple') : h('span', { class: 'pill pill-none' }, lab(E.RESULTADOS, e.resultado))),
          h('td', {}, e.resultado === 'completa' && !e.cumple ? `${e.inconveniente === 'otro' ? e.inconvenienteOtro : lab(E.INCONVENIENTES, e.inconveniente)} · ${lab(E.FRECUENCIAS, e.frecuencia)} · ${e.actividad === 'otro' ? (e.actividadOtro || 'Otro') : lab(E.ACTIVIDADES, e.actividad)}` : e.regreso ? `Regresar: ${e.regreso}` : ''),
          h('td', { class: 'detail-col' }, e.comentario || ''),
          h('td', { class: 'actions no-print' }, isAdmin() || (e.createdBy === state.user.id && e.fecha === CAT.hoy) ? h('button', { class: 'link-btn', type: 'button', onclick: (ev) => confirmInline(ev.currentTarget, async () => { await api('DELETE', '/api/encuestas/' + e.id); toast('Encuesta eliminada'); state.stale = true; window.Portal.route(); }) }, 'Eliminar') : null)))))),
      rows.length > view.limit ? h('button', { class: 'btn no-print', type: 'button', onclick: () => { view.limit += 50; render(); } }, 'Ver más') : null));
    root.append(...kids);
  }

  /* ---------- menú de reportes para BBVA ---------- */
  function reportItems() {
    if (!CAT) return [];
    const q = (extra = '') => `?desde=${view.desde}&hasta=${view.hasta}${view.sede ? '&sede=' + view.sede : ''}${extra}`;
    const printFor = (sedeId) => () => { const prev = view.sede; view.sede = sedeId; render(); setTimeout(() => { window.print(); view.sede = prev; render(); }, 150); };
    return [
      { label: 'PDF ejecutivo', hint: 'Avance, satisfacción, resultados y pisos del periodo (Polanco y Reforma)', onClick: printFor('') },
      ...CAT.sedes.map((s) => ({ label: `PDF de ${short(s.name)}`, hint: 'Mismo reporte solo con esta sede', onClick: printFor(String(s.id)) })),
      { label: 'Respuestas detalladas (Excel CSV)', hint: 'Una fila por encuesta con todas las respuestas', href: '/api/encuestas/reportes/respuestas.csv' + q() },
      { label: 'Avance diario por sede (Excel CSV)', hint: 'Realizadas contra meta por día hábil', href: '/api/encuestas/reportes/avance.csv' + q() },
      { label: 'Resultados por piso (Excel CSV)', hint: 'Encuestas e insatisfacción por piso', href: '/api/encuestas/reportes/pisos.csv' + q() },
      { label: 'Comentarios y sugerencias (Excel CSV)', hint: 'Respuestas abiertas del periodo', href: '/api/encuestas/reportes/comentarios.csv' + q() },
    ];
  }
  function reportsPanel() {
    return h('section', { class: 'panel no-print enc-reports' }, h('h2', {}, 'Reportes para BBVA'),
      h('p', { class: 'muted' }, `Usan el periodo y la sede elegidos arriba (${fullDate(view.desde)} – ${fullDate(view.hasta)}). Para el PDF, en la ventana de impresión elige "Guardar como PDF".`),
      h('div', { class: 'enc-rep-grid' }, reportItems().map((it) => (it.href
        ? h('a', { class: 'enc-rep', href: it.href }, h('strong', {}, it.label), h('span', {}, it.hint))
        : h('button', { class: 'enc-rep', type: 'button', onclick: it.onClick }, h('strong', {}, it.label), h('span', {}, it.hint))))));
  }

  async function configInicio(btn) {
    const box = h('div', { class: 'enc-config' });
    const inp = h('input', { type: 'date', value: CAT.config.definido ? CAT.config.inicio : '' });
    box.append(h('label', {}, 'Primer día del levantamiento ', inp), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await api('PUT', '/api/encuestas/config', { inicio: inp.value || null }); toast('Fecha de inicio guardada'); view.desde = null; view.hasta = null; await reload(); } catch (err) { toast(err.message, 'error'); } } }, 'Guardar'),
      h('span', { class: 'muted' }, ' Vacío = el día de la primera encuesta. El fin se calcula a 20 días hábiles.'));
    btn.closest('.panel').append(box); btn.disabled = true;
  }

  /* =========================================================
   * Captura guiada: una pantalla por paso, pensada para celular
   * ========================================================= */
  const W = { step: 'ubicacion', sedeId: '', pisoId: '', referencia: '', fecha: '', encuestadorId: '', r: {}, hist: [], last: null };
  const go = (step) => { W.hist.push(W.step); W.step = step; drawWizard(); };
  const back = () => { W.step = W.hist.pop() || 'ubicacion'; drawWizard(); };
  let wroot = null;

  async function viewWizard() {
    if (!canWrite()) return add(h('p', { class: 'empty' }, 'Tu usuario es de consulta: no puede registrar encuestas.'));
    await loadCat();
    if (!W.fecha) W.fecha = CAT.hoy;
    W.step = W.sedeId && W.pisoId ? 'inicio' : 'ubicacion'; W.hist = []; W.r = {};
    wroot = h('div', { class: 'enc-wizard' });
    add(h('nav', { class: 'crumb' }, h('a', { href: '#/iniciativa/encuestas' }, '← Encuestas a usuarios finales')), wroot);
    drawWizard();
  }

  async function save(resultado) {
    const body = { sedeId: W.sedeId, pisoId: W.pisoId, referencia: W.referencia, fecha: W.fecha, encuestadorId: W.encuestadorId || undefined, hora: new Date().toTimeString().slice(0, 5), resultado, ...W.r };
    const r = await api('POST', '/api/encuestas', body);
    state.stale = true; // el indicador de la iniciativa se recalcula al volver al tablero
    W.last = r; return r;
  }

  function drawWizard() {
    if (!wroot) return;
    wroot.textContent = '';
    const sede = CAT.sedes.find((s) => String(s.id) === String(W.sedeId));
    const piso = sede && sede.pisos.find((p) => String(p.id) === String(W.pisoId));
    const name = (state.user.name || '').split(' ')[0];
    const opt = (label, on, cls = '') => h('button', { class: 'enc-opt ' + cls, type: 'button', onclick: on }, label);
    const card = (...c) => h('section', { class: 'panel enc-step' }, ...c);
    const head = sede && W.step !== 'ubicacion' ? h('div', { class: 'enc-where' }, h('span', {}, `${short(sede.name)} · ${piso ? piso.name : ''}${W.referencia ? ' · ' + W.referencia : ''}`),
      h('button', { class: 'link-btn', type: 'button', onclick: () => { W.hist = []; W.step = 'ubicacion'; drawWizard(); } }, 'Cambiar ubicación')) : null;
    const progress = W.last ? h('p', { class: 'enc-prog' }, `Hoy: ${(W.last.hoy || []).map((x) => `${short(x.sede)} ${x.n}/${E.META.porSede}`).join(' · ') || '0'} · Tus encuestas: ${W.last.mias}`) : null;
    const backBtn = W.hist.length ? h('button', { class: 'btn enc-back', type: 'button', onclick: back }, '← Anterior') : null;
    const otherInput = (key, placeholder, next) => { const t = h('input', { type: 'text', class: 'enc-other', placeholder, maxlength: 200, value: W.r[key] || '' }); return h('div', { class: 'enc-otherbox' }, t, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (!t.value.trim()) { toast('Escribe la respuesta.', 'error'); return; } W.r[key] = t.value.trim(); next(); } }, 'Continuar')); };
    let body;
    switch (W.step) {
      case 'ubicacion': {
        const pisoSel = h('select', { id: 'enc-w-piso', onchange: (e) => { W.pisoId = e.target.value; } }, h('option', { value: '' }, 'Selecciona el piso…'), (sede ? sede.pisos : []).map((p) => h('option', { value: p.id, selected: String(p.id) === String(W.pisoId) }, p.name)));
        body = card(h('h1', {}, 'Nueva encuesta'), h('p', { class: 'muted' }, 'Indica dónde estás. Se conserva para las siguientes encuestas hasta que lo cambies.'),
          h('div', { class: 'enc-opts enc-opts-2' }, CAT.sedes.map((s) => opt(short(s.name), () => { W.sedeId = String(s.id); W.pisoId = ''; drawWizard(); }, String(s.id) === String(W.sedeId) ? 'is-on' : ''))),
          sede ? h('div', { class: 'field' }, h('label', { for: 'enc-w-piso' }, 'Piso'), pisoSel) : null,
          sede ? h('div', { class: 'field' }, h('label', { for: 'enc-w-ref' }, 'Referencia (zona, AP o ID de la posición)', h('span', { class: 'optional' }, ' opcional')), h('input', { id: 'enc-w-ref', type: 'text', maxlength: 120, value: W.referencia, oninput: (e) => { W.referencia = e.target.value; } })) : null,
          isAdmin() ? h('div', { class: 'rd-filters' },
            h('div', { class: 'field' }, h('label', { for: 'enc-w-fecha' }, 'Fecha'), h('input', { id: 'enc-w-fecha', type: 'date', value: W.fecha, max: CAT.hoy, onchange: (e) => { W.fecha = e.target.value; } })),
            h('div', { class: 'field' }, h('label', { for: 'enc-w-quien' }, 'Encuestador'), h('select', { id: 'enc-w-quien', onchange: (e) => { W.encuestadorId = e.target.value; } }, CAT.encuestadores.map((u) => h('option', { value: u.id, selected: String(u.id) === String(W.encuestadorId || state.user.id) }, u.name))))) : null,
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary enc-go', type: 'button', onclick: () => { if (!W.sedeId || !W.pisoId) { toast('Elige la sede y el piso.', 'error'); return; } W.hist = []; W.step = 'inicio'; drawWizard(); } }, 'Comenzar')));
        break;
      }
      case 'inicio':
        W.r = {};
        body = card(h('p', { class: 'enc-tag' }, 'Inicio y presentación'), h('blockquote', { class: 'enc-speech' }, E.SPEECH.inicio.replace('{nombre}', name)),
          h('div', { class: 'enc-opts' },
            opt('Aceptó', () => go('q1'), 'is-yes'),
            opt('Está ocupado', () => go('ocupado')),
            opt('No desea participar', async () => { try { await save('rechazo'); toast('Registrado: no desea participar'); drawWizard(); } catch (err) { toast(err.message, 'error'); } })),
          h('details', { class: 'section' }, h('summary', {}, 'Recomendaciones'), h('div', { class: 'section-body' }, h('ul', {}, E.RECOMENDACIONES.map((t) => h('li', {}, t))))));
        break;
      case 'ocupado': {
        const t = h('input', { type: 'text', placeholder: 'Ej.: después de las 13:00, extensión, lugar', maxlength: 120 });
        body = card(h('p', { class: 'enc-tag' }, 'Si el usuario está ocupado'), h('blockquote', { class: 'enc-speech' }, E.SPEECH.ocupado),
          h('div', { class: 'field' }, h('label', {}, '¿Cuándo regresar?', h('span', { class: 'optional' }, ' opcional')), t),
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { W.r = {}; W.r.regreso = t.value; await save('ocupado'); toast('Registrado: atender en otro momento'); W.hist = []; W.step = 'inicio'; drawWizard(); } catch (err) { toast(err.message, 'error'); } } }, 'Registrar y seguir'), backBtn));
        break;
      }
      case 'q1':
        body = card(h('blockquote', { class: 'enc-speech enc-speech-sm' }, E.SPEECH.acepta), h('p', { class: 'enc-tag' }, 'Pregunta 1'), h('h2', { class: 'enc-q' }, E.PREGUNTAS.q1),
          h('div', { class: 'enc-opts enc-opts-2' }, opt('Sí', () => { W.r.cumple = true; go('comentario'); }, 'is-yes'), opt('No', () => { W.r.cumple = false; go('q2'); }, 'is-no')), backBtn);
        break;
      case 'comentario': {
        const t = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Respuesta abierta (opcional)' });
        body = card(h('p', { class: 'enc-tag' }, 'Pregunta 2'), h('h2', { class: 'enc-q' }, E.PREGUNTAS.comentario), t,
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary enc-go', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { W.r.comentario = t.value; await save('completa'); W.hist = []; W.step = 'cierre'; drawWizard(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, 'Finalizar encuesta'), backBtn));
        break;
      }
      case 'q2':
        body = card(h('p', { class: 'enc-tag' }, 'Pregunta 2'), h('h2', { class: 'enc-q' }, E.PREGUNTAS.q2),
          W.r.inconveniente === 'otro' ? otherInput('inconvenienteOtro', '¿Cuál?', () => go('q3')) : h('div', { class: 'enc-opts' }, E.INCONVENIENTES.map((o) => opt(o.label, () => { W.r.inconveniente = o.key; if (o.key === 'otro') drawWizard(); else { W.r.inconvenienteOtro = null; go('q3'); } }))), backBtn);
        break;
      case 'q3':
        body = card(h('p', { class: 'enc-tag' }, 'Pregunta 3'), h('h2', { class: 'enc-q' }, E.PREGUNTAS.q3), h('div', { class: 'enc-opts' }, E.FRECUENCIAS.map((o) => opt(o.label, () => { W.r.frecuencia = o.key; go('q4'); }))), backBtn);
        break;
      case 'q4': {
        const finish = async () => { try { await save('completa'); W.hist = []; W.step = 'cierre'; drawWizard(); } catch (err) { toast(err.message, 'error'); } };
        body = card(h('p', { class: 'enc-tag' }, 'Pregunta 4'), h('h2', { class: 'enc-q' }, E.PREGUNTAS.q4),
          W.r.actividad === 'otro' ? otherInput('actividadOtro', '¿Cuál actividad?', finish) : h('div', { class: 'enc-opts' }, E.ACTIVIDADES.map((o) => opt(o.label, () => { W.r.actividad = o.key; if (o.key === 'otro') drawWizard(); else { W.r.actividadOtro = null; finish(); } }))), backBtn);
        break;
      }
      case 'cierre':
        body = card(h('p', { class: 'enc-tag' }, W.r.cumple ? '¡Muchas gracias por tu retro!' : '¡Muchas gracias por tu tiempo!'), h('blockquote', { class: 'enc-speech' }, E.SPEECH.cierre),
          h('p', {}, 'Muestra al usuario la postal: recomendaciones de uso y dónde reportar una falla (Service Now).'),
          h('a', { href: '/img/postal-wifi-bbva.jpg', target: '_blank', rel: 'noopener', class: 'enc-postal-link', title: 'Abrir la postal en grande' }, h('img', { class: 'enc-postal', src: '/img/postal-wifi-bbva.jpg', alt: 'Postal BBVA: Tu experiencia WiFi nos importa. Recomendaciones: Portal HPD WiFi BBVA, Hotspot y uso responsable. En caso de presentar una falla, registra tu incidencia en Service Now.' })),
          h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary enc-go', type: 'button', onclick: () => { W.hist = []; W.step = 'inicio'; drawWizard(); window.scrollTo(0, 0); } }, 'Siguiente encuesta'), h('a', { class: 'btn', href: '#/iniciativa/encuestas' }, 'Ver tablero')));
        break;
      default: body = null;
    }
    wroot.append(...[head, progress, body].filter(Boolean));
  }

  window.PortalEncuestas = {
    exportItems: () => reportItems(),
    async mount(el) { root = el; el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando encuestas…')); try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); } },
  };
  window.PortalRoutes = Object.assign(window.PortalRoutes || {}, { encuesta: () => viewWizard() });
})();
