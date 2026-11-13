'use strict';
/* Homologación de QoS WLAN: presentación ejecutiva del corte seleccionado.
   Un solo modelo de láminas con dos salidas: PowerPoint (.pptx, con PptxGenJS cargado solo cuando se usa) y PDF (las mismas láminas en HTML, por el diálogo de impresión). */
(() => {
  const X = window.PortalQosComun;
  const { toast } = window.Portal;
  const RED = 'C8141B', INK = '232426', INK2 = '505155', INK3 = '7B7C80', LINE = 'E2E2DF', SOFT = 'F4F4F2', GOOD = '3A9A6A', GOODBG = 'E3F2EA', WARNBG = 'FBEFD6', DARK = '2A2B2E';
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Contenido de las láminas, independiente del formato de salida. */
  function modelo(d) {
    const { c, h } = d; const base = d.esBase;
    const cls = (q) => (base ? `Cola ${q + 1}` : X.CLASES[q].name);
    const kpiLabel = base ? 'Interfaces hacia AP sin drops (antes de QoS)' : 'Interfaces hacia AP sin pérdida en Voice, Video y Signaling';
    const delta = base ? null : c.clean - d.inicial;
    const sedes = d.sedes.filter((a) => a.read);
    const top = sedes.filter((a) => a.bad).sort((x, y) => y.bad - x.bad);
    return {
      titulo: 'Homologación de QoS WLAN', eyebrow: `${d.cliente} · Mejora NPS · WLAN`.toUpperCase(),
      sub: `${base ? 'Drops antes de aplicar QoS' : 'Pérdida en tráfico prioritario y Signaling hacia los Access Points'} · corte del ${h.fullDate(c.fecha)}`,
      pie: `Fuente: contadores de colas de las interfaces (FED) · política ${X.POLITICA}`, autor: `Generado el ${h.fullDate(d.hoy)} por ${d.autor} · Sipnology`,
      kpi: { label: kpiLabel, valor: h.p1(c.clean), inicial: h.p1(d.inicial), delta: delta === null ? null : `${delta >= 0 ? '▲ +' : '▼ '}${h.nf(delta, 1)} pts`, deltaOk: delta === null || delta >= 0, objetivo: `${h.nf(d.fin.valor, d.fin.valor % 1 ? 1 : 0)}%`,
        objFecha: d.fin.fecha ? h.fullDate(d.fin.fecha) : '' },
      kv: [[h.nint(c.n), `interfaces hacia AP\nen ${h.plural(Object.keys(c.sedes).length, 'sede', 'sedes')}`], [h.nint(c.bad), base ? 'interfaces\ncon drops' : 'interfaces con pérdida\npor atender'], [base ? X.bytes(c.drpTotal) : X.perdida(c.clases[0].drp, c.clases[0].enq), base ? 'descartados\nen total' : 'pérdida\nen Voice']],
      siguiente: base ? '' : `Objetivo del mes: ${h.nf(d.obj.valor, 1)}% al ${h.fullDate(d.obj.fecha)}${c.clean >= d.obj.valor - 1e-9 ? ' (ya se cumple).' : ` (faltan ${h.nf(d.obj.valor - c.clean, 1)} pts).`}`,
      foco: top.length ? `Foco: ${top.slice(0, 2).map((a) => `${h.sedeN(a.k).split(' · ')[0]} (${a.bad})`).join(' y ')}.` : 'Todas las sedes sin pérdida.',
      sedes: sedes.map((a) => ({ name: h.sedeN(a.k), clean: a.clean, ok: a.bad === 0, n: a.n, bad: a.bad, sinLectura: a.sinLectura, ifs: a.clases.map((x) => x.ifs), drp: base ? a.drpTotal : a.drpFoco })),
      clases: [0, 1, 2, 3].map((q) => ({ name: cls(q), hint: base ? 'antes de QoS' : X.CLASES[q].hint, ref: !base && !X.CLASES[q].foco, enq: X.bytes(c.clases[q].enq), drp: X.bytes(c.clases[q].drp), pct: X.perdida(c.clases[q].drp, c.clases[q].enq), ifs: h.nint(c.clases[q].ifs) })),
      semanal: d.segs.slice().reverse().slice(0, 6).map((s, i, arr) => { const o = d.objetivos.find((x) => x.fecha >= s.fecha) || d.fin; const prev = arr[i + 1]; const dl = prev ? s.clean - prev.clean : null;
        return [h.fullDate(s.fecha), h.p1(s.clean), h.nint(s.bad), dl === null ? 'Primer seguimiento' : Math.abs(dl) < 0.05 ? 'Sin cambio' : `${dl > 0 ? '▲' : '▼'} ${h.nf(Math.abs(dl), 1)} pts`, `${h.nf(o.valor, 1)}% · ${h.dayMonth(o.fecha)}`, s.clean >= o.valor - 1e-9 ? '✓ Se cumple' : `Faltan ${h.nf(o.valor - s.clean, 1)} pts`]; }),
      objetivos: d.objetivos.map((o) => ({ fecha: o.fecha, txt: h.fullDate(o.fecha), valor: o.valor })), segs: d.segs.map((s) => ({ fecha: s.fecha, clean: s.clean, txt: h.dayMonth(s.fecha) })),
      malas: d.malas.slice(0, 8).map((r) => { const w = X.peor({ nd: r.d, ne: r.e }, c.tipo); return { host: r.h, sede: h.sedeN(r.s), intf: r.i, d: base ? [X.bytes(h.total(r.d))] : [0, 1, 2].map((q) => (r.d[q] ? X.bytes(r.d[q]) : '0')), peor: r.src === 'ap' ? '—' : `${X.perdida(r.d[w.q], r.e[w.q])} · ${cls(w.q)}`, crit: w.p >= 1 }; }),
      nMalas: d.malas.length, hallazgos: d.hallazgos.map((x) => `${x[0]} ${x[1]}`.trim()), base, chart: d.chart, fecha: c.fecha,
      notaClases: base ? 'Antes del QoS no existían las clases de la política: el indicador inicial cuenta cualquier descarte en la interfaz.' : 'Cero tolerancia: una interfaz cuenta como «con pérdida» con cualquier descarte en Voice, Video o Signaling. class-default se muestra como referencia.',
    };
  }

  /* ------------------------------------------------------------------ PDF (HTML + impresión) */
  function htmlDeck(m) {
    const head = (t, s) => `<header class="qd-head"><div><p class="qd-eyebrow">${esc(m.eyebrow)}</p><h2>${esc(t)}</h2><p class="qd-sub">${esc(s)}</p></div><img src="/img/sipnology-logo.png" alt="Sipnology"></header>`;
    const foot = (n) => `<footer class="qd-foot"><span>Sipnology · Tu visión, nuestra tecnología</span><span>${esc(m.pie)} · ${n} de 6</span></footer>`;
    const table = (hd, rows, cls = '') => `<table class="qd-table ${cls}"><thead><tr>${hd.map((t, i) => `<th class="${i ? 'n' : ''}">${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr class="${r.cls || ''}">${r.cells.map((v, i) => `<td class="${i ? 'n' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const bars = m.sedes.map((a) => `<div class="qd-bar"><span>${esc(a.name)}</span><div><i style="width:${a.clean}%;background:#${a.ok ? GOOD : DARK}"></i></div><b>${a.clean.toFixed(1)}%</b></div>`).join('');
    const s = [];
    s.push(`<section class="qd-slide qd-cover"><img src="/img/sipnology-logo.png" alt="Sipnology"><div><p class="qd-eyebrow">${esc(m.eyebrow)}</p><h1>${esc(m.titulo)}</h1><p class="qd-sub">${esc(m.sub)}</p><p class="qd-autor">${esc(m.autor)}</p></div></section>`);
    s.push(`<section class="qd-slide">${head(m.titulo, m.sub)}<div class="qd-two"><div><p class="qd-klabel">${esc(m.kpi.label)}</p><p class="qd-big">${esc(m.kpi.valor)}</p>
      <p class="qd-kline">Inicial ${esc(m.kpi.inicial)}${m.kpi.delta ? ` · <b class="${m.kpi.deltaOk ? 'ok' : 'bad'}">${esc(m.kpi.delta)}</b>` : ''} · Objetivo ${esc(m.kpi.objetivo)}</p>
      <div class="qd-kv">${m.kv.map(([a, b]) => `<div><b>${esc(a)}</b><span>${esc(b).replace(/\n/g, '<br>')}</span></div>`).join('')}</div><p class="qd-next">${m.siguiente ? `<b>${esc(m.siguiente)}</b> ` : ''}${esc(m.foco)}</p></div>
      <div><p class="qd-h">% de interfaces sin ${m.base ? 'drops' : 'pérdida'} por sede · primero las sedes sin pérdida</p>${bars}<p class="qd-leg"><i style="background:#${GOOD}"></i>Sede sin pérdida <i style="background:#${DARK}"></i>Sede con interfaces por atender</p></div></div>${foot(2)}</section>`);
    s.push(`<section class="qd-slide">${head('Ruta de objetivos', 'Objetivos mensuales con seguimiento semanal')}<div class="qd-chart">${m.chart}</div><p class="qd-leg"><i style="background:#${RED}"></i>Resultado de cada corte semanal <i class="o"></i>Objetivo mensual</p>
      ${m.semanal.length ? table(['Corte semanal', '% sin pérdida', 'Con pérdida', 'Cambio', 'Objetivo del mes', 'Brecha'], m.semanal.map((r) => ({ cells: r.map((v, i) => (i === 1 ? `<b>${esc(v)}</b>` : esc(v))) }))) : '<p class="qd-sub">Aún no hay cortes de seguimiento.</p>'}${foot(3)}</section>`);
    s.push(`<section class="qd-slide">${head(m.base ? 'Descarte por cola antes de QoS' : 'Pérdida por clase de tráfico', `Todas las sedes · corte del ${esc(window.Portal.fullDate(m.fecha))}`)}
      ${table([m.base ? 'Cola' : `Clase (política ${X.POLITICA})`, 'Tráfico cursado', 'Descartado', '% de pérdida', m.base ? 'Interfaces con drops' : 'Interfaces con pérdida'], m.clases.map((k) => ({ cls: k.ref ? 'ref' : '', cells: [`<b>${esc(k.name)}</b><small>${esc(k.hint)}${k.ref ? ' · referencia' : ''}</small>`, esc(k.enq), esc(k.drp), `<b>${esc(k.pct)}</b>`, esc(k.ifs)] })), 'big')}
      <p class="qd-note">${esc(m.notaClases)}</p>${foot(4)}</section>`);
    s.push(`<section class="qd-slide">${head('Resultado por sede', 'Primero las sedes sin pérdida')}
      ${table(m.base ? ['Sede', 'Interfaces AP', 'Con drops', '% sin drops', 'Descartado'] : ['Sede', 'Interfaces AP', 'Voice', 'Video', 'Signaling', 'Con pérdida', '% sin pérdida', 'Descartado'],
    m.sedes.map((a) => ({ cells: m.base ? [`<b>${esc(a.name)}</b>`, a.n, a.bad, `<b>${a.clean.toFixed(1)}%</b>`, esc(X.bytes(a.drp))] : [`<b>${esc(a.name)}</b>${a.sinLectura ? `<small>${a.sinLectura} sin lectura</small>` : ''}`, a.n, a.ifs[0], a.ifs[1], a.ifs[2], `<b>${a.bad}</b>`, `<b class="${a.ok ? 'ok' : ''}">${a.clean.toFixed(1)}%</b>`, esc(X.bytes(a.drp))] })))}${foot(5)}</section>`);
    s.push(`<section class="qd-slide">${head('Foco de atención y hallazgos', m.nMalas ? `${m.nMalas} ${m.nMalas === 1 ? 'interfaz' : 'interfaces'} ${m.base ? 'con drops' : 'con pérdida en tráfico prioritario o Signaling'}` : 'Sin interfaces con pérdida')}<div class="qd-two qd-two-b"><div>
      ${m.malas.length ? table(m.base ? ['Switch · interfaz', 'Drops', 'Peor % de pérdida'] : ['Switch · interfaz', 'Voice', 'Video', 'Signaling', 'Peor % de pérdida'], m.malas.map((r) => ({ cells: [`<b>${esc(r.host)}</b> ${esc(r.intf)}<small>${esc(r.sede)}</small>`, ...r.d.map(esc), `<span class="${r.crit ? 'bad' : ''}">${esc(r.peor)}</span>`] })), 'sm') : '<p class="qd-sub">Ninguna interfaz leída tiene pérdida en estas clases.</p>'}
      ${m.nMalas > m.malas.length ? `<p class="qd-note">Se muestran ${m.malas.length} de ${m.nMalas}.</p>` : ''}</div><div><p class="qd-h">Hallazgos</p><ul class="qd-list">${m.hallazgos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>${foot(6)}</section>`);
    return s.join('');
  }
  function pdf(d) {
    if (!d) return;
    const m = modelo(d);
    document.querySelectorAll('.qos-deck, #qos-deck-page').forEach((n) => n.remove());
    const deck = document.createElement('div'); deck.className = 'qos-deck'; deck.innerHTML = htmlDeck(m);
    const page = document.createElement('style'); page.id = 'qos-deck-page'; page.textContent = '@media print { @page { size: 13.333in 7.5in; margin: 0; } }';
    document.head.append(page); document.body.append(deck); document.body.classList.add('qos-deck-print');
    const clean = () => { document.body.classList.remove('qos-deck-print'); deck.remove(); page.remove(); window.removeEventListener('afterprint', clean); };
    window.addEventListener('afterprint', clean);
    const imgs = [...deck.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))).then(() => setTimeout(() => window.print(), 60));
  }

  /* ------------------------------------------------------------------ PowerPoint */
  let lib = null;
  const loadLib = () => lib || (lib = new Promise((resolve, reject) => {
    if (window.PptxGenJS) return resolve(window.PptxGenJS);
    const s = document.createElement('script'); s.src = '/js/vendor/pptxgen.bundle.js?v=4.0.1';
    s.onload = () => (window.PptxGenJS ? resolve(window.PptxGenJS) : reject(new Error('No se pudo cargar el generador de PowerPoint.')));
    s.onerror = () => { lib = null; reject(new Error('No se pudo cargar el generador de PowerPoint.')); };
    document.head.append(s);
  }));
  let logoData = null;
  async function logo() {
    if (logoData) return logoData;
    const blob = await fetch('/img/sipnology-logo.png').then((r) => r.blob());
    logoData = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    return logoData;
  }

  async function pptx(d) {
    if (!d) return;
    try {
      toast('Generando la presentación…');
      const [Pptx, lg] = await Promise.all([loadLib(), logo()]);
      const m = modelo(d);
      const p = new Pptx(); p.layout = 'LAYOUT_WIDE'; p.author = 'Sipnology'; p.company = 'Sipnology'; p.title = `${m.titulo} · ${m.fecha}`;
      const F = 'Arial', W = 13.333, MX = 0.6;
      const T = (s, txt, o) => s.addText(txt, { fontFace: F, color: INK, margin: 0, valign: 'top', ...o });
      const frame = (title, sub, n) => {
        const s = p.addSlide(); s.background = { color: 'FFFFFF' };
        s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: RED }, line: { color: RED, width: 0 } });
        T(s, m.eyebrow, { x: MX, y: 0.42, w: 9, h: 0.25, fontSize: 10, bold: true, color: INK3, charSpacing: 2 });
        T(s, title, { x: MX, y: 0.68, w: 10.4, h: 0.6, fontSize: 28, bold: true });
        T(s, sub, { x: MX, y: 1.28, w: 10.6, h: 0.35, fontSize: 14, color: INK2 });
        s.addImage({ data: lg, x: W - MX - 1.25, y: 0.42, w: 1.25, h: 0.93 });
        s.addShape(p.ShapeType.line, { x: MX, y: 6.95, w: W - 2 * MX, h: 0, line: { color: LINE, width: 0.75 } });
        T(s, 'Sipnology · Tu visión, nuestra tecnología', { x: MX, y: 7.02, w: 5, h: 0.25, fontSize: 9, color: INK3 });
        T(s, `${m.pie} · ${n} de 6`, { x: W - MX - 7, y: 7.02, w: 7, h: 0.25, fontSize: 9, color: INK3, align: 'right' });
        return s;
      };
      const tabla = (s, hd, rows, o) => {
        const cell = (v, extra) => ({ text: String(v), options: { fontFace: F, fontSize: o.fs || 11, color: INK, valign: 'middle', border: [{ type: 'none' }, { type: 'none' }, { type: 'solid', color: LINE, pt: 0.75 }, { type: 'none' }], ...extra } });
        const data = [hd.map((t, i) => cell(t.toUpperCase(), { bold: true, color: INK3, fontSize: (o.fs || 11) - 2.5, align: i ? 'right' : 'left', border: [{ type: 'none' }, { type: 'none' }, { type: 'solid', color: INK3, pt: 1 }, { type: 'none' }] })),
          ...rows.map((r) => r.map((v, i) => (v && typeof v === 'object' ? cell(v.t, { align: i ? 'right' : 'left', ...v.o }) : cell(v, { align: i ? 'right' : 'left' }))))];
        s.addTable(data, { x: o.x, y: o.y, w: o.w, colW: o.colW, rowH: o.rowH || 0.36, margin: [0.03, 0.08, 0.03, 0.08] });
      };

      // 1. portada
      { const s = p.addSlide(); s.background = { color: 'FFFFFF' };
        s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.16, fill: { color: RED }, line: { color: RED, width: 0 } });
        s.addImage({ data: lg, x: MX, y: 0.9, w: 2.1, h: 1.57 });
        s.addShape(p.ShapeType.rect, { x: MX, y: 3.25, w: 5.2, h: 0.06, fill: { color: RED }, line: { color: RED, width: 0 } });
        T(s, m.eyebrow, { x: MX, y: 3.5, w: 11, h: 0.3, fontSize: 12, bold: true, color: INK3, charSpacing: 2 });
        T(s, m.titulo, { x: MX, y: 3.85, w: 12, h: 0.9, fontSize: 44, bold: true });
        T(s, m.sub, { x: MX, y: 4.8, w: 12, h: 0.45, fontSize: 18, color: RED });
        T(s, m.autor, { x: MX, y: 6.6, w: 12, h: 0.3, fontSize: 11, color: INK3 }); }

      // 2. resumen
      { const s = frame(m.titulo, m.sub, 2);
        T(s, m.kpi.label, { x: MX, y: 1.95, w: 5.4, h: 0.3, fontSize: 13, color: INK2 });
        T(s, m.kpi.valor, { x: MX, y: 2.25, w: 5.4, h: 1.35, fontSize: 88, bold: true });
        T(s, [{ text: `Inicial ${m.kpi.inicial} · `, options: { color: INK2 } }, ...(m.kpi.delta ? [{ text: m.kpi.delta, options: { color: m.kpi.deltaOk ? '17754A' : '8F1230', bold: true } }, { text: ' · ', options: { color: INK2 } }] : []), { text: `Objetivo ${m.kpi.objetivo}`, options: { color: INK2 } }], { x: MX, y: 3.68, w: 5.4, h: 0.32, fontSize: 14 });
        m.kv.forEach(([a, b], i) => { T(s, a, { x: MX + i * 1.82, y: 4.3, w: 1.75, h: 0.5, fontSize: 24, bold: true, fit: 'shrink' }); T(s, b, { x: MX + i * 1.82, y: 4.82, w: 1.75, h: 0.55, fontSize: 10.5, color: INK2 }); });
        T(s, [...(m.siguiente ? [{ text: m.siguiente + ' ', options: { bold: true } }] : []), { text: m.foco }], { x: MX, y: 5.65, w: 5.4, h: 0.8, fontSize: 12.5 });
        const bx = 6.6, bw = W - MX - bx; T(s, `% de interfaces sin ${m.base ? 'drops' : 'pérdida'} por sede · primero las sedes sin pérdida`, { x: bx, y: 1.95, w: bw, h: 0.3, fontSize: 13, bold: true });
        const rh = Math.min(0.4, 4.1 / Math.max(1, m.sedes.length));
        m.sedes.forEach((a, i) => { const y = 2.4 + i * rh; T(s, a.name, { x: bx, y, w: 2.15, h: rh, fontSize: 11.5, valign: 'middle' });
          s.addShape(p.ShapeType.rect, { x: bx + 2.2, y: y + rh * 0.24, w: bw - 3.1, h: rh * 0.5, fill: { color: 'EFEFEC' }, line: { color: 'EFEFEC', width: 0 } });
          if (a.clean > 0) s.addShape(p.ShapeType.rect, { x: bx + 2.2, y: y + rh * 0.24, w: Math.max(0.02, (bw - 3.1) * a.clean / 100), h: rh * 0.5, fill: { color: a.ok ? GOOD : DARK }, line: { color: a.ok ? GOOD : DARK, width: 0 } });
          T(s, `${a.clean.toFixed(1)}%`, { x: W - MX - 0.85, y, w: 0.85, h: rh, fontSize: 11.5, bold: true, align: 'right', valign: 'middle' }); });
        const ly = 2.4 + m.sedes.length * rh + 0.12;
        s.addShape(p.ShapeType.rect, { x: bx, y: ly + 0.05, w: 0.14, h: 0.14, fill: { color: GOOD }, line: { color: GOOD, width: 0 } }); T(s, 'Sede sin pérdida', { x: bx + 0.2, y: ly, w: 1.7, h: 0.24, fontSize: 10, color: INK2 });
        s.addShape(p.ShapeType.rect, { x: bx + 2.0, y: ly + 0.05, w: 0.14, h: 0.14, fill: { color: DARK }, line: { color: DARK, width: 0 } }); T(s, 'Sede con interfaces por atender', { x: bx + 2.2, y: ly, w: 3, h: 0.24, fontSize: 10, color: INK2 }); }

      // 3. ruta de objetivos (dibujada con formas para que sea igual al portal)
      { const s = frame('Ruta de objetivos', 'Objetivos mensuales con seguimiento semanal', 3);
        const pts = m.segs.filter((x) => x.clean !== null), objs = m.objetivos;
        const t = (f) => Date.parse(f + 'T00:00:00Z'); const dates = [...pts.map((x) => x.fecha), ...objs.map((o) => o.fecha)].sort();
        if (dates.length) {
          let t0 = t(dates[0]), t1 = t(dates[dates.length - 1]); if (t1 - t0 < 14 * 864e5) { t0 -= 7 * 864e5; t1 += 7 * 864e5; }
          const vals = [...pts.map((x) => x.clean), ...objs.map((o) => o.valor)]; const lo = Math.min(...vals); const span = Math.max(100 - lo, 0.5);
          const step = span <= 1 ? 0.25 : span <= 2.5 ? 0.5 : span <= 5 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10; const y0v = Math.max(0, Math.floor((lo - step * 0.6) / step) * step); const dec = step < 1 ? (step < 0.5 ? 2 : 1) : 0;
          const cx0 = MX + 0.7, cx1 = W - MX - 0.3, cyT = 2.05, cyB = 4.0;
          const Xf = (f) => cx0 + ((t(f) - t0) / (t1 - t0)) * (cx1 - cx0), Yf = (v) => cyB - ((v - y0v) / (100 - y0v)) * (cyB - cyT);
          const seg = (xa, ya, xb, yb, line) => s.addShape(p.ShapeType.line, { x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya), flipV: (yb - ya) * (xb - xa) < 0, line });
          for (let v = y0v; v <= 100 + 1e-9; v += step) { seg(cx0, Yf(v), cx1, Yf(v), { color: Math.abs(v - y0v) < 1e-9 ? 'C9C9C5' : 'ECECE9', width: 0.75 }); T(s, `${v.toFixed(dec)}%`, { x: MX, y: Yf(v) - 0.11, w: 0.62, h: 0.22, fontSize: 9, color: INK3, align: 'right' }); }
          let px = cx0; objs.forEach((o) => { const x = Xf(o.fecha), y = Yf(o.valor); seg(px, y, x, y, { color: '8A8B8F', width: 1.5, dashType: 'dash' }); px = x; });
          objs.forEach((o) => { const x = Xf(o.fecha), y = Yf(o.valor); s.addShape(p.ShapeType.ellipse, { x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16, fill: { color: 'FFFFFF' }, line: { color: '8A8B8F', width: 1.5 } });
            T(s, `${o.valor % 1 ? o.valor.toFixed(1) : o.valor}%`, { x: x - 0.6, y: y - 0.36, w: 1.2, h: 0.22, fontSize: 10, bold: true, color: INK2, align: 'center' }); T(s, window.Portal.dayMonth(o.fecha), { x: x - 0.6, y: cyB + 0.08, w: 1.2, h: 0.22, fontSize: 9.5, bold: true, align: 'center' }); });
          pts.forEach((x, i) => { if (i) seg(Xf(pts[i - 1].fecha), Yf(pts[i - 1].clean), Xf(x.fecha), Yf(x.clean), { color: RED, width: 2.5 }); });
          pts.forEach((x, i) => { const cx = Xf(x.fecha), cy = Yf(x.clean); s.addShape(p.ShapeType.ellipse, { x: cx - 0.09, y: cy - 0.09, w: 0.18, h: 0.18, fill: { color: RED }, line: { color: 'FFFFFF', width: 1.5 } });
            if (pts.length <= 8 || i === pts.length - 1) T(s, `${x.clean.toFixed(1)}%`, { x: cx - 0.6, y: cy + 0.12, w: 1.2, h: 0.24, fontSize: 11, bold: true, align: 'center' }); });
        }
        s.addShape(p.ShapeType.ellipse, { x: MX, y: 4.5, w: 0.14, h: 0.14, fill: { color: RED }, line: { color: RED, width: 0 } }); T(s, 'Resultado de cada corte semanal', { x: MX + 0.2, y: 4.45, w: 3, h: 0.24, fontSize: 10, color: INK2 });
        s.addShape(p.ShapeType.ellipse, { x: MX + 3.3, y: 4.5, w: 0.14, h: 0.14, fill: { color: 'FFFFFF' }, line: { color: '8A8B8F', width: 1.5 } }); T(s, 'Objetivo mensual', { x: MX + 3.5, y: 4.45, w: 3, h: 0.24, fontSize: 10, color: INK2 });
        if (m.semanal.length) tabla(s, ['Corte semanal', '% sin pérdida', 'Con pérdida', 'Cambio', 'Objetivo del mes', 'Brecha'], m.semanal.slice(0, 5).map((r) => r.map((v, i) => (i === 1 ? { t: v, o: { bold: true } } : v))), { x: MX, y: 4.85, w: W - 2 * MX, colW: [2.6, 1.7, 1.6, 2.2, 2.1, 1.93], rowH: 0.32, fs: 11 });
        else T(s, 'Aún no hay cortes de seguimiento.', { x: MX, y: 4.9, w: 8, h: 0.3, fontSize: 12, color: INK2 }); }

      // 4. clases
      { const s = frame(m.base ? 'Descarte por cola antes de QoS' : 'Pérdida por clase de tráfico', `Todas las sedes · corte del ${window.Portal.fullDate(m.fecha)}`, 4);
        tabla(s, [m.base ? 'Cola' : `Clase (política ${X.POLITICA})`, 'Tráfico cursado', 'Descartado', '% de pérdida', m.base ? 'Interfaces con drops' : 'Interfaces con pérdida'],
          m.clases.map((k) => [{ t: `${k.name}  ·  ${k.hint}${k.ref ? ' · referencia' : ''}`, o: { bold: true, color: k.ref ? INK3 : INK } }, { t: k.enq, o: { color: k.ref ? INK3 : INK } }, { t: k.drp, o: { color: k.ref ? INK3 : INK } }, { t: k.pct, o: { bold: true, color: k.ref ? INK3 : INK } }, { t: k.ifs, o: { color: k.ref ? INK3 : INK } }]),
          { x: MX, y: 2.1, w: W - 2 * MX, colW: [4.93, 1.9, 1.8, 1.7, 1.8], rowH: 0.62, fs: 15 });
        s.addShape(p.ShapeType.rect, { x: MX, y: 5.55, w: W - 2 * MX, h: 0.75, fill: { color: SOFT }, line: { color: SOFT, width: 0 } }); s.addShape(p.ShapeType.rect, { x: MX, y: 5.55, w: 0.06, h: 0.75, fill: { color: RED }, line: { color: RED, width: 0 } });
        T(s, m.notaClases, { x: MX + 0.25, y: 5.55, w: W - 2 * MX - 0.4, h: 0.75, fontSize: 12.5, color: INK2, valign: 'middle' }); }

      // 5. sedes
      { const s = frame('Resultado por sede', 'Primero las sedes sin pérdida', 5);
        const rh = Math.min(0.4, 4.6 / (m.sedes.length + 1));
        if (m.base) tabla(s, ['Sede', 'Interfaces AP', 'Con drops', '% sin drops', 'Descartado'], m.sedes.map((a) => [{ t: a.name, o: { bold: true } }, a.n, a.bad, { t: `${a.clean.toFixed(1)}%`, o: { bold: true } }, X.bytes(a.drp)]), { x: MX, y: 1.95, w: W - 2 * MX, colW: [4.53, 1.9, 1.9, 1.9, 1.9], rowH: rh, fs: 12 });
        else tabla(s, ['Sede', 'Interfaces AP', 'Voice', 'Video', 'Signaling', 'Con pérdida', '% sin pérdida', 'Descartado'],
          m.sedes.map((a) => [{ t: a.name + (a.sinLectura ? `  (${a.sinLectura} sin lectura)` : ''), o: { bold: true } }, a.n, a.ifs[0], a.ifs[1], a.ifs[2], { t: a.bad, o: { bold: true } }, { t: `${a.clean.toFixed(1)}%`, o: { bold: true, color: a.ok ? '17754A' : INK, fill: { color: a.ok ? GOODBG : 'FFFFFF' } } }, X.bytes(a.drp)]),
          { x: MX, y: 1.95, w: W - 2 * MX, colW: [3.63, 1.45, 0.95, 0.95, 1.15, 1.35, 1.35, 1.3], rowH: rh, fs: 12 }); }

      // 6. foco y hallazgos
      { const s = frame('Foco de atención y hallazgos', m.nMalas ? `${m.nMalas} ${m.nMalas === 1 ? 'interfaz' : 'interfaces'} ${m.base ? 'con drops' : 'con pérdida en tráfico prioritario o Signaling'}` : 'Sin interfaces con pérdida', 6);
        const lw = 7.5;
        if (m.malas.length) tabla(s, m.base ? ['Switch · interfaz', 'Drops', 'Peor % de pérdida'] : ['Switch · interfaz', 'Voice', 'Video', 'Signaling', 'Peor % de pérdida'],
          m.malas.map((r) => [{ t: `${r.host}  ${r.intf}`, o: { bold: true } }, ...r.d, { t: r.peor, o: { color: r.crit ? '8F1230' : INK, bold: r.crit } }]),
          { x: MX, y: 1.95, w: lw, colW: m.base ? [4.3, 1.4, 1.8] : [3.35, 0.75, 0.95, 1.05, 1.4], rowH: 0.42, fs: 10 });
        else { s.addShape(p.ShapeType.rect, { x: MX, y: 1.95, w: lw, h: 0.7, fill: { color: GOODBG }, line: { color: GOODBG, width: 0 } }); T(s, 'Ninguna interfaz leída tiene pérdida en estas clases.', { x: MX + 0.2, y: 1.95, w: lw - 0.4, h: 0.7, fontSize: 13, valign: 'middle' }); }
        if (m.nMalas > m.malas.length) T(s, `Se muestran ${m.malas.length} de ${m.nMalas}.`, { x: MX, y: 6.55, w: lw, h: 0.25, fontSize: 9.5, color: INK3 });
        const hx = MX + lw + 0.45, hw = W - MX - hx;
        s.addShape(p.ShapeType.rect, { x: hx, y: 1.95, w: hw, h: 4.75, fill: { color: SOFT }, line: { color: SOFT, width: 0 } });
        T(s, 'HALLAZGOS', { x: hx + 0.25, y: 2.1, w: hw - 0.5, h: 0.25, fontSize: 10, bold: true, color: RED, charSpacing: 2 });
        T(s, m.hallazgos.map((x) => ({ text: x, options: { bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 7 } })), { x: hx + 0.25, y: 2.45, w: hw - 0.5, h: 4.1, fontSize: 11.5, color: INK }); }

      // se quitan las entradas de carpeta del .pptx: algunos servicios en la nube no lo abren si las trae
      let blob = await p.write({ outputType: 'blob' });
      if (window.JSZip) { const z = await window.JSZip.loadAsync(blob); Object.keys(z.files).filter((k) => z.files[k].dir).forEach((k) => { delete z.files[k]; });
        blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `QoS WLAN - Presentacion ejecutiva - ${m.fecha}.pptx`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Presentación descargada');
    } catch (err) { console.error(err); toast(err.message || 'No se pudo generar la presentación.', 'error'); }
  }
  void WARNBG;
  window.PortalQosDeck = { pptx, pdf };
})();
