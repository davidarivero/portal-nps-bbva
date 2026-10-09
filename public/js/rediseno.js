'use strict';
/* Rediseño WLAN: tablero diario de usuarios y utilización de canal por AP, dentro de la página de la iniciativa. */
(() => {
  const { h, api, toast, state, canWrite, isAdmin, confirmInline, dayMonth, fullDate, todayStr, MONTHS } = window.Portal;
  const nf = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: d }).format(v));
  const LV = { good: 'Bueno', regular: 'Regular', alarm: 'Alarmante' };
  const HEX = { good: '#cfe9d9', regular: '#fbe3a8', alarm: '#f6c1c5', ink: '#232426', ink2: '#505155', ink3: '#7b7c80', line: '#e2e2df', red: '#ed1c24', series: '#2a2b2e', peak: '#9a9b9f', goodLine: '#17754a', warnLine: '#8a5800', critLine: '#8f1230' };
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const stamp = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const view = { desde: null, hasta: null, sede: 'all', panel: null };
  let D = null; // datos del periodo
  let root = null; let kpi = null;

  async function apiX(method, url, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portal' }, body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error('No hay conexión con el servidor.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la acción.'), data);
    return data;
  }
  const level = (v) => (v === null || v === undefined ? null : v > D.umbrales.alarm ? 'alarm' : v >= D.umbrales.regular ? 'regular' : 'good');
  const lvClass = (v) => { const l = level(v); return l ? ' lv lv-' + l : ''; };
  const levelPill = (l) => h('span', { class: 'pill lvp lvp-' + l }, h('span', { class: 'pill-icon', 'aria-hidden': 'true' }, l === 'good' ? '✓' : l === 'regular' ? '!' : '▲'), LV[l]);

  /* ---------- cálculo ---------- */
  function agg(rows) { // rows: [apId, fecha, n, uAvg, uMax, cAvg, cMax]
    let su = 0, n = 0, sc = 0, nc = 0, uMax = null, cMax = null;
    for (const r of rows) {
      if (r[3] !== null) { su += r[3] * r[2]; n += r[2]; if (uMax === null || r[4] > uMax) uMax = r[4]; }
      if (r[5] !== null) { sc += r[5] * r[2]; nc += r[2]; if (cMax === null || r[6] > cMax) cMax = r[6]; }
    }
    return { uAvg: n ? su / n : null, uMax, cAvg: nc ? sc / nc : null, cMax, n };
  }
  function compute() {
    const apInfo = new Map();
    D.sedes.forEach((s) => s.aps.forEach((a) => apInfo.set(a.id, { ...a, sedeId: s.id, sede: s.name })));
    const rows = D.diario.filter((r) => apInfo.has(r[0]));
    const days = [...new Set(rows.map((r) => r[1]))].sort();
    const byDay = (list) => days.map((d) => ({ d, ...agg(list.filter((r) => r[1] === d)) }));
    const trend = (series) => { // últimos días medidos contra los anteriores
      const v = series.filter((x) => x.uAvg !== null);
      if (v.length < 4) return null;
      const half = Math.min(5, Math.floor(v.length / 2));
      const mean = (a) => a.reduce((s, x) => s + x.uAvg, 0) / a.length;
      const prev = mean(v.slice(-half * 2, -half)), last = mean(v.slice(-half));
      return { prev, last, pct: prev > 0 ? ((last - prev) / prev) * 100 : null, dias: half };
    };
    const apStats = [...apInfo.values()].map((a) => {
      const list = rows.filter((r) => r[0] === a.id);
      const over = list.filter((r) => r[4] !== null && r[4] > D.umbrales.alarm).map((r) => r[1]);
      let run = 0, best = 0;
      for (const d of days) { const r = list.find((x) => x[1] === d); if (r && r[4] > D.umbrales.alarm) { run += 1; if (run > best) best = run; } else if (r) run = 0; }
      const peakRow = list.reduce((m, r) => (r[4] !== null && (!m || r[4] > m[4]) ? r : m), null);
      return { ...a, ...agg(list), dias: list.length, over: over.length, racha: best, peakDay: peakRow ? peakRow[1] : null, byDay: new Map(list.map((r) => [r[1], r])) };
    });
    const sedes = D.sedes.map((s) => {
      const list = rows.filter((r) => apInfo.get(r[0]).sedeId === s.id);
      const series = byDay(list);
      return { ...s, ...agg(list), series, trend: trend(series), aps: apStats.filter((a) => a.sedeId === s.id), lastDay: list.length ? list[list.length - 1][1] : null };
    });
    const series = byDay(rows);
    const tally = { good: 0, regular: 0, alarm: 0 };
    rows.forEach((r) => { const l = level(r[4]); if (l) tally[l] += 1; });
    return { days, rows, apStats, sedes, series, general: { ...agg(rows), trend: trend(series) }, tally };
  }

  /* ---------- hallazgos ---------- */
  function findings(C, scope) {
    const out = [];
    const aps = scope ? C.apStats.filter((a) => a.sedeId === scope.id) : C.apStats;
    const withData = aps.filter((a) => a.n > 0);
    const push = (kind, title, text) => out.push({ kind, title, text });
    for (const a of withData.filter((x) => x.racha > 5).sort((x, y) => y.racha - x.racha)) push('alarm', 'Candidato a rediseño', `${a.name} (${a.sede}) superó ${D.umbrales.alarm} usuarios ${a.racha} días seguidos. El criterio del programa es más de 5 días consecutivos.`);
    const overs = withData.filter((a) => a.over > 0 && a.racha <= 5).sort((x, y) => y.uMax - x.uMax);
    if (overs.length) push('alarm', `${overs.length} AP ${overs.length === 1 ? 'superó' : 'superaron'} ${D.umbrales.alarm} usuarios`, overs.slice(0, 5).map((a) => `${a.name}: pico de ${a.uMax} el ${dayMonth(a.peakDay)}, ${a.over} ${a.over === 1 ? 'día' : 'días'} sobre el umbral`).join(' · ') + (overs.length > 5 ? ` · y ${overs.length - 5} más` : ''));
    for (const s of (scope ? [scope] : C.sedes)) {
      const t = s.trend;
      if (t && t.pct !== null && Math.abs(t.pct) >= 10) push(t.pct > 0 ? 'regular' : 'good', `${s.name}: tendencia ${t.pct > 0 ? 'al alza' : 'a la baja'}`, `El promedio de usuarios por AP pasó de ${nf(t.prev)} a ${nf(t.last)} (${t.pct > 0 ? '+' : '−'}${nf(Math.abs(t.pct), 0)}%) al comparar los últimos ${t.dias} días medidos con los ${t.dias} anteriores.`);
      if (s.lastDay && C.days.length && s.lastDay < C.days[C.days.length - 1]) push('regular', `${s.name}: sin lecturas recientes`, `Su última lectura del periodo es del ${dayMonth(s.lastDay)}; otras sedes tienen datos hasta el ${dayMonth(C.days[C.days.length - 1])}.`);
      if (!s.n) push('regular', `${s.name}: sin lecturas en el periodo`, 'No hay información cargada para estas fechas.');
    }
    if (withData.length > 1) {
      const by = (f) => withData.filter((a) => f(a) !== null).sort((x, y) => f(y) - f(x));
      const u = by((a) => a.uAvg), c = by((a) => a.cAvg);
      push('info', 'Usuarios por AP', `Mayor promedio: ${u[0].name} con ${nf(u[0].uAvg)} (pico ${u[0].uMax}). Menor promedio: ${u[u.length - 1].name} con ${nf(u[u.length - 1].uAvg)}.`);
      if (c.length) push('info', 'Utilización de canal (informativa)', `Mayor promedio: ${c[0].name} con ${nf(c[0].cAvg, 0)}% (pico ${nf(c[0].cMax, 0)}%). Menor promedio: ${c[c.length - 1].name} con ${nf(c[c.length - 1].cAvg, 0)}%.`);
      const idle = withData.filter((a) => a.uMax === 0);
      if (idle.length) push('regular', `${idle.length} AP sin usuarios en todo el periodo`, idle.map((a) => a.name).join(', ') + '. Conviene confirmar si el área está desocupada o si el AP tiene un problema.');
    }
    return out;
  }

  /* ---------- gráfica de dos series con umbrales ---------- */
  function lineChart(box, o) { // o: {days, series:[{name, values, cls}], refs:[{value,label,kind}], suffix, max}
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a, txt) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (txt !== undefined) n.textContent = txt; return n; };
    const draw = () => {
      const W = Math.max(320, box.clientWidth || 900), H = 260, m = { t: 16, r: 16, b: 34, l: 40 };
      const all = o.series.flatMap((s) => s.values.filter((v) => v !== null));
      const top0 = Math.max(o.max || 0, ...all, ...(o.refs || []).map((r) => r.value)) * 1.08 || 1;
      const raw = top0 / 4, exp = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / exp;
      const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
      const top = Math.ceil(top0 / step) * step;
      const x = (i) => (o.days.length === 1 ? (m.l + W - m.r) / 2 : m.l + 8 + (i * (W - m.l - m.r - 16)) / (o.days.length - 1));
      const y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.title });
      for (let v = 0; v <= top + 1e-9; v += step) { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? 'ch-grid' : 'ch-axis' })); svg.append(el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ch-tick' }, nf(v, 1) + (o.suffix || ''))); }
      for (const r of o.refs || []) { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(r.value), y2: y(r.value), class: 'ch-ref ch-ref-' + r.kind })); svg.append(el('text', { x: m.l + 6, y: y(r.value) - 5, 'text-anchor': 'start', class: 'ch-ref-label' }, r.label)); }
      const every = Math.ceil(o.days.length / Math.max(3, Math.floor((W - m.l - m.r) / 58)));
      o.days.forEach((d, i) => { if (i % every === 0 || i === o.days.length - 1) svg.append(el('text', { x: x(i), y: H - m.b + 18, 'text-anchor': i === 0 ? 'start' : i === o.days.length - 1 ? 'end' : 'middle', class: 'ch-xsub' }, dayMonth(d))); });
      for (const s of o.series) {
        let dpath = ''; let pen = false;
        s.values.forEach((v, i) => { if (v === null) { pen = false; return; } dpath += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
        svg.append(el('path', { d: dpath, class: 'ch-line ' + s.cls, fill: 'none' }));
        const last = s.values.reduce((a, v, i) => (v !== null ? i : a), -1);
        s.values.forEach((v, i) => { if (v !== null && (o.days.length <= 31 || i === last)) svg.append(el('circle', { cx: x(i), cy: y(v), r: i === last ? 4.5 : 2.5, class: 'ch-dot ' + s.cls })); });
        if (last >= 0) svg.append(el('text', { x: Math.min(x(last), W - m.r - 2), y: y(s.values[last]) - 9, 'text-anchor': 'end', class: 'ch-value' }, nf(s.values[last], 1) + (o.suffix || '')));
      }
      const cross = el('line', { y1: m.t, y2: H - m.b, class: 'ch-cross', visibility: 'hidden' }); svg.append(cross);
      const tip = document.createElement('div'); tip.className = 'ch-tip'; tip.hidden = true;
      o.days.forEach((d, i) => {
        const x0 = i === 0 ? m.l : (x(i - 1) + x(i)) / 2, x1 = i === o.days.length - 1 ? W - m.r : (x(i) + x(i + 1)) / 2;
        const hit = el('rect', { x: x0, y: m.t, width: Math.max(1, x1 - x0), height: H - m.t - m.b, fill: 'transparent' });
        hit.addEventListener('pointerenter', () => {
          cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
          tip.textContent = ''; const st = document.createElement('strong'); st.textContent = fullDate(d); tip.append(st);
          for (const s of o.series) { const sp = document.createElement('span'); sp.textContent = `${s.name}: ${nf(s.values[i], 1)}${s.values[i] === null ? '' : (o.suffix || '')}`; tip.append(sp); }
          tip.hidden = false; const tw = tip.offsetWidth; tip.style.left = Math.max(4, x(i) + 12 + tw > W ? x(i) - tw - 12 : x(i) + 12) + 'px'; tip.style.top = '18px';
        });
        svg.append(hit);
      });
      svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
      box.textContent = ''; box.append(svg, tip);
    };
    draw();
    let lastW = box.clientWidth;
    const ro = new ResizeObserver(() => { if (!box.isConnected) return ro.disconnect(); if (Math.abs(box.clientWidth - lastW) > 2) { lastW = box.clientWidth; draw(); } });
    ro.observe(box);
  }
  function spark(series) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 220, H = 54, pad = 5;
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'rd-spark'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
    const top = Math.max(D.umbrales.alarm * 1.1, ...series.map((s) => s.uMax || 0));
    const x = (i) => (series.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (series.length - 1)), y = (v) => pad + (1 - v / top) * (H - pad * 2);
    const line = (cls, yv, dash) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', 0); l.setAttribute('x2', W); l.setAttribute('y1', y(yv)); l.setAttribute('y2', y(yv)); l.setAttribute('class', cls); if (dash) l.setAttribute('stroke-dasharray', dash); svg.append(l); };
    line('ch-ref ch-ref-limit', D.umbrales.alarm);
    for (const [key, cls] of [['uMax', 'ch-line s-peak'], ['uAvg', 'ch-line']]) {
      let dp = '', pen = false; series.forEach((s, i) => { if (s[key] === null) { pen = false; return; } dp += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)} `; pen = true; });
      const pth = document.createElementNS(NS, 'path'); pth.setAttribute('d', dp); pth.setAttribute('class', cls); pth.setAttribute('fill', 'none'); svg.append(pth);
    }
    return svg;
  }

  /* ---------- imagen del reporte por sede ---------- */
  let logoData = null;
  async function logo() {
    if (logoData) return logoData;
    const blob = await fetch('/img/sipnology-logo.png').then((r) => r.blob());
    logoData = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    return logoData;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function sedeImage(C, s) {
    const W = 1600, P = 48, days = C.days;
    const aps = s.aps;
    const cellW = Math.max(22, Math.min(86, Math.floor((W - P * 2 - 330 - 300) / Math.max(1, days.length))));
    const gridY = 660, rowH = 30, H = gridY + 60 + aps.length * rowH + 90;
    const F = 'font-family="Helvetica Neue, Arial, sans-serif"';
    const T = (x, y, txt, size, fill, weight = 400, anchor = 'start') => `<text x="${x}" y="${y}" ${F} font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${esc(txt)}</text>`;
    const lv = (v) => (v === null || v === undefined ? '#f4f4f2' : HEX[level(v)]);
    let g = `<rect width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="10" fill="${HEX.red}"/>`;
    g += `<image href="${await logo()}" x="${P}" y="34" width="150" height="112"/>`;
    g += T(P + 190, 74, `${state.data.program.client} · Mejora NPS · WLAN`.toUpperCase(), 17, HEX.ink3, 600);
    g += T(P + 190, 118, `Rediseño WLAN · ${s.name}`, 42, HEX.ink, 700);
    g += T(P + 190, 152, `Periodo: ${fullDate(D.desde)} – ${fullDate(D.hasta)} · ${aps.length} AP · ${s.n} lecturas`, 20, HEX.ink2);
    // indicadores
    const tiles = [['Promedio de usuarios por AP', nf(s.uAvg), lv(s.uAvg), s.uAvg === null ? '' : LV[level(s.uAvg)]], ['Pico de usuarios en un AP', nf(s.uMax, 0), lv(s.uMax), s.uMax === null ? '' : LV[level(s.uMax)]],
      ['Utilización de canal promedio', s.cAvg === null ? '—' : nf(s.cAvg, 0) + '%', '#f4f4f2', 'Informativa'], ['Utilización de canal pico', s.cMax === null ? '—' : nf(s.cMax, 0) + '%', '#f4f4f2', 'Informativa']];
    const tw = (W - P * 2 - 3 * 20) / 4;
    tiles.forEach((t, i) => { const x = P + i * (tw + 20); g += `<rect x="${x}" y="190" width="${tw}" height="130" rx="8" fill="${t[2]}"/>` + T(x + 20, 224, t[0].toUpperCase(), 14, HEX.ink2, 600) + T(x + 20, 288, t[1], 56, HEX.ink, 700) + T(x + tw - 20, 288, t[3], 18, HEX.ink2, 600, 'end'); });
    // tendencia
    const cx0 = P + 50, cx1 = W - P - 10, cy0 = 380, cy1 = 600;
    const top = Math.max(D.umbrales.alarm * 1.15, ...s.series.map((d) => d.uMax || 0)) * 1.05;
    const X = (i) => (days.length === 1 ? (cx0 + cx1) / 2 : cx0 + (i * (cx1 - cx0)) / (days.length - 1)), Y = (v) => cy0 + (1 - v / top) * (cy1 - cy0);
    g += T(P, 362, 'Usuarios por AP: promedio y pico diario', 22, HEX.ink, 700);
    g += `<g ${F} font-size="15"><line x1="${W - P - 420}" x2="${W - P - 390}" y1="356" y2="356" stroke="${HEX.series}" stroke-width="3"/><text x="${W - P - 382}" y="361" fill="${HEX.ink2}">Promedio</text><line x1="${W - P - 290}" x2="${W - P - 260}" y1="356" y2="356" stroke="${HEX.peak}" stroke-width="3"/><text x="${W - P - 252}" y="361" fill="${HEX.ink2}">Pico</text><line x1="${W - P - 190}" x2="${W - P - 160}" y1="356" y2="356" stroke="${HEX.critLine}" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - P - 152}" y="361" fill="${HEX.ink2}">Criterio de ${D.umbrales.alarm}</text></g>`;
    for (let v = 0; v <= top; v += 10) g += `<line x1="${cx0}" x2="${cx1}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v ? '#efefec' : '#c9c9c5'}"/>` + T(cx0 - 10, Y(v) + 5, v, 15, HEX.ink3, 400, 'end');
    g += `<line x1="${cx0}" x2="${cx1}" y1="${Y(D.umbrales.alarm)}" y2="${Y(D.umbrales.alarm)}" stroke="${HEX.critLine}" stroke-width="2" stroke-dasharray="6 5"/>`;
    for (const [key, color, wdt] of [['uMax', HEX.peak, 3], ['uAvg', HEX.series, 4]]) {
      let dp = '', pen = false; s.series.forEach((d, i) => { if (d[key] === null) { pen = false; return; } dp += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[key]).toFixed(1)} `; pen = true; });
      g += `<path d="${dp}" fill="none" stroke="${color}" stroke-width="${wdt}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    const step = Math.ceil(days.length / 14);
    days.forEach((d, i) => { if (i % step === 0 || i === days.length - 1) g += T(X(i), cy1 + 26, dayMonth(d), 15, HEX.ink3, 400, i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'); });
    // matriz por AP
    g += T(P, gridY, 'Pico diario de usuarios por AP', 22, HEX.ink, 700);
    const gx = P + 330, hy = gridY + 40;
    const dstep = Math.ceil(46 / cellW);
    days.forEach((d, i) => { if (i % dstep === 0) g += T(gx + i * cellW + cellW / 2, hy, dayMonth(d).replace(' ', ' '), 12, HEX.ink3, 400, 'middle'); });
    const sx = gx + days.length * cellW + 24;
    ['Prom.', 'Pico', 'Canal'].forEach((t, i) => { g += T(sx + i * 90 + 70, hy, t, 14, HEX.ink3, 600, 'end'); });
    aps.forEach((a, r) => {
      const y = hy + 12 + r * rowH;
      g += T(P, y + 20, a.name, 16, HEX.ink, 600);
      days.forEach((d, i) => { const row = a.byDay.get(d); const v = row ? row[4] : null; g += `<rect x="${gx + i * cellW + 1}" y="${y + 1}" width="${cellW - 2}" height="${rowH - 2}" rx="3" fill="${lv(v)}"/>`; if (v !== null && cellW >= 26) g += T(gx + i * cellW + cellW / 2, y + 20, v, 13, HEX.ink, 600, 'middle'); });
      g += T(sx + 70, y + 20, nf(a.uAvg), 16, HEX.ink, 600, 'end') + T(sx + 160, y + 20, nf(a.uMax, 0), 16, HEX.ink, 700, 'end') + T(sx + 250, y + 20, a.cAvg === null ? '—' : nf(a.cAvg, 0) + '%', 16, HEX.ink2, 400, 'end');
    });
    const fy = H - 34;
    [['good', `Bueno < ${D.umbrales.regular}`], ['regular', `Regular ${D.umbrales.regular} a ${D.umbrales.alarm}`], ['alarm', `Alarmante > ${D.umbrales.alarm}`]].forEach(([k, t], i) => { g += `<rect x="${P + i * 230}" y="${fy - 15}" width="18" height="18" rx="3" fill="${HEX[k]}"/>` + T(P + i * 230 + 26, fy, t, 15, HEX.ink2); });
    g += T(W - P, fy, `Generado el ${stamp(new Date().toISOString())} por ${state.user.name} · Sipnology`, 15, HEX.ink3, 400, 'end');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo generar la imagen.')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `rediseno-wlan-${s.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${D.hasta}.png`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- carga de Excel ---------- */
  function uploadPanel() {
    const out = h('div', { class: 'rd-preview' });
    const file = h('input', { type: 'file', id: 'rd-file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const send = async (f, modo) => {
      const res = await fetch(`/api/rediseno/importar?modo=${modo}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'portal' }, body: f }).catch(() => { throw new Error('No hay conexión con el servidor.'); });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo leer el archivo.');
      return data;
    };
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      out.textContent = ''; out.append(h('p', { class: 'muted' }, 'Leyendo y validando el archivo…'));
      try {
        const r = await send(f, 'revisar');
        out.textContent = '';
        const nothing = r.nuevas + r.actualizadas === 0;
        out.append(
          h('p', { class: 'notice' }, h('strong', {}, `${r.nuevas} lecturas nuevas`), `, ${r.actualizadas} que cambian de valor y ${r.sinCambio} que ya estaban cargadas. `, r.errores ? `${r.errores} datos no válidos se omiten. ` : '', 'Nada se guarda hasta que confirmes.'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, ['Sede', 'Días', 'Periodo', 'AP', 'Nuevas', 'Cambian', 'Sin cambio', `Sobre ${D.umbrales.alarm}`].map((t, i) => h('th', { class: i ? 'num-col' : '' }, t)))),
            h('tbody', {}, r.sedes.map((s) => h('tr', {}, h('td', {}, s.sede), h('td', { class: 'num-col plain' }, s.dias), h('td', { class: 'num-col plain nowrap' }, s.desde ? `${dayMonth(s.desde)} – ${dayMonth(s.hasta)}` : '—'), h('td', { class: 'num-col plain' }, s.aps), h('td', { class: 'num-col plain' }, s.nuevas), h('td', { class: 'num-col plain' }, s.actualizadas), h('td', { class: 'num-col plain' }, s.sinCambio), h('td', { class: 'num-col plain' }, s.sobreUmbral)))))),
          r.cambios.length ? h('details', { class: 'section', open: true }, h('summary', {}, `Lecturas ya cargadas que cambiarían de valor (${r.actualizadas})`),
            h('div', { class: 'section-body' }, h('ul', {}, r.cambios.map((c) => h('li', {}, `${c.ap}, ${dayMonth(c.fecha)} ${c.hora}: usuarios ${nf(c.antes.usuarios, 0)} → ${nf(c.despues.usuarios, 0)}, canal ${nf(c.antes.util, 0)}% → ${nf(c.despues.util, 0)}%`))))) : null,
          r.issues.length ? h('details', { class: 'section', open: r.errores > 0 }, h('summary', {}, `Validación: ${r.errores} ${r.errores === 1 ? 'error' : 'errores'} y ${r.avisos} ${r.avisos === 1 ? 'aviso' : 'avisos'}`),
            h('div', { class: 'section-body' }, h('ul', { class: 'rd-issues' }, r.issues.map((i) => h('li', { class: 'is-' + i.level }, h('strong', {}, i.level === 'error' ? 'Error' : 'Aviso'), ` · ${i.where}: ${i.msg}`, i.count > 1 ? h('span', { class: 'muted' }, ` (y ${i.count - 1} casos similares)`) : null))))) : h('p', { class: 'ok-text' }, 'Validación sin observaciones.'),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', disabled: nothing, onclick: async (e) => { e.currentTarget.disabled = true; try { const s = await send(f, 'guardar'); toast(`Se guardaron ${s.nuevas} lecturas nuevas y ${s.actualizadas} actualizadas`); view.panel = null; view.desde = null; view.hasta = null; await reload(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; } } }, nothing ? 'No hay nada nuevo que guardar' : `Guardar ${r.nuevas + r.actualizadas} lecturas`),
            h('button', { class: 'btn', type: 'button', onclick: () => { view.panel = null; render(); } }, 'Cancelar')));
      } catch (err) { out.textContent = ''; out.append(h('p', { class: 'form-error' }, err.message)); }
    });
    return h('section', { class: 'panel no-print' }, h('h2', {}, 'Cargar reporte de Excel'),
      h('p', { class: 'muted' }, 'Sube la plantilla de captura o el "Reporte de canal de utilización" (.xlsx). El portal extrae las lecturas, las valida y te muestra el resumen antes de guardar. Puedes subir el archivo completo cada día: solo se agregan las lecturas nuevas.'),
      h('p', {}, h('a', { class: 'btn', href: '/descargas/plantilla-rediseno-wlan.xlsx', download: 'Rediseno WLAN - Lecturas.xlsx' }, 'Descargar plantilla de captura'), ' ', h('span', { class: 'muted' }, 'Una fila por AP y hora, con lista de AP y validaciones. También se acepta el reporte anterior por sede.')),
      h('div', { class: 'field' }, h('label', { for: 'rd-file' }, 'Archivo de Excel'), file), out);
  }

  /* ---------- captura manual ---------- */
  function capturePanel() {
    const now = new Date();
    const sedeSel = h('select', { id: 'rd-c-sede' }, D.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === String(view.sede) }, s.name)));
    const fecha = h('input', { id: 'rd-c-fecha', type: 'date', max: todayStr(), value: todayStr() });
    const hora = h('input', { id: 'rd-c-hora', type: 'time', value: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` });
    const grid = h('div', {}); const prior = h('p', { class: 'hint' }); const error = h('div', { class: 'form-error', hidden: true });
    const fill = async () => {
      const s = D.sedes.find((x) => String(x.id) === sedeSel.value);
      grid.textContent = '';
      grid.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table rd-capture' },
        h('thead', {}, h('tr', {}, h('th', {}, 'AP'), h('th', {}, 'Usuarios'), h('th', {}, 'Utilización de canal (%)'))),
        h('tbody', {}, s.aps.map((a) => h('tr', {}, h('td', {}, h('strong', {}, a.name)),
          h('td', {}, h('input', { type: 'number', min: 0, max: 500, step: 1, inputmode: 'numeric', id: `rd-u-${a.id}`, 'aria-label': `Usuarios de ${a.name}` })),
          h('td', {}, h('input', { type: 'number', min: 0, max: 100, step: 'any', inputmode: 'decimal', id: `rd-c-${a.id}`, 'aria-label': `Utilización de canal de ${a.name}` }))))))));
      try {
        const { lecturas } = await api('GET', `/api/rediseno/lecturas?sede=${s.id}&fecha=${fecha.value}`);
        const horas = [...new Set(lecturas.map((l) => l.hora || `lectura ${l.slot}`))];
        prior.textContent = horas.length ? `Ese día ya hay lecturas de ${s.name} a las: ${horas.join(', ')}. Si capturas la misma hora, se actualizan.` : `Aún no hay lecturas de ${s.name} para ese día.`;
      } catch { prior.textContent = ''; }
    };
    sedeSel.addEventListener('change', fill); fecha.addEventListener('change', fill);
    const save = async (confirm) => {
      error.hidden = true;
      const s = D.sedes.find((x) => String(x.id) === sedeSel.value);
      const lecturas = s.aps.map((a) => ({ apId: a.id, usuarios: document.getElementById(`rd-u-${a.id}`).value, util: document.getElementById(`rd-c-${a.id}`).value }));
      try {
        const r = await apiX('POST', '/api/rediseno/lecturas', { sedeId: s.id, fecha: fecha.value, hora: hora.value, lecturas, confirm });
        toast(`Lecturas guardadas: ${r.nuevas} nuevas, ${r.actualizadas} actualizadas`); view.panel = null; if (fecha.value > view.hasta) { view.desde = null; view.hasta = null; } await reload();
      } catch (err) {
        error.textContent = ''; error.append(err.message, err.raros ? h('ul', {}, err.raros.map((x) => h('li', {}, x))) : null,
          err.code === 'atipico' ? h('button', { class: 'btn', type: 'button', onclick: () => save(true) }, 'Son correctos: guardar') : null);
        error.hidden = false;
      }
    };
    const newAp = h('input', { type: 'text', id: 'rd-new-ap', maxlength: 50, placeholder: 'AP-P37-MR56-PUEBLA-08', 'aria-label': 'Nombre del AP nuevo' });
    const addAp = async (confirm) => { try { const s = D.sedes.find((x) => String(x.id) === sedeSel.value); const r = await apiX('POST', '/api/rediseno/aps', { sedeId: s.id, name: newAp.value, confirm }); toast(`Se agregó ${r.name}`); view.sede = String(s.id); await reload(); }
      catch (err) { if (err.code === 'similar') { error.textContent = ''; error.append(err.message + ' ', h('button', { class: 'btn', type: 'button', onclick: () => addAp(true) }, 'Es otro AP: agregarlo')); error.hidden = false; } else toast(err.message, 'error'); } };
    const panel = h('section', { class: 'panel no-print' }, h('h2', {}, 'Capturar lecturas'),
      h('p', { class: 'muted' }, `Quedarán registradas a nombre de ${state.user.name} con la fecha y hora de la captura.`),
      h('div', { class: 'form-grid form-grid-4' },
        h('div', { class: 'field' }, h('label', { for: 'rd-c-sede' }, 'Sede'), sedeSel),
        h('div', { class: 'field' }, h('label', { for: 'rd-c-fecha' }, 'Fecha de la lectura'), fecha),
        h('div', { class: 'field' }, h('label', { for: 'rd-c-hora' }, 'Hora de la lectura'), hora)),
      prior, grid, error,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(false) }, 'Guardar lecturas'), h('button', { class: 'btn', type: 'button', onclick: () => { view.panel = null; render(); } }, 'Cancelar')),
      h('details', { class: 'section' }, h('summary', {}, 'Agregar un AP nuevo a la sede'), h('div', { class: 'section-body' }, h('div', { class: 'adder' }, newAp, h('button', { class: 'btn', type: 'button', onclick: () => addAp(false) }, 'Agregar AP')))));
    fill();
    return panel;
  }

  /* ---------- vista ---------- */
  async function reload() {
    const q = view.desde ? `?desde=${view.desde}&hasta=${view.hasta}` : '';
    D = await api('GET', '/api/rediseno/resumen' + q);
    view.desde = D.desde; view.hasta = D.hasta;
    render();
  }
  const setRange = (days) => { view.hasta = D.rango.max || todayStr(); view.desde = days ? addDays(view.hasta, -(days - 1)) : D.rango.min; reload(); };

  function render() {
    if (!root || !root.isConnected) return;
    const C = compute();
    const scope = view.sede === 'all' ? null : C.sedes.find((s) => String(s.id) === String(view.sede)) || null;
    const S = scope || { ...C.general, series: C.series, name: 'Todas las sedes', aps: C.apStats };
    root.textContent = '';
    const kids = [];
    const push = (...n) => kids.push(...n.flat().filter(Boolean));

    push(h('div', { class: 'print-head only-print' }, h('img', { src: '/img/sipnology-logo.png', alt: 'Sipnology' }),
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.data.program.client} · Mejora NPS · WLAN`), h('h1', {}, `Rediseño WLAN · ${S.name}`), h('p', {}, `Periodo: ${fullDate(D.desde)} – ${fullDate(D.hasta)}`), h('p', { class: 'muted' }, `Generado el ${stamp(new Date().toISOString())} por ${state.user.name}`))));

    // barra de periodo y acciones
    const dateInput = (id, label, key) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'date', value: view[key], min: D.rango.min, max: todayStr(), onchange: (e) => { if (!e.target.value) return; view[key] = e.target.value; if (view.desde > view.hasta) view[key === 'desde' ? 'hasta' : 'desde'] = e.target.value; reload(); } }));
    push(h('section', { class: 'panel rd-bar no-print' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Seguimiento diario'),
        h('div', { class: 'form-actions' },
          canWrite() ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { view.panel = view.panel === 'excel' ? null : 'excel'; render(); } }, 'Cargar Excel') : null,
          canWrite() ? h('button', { class: 'btn', type: 'button', onclick: () => { view.panel = view.panel === 'manual' ? null : 'manual'; render(); } }, 'Capturar lecturas') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Exportar a PDF'),
          scope ? h('button', { class: 'btn', type: 'button', onclick: (e) => exportImage(e.currentTarget, C, scope) }, 'Descargar imagen de la sede') : null)),
      h('div', { class: 'rd-filters' }, dateInput('rd-desde', 'Desde', 'desde'), dateInput('rd-hasta', 'Hasta', 'hasta'),
        h('div', { class: 'field' }, h('label', { for: 'rd-sede' }, 'Sede'), h('select', { id: 'rd-sede', onchange: (e) => { view.sede = e.target.value; render(); } }, h('option', { value: 'all' }, 'Todas las sedes'), D.sedes.map((s) => h('option', { value: s.id, selected: String(s.id) === String(view.sede) }, s.name)))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Periodo rápido'), h('div', { class: 'tabs' }, [['2 semanas', 14], ['1 mes', 30], ['3 meses', 90], ['Todo', 0]].map(([t, n]) => h('button', { class: 'tab', type: 'button', onclick: () => setRange(n) }, t))))),
      h('p', { class: 'muted' }, D.rango.min ? `Hay lecturas del ${fullDate(D.rango.min)} al ${fullDate(D.rango.max)}.` : 'Aún no hay lecturas cargadas.')));
    if (view.panel === 'excel' && canWrite()) push(uploadPanel());
    if (view.panel === 'manual' && canWrite()) push(capturePanel());

    if (!C.rows.length) { push(h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'No hay lecturas en este periodo. Amplía las fechas o carga información.'))); root.append(...kids); return; }

    // hallazgos
    const fnd = findings(C, scope);
    push(h('section', { class: 'panel' }, h('h2', {}, 'Hallazgos del periodo'),
      h('ul', { class: 'rd-findings' }, fnd.map((f) => h('li', { class: 'fd fd-' + f.kind }, h('span', { class: 'fd-icon', 'aria-hidden': 'true' }, f.kind === 'alarm' ? '▲' : f.kind === 'regular' ? '!' : f.kind === 'good' ? '↓' : 'i'), h('div', {}, h('strong', {}, f.title), h('p', {}, f.text)))))));

    // estadística general (o de la sede elegida)
    const base = kpi && kpi.baseline !== null && kpi.baseline !== undefined ? kpi.baseline : null;
    const sub = S.aps.filter((a) => a.over > 0).length;
    const tally = scope ? (() => { const t = { good: 0, regular: 0, alarm: 0 }; C.rows.filter((r) => scope.aps.some((a) => a.id === r[0])).forEach((r) => { const l = level(r[4]); if (l) t[l] += 1; }); return t; })() : C.tally;
    const tot = tally.good + tally.regular + tally.alarm;
    const seg = (k) => (tally[k] ? h('div', { class: 'mix-seg lv-' + k, style: `flex:${tally[k]}` }) : null);
    push(h('section', { class: 'rd-tiles' },
      h('div', { class: 'tile' + lvClass(S.uAvg) }, h('span', { class: 'tile-label' }, 'Promedio de usuarios por AP'), h('span', { class: 'tile-num' }, nf(S.uAvg)),
        h('span', { class: 'tile-sub' }, `${LV[level(S.uAvg)]}${base !== null ? ` · métrica inicial ${nf(base)}` : ''}`)),
      h('div', { class: 'tile' + lvClass(S.uMax) }, h('span', { class: 'tile-label' }, 'Pico de usuarios en un AP'), h('span', { class: 'tile-num' }, nf(S.uMax, 0)),
        h('span', { class: 'tile-sub' }, `${LV[level(S.uMax)]} · criterio de rediseño: más de ${D.umbrales.alarm}`)),
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, `AP que superaron ${D.umbrales.alarm}`), h('span', { class: 'tile-num' }, sub), h('span', { class: 'tile-sub' }, `de ${S.aps.length} AP monitoreados`)),
      h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, 'Utilización de canal'), h('span', { class: 'tile-num' }, S.cAvg === null ? '—' : nf(S.cAvg, 0) + '%'), h('span', { class: 'tile-sub' }, `Promedio · pico ${S.cMax === null ? '—' : nf(S.cMax, 0) + '%'} · no forma parte de la métrica`)),
      h('div', { class: 'tile tile-wide' }, h('span', { class: 'tile-label' }, `Días-AP por nivel, según su pico diario (${tot})`),
        h('div', { class: 'mix', role: 'img', 'aria-label': `Buenos ${tally.good}, regulares ${tally.regular}, alarmantes ${tally.alarm}` }, seg('good'), seg('regular'), seg('alarm')),
        h('div', { class: 'mix-legend' }, [['good', `Bueno, menos de ${D.umbrales.regular}`], ['regular', `Regular, de ${D.umbrales.regular} a ${D.umbrales.alarm}`], ['alarm', `Alarmante, más de ${D.umbrales.alarm}`]].map(([k, t]) => h('span', {}, h('i', { class: 'sw lv-' + k }), `${t}: ${tally[k]} (${tot ? Math.round((tally[k] / tot) * 100) : 0}%)`))))));

    const c1 = h('div', { class: 'chart' }), c2 = h('div', { class: 'chart' });
    push(h('div', { class: 'two' },
      h('section', { class: 'panel' }, h('h2', {}, `Usuarios por AP · ${S.name}`), c1, h('p', { class: 'legend' }, h('span', { class: 'lg lg-line' }, 'Promedio diario'), h('span', { class: 'lg lg-peak' }, 'Pico diario'), h('span', { class: 'lg lg-limit' }, `Criterio de rediseño (${D.umbrales.alarm})`))),
      h('section', { class: 'panel' }, h('h2', {}, `Utilización de canal · ${S.name}`), c2, h('p', { class: 'legend' }, h('span', { class: 'lg lg-line' }, 'Promedio diario'), h('span', { class: 'lg lg-peak' }, 'Pico diario'), h('span', { class: 'muted' }, 'Informativa: no forma parte de la métrica')))));

    // estadística por sede
    push(h('section', { class: 'tests' }, h('h2', {}, 'Estadística por sede'),
      h('div', { class: 'rd-sedes' }, C.sedes.map((s) => {
        const t = s.trend;
        return h('article', { class: 'rd-sede' + (scope && scope.id === s.id ? ' is-selected' : '') },
          h('header', {}, h('h3', {}, s.name), s.uMax === null ? h('span', { class: 'tag tag-none' }, 'Sin datos') : levelPill(level(s.uMax))),
          h('div', { class: 'rd-sede-nums' },
            h('div', {}, h('span', { class: 'tile-label' }, 'Promedio'), h('span', { class: 'rd-num' + lvClass(s.uAvg) }, nf(s.uAvg))),
            h('div', {}, h('span', { class: 'tile-label' }, 'Pico'), h('span', { class: 'rd-num' + lvClass(s.uMax) }, nf(s.uMax, 0))),
            h('div', {}, h('span', { class: 'tile-label' }, 'Canal'), h('span', { class: 'rd-num' }, s.cAvg === null ? '—' : nf(s.cAvg, 0) + '%'))),
          s.n ? spark(s.series) : null,
          h('p', { class: 'tile-sub' }, `${s.aps.length} AP · ${s.n} lecturas`, t && t.pct !== null ? ` · tendencia ${t.pct > 0 ? '+' : '−'}${nf(Math.abs(t.pct), 0)}%` : ''),
          h('div', { class: 'form-actions no-print' },
            h('button', { class: 'btn', type: 'button', onclick: () => { view.sede = scope && scope.id === s.id ? 'all' : String(s.id); render(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, scope && scope.id === s.id ? 'Ver todas' : 'Ver detalle'),
            s.n ? h('button', { class: 'btn', type: 'button', onclick: (e) => exportImage(e.currentTarget, C, s) }, 'Descargar imagen') : null));
      }))));

    // detalle por AP
    const detail = (s) => {
      const showDays = C.days.length <= 31 ? C.days : C.days.slice(-31);
      return h('section', { class: 'panel' }, h('h2', {}, `Pico diario de usuarios por AP · ${s.name}`),
        C.days.length > 31 ? h('p', { class: 'muted' }, 'Se muestran los últimos 31 días con lecturas; los totales consideran todo el periodo.') : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'table matrix rd-heat' },
          h('thead', {}, h('tr', {}, h('th', {}, 'AP'), showDays.map((d) => h('th', { class: 'sub' }, dayMonth(d))), h('th', { class: 'sub grp' }, 'Prom.'), h('th', { class: 'sub' }, 'Pico'), h('th', { class: 'sub' }, 'Canal prom.'), h('th', { class: 'sub' }, 'Canal pico'), h('th', { class: 'sub' }, `Días > ${D.umbrales.alarm}`))),
          h('tbody', {}, s.aps.map((a) => h('tr', {}, h('td', { class: 'nowrap' }, h('strong', {}, a.name)),
            showDays.map((d) => { const r = a.byDay.get(d); return r ? h('td', { class: 'num-col' + lvClass(r[4]), title: `${dayMonth(d)} · promedio ${nf(r[3])}, pico ${r[4]}, canal ${nf(r[5], 0)}% (pico ${nf(r[6], 0)}%), ${r[2]} lecturas` }, r[4]) : h('td', { class: 'num-col empty-cell' }, ''); }),
            h('td', { class: 'num-col' + lvClass(a.uAvg) }, nf(a.uAvg)), h('td', { class: 'num-col' + lvClass(a.uMax) }, nf(a.uMax, 0)), h('td', { class: 'num-col plain' }, a.cAvg === null ? '—' : nf(a.cAvg, 0) + '%'), h('td', { class: 'num-col plain' }, a.cMax === null ? '—' : nf(a.cMax, 0) + '%'), h('td', { class: 'num-col plain' }, a.over)))))));
    };
    push((scope ? [scope] : C.sedes.filter((s) => s.n)).map(detail));

    // cargas
    push(h('section', { class: 'panel' }, h('h2', {}, 'Cargas de información'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha y hora'), h('th', {}, 'Ingeniero'), h('th', {}, 'Origen'), h('th', { class: 'num-col' }, 'Nuevas'), h('th', { class: 'num-col' }, 'Actualizadas'), h('th', { class: 'num-col' }, 'Avisos'), h('th', { class: 'no-print' }, ''))),
        h('tbody', {}, D.cargas.map((c) => { const r = c.resumen || {}; return h('tr', {}, h('td', { class: 'nowrap' }, stamp(c.ts)), h('td', {}, c.user),
          h('td', {}, { excel: 'Excel', manual: 'Captura manual', inicial: 'Histórico inicial' }[c.tipo] || c.tipo, c.archivo ? h('span', { class: 'meta' }, c.archivo) : null, r.deshecha ? h('span', { class: 'meta warn-text' }, `Deshecha por ${r.deshecha.por}`) : null),
          h('td', { class: 'num-col plain' }, r.nuevas ?? '—'), h('td', { class: 'num-col plain' }, r.actualizadas ?? '—'), h('td', { class: 'num-col plain' }, (r.errores || 0) + (r.avisos || 0)),
          h('td', { class: 'actions no-print' }, !r.deshecha && c.tipo !== 'inicial' && (isAdmin() || (c.tipo === 'manual' && c.user === state.user.name)) ? h('button', { class: 'link-btn', type: 'button', onclick: (e) => confirmInline(e.currentTarget, async () => { const x = await api('DELETE', '/api/rediseno/cargas/' + c.id); toast(`Carga deshecha: ${x.lecturas} lecturas eliminadas`); await reload(); }) }, 'Deshacer') : null)); }))))));

    root.append(...kids);
    const sr = S.series;
    lineChart(c1, { title: 'Usuarios por AP por día', days: C.days, max: D.umbrales.alarm, series: [{ name: 'Pico', values: sr.map((d) => d.uMax), cls: 's-peak' }, { name: 'Promedio', values: sr.map((d) => (d.uAvg === null ? null : Math.round(d.uAvg * 10) / 10)), cls: '' }], refs: [{ value: D.umbrales.alarm, label: `Criterio ${D.umbrales.alarm}`, kind: 'limit' }] });
    lineChart(c2, { title: 'Utilización de canal por día', days: C.days, suffix: '%', series: [{ name: 'Pico', values: sr.map((d) => d.cMax), cls: 's-peak' }, { name: 'Promedio', values: sr.map((d) => (d.cAvg === null ? null : Math.round(d.cAvg * 10) / 10)), cls: '' }] });
  }
  async function exportImage(btn, C, s) {
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'Generando…';
    try { await sedeImage(C, s); toast(`Imagen de ${s.name} descargada`); } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = t;
  }

  window.PortalRediseno = {
    async mount(el, it) {
      root = el; kpi = it.kpis[0];
      el.textContent = ''; el.append(h('p', { class: 'loading' }, 'Cargando el seguimiento diario…'));
      try { await reload(); } catch (err) { el.textContent = ''; el.append(h('p', { class: 'empty' }, err.message)); }
    },
    open(panel) { view.panel = panel; render(); if (root) root.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  };
})();
