'use strict';
(() => {
  /* ---------- utilidades ---------- */
  const h = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'hidden' || k === 'disabled' || k === 'required' || k === 'open' || k === 'selected') n[k] = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  };
  const view = document.getElementById('view');
  const state = { user: null, data: null };
  const add = (...nodes) => view.append(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'portal' } : { 'X-Requested-With': 'portal' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('No hay conexión con el servidor. Revisa tu red e intenta de nuevo.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'no_session') { window.location.assign('/login'); throw new Error(data.error); }
    if (!res.ok) { const e = new Error(data.error || 'No se pudo completar la acción.'); e.code = data.code; throw e; }
    return data;
  }

  let toastTimer;
  function toast(msg, kind = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast toast-' + kind; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  /* ---------- fechas y números ---------- */
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const utc = (s) => new Date(s + 'T00:00:00Z');
  const iso = (d) => d.toISOString().slice(0, 10);
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const mondayOf = (s) => { const d = utc(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); };
  function weekNumber(mon) {
    const d = utc(mon); d.setUTCDate(d.getUTCDate() + 3); // jueves de esa semana
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round((d - jan4) / 6048e5 + ((jan4.getUTCDay() + 6) % 7 - 3) / 7);
  }
  const dayMonth = (s) => { const d = utc(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const fullDate = (s) => { const d = utc(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  function weekRange(mon) {
    const end = utc(mon); end.setUTCDate(end.getUTCDate() + 6);
    return `${dayMonth(mon)} – ${dayMonth(iso(end))} ${end.getUTCFullYear()}`;
  }
  const weekLabel = (mon) => `Semana ${weekNumber(mon)}`;
  const fmt = (v, decimals = 0) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(v);
  const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);
  const localDate = (isoTs) => { const d = new Date(isoTs); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const withUnit = (v, kpi) => (v === null || v === undefined ? '—' : fmt(v, kpi.decimals) + (kpi.unit === '%' ? '%' : ''));

  /* ---------- indicadores ---------- */
  function kpiValue(kpi, values) {
    if (kpi.ratio) {
      const [a, b] = kpi.ratio.map((k) => values[k]);
      if (a === undefined || b === undefined || !(b > 0)) return null;
      return (a / b) * 100;
    }
    const v = values[kpi.key];
    return v === undefined ? null : v;
  }
  const recordsOf = (slug) => state.data.records.filter((r) => r.initiative === slug);
  function series(it, kpi) {
    return recordsOf(it.slug).map((r) => ({ rec: r, value: kpiValue(kpi, r.values) })).filter((p) => p.value !== null);
  }
  const meets = (v, kpi) => ({ '>=': v >= kpi.target, '>': v > kpi.target, '<=': v <= kpi.target, '<': v < kpi.target }[kpi.op || (kpi.dir === 'down' ? '<=' : '>=')]);
  const OPS = { '>=': '', '>': '> ', '<=': '≤ ', '<': '< ' };
  const targetText = (kpi) => (kpi.target === null || kpi.target === undefined ? null : OPS[kpi.op || '>='] + withUnit(kpi.target, kpi));

  const STATUS = {
    cumplido: { label: 'Objetivo cumplido', cls: 'good', icon: '✓' },
    criterio: { label: 'Dentro de criterio', cls: 'good', icon: '✓' },
    mejora: { label: 'Mejora vs. inicial', cls: 'good', icon: '✓' },
    progreso: { label: 'En progreso', cls: 'prog', icon: '→' },
    atencion: { label: 'Requiere atención', cls: 'warn', icon: '!' },
    alerta: { label: 'Evaluar rediseño', cls: 'crit', icon: '▲' },
    sin_datos: { label: 'Sin datos', cls: 'none', icon: '–' },
  };
  function evaluate(it, kpi) {
    const s = series(it, kpi);
    const last = s[s.length - 1];
    const cur = last ? last.value : null;
    const out = { kpi, series: s, last, current: cur, progress: null, status: 'sin_datos' };
    if (cur === null) return out;
    const hasT = kpi.target !== null && kpi.target !== undefined;
    const hasB = kpi.baseline !== null && kpi.baseline !== undefined;
    const better = hasB ? (kpi.dir === 'down' ? cur < kpi.baseline : cur > kpi.baseline) : null;
    if (hasT) {
      const from = hasB ? kpi.baseline : (kpi.dir === 'down' ? null : 0);
      if (from !== null && kpi.target !== from) out.progress = Math.max(0, Math.min(1, (cur - from) / (kpi.target - from)));
      if (meets(cur, kpi)) { out.status = 'cumplido'; out.progress = 1; }
      else out.status = better === false || (out.progress !== null && out.progress <= 0) ? 'atencion' : 'progreso';
    } else if (kpi.limit !== null && kpi.limit !== undefined) {
      out.status = cur < kpi.limit ? 'criterio' : 'alerta';
    } else if (hasB && kpi.dir) {
      out.status = better ? 'mejora' : cur === kpi.baseline ? 'progreso' : 'atencion';
    } else out.status = 'progreso';
    if (hasB) {
      out.delta = cur - kpi.baseline;
      out.deltaPct = kpi.baseline > 0 ? (out.delta / kpi.baseline) * 100 : null;
    }
    return out;
  }
  const pill = (key) => {
    const s = STATUS[key];
    return h('span', { class: 'pill pill-' + s.cls }, h('span', { class: 'pill-icon', 'aria-hidden': 'true' }, s.icon), s.label);
  };
  const canWrite = () => state.user.role === 'admin' || state.user.role === 'ingeniero';
  const isAdmin = () => state.user.role === 'admin';
  const ROLE_LABEL = { admin: 'Administrador', ingeniero: 'Ingeniero', consulta: 'Solo consulta' };

  /* ---------- barra superior ---------- */
  function renderChrome(route) {
    const nav = document.getElementById('nav');
    nav.textContent = '';
    const link = (href, label, key) => h('a', { href, class: 'nav-link' + (route === key ? ' is-active' : ''), 'aria-current': route === key ? 'page' : null }, label);
    if (!state.user.mustChange) {
      nav.append(link('#/', 'Tablero', 'tablero'));
      nav.append(link('#/recorridos', 'Recorridos', 'recorridos'));
      if (canWrite()) nav.append(link('#/capturar', 'Capturar avance', 'capturar'));
      if (isAdmin()) nav.append(link('#/usuarios', 'Usuarios', 'usuarios'));
    }
    const u = document.getElementById('user');
    u.textContent = '';
    u.append(
      h('div', { class: 'user-id' }, h('span', { class: 'user-name' }, state.user.name), h('span', { class: 'user-role' }, ROLE_LABEL[state.user.role])),
      h('a', { href: '#/cuenta', class: 'link-btn' }, 'Contraseña'),
      h('button', { class: 'link-btn', type: 'button', onclick: async () => { await api('POST', '/api/logout', {}); window.location.assign('/login'); } }, 'Salir'),
    );
    if (state.data) document.getElementById('program-client').textContent = 'Cliente: ' + state.data.program.client;
  }

  /* ---------- tablero ejecutivo ---------- */
  function viewDashboard() {
    const { initiatives, records } = state.data;
    const evals = initiatives.map((it) => ({ it, ev: evaluate(it, it.kpis[0]) }));
    const count = (cls) => evals.filter((e) => STATUS[e.ev.status].cls === cls).length;
    const good = count('good');
    const attention = count('warn') + count('crit');
    const lastWeek = records.length ? records[records.length - 1].week : null;

    const cards = evals.map(({ it, ev }) => {
      const k = ev.kpi;
      const vals = [];
      if (k.baseline !== null && k.baseline !== undefined) vals.push(k.baseline);
      ev.series.forEach((p) => vals.push(p.value));
      const tgt = targetText(k);
      const alt = !tgt && !k.limit ? it.kpis.find((x) => x.target !== null && x.target !== undefined) : null;
      return h('a', { class: 'card card-' + STATUS[ev.status].cls, href: '#/iniciativa/' + it.slug },
        h('div', { class: 'card-top' }, pill(ev.status)),
        h('h3', { class: 'card-title' }, it.name),
        h('p', { class: 'card-kpi-name' }, k.label),
        h('div', { class: 'card-main' },
          h('div', { class: 'card-value' },
            h('span', { class: 'num' }, withUnit(ev.current, k)),
            k.unit !== '%' ? h('span', { class: 'unit' }, k.unit) : null),
          vals.length ? Charts.spark(vals, k.target ?? k.limit ?? null) : null),
        h('dl', { class: 'card-refs' },
          h('div', {}, h('dt', {}, 'Inicial'), h('dd', {}, withUnit(k.baseline, k))),
          h('div', {}, h('dt', {}, tgt ? 'Objetivo' : k.limit ? 'Criterio' : 'Objetivo'), h('dd', {}, tgt || (k.limit ? '< ' + withUnit(k.limit, k) : alt ? h('span', {}, targetText(alt), h('small', {}, ' ' + alt.label.toLowerCase())) : '—')))),
        ev.progress !== null
          ? h('div', { class: 'bar', role: 'img', 'aria-label': `Avance hacia el objetivo: ${Math.round(ev.progress * 100)}%` },
              h('div', { class: 'bar-fill', style: `width:${Math.round(ev.progress * 100)}%` }),
              h('span', { class: 'bar-label' }, Math.round(ev.progress * 100) + '% del objetivo'))
          : h('div', { class: 'bar bar-empty' }, h('span', { class: 'bar-label' },
              ev.deltaPct !== null && ev.deltaPct !== undefined ? `${signed(ev.deltaPct, 1)}% vs. inicial` : 'Indicador de seguimiento')),
        h('p', { class: 'card-foot' }, ev.last ? `${weekLabel(ev.last.rec.week)} · ${weekRange(ev.last.rec.week)}` : 'Aún no hay avances capturados'),
      );
    });

    add(
      h('section', { class: 'hero' },
        h('div', { class: 'hero-text' },
          h('p', { class: 'eyebrow' }, `${state.data.program.client} · Iniciativas enfocadas a mejora NPS · WLAN`),
          h('h1', {}, h('span', { class: 'hero-num' }, `${good} de ${initiatives.length}`), ' iniciativas cumplen su objetivo o criterio'),
          h('p', { class: 'hero-sub' }, lastWeek ? `Corte: ${weekLabel(lastWeek).toLowerCase()} (${weekRange(lastWeek)}).` : 'Aún no hay avances capturados.')),
        h('div', { class: 'tally' },
          h('div', { class: 'tally-item tally-good' }, h('span', { class: 'tally-num' }, good), h('span', { class: 'tally-label' }, 'En objetivo')),
          h('div', { class: 'tally-item tally-prog' }, h('span', { class: 'tally-num' }, count('prog')), h('span', { class: 'tally-label' }, 'En progreso')),
          h('div', { class: 'tally-item tally-warn' }, h('span', { class: 'tally-num' }, attention), h('span', { class: 'tally-label' }, 'Requieren atención'))),
        h('div', { class: 'hero-actions no-present' },
          h('button', { class: 'btn', type: 'button', onclick: togglePresent }, 'Modo presentación'),
          h('a', { class: 'btn', href: '/api/export.csv' }, 'Descargar CSV'),
          canWrite() ? h('a', { class: 'btn btn-primary', href: '#/capturar' }, 'Capturar avance') : null)),
      h('section', { class: 'cards', 'aria-label': 'Iniciativas' }, cards),
      h('button', { class: 'btn exit-present', type: 'button', onclick: togglePresent }, 'Salir de presentación'),
    );
  }
  function togglePresent() {
    const on = document.body.classList.toggle('present');
    if (on) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('present'); });

  /* ---------- detalle de iniciativa ---------- */
  function renderSection(s) {
    const body = [];
    if (s.intro) body.push(h('p', {}, s.intro));
    if (s.type === 'text') body.push(h('p', {}, s.text));
    if (s.type === 'quote') body.push(h('blockquote', {}, s.text));
    if (s.type === 'list') body.push(h('ul', { class: s.columns ? 'cols' : null }, s.items.map((i) => h('li', {}, i))));
    if (s.type === 'steps') body.push(h('ol', {}, s.items.map((i) => h('li', {}, i))));
    if (s.type === 'groups') body.push(h('ol', { class: 'groups' }, s.groups.map((g) => h('li', {}, h('strong', {}, g.title), h('ul', {}, g.items.map((i) => h('li', {}, i)))))));
    if (s.outro) body.push(h('p', { class: 'muted' }, s.outro));
    if (s.link) body.push(h('p', {}, h('a', { href: s.link.url, target: '_blank', rel: 'noopener noreferrer' }, s.link.label)));
    return h('details', { class: 'section' }, h('summary', {}, s.title), h('div', { class: 'section-body' }, body));
  }

  function viewDetail(slug) {
    const it = state.data.initiatives.find((i) => i.slug === slug);
    if (!it) return add(h('p', { class: 'empty' }, 'La iniciativa no existe. ', h('a', { href: '#/' }, 'Volver al tablero')));
    const evals = it.kpis.map((k) => evaluate(it, k));
    const main = evals[0];
    const k = main.kpi;
    const recs = recordsOf(slug).slice().reverse();
    const altT = k.target === null || k.target === undefined ? (k.limit ? null : it.kpis.find((x) => x.target !== null && x.target !== undefined)) : null;
    const unitText = (kk) => (kk.unit === '%' ? '' : kk.unit);

    // encabezado y trío de métricas
    const trio = h('div', { class: 'trio' },
      h('div', { class: 'trio-item' }, h('span', { class: 'trio-label' }, 'Métrica inicial'),
        h('span', { class: 'trio-num' }, withUnit(k.baseline, k)), h('span', { class: 'trio-unit' }, k.baselineLabel || unitText(k))),
      h('div', { class: 'trio-item trio-current' }, h('span', { class: 'trio-label' }, 'Métrica actual'),
        h('span', { class: 'trio-num' }, withUnit(main.current, k)),
        h('span', { class: 'trio-unit' }, [unitText(k), main.last ? `${weekLabel(main.last.rec.week).toLowerCase()} (${weekRange(main.last.rec.week)})` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'trio-item' }, h('span', { class: 'trio-label' }, k.target === null || k.target === undefined ? (k.limit ? k.limitLabel : 'Métrica objetivo') : 'Métrica objetivo'),
        h('span', { class: 'trio-num' }, targetText(k) || (k.limit ? '< ' + withUnit(k.limit, k) : altT ? targetText(altT) : '—')),
        h('span', { class: 'trio-unit' }, k.target === null || k.target === undefined ? (k.limit ? unitText(k) : altT ? altT.label : 'Sin objetivo numérico') : unitText(k))),
    );
    const facts = [];
    if (main.deltaPct !== null && main.deltaPct !== undefined) facts.push(`Variación contra la métrica inicial: ${signed(main.deltaPct, 1)}%.`);
    else if (main.delta) facts.push(`Variación contra la métrica inicial: ${signed(main.delta, k.decimals)} ${k.short}.`);
    if (k.note) facts.push(k.note);

    // gráfica con selector de indicador
    const chartBox = h('div', { class: 'chart' });
    const chartTitle = h('h2', {}, '');
    const drawChart = (ev) => {
      const kk = ev.kpi;
      chartTitle.textContent = kk.label + (kk.unit === '%' ? ' (%)' : ` (${kk.unit})`);
      const pts = [];
      if (kk.baseline !== null && kk.baseline !== undefined) pts.push({ label: 'Inicial', value: kk.baseline, kind: 'base', tip: ['Métrica inicial del programa'] });
      ev.series.forEach((p) => pts.push({
        label: 'Sem ' + weekNumber(p.rec.week), sub: dayMonth(p.rec.week), value: p.value,
        tip: [p.rec.detail.length > 140 ? p.rec.detail.slice(0, 140) + '…' : p.rec.detail, 'Capturó: ' + p.rec.author],
      }));
      chartBox.textContent = '';
      if (!pts.length) { chartBox.append(h('p', { class: 'empty' }, 'Aún no hay datos para este indicador. Se graficará con la primera captura semanal.')); return; }
      const refs = [];
      if (kk.target !== null && kk.target !== undefined) refs.push({ value: kk.target, label: 'Objetivo', kind: 'target' });
      if (kk.limit) refs.push({ value: kk.limit, label: kk.limitLabel || 'Criterio', kind: 'limit' });
      Charts.line(chartBox, { points: pts, refs, unit: kk.unit, title: `Tendencia semanal de ${kk.label}`, fmt: (v) => fmt(v, kk.decimals) });
    };
    const tabs = evals.length > 1
      ? h('div', { class: 'tabs', role: 'tablist' }, evals.map((ev, i) => h('button', {
          type: 'button', role: 'tab', class: 'tab' + (i === 0 ? ' is-active' : ''), 'aria-selected': String(i === 0),
          onclick: (e) => {
            e.currentTarget.parentNode.querySelectorAll('.tab').forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
            e.currentTarget.classList.add('is-active'); e.currentTarget.setAttribute('aria-selected', 'true');
            drawChart(ev);
          } }, ev.kpi.label)))
      : null;

    // otros indicadores
    const others = evals.slice(1);
    const othersBox = others.length ? h('div', { class: 'others' }, others.map((ev) => h('div', { class: 'other' },
      h('span', { class: 'other-label' }, ev.kpi.label),
      h('span', { class: 'other-num' }, ev.current === null ? 'Sin dato' : withUnit(ev.current, ev.kpi) + (ev.kpi.unit === '%' ? '' : ' ' + ev.kpi.short)),
      ev.kpi.target !== null && ev.kpi.target !== undefined ? h('span', { class: 'other-target' }, 'Objetivo: ' + targetText(ev.kpi)) : null,
      ev.kpi.target !== null && ev.kpi.target !== undefined && ev.current !== null ? pill(ev.status) : null))) : null;

    // hitos
    const today = todayStr();
    const msList = it.milestones.length
      ? h('ol', { class: 'timeline' }, it.milestones.map((ms) => {
          const future = ms.date && ms.date > today;
          const when = ms.date ? (ms.dateEnd ? `${dayMonth(ms.date)} – ${fullDate(ms.dateEnd)}` : fullDate(ms.date)) : ms.label;
          return h('li', { class: 'tl-item' + (future ? ' is-future' : '') },
            h('span', { class: 'tl-when' }, when, future ? h('span', { class: 'tag' }, 'Programado') : null),
            h('span', { class: 'tl-text' }, ms.text),
            (isAdmin() || (state.user.role === 'ingeniero' && ms.createdBy === state.user.id)) ? h('button', { class: 'link-btn tl-del no-present', type: 'button', 'aria-label': 'Eliminar hito',
              onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', '/api/milestones/' + ms.id); await reload('Hito eliminado'); }) }, 'Eliminar') : null);
        }))
      : h('p', { class: 'muted' }, 'Sin hitos registrados.');
    const msForm = canWrite() ? h('form', { class: 'inline-form no-present', onsubmit: async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        try {
          await api('POST', '/api/milestones', { initiative: slug, date: f.elements.date.value, text: f.elements.text.value });
          await reload('Hito agregado');
        } catch (err) { toast(err.message, 'error'); }
      } },
      h('label', { class: 'sr-only', for: 'ms-date' }, 'Fecha del hito'), h('input', { id: 'ms-date', name: 'date', type: 'date', required: true }),
      h('label', { class: 'sr-only', for: 'ms-text' }, 'Descripción del hito'), h('input', { id: 'ms-text', name: 'text', type: 'text', placeholder: 'Descripción del hito', maxlength: 400, required: true }),
      h('button', { class: 'btn', type: 'submit' }, 'Agregar hito')) : null;

    // bitácora
    const table = recs.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Semana'), it.fields.map((f) => h('th', { class: 'num-col' }, f.label)), h('th', {}, 'Detalle'), h('th', {}, 'Capturó'), h('th', { class: 'no-present' }, ''))),
      h('tbody', {}, recs.map((r) => h('tr', {},
        h('td', { class: 'nowrap' }, h('strong', {}, weekLabel(r.week)), h('br'), h('span', { class: 'muted' }, weekRange(r.week))),
        it.fields.map((f) => h('td', { class: 'num-col' }, r.values[f.key] === undefined ? '—' : fmt(r.values[f.key], 2))),
        h('td', { class: 'detail-col' }, r.detail,
          r.sede ? h('span', { class: 'meta' }, 'Sede: ' + r.sede) : null,
          r.evidenceUrl ? h('a', { class: 'meta', href: r.evidenceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Ver evidencia') : null),
        h('td', { class: 'nowrap' }, r.author, h('br'), h('span', { class: 'muted' }, localDate(r.updatedAt))),
        h('td', { class: 'actions no-present' },
          r.auto ? h('a', { class: 'link-btn', href: '#/recorridos' }, 'Ver recorridos') : null,
          canWrite() && !r.auto ? h('a', { class: 'link-btn', href: `#/capturar/${slug}/${r.week}` }, 'Editar') : null,
          !r.auto && (isAdmin() || (state.user.role === 'ingeniero' && r.createdBy === state.user.id))
            ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { await api('DELETE', '/api/records/' + r.id); await reload('Registro eliminado'); }) }, 'Eliminar') : null))))))
      : h('p', { class: 'empty' }, 'Aún no hay avances capturados para esta iniciativa.');

    // metas (administrador)
    const goals = isAdmin() ? h('details', { class: 'section no-present' }, h('summary', {}, 'Editar métricas inicial y objetivo'),
      h('div', { class: 'section-body' }, it.kpis.map((kk) => h('form', { class: 'inline-form', onsubmit: async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          try {
            await api('PUT', `/api/initiatives/${slug}/kpis/${kk.key}`, { baseline: f.elements.baseline.value, target: f.elements.target.value });
            await reload('Métricas actualizadas');
          } catch (err) { toast(err.message, 'error'); }
        } },
        h('strong', { class: 'goal-name' }, kk.label),
        h('label', {}, 'Inicial', h('input', { name: 'baseline', type: 'number', step: 'any', min: 0, value: kk.baseline ?? '', id: `g-b-${kk.key}` })),
        h('label', {}, 'Objetivo', h('input', { name: 'target', type: 'number', step: 'any', min: 0, value: kk.target ?? '', id: `g-t-${kk.key}` })),
        h('button', { class: 'btn', type: 'submit' }, 'Guardar'))))) : null;

    add(
      h('nav', { class: 'crumb no-present' }, h('a', { href: '#/' }, '← Tablero')),
      h('header', { class: 'detail-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, it.subtitle), h('h1', {}, it.name), pill(main.status)),
        slug === 'recorridos'
          ? h('div', { class: 'form-actions no-present' }, h('a', { class: 'btn', href: '#/recorridos' }, 'Ver recorridos diarios'), canWrite() ? h('a', { class: 'btn btn-primary', href: '#/recorrido/nuevo' }, 'Nuevo recorrido') : null)
          : canWrite() ? h('a', { class: 'btn btn-primary no-present', href: '#/capturar/' + slug }, 'Capturar avance') : null),
      h('p', { class: 'kpi-caption' }, k.label),
      trio,
      facts.length ? h('p', { class: 'facts' }, facts.join(' ')) : null,
      othersBox,
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, chartTitle, tabs), chartBox,
        h('p', { class: 'legend' },
          h('span', { class: 'lg lg-line' }, 'Valor semanal'),
          k.target !== null && k.target !== undefined ? h('span', { class: 'lg lg-target' }, 'Objetivo') : null,
          k.limit ? h('span', { class: 'lg lg-limit' }, k.limitLabel) : null)),
      h('div', { class: 'two' },
        h('section', { class: 'panel' },
          h('h2', {}, 'Valor generado al negocio'), h('p', { class: 'value-text' }, it.value),
          h('h2', {}, 'Impacto esperado'), h('ul', { class: 'impact' }, it.impact.map((i) => h('li', {}, i)))),
        h('section', { class: 'panel' }, h('h2', {}, 'Hitos'), msList, msForm)),
      h('section', { class: 'panel' }, h('h2', {}, 'Bitácora de avances semanales'), table),
      h('section', { class: 'sections' }, (it.sections || []).map(renderSection), goals),
    );
    drawChart(main);
  }

  /** Confirmación en la misma página (sin diálogos del navegador). */
  function confirmInline(btn, action) {
    if (btn.dataset.armed) return;
    const original = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = '¿Confirmar?';
    btn.classList.add('is-danger');
    const reset = () => { delete btn.dataset.armed; btn.textContent = original; btn.classList.remove('is-danger'); btn.removeEventListener('click', go); };
    const go = async (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      try { await action(); } catch (err) { toast(err.message, 'error'); reset(); }
    };
    const timer = setTimeout(reset, 4000);
    setTimeout(() => btn.addEventListener('click', go), 0);
  }

  /* ---------- captura semanal ---------- */
  function viewCapture(slugArg, weekArg) {
    if (!canWrite()) return add(h('p', { class: 'empty' }, 'Tu usuario es de consulta: no puede capturar avances.'));
    if (slugArg === 'recorridos') { window.location.hash = '#/recorrido/nuevo'; return; }
    const inits = state.data.initiatives.filter((i) => i.slug !== 'recorridos');
    let it = inits.find((i) => i.slug === slugArg) || inits[0];
    const today = todayStr();

    const sel = h('select', { id: 'c-init', name: 'initiative' }, inits.map((i) => h('option', { value: i.slug, selected: i.slug === it.slug }, i.name)));
    const date = h('input', { id: 'c-week', name: 'week', type: 'date', max: today, value: weekArg || today, required: true });
    const weekInfo = h('p', { class: 'hint', id: 'c-week-info' });
    const fieldsBox = h('div', { class: 'fields' });
    const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
    const sede = h('input', { id: 'c-sede', name: 'sede', type: 'text', maxlength: 200, placeholder: 'Ej. Reforma, Polanco' });
    const detail = h('textarea', { id: 'c-detail', name: 'detail', rows: 5, maxlength: 2000, required: true,
      placeholder: 'Qué se hizo, dónde, con quién y qué se encontró. Este texto se muestra en la bitácora y en la gráfica.' });
    const counter = h('span', { class: 'hint' }, '0 / 2000');
    const evid = h('input', { id: 'c-evid', name: 'evidenceUrl', type: 'url', maxlength: 500, placeholder: 'https://…' });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const exists = h('p', { class: 'notice', hidden: true });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Guardar avance');

    const readValues = () => Object.fromEntries(it.fields.map((f) => [f.key, document.getElementById('f-' + f.key).value]).filter(([, v]) => v !== ''));
    const updatePreview = () => {
      const raw = readValues();
      const vals = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
      preview.textContent = '';
      it.kpis.forEach((kk) => {
        const v = kpiValue(kk, vals);
        if (v === null || Number.isNaN(v)) return;
        const ok = kk.target !== null && kk.target !== undefined ? meets(v, kk) : null;
        preview.append(h('div', { class: 'preview-item' },
          h('span', { class: 'preview-label' }, kk.label),
          h('span', { class: 'preview-num' }, withUnit(v, kk) + (kk.unit === '%' ? '' : ' ' + kk.short)),
          kk.target !== null && kk.target !== undefined ? h('span', { class: 'preview-target' }, `Objetivo ${targetText(kk)} · ${ok ? 'cumple' : 'aún no cumple'}`) : null));
      });
    };
    const fill = () => {
      const wk = date.value ? mondayOf(date.value) : null;
      weekInfo.textContent = wk ? `Se registrará en la ${weekLabel(wk).toLowerCase()}: ${weekRange(wk)}.` : '';
      const prev = wk ? recordsOf(it.slug).find((r) => r.week === wk) : null;
      exists.hidden = !prev;
      if (prev) exists.textContent = `Ya hay un avance de esta semana, capturado por ${prev.author}. Se cargó para que lo edites; al guardar se reemplaza.`;
      it.fields.forEach((f) => { document.getElementById('f-' + f.key).value = prev && prev.values[f.key] !== undefined ? prev.values[f.key] : ''; });
      sede.value = prev?.sede || '';
      detail.value = prev?.detail || '';
      evid.value = prev?.evidenceUrl || '';
      counter.textContent = `${detail.value.length} / 2000`;
      submit.textContent = prev ? 'Guardar cambios' : 'Guardar avance';
      updatePreview();
    };
    const buildFields = () => {
      fieldsBox.textContent = '';
      it.fields.forEach((f) => fieldsBox.append(h('div', { class: 'field' },
        h('label', { for: 'f-' + f.key }, f.label, f.required ? null : h('span', { class: 'optional' }, ' (opcional)')),
        h('input', { id: 'f-' + f.key, name: f.key, type: 'number', inputmode: f.integer ? 'numeric' : 'decimal', step: f.integer ? 1 : 'any', min: f.min, max: f.max, required: f.required, oninput: updatePreview }))));
      fill();
    };
    sel.addEventListener('change', () => { it = inits.find((i) => i.slug === sel.value); buildFields(); });
    date.addEventListener('change', fill);
    detail.addEventListener('input', () => { counter.textContent = `${detail.value.length} / 2000`; });

    const form = h('form', { class: 'panel form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        const fail = (msg, focusEl) => { error.textContent = msg; error.hidden = false; focusEl?.focus(); };
        if (!date.value) return fail('Selecciona una fecha de la semana que reportas.', date);
        for (const f of it.fields) {
          const inp = document.getElementById('f-' + f.key);
          if (f.required && inp.value === '') return fail(`Falta el campo: ${f.label}.`, inp);
        }
        if (detail.value.trim().length < 20) return fail('Describe el avance con al menos 20 caracteres: qué se hizo y qué se encontró.', detail);
        submit.disabled = true;
        try {
          const r = await api('POST', '/api/records', { initiative: it.slug, week: date.value, values: readValues(), detail: detail.value, sede: sede.value, evidenceUrl: evid.value });
          await reload(r.replaced ? 'Avance actualizado' : 'Avance guardado', '#/iniciativa/' + it.slug);
        } catch (err) { fail(err.message); submit.disabled = false; }
      } },
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'c-init' }, 'Iniciativa'), sel),
        h('div', { class: 'field' }, h('label', { for: 'c-week' }, 'Semana que reportas'), date, weekInfo)),
      exists,
      h('h2', {}, 'Métricas de la semana'),
      fieldsBox, preview,
      h('h2', {}, 'Detalle del avance'),
      h('div', { class: 'field' }, h('label', { for: 'c-detail' }, 'Detalle'), detail, counter),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'c-sede' }, 'Sede o sedes', h('span', { class: 'optional' }, ' (opcional)')), sede),
        h('div', { class: 'field' }, h('label', { for: 'c-evid' }, 'Enlace a la evidencia', h('span', { class: 'optional' }, ' (opcional)')), evid)),
      error,
      h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn', href: '#/' }, 'Cancelar')));

    add(
      h('header', { class: 'page-head' }, h('h1', {}, 'Capturar avance semanal'),
        h('p', { class: 'muted' }, `Un registro por iniciativa por semana. Capturas como ${state.user.name}. `,
          h('a', { href: '#/recorrido/nuevo' }, 'Los recorridos proactivos se capturan por día aquí.'))),
      form);
    buildFields();
  }

  /* ---------- usuarios (administrador) ---------- */
  async function viewUsers() {
    if (!isAdmin()) return add(h('p', { class: 'empty' }, 'Solo un administrador puede gestionar usuarios.'));
    const { users } = await api('GET', '/api/users');
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const save = async (id, body, msg) => { try { await api('PUT', '/api/users/' + id, body); toast(msg); route(); } catch (err) { toast(err.message, 'error'); route(); } };

    const rows = users.map((u) => {
      const role = h('select', { 'aria-label': 'Rol de ' + u.name, id: 'role-' + u.id, onchange: (e) => save(u.id, { role: e.target.value }, 'Rol actualizado') },
        Object.entries(ROLE_LABEL).map(([k, l]) => h('option', { value: k, selected: u.role === k }, l)));
      const pw = h('input', { type: 'text', 'aria-label': 'Contraseña temporal para ' + u.name, id: 'pw-' + u.id, placeholder: 'Nueva contraseña temporal', autocomplete: 'off' });
      return h('tr', { class: u.active ? '' : 'is-inactive' },
        h('td', {}, h('strong', {}, u.name), h('br'), h('span', { class: 'muted' }, u.username)),
        h('td', {}, role),
        h('td', {}, u.active ? (u.mustChange ? 'Activo · debe cambiar contraseña' : 'Activo') : 'Desactivado'),
        h('td', { class: 'actions' },
          h('span', { class: 'reset' }, pw, h('button', { class: 'btn', type: 'button', onclick: () => {
            if (pw.value.length < 10) return toast('La contraseña temporal debe tener al menos 10 caracteres.', 'error');
            save(u.id, { password: pw.value }, 'Contraseña restablecida. El usuario deberá cambiarla al entrar.');
          } }, 'Restablecer')),
          u.id !== state.user.id ? h('button', { class: 'link-btn', type: 'button', onclick: () => save(u.id, { active: !u.active }, u.active ? 'Usuario desactivado' : 'Usuario reactivado') }, u.active ? 'Desactivar' : 'Reactivar') : null));
    });

    const form = h('form', { class: 'panel form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        const f = e.currentTarget;
        try {
          await api('POST', '/api/users', { name: f.elements.name.value, username: f.elements.username.value, role: f.elements.role.value, password: f.elements.password.value });
          toast('Usuario creado. Deberá cambiar su contraseña al entrar.');
          route();
        } catch (err) { error.textContent = err.message; error.hidden = false; }
      } },
      h('h2', {}, 'Nuevo usuario'),
      h('div', { class: 'form-grid form-grid-4' },
        h('div', { class: 'field' }, h('label', { for: 'u-name' }, 'Nombre completo'), h('input', { id: 'u-name', name: 'name', type: 'text', maxlength: 80, required: true })),
        h('div', { class: 'field' }, h('label', { for: 'u-user' }, 'Usuario'), h('input', { id: 'u-user', name: 'username', type: 'text', maxlength: 40, autocapitalize: 'none', autocomplete: 'off', required: true })),
        h('div', { class: 'field' }, h('label', { for: 'u-role' }, 'Rol'), h('select', { id: 'u-role', name: 'role' },
          h('option', { value: 'ingeniero' }, 'Ingeniero: captura avances'), h('option', { value: 'consulta' }, 'Solo consulta'), h('option', { value: 'admin' }, 'Administrador'))),
        h('div', { class: 'field' }, h('label', { for: 'u-pass' }, 'Contraseña temporal'), h('input', { id: 'u-pass', name: 'password', type: 'text', minlength: 10, autocomplete: 'off', required: true }),
          h('span', { class: 'hint' }, 'Mínimo 10 caracteres.'))),
      error,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crear usuario')));

    const bulkOut = h('div', { class: 'bulk-out', role: 'status' });
    const bulk = h('form', { class: 'panel form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const btn = f.querySelector('button');
        btn.disabled = true;
        bulkOut.textContent = '';
        try {
          const r = await api('POST', '/api/users/bulk', { csv: f.elements.csv.value });
          bulkOut.append(h('p', { class: 'notice' }, `Usuarios creados: ${r.created}. Ya existían: ${r.skipped.length}. Con error: ${r.errors.length}.`));
          if (r.errors.length) bulkOut.append(h('ul', { class: 'form-error' }, r.errors.map((x) => h('li', {}, x))));
          if (r.created) { f.elements.csv.value = ''; toast('Usuarios creados. Cada quien cambiará su contraseña al entrar.'); setTimeout(route, 2500); }
        } catch (err) { bulkOut.append(h('p', { class: 'form-error' }, err.message)); }
        btn.disabled = false;
      } },
      h('h2', {}, 'Alta masiva'),
      h('div', { class: 'field' },
        h('label', { for: 'u-bulk' }, 'Pega una línea por persona: usuario, nombre, rol, contraseña temporal'),
        h('textarea', { id: 'u-bulk', name: 'csv', rows: 6, spellcheck: 'false', autocomplete: 'off', placeholder: 'ana.torres, Ana Torres, ingeniero, Clave-Temporal-01' }),
        h('span', { class: 'hint' }, 'Roles: admin, ingeniero o consulta. Puedes pegar el contenido del archivo usuarios.csv tal cual. Los usuarios que ya existen se omiten.')),
      bulkOut,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Crear usuarios de la lista')));

    add(
      h('header', { class: 'page-head' }, h('h1', {}, 'Usuarios del portal')),
      h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Persona'), h('th', {}, 'Rol'), h('th', {}, 'Estado'), h('th', {}, 'Acciones'))),
        h('tbody', {}, rows)))),
      form, bulk);
  }

  /* ---------- contraseña ---------- */
  function viewAccount() {
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const forced = state.user.mustChange;
    add(
      h('header', { class: 'page-head' }, h('h1', {}, forced ? 'Define tu contraseña' : 'Cambiar contraseña'),
        forced ? h('p', { class: 'muted' }, 'Es tu primer acceso o tu contraseña fue restablecida. Elige una nueva para continuar.') : null),
      h('form', { class: 'panel form form-narrow', novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          error.hidden = true;
          const f = e.currentTarget;
          const fail = (m) => { error.textContent = m; error.hidden = false; };
          if (f.elements.next.value.length < 10) return fail('La nueva contraseña debe tener al menos 10 caracteres.');
          if (f.elements.next.value !== f.elements.repeat.value) return fail('La confirmación no coincide con la nueva contraseña.');
          try {
            await api('POST', '/api/password', { current: f.elements.current.value, next: f.elements.next.value });
            state.user.mustChange = false;
            if (!state.data) state.data = await api('GET', '/api/data');
            toast('Contraseña actualizada');
            window.location.hash = '#/';
            route();
          } catch (err) { fail(err.message); }
        } },
        h('div', { class: 'field' }, h('label', { for: 'p-cur' }, forced ? 'Contraseña temporal' : 'Contraseña actual'), h('input', { id: 'p-cur', name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
        h('div', { class: 'field' }, h('label', { for: 'p-new' }, 'Nueva contraseña'), h('input', { id: 'p-new', name: 'next', type: 'password', autocomplete: 'new-password', minlength: 10, required: true }), h('span', { class: 'hint' }, 'Mínimo 10 caracteres.')),
        h('div', { class: 'field' }, h('label', { for: 'p-rep' }, 'Confirma la nueva contraseña'), h('input', { id: 'p-rep', name: 'repeat', type: 'password', autocomplete: 'new-password', required: true })),
        error,
        h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Guardar contraseña'))));
  }

  window.Portal = { h, add, api, toast, state, view, canWrite, isAdmin, confirmInline, dayMonth, fullDate, weekLabel, weekRange, todayStr, MONTHS, fmt, route: () => route() };

  /* ---------- ruteo ---------- */
  async function reload(msg, hash) {
    state.data = await api('GET', '/api/data');
    if (msg) toast(msg);
    if (hash && window.location.hash !== hash) window.location.hash = hash; else route();
  }
  async function route() {
    const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let key = parts[0] || 'tablero';
    if (state.user.mustChange) key = 'cuenta';
    view.textContent = '';
    renderChrome(key === 'iniciativa' ? 'tablero' : key === 'recorrido' ? 'recorridos' : key);
    try {
      if (key === 'tablero') viewDashboard();
      else if (key === 'iniciativa') viewDetail(parts[1]);
      else if (key === 'capturar') viewCapture(parts[1], /^\d{4}-\d{2}-\d{2}$/.test(parts[2] || '') ? parts[2] : null);
      else if (key === 'usuarios') await viewUsers();
      else if (key === 'cuenta') viewAccount();
      else if (window.PortalRoutes && window.PortalRoutes[key]) await window.PortalRoutes[key](parts);
      else add(h('p', { class: 'empty' }, 'Página no encontrada. ', h('a', { href: '#/' }, 'Ir al tablero')));
    } catch (err) {
      add(h('p', { class: 'empty' }, err.message));
    }
    window.scrollTo(0, 0);
  }

  (async () => {
    try {
      state.user = (await api('GET', '/api/me')).user;
      if (!state.user.mustChange) state.data = await api('GET', '/api/data');
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      view.textContent = '';
      add(h('p', { class: 'empty' }, err.message));
    }
  })();
})();
