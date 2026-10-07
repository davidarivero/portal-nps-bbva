'use strict';
/* Gráficas SVG sin librerías externas. Los colores vienen de las variables CSS. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  }
  const tickFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

  /**
   * Gráfica de tendencia.
   * opts: { points:[{label, sub, value, tip:[lines], kind}], refs:[{value,label,kind}], fmt(v), unit, title }
   */
  function line(container, opts) {
    const draw = () => {
      container.textContent = '';
      const W = Math.max(300, container.clientWidth || 640);
      const H = W < 480 ? 250 : 300;
      const narrow = W < 480;
      const refs = (opts.refs || []).filter((r) => r.value !== null && r.value !== undefined);
      const pts = opts.points;
      const m = { t: 22, r: narrow ? 16 : 24, b: 46, l: 46 };
      const top = Math.max(0, ...pts.map((p) => p.value), ...refs.map((r) => r.value));
      const step = niceStep((top * 1.1 || 1) / 4);
      const nTicks = Math.max(2, Math.ceil((top * 1.1 || 1) / step));
      const yMax = step * nTicks;
      const x = (i) => (pts.length === 1 ? m.l + (W - m.l - m.r) / 2 : m.l + 14 + (i * (W - m.l - m.r - 28)) / (pts.length - 1));
      const y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);

      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.title || 'Tendencia semanal' });

      // rejilla y eje Y
      for (let i = 0; i <= nTicks; i++) {
        const v = step * i;
        svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i === 0 ? 'ch-axis' : 'ch-grid' }));
        svg.append(el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'ch-tick' }, tickFmt.format(v)));
      }

      // líneas de referencia (objetivo, criterio)
      const taken = [];
      for (const r of refs) {
        const yy = y(r.value);
        svg.append(el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'ch-ref ch-ref-' + r.kind }));
        let ly = yy - 6;
        if (ly < 12) ly = yy + 14;
        while (taken.some((t) => Math.abs(t - ly) < 14)) ly += 14;
        taken.push(ly);
        const txt = el('text', { x: W - m.r, y: ly, 'text-anchor': 'end', class: 'ch-ref-label ch-ref-label-' + r.kind }, `${r.label} ${opts.fmt(r.value)}`);
        svg.append(txt);
      }

      // serie
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
        const area = `${d} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
        svg.append(el('path', { d: area, class: 'ch-area' }));
        svg.append(el('path', { d, class: 'ch-line', fill: 'none' }));
      }
      const every = Math.ceil(pts.length / (narrow ? 4 : 9));
      pts.forEach((p, i) => {
        const last = i === pts.length - 1;
        svg.append(el('circle', { cx: x(i), cy: y(p.value), r: last ? 5.5 : 4, class: 'ch-dot' + (p.kind === 'base' ? ' ch-dot-base' : '') + (last ? ' ch-dot-last' : '') }));
        if (i % every === 0 || last) {
          const anchor = i === 0 && pts.length > 1 ? 'start' : last && pts.length > 1 ? 'end' : 'middle';
          const lx = anchor === 'start' ? x(i) - 10 : anchor === 'end' ? x(i) + 10 : x(i);
          if (!(last && i % every !== 0 && pts.length > 2 && x(i) - x(i - (i % every)) < 70)) {
            svg.append(el('text', { x: lx, y: H - m.b + 18, 'text-anchor': anchor, class: 'ch-xlabel' }, p.label));
            if (p.sub) svg.append(el('text', { x: lx, y: H - m.b + 33, 'text-anchor': anchor, class: 'ch-xsub' }, p.sub));
          }
        }
        // etiqueta directa solo en el primer y último punto
        if (i === 0 || last) {
          const above = y(p.value) - 12 > m.t + 4;
          svg.append(el('text', {
            x: Math.min(Math.max(x(i), m.l + 16), W - m.r - 4), y: above ? y(p.value) - 12 : y(p.value) + 20,
            'text-anchor': last && pts.length > 1 ? 'end' : i === 0 && pts.length > 1 ? 'start' : 'middle',
            class: 'ch-value' + (last ? ' ch-value-last' : ''),
          }, opts.fmt(p.value) + (opts.unit === '%' ? '%' : '')));
        }
      });

      // capa de interacción
      const cross = el('line', { y1: m.t, y2: H - m.b, class: 'ch-cross', visibility: 'hidden' });
      svg.append(cross);
      const tip = document.createElement('div');
      tip.className = 'ch-tip';
      tip.hidden = true;
      const show = (i) => {
        const p = pts[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        tip.textContent = '';
        const head = document.createElement('strong');
        head.textContent = `${opts.fmt(p.value)}${opts.unit === '%' ? '%' : ' ' + (opts.unit || '')}`;
        const when = document.createElement('span');
        when.className = 'ch-tip-when';
        when.textContent = p.sub ? `${p.label} · ${p.sub}` : p.label;
        tip.append(head, when);
        for (const t of p.tip || []) { const s = document.createElement('span'); s.textContent = t; tip.append(s); }
        tip.hidden = false;
        const tw = tip.offsetWidth;
        let left = x(i) + 12;
        if (left + tw > W - 4) left = x(i) - tw - 12;
        tip.style.left = Math.max(4, left) + 'px';
        tip.style.top = Math.max(4, y(p.value) - 20) + 'px';
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      pts.forEach((p, i) => {
        const x0 = i === 0 ? m.l : (x(i - 1) + x(i)) / 2;
        const x1 = i === pts.length - 1 ? W - m.r : (x(i) + x(i + 1)) / 2;
        const hit = el('rect', { x: x0, y: m.t, width: Math.max(1, x1 - x0), height: H - m.t - m.b, fill: 'transparent', tabindex: 0, 'aria-label': `${p.label}: ${opts.fmt(p.value)} ${opts.unit || ''}` });
        hit.addEventListener('pointerenter', () => show(i));
        hit.addEventListener('pointermove', () => show(i));
        hit.addEventListener('focus', () => show(i));
        hit.addEventListener('blur', hide);
        svg.append(hit);
      });
      svg.addEventListener('pointerleave', hide);
      container.append(svg, tip);
    };
    draw();
    let lastW = container.clientWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (!container.isConnected) return ro.disconnect();
      if (Math.abs(container.clientWidth - lastW) < 2) return;
      lastW = container.clientWidth;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(container);
  }

  /** Minigráfica para las tarjetas del tablero. values: números; ref: objetivo opcional. */
  function spark(values, ref) {
    const W = 120, H = 36, pad = 5;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', class: 'spark' });
    const max = Math.max(...values, ref ?? 0) || 1;
    const x = (i) => (values.length === 1 ? W - pad : pad + (i * (W - pad * 2)) / (values.length - 1));
    const y = (v) => pad + (1 - v / max) * (H - pad * 2);
    if (ref !== null && ref !== undefined) svg.append(el('line', { x1: 0, x2: W, y1: y(ref), y2: y(ref), class: 'ch-ref ch-ref-target' }));
    if (values.length > 1) {
      svg.append(el('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: 'ch-line', fill: 'none' }));
    }
    svg.append(el('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3.5, class: 'ch-dot ch-dot-last' }));
    return svg;
  }

  window.Charts = { line, spark };
})();
