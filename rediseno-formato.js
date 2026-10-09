'use strict';
/*
 * Lee el "Reporte de canal de utilización" (una hoja por sede). Cada día es un bloque:
 *   fecha | horas de las lecturas | por cada AP: nombre, fila "Usuarios", fila "Utilización de canal".
 * El lector tolera bloques lado a lado, horas escritas como texto y porcentajes sin formato,
 * y reporta todo lo que no es congruente en lugar de cargarlo en silencio.
 */
const { readXlsx } = require('./xlsx-lite');

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isAp = (v) => typeof v === 'string' && /^AP[-_ ]/i.test(v) && v.length <= 60;
const isUsers = (v) => typeof v === 'string' && /^usuarios?$/.test(plain(v));
const isUtil = (v) => typeof v === 'string' && /^utilizacion/.test(plain(v));
const isLabel = (v) => isAp(v) || isUsers(v) || isUtil(v);
const isDate = (v) => typeof v === 'number' && v >= 40000 && v < 70000;
const MAX_READINGS = 8;

function toTime(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  if (typeof v === 'string') { const m = v.match(/^(\d{1,2})\s*[:.]\s*(\d{2})/); if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`; }
  if (typeof v === 'string') { const m = v.trim().match(/^(\d{1,2})\s*(?:hrs?|h)\.?$/i); if (m && Number(m[1]) < 24) return `${m[1].padStart(2, '0')}:00`; }
  return null;
}
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());
/** "PUEBLA - INXIGNIA" → "Puebla · Inxignia" */
const sedeName = (sheet) => titleCase(sheet.replace(/\s+/g, ' ').trim()).replace(/\s*-\s*/g, ' · ');
const apName = (v) => v.toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
const apPiso = (name) => { const m = name.match(/^AP-P(H?\d+)-/); return m ? 'Piso ' + m[1] : null; };

/* Formato de tabla (plantilla "Rediseño WLAN · Lecturas"): una fila por AP y hora. */
const HEAD = { fecha: /^fecha$/, hora: /^hora$/, ap: /^ap$/, usuarios: /^usuarios$/, util: /^utilizacion/, sede: /^sede$/, ingeniero: /^ingeniero$/ };
function findHeader(sh) {
  for (let r = 1; r <= Math.min(sh.maxRow, 20); r++) {
    const cols = {};
    for (let c = 1; c <= Math.min(sh.maxCol, 30); c++) {
      const x = sh.cells.get(`${r},${c}`);
      if (!x || typeof x.v !== 'string') continue;
      const t = plain(x.v).trim();
      for (const [k, re] of Object.entries(HEAD)) if (re.test(t) && !cols[k]) cols[k] = c;
    }
    if (cols.fecha && cols.ap && cols.usuarios) return { row: r, cols };
  }
  return null;
}
function parseFlat(sh, hd, toDate, issue) {
  const groups = new Map();
  const seen = new Set();
  const get = (r, k) => (hd.cols[k] ? sh.cells.get(`${r},${hd.cols[k]}`) : undefined);
  for (let r = hd.row + 1; r <= sh.maxRow; r++) {
    const f = get(r, 'fecha'), a = get(r, 'ap'), u = get(r, 'usuarios'), c = get(r, 'util'), h = get(r, 'hora'), s = get(r, 'sede');
    if (!f && !a && !u && !c) continue;
    const where = `${sh.name} fila ${r}`;
    let fecha = null;
    if (f && typeof f.v === 'number' && f.v >= 40000) fecha = toDate(f.v);
    else if (f && typeof f.v === 'string') { const m = f.v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) fecha = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    if (!fecha) { issue('error', sh.name, where, 'Falta la fecha o no es válida; la fila se omitió.'); continue; }
    if (!a || !isAp(a.v)) { issue('error', sh.name, where, `Falta el AP o no tiene la forma AP-…; la fila se omitió.`); continue; }
    const ap = apName(a.v);
    let hora = null;
    if (h) hora = toTime(typeof h.v === 'number' && h.v >= 1 ? h.v % 1 : h.v);
    if (h && !hora) issue('aviso', sh.name, where, `${ap}: la hora "${h.v}" no es válida; se cargó sin hora.`);
    let usuarios = null, util = null;
    if (u) { if (typeof u.v === 'number' && Number.isInteger(u.v) && u.v >= 0 && u.v <= 500) usuarios = u.v; else issue('error', sh.name, where, `${ap} (${fecha}): "${u.v}" no es un número de usuarios válido; se omitió.`); }
    if (c) {
      let x = c.v;
      if (typeof x === 'string') { const m = x.match(/^(\d+(?:[.,]\d+)?)\s*%*$/); x = m ? Number(m[1].replace(',', '.')) : NaN; if (Number.isFinite(x)) util = x; }
      else if (c.pct || x <= 1) util = Math.round(x * 10000) / 100;
      else { util = x; issue('aviso', sh.name, where, `${ap} (${fecha}): utilización "${x}" sin formato de porcentaje; se interpretó como ${x}%.`); }
      if (!Number.isFinite(util) || util < 0 || util > 100) { issue('error', sh.name, where, `${ap} (${fecha}): utilización "${c.v}" fuera de 0 a 100%; se omitió.`); util = null; }
    }
    if (usuarios === null && util === null) continue;
    const key = `${ap}|${fecha}|${hora || 'r' + r}`;
    if (seen.has(key)) { issue('error', sh.name, where, `${ap}: la lectura del ${fecha} a las ${hora} está repetida; se omitió la segunda.`); continue; }
    seen.add(key);
    const sede = s && typeof s.v === 'string' ? s.v.trim() : '';
    if (!groups.has(sede)) groups.set(sede, []);
    groups.get(sede).push({ ap, piso: apPiso(ap), fecha, hora, usuarios, util, byHora: true });
  }
  return [...groups].map(([sede, readings]) => ({ name: sede, sheet: sh.name, readings }));
}

function parseWorkbook(buf) {
  const { sheets, date1904 } = readXlsx(buf);
  const epoch = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 864e5 : 0);
  const toDate = (n) => new Date(epoch + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  const out = { sedes: [], issues: [] };
  const issue = (level, sede, where, msg) => out.issues.push({ level, sede, where, msg });

  for (const sh of sheets) {
    if (/instruc|resumen|cat[aá]logo|catalogo/i.test(plain(sh.name))) continue; // hojas de apoyo de la plantilla
    const flat = findHeader(sh);
    if (flat) { out.sedes.push(...parseFlat(sh, flat, toDate, issue).filter((g) => g.readings.length)); continue; }
    const get = (r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : undefined; };
    const cell = (r, c) => sh.cells.get(`${r},${c}`);
    const headers = [];
    for (const [k, x] of sh.cells) if (isDate(x.v)) { const [r, c] = k.split(',').map(Number); headers.push({ r, c, fecha: toDate(x.v) }); }
    if (!headers.length) continue; // hoja sin bloques de fechas: no es del reporte
    headers.sort((a, b) => a.c - b.c || a.r - b.r);
    // Fecha repetida en la misma columna: si el orden del archivo deja un día hábil sin bloque, se corrige y se avisa.
    const nextBiz = (iso, dir) => { const d = new Date(iso + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + dir); } while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); };
    const present = new Set(headers.map((x) => `${x.c}|${x.fecha}`));
    for (let i = 0; i + 1 < headers.length; i++) {
      const a1 = headers[i], b1 = headers[i + 1];
      if (a1.c !== b1.c || a1.fecha !== b1.fecha) continue;
      const before = headers[i - 1] && headers[i - 1].c === a1.c ? headers[i - 1].fecha : null;
      const after = headers[i + 2] && headers[i + 2].c === a1.c ? headers[i + 2].fecha : null;
      const desc = before ? before > a1.fecha : after ? after < a1.fecha : true;
      const target = desc ? a1 : b1;
      const cand = nextBiz(a1.fecha, 1);
      const limit = desc ? before : after;
      if (!present.has(`${a1.c}|${cand}`) && (!limit || cand < limit)) {
        issue('aviso', sedeName(sh.name), `${sh.name} fila ${target.r}`, `La fecha ${a1.fecha} aparece dos veces; por el orden del archivo, este bloque se tomó como ${cand}. Corrige la fecha en el Excel.`);
        target.fecha = cand; present.add(`${a1.c}|${cand}`);
      }
    }
    const name = sedeName(sh.name);
    const sede = { name, sheet: sh.name, days: new Map() };
    const seenBlocks = new Set();
    const knownAps = new Set(); const apCount = new Map();
    for (const x of sh.cells.values()) if (isAp(x.v)) { const n = apName(x.v); apCount.set(n, (apCount.get(n) || 0) + 1); }
    for (const [n, c] of apCount) if (c >= 3) knownAps.add(n);

    headers.forEach((h, i) => {
      const next = headers[i + 1] && headers[i + 1].c === h.c ? headers[i + 1].r : sh.maxRow + 1;
      // límite a la derecha: otro bloque que arranca en la misma fila
      const right = Math.min(...headers.filter((x) => x.c > h.c && Math.abs(x.r - h.r) <= 1).map((x) => x.c), h.c + MAX_READINGS + 1);
      const width = right - h.c - 1;
      // filas entre la fecha y el primer AP: ahí van las horas
      let first = h.r + 1;
      while (first < next && !isLabel(get(first, h.c))) first++;
      const times = [];
      for (let r = h.r; r < first; r++) for (let k = 1; k <= width; k++) { const t = toTime(get(r, h.c + k)); if (t && !times[k - 1] && !(r === h.r && isDate(get(r, h.c + k)))) times[k - 1] = t; }
      const block = { fecha: h.fecha, where: `${sh.name} fila ${h.r}`, times, aps: [] };
      let ap = null;
      const values = (r, kind) => {
        const arr = [];
        for (let k = 1; k <= width; k++) {
          const x = cell(r, h.c + k);
          if (!x) { arr.push(null); continue; }
          if (isLabel(x.v) || isDate(x.v)) break;
          arr.push({ ...x, kind, where: `${sh.name} fila ${r}` });
        }
        while (arr.length && arr[arr.length - 1] === null) arr.pop();
        return arr;
      };
      for (let r = first; r < next; r++) {
        const v = get(r, h.c);
        if (isAp(v)) { ap = { name: apName(v), users: [], util: [], row: r }; block.aps.push(ap); continue; }
        if (!ap) continue;
        if (isUsers(v)) { ap.users = values(r, 'u'); ap.usersRow = r; }
        else if (isUtil(v)) ap.util = values(r, 'c');
        else if (v === undefined && ap.usersRow === r - 1 && !ap.util.length) {
          const guess = values(r, 'c');
          if (guess.some((x) => x && typeof x.v === 'number')) { ap.util = guess; issue('aviso', name, `${sh.name} fila ${r}`, `${ap.name}: la fila de utilización no tiene etiqueta; se tomó por su posición.`); }
        }
      }
      if (!block.aps.length) return;
      // AP repetido dentro del mismo bloque. Dos casos:
      //  a) consecutivo mal escrito (…-01, …-01 en lugar de …-02): se corrige si el AP esperado existe en la hoja;
      //  b) la lista de AP vuelve a empezar: es otro día al que le falta la fecha.
      const blocks = [block];
      const names = new Set();
      const all = block.aps; block.aps = [];
      let cur = block;
      for (let idx = 0; idx < all.length; idx++) {
        const x = all[idx];
        if (!names.has(x.name)) { names.add(x.name); cur.aps.push(x); continue; }
        const prev = all[idx - 1];
        const mm = prev && prev.name.match(/^(.*-)(\d+)$/);
        const cand = mm ? mm[1] + String(Number(mm[2]) + 1).padStart(mm[2].length, '0') : null;
        if (cand && knownAps.has(cand) && !names.has(cand) && !all.some((y) => y.name === cand)) {
          issue('aviso', name, `${sh.name} fila ${x.row}`, `${x.name} aparece dos veces el ${cur.fecha || block.fecha}; por su posición se tomó como ${cand}. Corrige el nombre en el Excel.`);
          x.name = cand; names.add(cand); cur.aps.push(x); continue;
        }
        const nextH = headers[i + 1] && headers[i + 1].c === h.c ? headers[i + 1].fecha : null;
        const desc = nextH ? nextH < h.fecha : true;
        const guess = nextBiz(cur.fecha || h.fecha, desc ? -1 : 1);
        const free = !present.has(`${h.c}|${guess}`) && (!nextH || (desc ? guess > nextH : guess < nextH));
        if (free) { issue('aviso', name, `${sh.name} fila ${x.row}`, `Hay un bloque de lecturas sin fecha después del ${cur.fecha}; por el orden del archivo se tomó como ${guess}. Agrega la fecha en el Excel.`); present.add(`${h.c}|${guess}`); }
        else issue('error', name, `${sh.name} fila ${x.row}`, `Hay un bloque de lecturas sin fecha después del ${cur.fecha} y no se pudo deducir a qué día corresponde; se omitió.`);
        cur = { fecha: free ? guess : null, where: `${sh.name} fila ${x.row}`, times: [], aps: [x] };
        names.clear(); names.add(x.name);
        blocks.push(cur);
      }
      for (const b of blocks) {
        if (!b.fecha || !b.aps.length) continue;
        const dupAps = b.aps.filter((a) => seenBlocks.has(`${b.fecha}|${a.name}`));
        if (dupAps.length) { issue('error', name, b.where, `La fecha ${b.fecha} aparece dos veces para ${dupAps.length === b.aps.length ? 'los mismos AP' : dupAps.map((a) => a.name).join(', ')}. Se conservó el primer bloque y este se omitió: revisa cuál fecha es la correcta.`); continue; }
        b.aps.forEach((a) => seenBlocks.add(`${b.fecha}|${a.name}`));
        if (!sede.days.has(b.fecha)) sede.days.set(b.fecha, []);
        sede.days.get(b.fecha).push(b);
      }
    });

    // lecturas normalizadas
    sede.readings = [];
    for (const [fecha, blocks] of sede.days) {
      const dayTimes = blocks.map((b) => b.times).sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0] || [];
      for (const b of blocks) {
        const borrowed = !b.times.some(Boolean) && dayTimes.some(Boolean);
        for (const ap of b.aps) {
          const n = Math.max(ap.users.length, ap.util.length);
          if (!n) { issue('aviso', name, b.where, `${ap.name}: sin lecturas el ${fecha}.`); continue; }
          for (let i = 0; i < n; i++) {
            const u = ap.users[i], c = ap.util[i];
            let usuarios = null, util = null;
            if (u) {
              if (typeof u.v === 'number' && Number.isInteger(u.v) && u.v >= 0 && u.v <= 500) usuarios = u.v;
              else issue('error', name, u.where, `${ap.name} (${fecha}): "${u.v}" no es un número de usuarios válido; la lectura se omitió.`);
            }
            if (c) {
              let x = c.v;
              if (typeof x === 'string') { const m = x.match(/^(\d+(?:[.,]\d+)?)\s*%+$/); x = m ? Number(m[1].replace(',', '.')) : NaN; if (m) { util = x; issue('aviso', name, c.where, `${ap.name} (${fecha}): utilización escrita como texto "${c.v}"; se interpretó como ${x}%.`); } else issue('error', name, c.where, `${ap.name} (${fecha}): "${c.v}" no es una utilización válida; se omitió.`); }
              else if (c.pct || x < 1) util = Math.round(x * 10000) / 100;
              else { util = x; issue('aviso', name, c.where, `${ap.name} (${fecha}): utilización "${x}" sin formato de porcentaje; se interpretó como ${x}%.`); }
              if (util !== null && (util < 0 || util > 100)) { issue('error', name, c.where, `${ap.name} (${fecha}): utilización de ${util}% fuera de rango; se omitió.`); util = null; }
            }
            if (usuarios === null && util === null) continue;
            sede.readings.push({ ap: ap.name, piso: apPiso(ap.name), fecha, slot: i + 1, hora: (borrowed ? dayTimes[i] : b.times[i]) || null, usuarios, util });
          }
        }
      }
    }
    delete sede.days;
    if (sede.readings.length) out.sedes.push(sede);
  }
  if (!out.sedes.length) throw new Error('No se encontraron bloques con fecha, AP, "Usuarios" y "Utilización de canal". Revisa que el archivo sea la plantilla de captura (con lecturas en la hoja Captura) o el reporte de utilización de canal.');
  return out;
}
module.exports = { parseWorkbook, sedeName, apName, apPiso, plain };
