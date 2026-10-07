'use strict';
/* Lector mínimo de archivos .xlsx (ZIP + XML) sin dependencias. Devuelve las celdas con valor de cada hoja. */
const zlib = require('node:zlib');

function unzip(buf, wanted, limit = 80 * 1024 * 1024) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un Excel .xlsx válido.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map(); let total = 0;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: limit }) : null;
    if (!data) throw new Error('El archivo usa una compresión no compatible.');
    total += data.length;
    if (total > limit) throw new Error('El archivo es demasiado grande.');
    out.set(name, data.toString('utf8'));
  }
  return out;
}
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e) => (e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
const colNum = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n; };

/** @returns {{sheets: {name: string, cells: Map<string, {v: number|string, pct: boolean}>, maxRow: number, maxCol: number}[], date1904: boolean}} */
function readXlsx(buf) {
  const files = unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const wb = files.get('xl/workbook.xml');
  if (!wb) throw new Error('El archivo no es un libro de Excel .xlsx.');
  const rels = new Map([...(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const strings = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].replace(/<rPh>[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  // estilos con formato de porcentaje
  const styles = files.get('xl/styles.xml') || '';
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [attr(m[0], 'numFmtId'), attr(m[0], 'formatCode') || '']));
  const xfs = ((styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '').match(/<xf\b[^>]*>/g) || [];
  const pctStyle = xfs.map((x) => { const id = attr(x, 'numFmtId'); return id === '9' || id === '10' || (custom.get(id) || '').includes('%'); });

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const target = rels.get(attr(m[0], 'r:id')) || '';
    const xml = files.get('xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    if (!xml || attr(m[0], 'state') === 'hidden') continue;
    const cells = new Map(); let maxRow = 0, maxCol = 0;
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (c[2] === undefined) continue;
      const ref = attr(c[1], 'r'); if (!ref) continue;
      const t = attr(c[1], 't');
      const raw = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let v;
      if (t === 's') v = strings[Number(raw)];
      else if (t === 'inlineStr') v = decode([...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (t === 'str') v = raw === undefined ? undefined : decode(raw);
      else if (t === 'b' || t === 'e') continue;
      else if (raw !== undefined && raw !== '') { v = Number(raw); if (!Number.isFinite(v)) continue; }
      if (v === undefined || v === '') continue;
      if (typeof v === 'string') { v = v.trim(); if (!v) continue; }
      const row = Number(ref.replace(/^[A-Z]+/, '')), col = colNum(ref);
      cells.set(`${row},${col}`, { v, pct: !!pctStyle[Number(attr(c[1], 's') || 0)] });
      if (row > maxRow) maxRow = row; if (col > maxCol) maxCol = col;
    }
    sheets.push({ name, cells, maxRow, maxCol });
  }
  return { sheets, date1904: /date1904="(1|true)"/.test(wb) };
}
module.exports = { readXlsx };
