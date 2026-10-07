'use strict';
/*
 * Recorridos proactivos (captura diaria): sedes, pisos, áreas, pruebas, evidencias y OCR.
 * Las tablas se crean si no existen; no modifica las que ya tenía el portal.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const P = require('./public/js/pruebas.js');

const SSIDS = ['BBVA_GLOBAL', 'BBVA'];
const range = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => (a <= b ? a + i : a - i));
const SEDES = [
  { name: 'BBVA Polanco', pisos: [
    ...range(29, 8).map((n) => `Piso ${n}`), ...range(7, 1).map((n) => `Estacionamiento ${n}`),
    'Planta Baja', ...range(1, 9).map((n) => `Sótano -${n}`)] },
  { name: 'BBVA Reforma', pisos: [
    'Piso 53', ...range(50, 12).map((n) => `Piso ${n}`), 'Mezzanine 11',
    ...range(11, 3).map((n) => `Piso ${String(n).padStart(2, '0')}`),
    'Mezzanine 03', 'Mezzanine 02', 'Mezzanine 01', 'Planta Baja', ...range(1, 7).map((n) => `Sótano ${n}`)] },
  { name: 'BBVA Murano', pisos: ['Piso único'] },
  { name: 'BBVA Tecnoparque', pisos: ['Piso único'] },
  { name: 'BBVA Toreo', pisos: ['Piso único'] },
  { name: 'BBVA Guadalajara Landmark', pisos: [
    'Piso 1-1', 'Piso 2-1', 'Piso 2-2', 'Piso 10-1', 'Piso 10-2', 'Piso 11-1', 'Piso 11-2', 'Piso PH-1', 'Piso PH-2',
    'Piso PH2-1', 'Piso PH2-2', 'Piso PH3-1', 'Piso PH3-2', 'Piso PH4-1', 'Piso PH4-2', 'Sótano 6', 'Sótano 2', 'Sótano 3'] },
  { name: 'BBVA Tijuana', pisos: ['Sótano 4', 'Planta Baja', 'Piso 9', 'Piso 12', 'Piso 15', 'Piso 17', 'Piso 19', 'Piso 20'] },
];

/* ---------- normalización para evitar duplicados ---------- */
const plain = P.plain;
const tidy = (s) => String(s || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
const sedeKey = (s) => plain(s).replace(/\bbbva\b/g, '').replace(/[^a-z0-9]/g, '');
const areaKey = (s) => plain(s).replace(/[^a-z0-9]/g, '');
const pisoKey = (s) => plain(s).split(/[^a-z0-9]+/).filter(Boolean).map((t) => (/^\d+$/.test(t) ? String(Number(t)) : t)).join('-');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const similar = (a, b) => a !== b && Math.min(a.length, b.length) >= 4 &&
  (lev(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1) || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))));

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now, DATA_DIR } = ctx;
  const EVID_DIR = path.join(DATA_DIR, 'evidencias');
  fs.mkdirSync(EVID_DIR, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS sedes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pisos (id INTEGER PRIMARY KEY, sede_id INTEGER NOT NULL REFERENCES sedes(id),
      name TEXT NOT NULL, key TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, UNIQUE (sede_id, key));
    CREATE TABLE IF NOT EXISTS areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS recorridos (
      id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT NOT NULL,
      sede_id INTEGER NOT NULL REFERENCES sedes(id), piso_id INTEGER NOT NULL REFERENCES pisos(id),
      area_id INTEGER NOT NULL REFERENCES areas(id), ssid TEXT NOT NULL,
      ejecutor_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'en_curso', notas TEXT,
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS recorridos_fecha ON recorridos (fecha);
    CREATE TABLE IF NOT EXISTS recorrido_pruebas (
      id INTEGER PRIMARY KEY, recorrido_id INTEGER NOT NULL REFERENCES recorridos(id) ON DELETE CASCADE,
      test_key TEXT NOT NULL, vals TEXT NOT NULL DEFAULT '{}', source TEXT, review INTEGER NOT NULL DEFAULT 0,
      ocr_vals TEXT, ocr_text TEXT, ocr_conf REAL, ocr_notes TEXT,
      evidence_file TEXT, evidence_mime TEXT, na INTEGER NOT NULL DEFAULT 0, na_motivo TEXT,
      updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL,
      UNIQUE (recorrido_id, test_key)
    );
    CREATE TABLE IF NOT EXISTS recorrido_log (
      id INTEGER PRIMARY KEY, recorrido_id INTEGER NOT NULL, ts TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT
    );
  `);
  if (db.prepare('SELECT COUNT(*) AS n FROM sedes').get().n === 0) {
    const insS = db.prepare('INSERT INTO sedes (name, key, sort) VALUES (?,?,?)');
    const insP = db.prepare('INSERT OR IGNORE INTO pisos (sede_id, name, key, sort) VALUES (?,?,?,?)');
    SEDES.forEach((s, i) => {
      const id = Number(insS.run(s.name, sedeKey(s.name), i).lastInsertRowid);
      s.pisos.forEach((p, j) => insP.run(id, p, pisoKey(p), j));
    });
  }

  /* ---------- OCR con Tesseract (si está instalado en el servidor) ---------- */
  const ocr = { available: false, langs: 'eng' };
  execFile('tesseract', ['--list-langs'], { timeout: 8000 }, (err, stdout, stderr) => {
    if (err) { console.log('OCR no disponible: no se encontró Tesseract. Los resultados se capturan a mano.'); return; }
    const langs = String(stdout + stderr).split(/\r?\n/).map((l) => l.trim());
    ocr.available = true;
    ocr.langs = ['spa', 'eng'].filter((l) => langs.includes(l)).join('+') || 'eng';
    console.log(`OCR disponible (Tesseract, idiomas: ${ocr.langs}).`);
  });
  let queue = Promise.resolve();
  const runOcr = (file) => {
    const job = () => new Promise((resolve) => {
      if (!ocr.available) return resolve(null);
      execFile('tesseract', [file, 'stdout', '-l', ocr.langs, '--psm', '6', 'tsv'], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve(null);
        const lines = new Map(); let sum = 0; let n = 0;
        for (const row of String(stdout).split('\n').slice(1)) {
          const c = row.split('\t');
          if (c.length < 12 || c[0] !== '5') continue;
          const word = c.slice(11).join('\t').trim();
          const conf = Number(c[10]);
          if (!word) continue;
          const k = `${c[2]}-${c[3]}-${c[4]}`;
          lines.set(k, (lines.get(k) ? lines.get(k) + ' ' : '') + word);
          if (conf >= 0) { sum += conf; n += 1; }
        }
        resolve({ text: [...lines.values()].join('\n').slice(0, 20000), conf: n ? Math.round(sum / n) : 0 });
      });
    });
    const p = queue.then(job, job);
    queue = p.catch(() => {});
    return p;
  };

  /* ---------- utilidades ---------- */
  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const log = (rid, userId, action, detail) => db.prepare('INSERT INTO recorrido_log (recorrido_id, ts, user_id, action, detail) VALUES (?,?,?,?,?)')
    .run(rid, now(), userId ?? null, action, detail ? JSON.stringify(detail) : null);
  const userName = (id) => (id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || 'Usuario eliminado' : null);
  const text = (v, max, label, required) => {
    const s = tidy(typeof v === 'string' ? v : '');
    if (!s && required) throw new HttpError(400, `Falta el campo: ${label}.`);
    if (s.length > max) throw new HttpError(400, `${label}: máximo ${max} caracteres.`);
    return s;
  };
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'La imagen es demasiado grande (máximo 5 MB).')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function imageType(buf) {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
    if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    return null;
  }
  const removeFile = (name) => { if (name) fs.rm(path.join(EVID_DIR, path.basename(name)), { force: true }, () => {}); };

  /* ---------- catálogos ---------- */
  function catalog(user) {
    const pisos = db.prepare('SELECT id, sede_id AS sedeId, name FROM pisos ORDER BY sort, id').all();
    const out = {
      sedes: db.prepare('SELECT id, name FROM sedes ORDER BY sort, id').all().map((s) => ({ ...s, pisos: pisos.filter((p) => p.sedeId === s.id).map(({ id, name }) => ({ id, name })) })),
      areas: db.prepare('SELECT id, name FROM areas ORDER BY name COLLATE NOCASE').all(),
      ssids: SSIDS,
      ingenieros: db.prepare("SELECT id, name FROM users WHERE active = 1 AND role IN ('admin','ingeniero') ORDER BY name").all(),
      ocr: ocr.available,
    };
    if (user.role === 'admin') {
      let bytes = 0; let files = 0;
      for (const f of fs.readdirSync(EVID_DIR)) { try { bytes += fs.statSync(path.join(EVID_DIR, f)).size; files += 1; } catch { /* archivo en uso */ } }
      out.storage = { files, bytes };
    }
    return out;
  }
  /** Busca por nombre normalizado; si hay uno parecido pide confirmar antes de crear. */
  function resolveNamed(table, name, key, where, params, confirm, label) {
    const exact = db.prepare(`SELECT id, name FROM ${table} WHERE key = ? ${where}`).get(key, ...params);
    if (exact) return { row: exact, created: false };
    if (!key) throw new HttpError(400, `${label}: escribe un nombre válido.`);
    if (!confirm && table !== 'pisos') {
      const near = db.prepare(`SELECT id, name, key FROM ${table} WHERE 1=1 ${where}`).all(...params).filter((r) => similar(r.key, key));
      if (near.length) { const e = new HttpError(409, `${label}: ya existe un nombre parecido.`, 'similar'); e.extra = { field: table, suggestions: near.map(({ id, name: n }) => ({ id, name: n })) }; throw e; }
    }
    return { row: null, created: true };
  }
  function getOrCreateArea(name, confirm, user) {
    const clean = text(name, 80, 'Área', true);
    const key = areaKey(clean);
    const r = resolveNamed('areas', clean, key, '', [], confirm, 'Área');
    if (r.row) return r.row;
    const id = Number(db.prepare('INSERT INTO areas (name, key) VALUES (?,?)').run(clean, key).lastInsertRowid);
    audit(user.id, 'area_creada', { name: clean });
    return { id, name: clean };
  }

  /* ---------- lectura de recorridos ---------- */
  const SELECT = `SELECT r.id, r.fecha, r.hora, r.ssid, r.status, r.notas, r.created_at AS createdAt, r.updated_at AS updatedAt, r.completed_at AS completedAt,
      r.sede_id AS sedeId, s.name AS sede, r.piso_id AS pisoId, p.name AS piso, r.area_id AS areaId, a.name AS area,
      r.ejecutor_id AS ejecutorId, COALESCE(u.name, 'Usuario eliminado') AS ejecutor, r.created_by AS createdBy
    FROM recorridos r JOIN sedes s ON s.id = r.sede_id JOIN pisos p ON p.id = r.piso_id JOIN areas a ON a.id = r.area_id
    LEFT JOIN users u ON u.id = r.ejecutor_id`;
  const pruebaOut = (row, full) => ({
    id: row.id, values: JSON.parse(row.vals || '{}'), source: row.source, review: !!row.review, na: !!row.na, naMotivo: row.na_motivo,
    hasEvidence: !!row.evidence_file, updatedBy: row.updatedByName || null, updatedAt: row.updated_at,
    ...(full ? { ocrValues: row.ocr_vals ? JSON.parse(row.ocr_vals) : null, ocrConf: row.ocr_conf, ocrNotes: row.ocr_notes ? JSON.parse(row.ocr_notes) : [], ocrText: row.ocr_text || '' } : {}),
  });
  function attachPruebas(walks, full) {
    if (!walks.length) return walks;
    const ids = walks.map((w) => w.id);
    const rows = db.prepare(`SELECT rp.*, u.name AS updatedByName FROM recorrido_pruebas rp LEFT JOIN users u ON u.id = rp.updated_by
      WHERE rp.recorrido_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const by = new Map(walks.map((w) => [w.id, w]));
    for (const w of walks) w.pruebas = {};
    for (const r of rows) if (P.BY_KEY[r.test_key]) by.get(r.recorrido_id).pruebas[r.test_key] = pruebaOut(r, full);
    return walks;
  }
  function getWalk(id, full) {
    const w = db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(id));
    if (!w) throw new HttpError(404, 'El recorrido no existe.');
    attachPruebas([w], full);
    if (full) {
      w.log = db.prepare(`SELECT l.ts, l.action, l.detail, COALESCE(u.name, 'Sistema') AS user FROM recorrido_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.recorrido_id = ? ORDER BY l.id DESC LIMIT 300`).all(w.id).map((l) => ({ ...l, detail: l.detail ? JSON.parse(l.detail) : null }));
    }
    return w;
  }
  function missing(w) {
    const out = [];
    for (const t of P.TESTS) {
      const p = w.pruebas[t.key];
      if (p && p.na) continue;
      if (!p || !p.hasEvidence) { out.push({ test: t.key, label: t.label, reason: 'falta la evidencia' }); continue; }
      if (!P.hasRequired(t, p.values)) { out.push({ test: t.key, label: t.label, reason: 'faltan resultados' }); continue; }
      if (p.review) out.push({ test: t.key, label: t.label, reason: 'revisa la lectura del OCR' });
    }
    return out;
  }
  const mayEdit = (user, w) => user.role === 'admin' || (user.role === 'ingeniero' && w.ejecutorId === user.id);
  function requireEdit(user, w, allowComplete) {
    if (!mayEdit(user, w)) throw new HttpError(403, 'Solo el ejecutor del recorrido o un administrador puede modificarlo.');
    if (w.status === 'completo' && !allowComplete) throw new HttpError(409, 'El recorrido está marcado como completo. Reábrelo para modificarlo.');
  }
  const touch = (id) => db.prepare('UPDATE recorridos SET updated_at = ? WHERE id = ?').run(now(), id);

  function headerInput(body, user, prev) {
    if (!isDate(body.fecha)) throw new HttpError(400, 'Selecciona la fecha del recorrido.');
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    if (body.fecha > tomorrow) throw new HttpError(400, 'La fecha no puede ser futura.');
    if (body.fecha < '2024-01-01') throw new HttpError(400, 'La fecha es demasiado antigua.');
    if (!isTime(body.hora)) throw new HttpError(400, 'Escribe la hora en formato de 24 horas, por ejemplo 09:30.');
    if (!SSIDS.includes(body.ssid)) throw new HttpError(400, 'Selecciona el SSID: BBVA_GLOBAL o BBVA.');
    const piso = db.prepare('SELECT id, sede_id FROM pisos WHERE id = ?').get(Number(body.pisoId));
    if (!piso || piso.sede_id !== Number(body.sedeId)) throw new HttpError(400, 'Selecciona la sede y un piso de esa sede.');
    const area = getOrCreateArea(body.area, !!body.areaConfirm, user);
    let ejecutorId = prev ? prev.ejecutorId : user.id;
    if (body.ejecutorId !== undefined && body.ejecutorId !== null && Number(body.ejecutorId) !== ejecutorId) {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede asignar el recorrido a otro ingeniero.');
      const target = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role IN ('admin','ingeniero')").get(Number(body.ejecutorId));
      if (!target) throw new HttpError(400, 'El ingeniero seleccionado no existe o está desactivado.');
      ejecutorId = target.id;
    }
    return { fecha: body.fecha, hora: body.hora, ssid: body.ssid, sedeId: piso.sede_id, pisoId: piso.id, areaId: area.id, ejecutorId, notas: text(body.notas, 1000, 'Notas', false) || null };
  }

  function validateValues(test, input) {
    const fields = P.fieldsOf(test);
    const out = {};
    for (const f of fields) {
      const raw = input ? input[f.key] : undefined;
      if (raw === undefined || raw === null || raw === '') continue;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n) || n < (f.min ?? 0)) throw new HttpError(400, `${test.label} · ${f.label}: escribe un número válido.`);
      if (f.integer && !Number.isInteger(n)) throw new HttpError(400, `${test.label} · ${f.label}: debe ser un número entero.`);
      if (n > f.max) throw new HttpError(400, `${test.label} · ${f.label}: el valor es demasiado alto.`);
      out[f.key] = n;
    }
    for (const f of fields) {
      if (f.maxField && out[f.key] !== undefined && out[f.maxField] !== undefined && out[f.key] > out[f.maxField]) {
        throw new HttpError(400, `${test.label}: "${f.label}" no puede ser mayor que "${fields.find((x) => x.key === f.maxField).label}".`);
      }
    }
    return out;
  }
  const sameValues = (a, b) => { const ka = Object.keys(a || {}).sort(); const kb = Object.keys(b || {}).sort(); return ka.join() === kb.join() && ka.every((k) => a[k] === b[k]); };

  function listWalks(q) {
    const desde = isDate(q.get('desde')) ? q.get('desde') : '2000-01-01';
    const hasta = isDate(q.get('hasta')) ? q.get('hasta') : '2999-12-31';
    return attachPruebas(db.prepare(`${SELECT} WHERE r.fecha BETWEEN ? AND ? ORDER BY r.fecha DESC, r.hora DESC, r.id DESC LIMIT 2000`).all(desde, hasta), false);
  }
  const csvCell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /** Recorridos completos por semana, para el indicador "Recorridos por semana". */
  function weeklySummary() {
    const weeks = new Map();
    for (const r of db.prepare(`SELECT r.fecha, r.status, r.updated_at AS updatedAt, s.name AS sede FROM recorridos r JOIN sedes s ON s.id = r.sede_id`).all()) {
      const wk = mondayOf(r.fecha);
      const w = weeks.get(wk) || { week: wk, completos: 0, enCurso: 0, sedes: new Set(), updatedAt: r.updatedAt };
      if (r.status === 'completo') { w.completos += 1; w.sedes.add(r.sede.replace(/^BBVA\s+/i, '')); } else w.enCurso += 1;
      if (r.updatedAt > w.updatedAt) w.updatedAt = r.updatedAt;
      weeks.set(wk, w);
    }
    return [...weeks.values()].map((w) => ({ ...w, sedes: [...w.sedes].sort() }));
  }

  /* ---------- rutas ---------- */
  async function handle(req, res, url, user) {
    const p = url.pathname;
    const m = req.method;
    let mm;

    if (p === '/api/recorridos/catalogo' && m === 'GET') return send(res, 200, catalog(user)), true;

    if (p === '/api/sedes' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario no puede agregar sedes.');
      const body = await readJson(req);
      const name = text(body.name, 60, 'Sede', true);
      const r = resolveNamed('sedes', name, sedeKey(name), '', [], !!body.confirm, 'Sede');
      if (r.row) return send(res, 200, { sede: r.row, existed: true }), true;
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM sedes').get().n;
      const id = Number(db.prepare('INSERT INTO sedes (name, key, sort) VALUES (?,?,?)').run(name, sedeKey(name), sort).lastInsertRowid);
      audit(user.id, 'sede_creada', { name });
      return send(res, 200, { sede: { id, name }, existed: false }), true;
    }
    if (p === '/api/pisos' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario no puede agregar pisos.');
      const body = await readJson(req);
      const sede = db.prepare('SELECT id, name FROM sedes WHERE id = ?').get(Number(body.sedeId));
      if (!sede) throw new HttpError(400, 'Selecciona primero la sede.');
      const name = text(body.name, 40, 'Piso', true);
      const key = pisoKey(name);
      if (!key) throw new HttpError(400, 'Piso: escribe un nombre válido.');
      const exact = db.prepare('SELECT id, name FROM pisos WHERE sede_id = ? AND key = ?').get(sede.id, key);
      if (exact) return send(res, 200, { piso: exact, existed: true }), true;
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM pisos WHERE sede_id = ?').get(sede.id).n;
      const id = Number(db.prepare('INSERT INTO pisos (sede_id, name, key, sort) VALUES (?,?,?,?)').run(sede.id, name, key, sort).lastInsertRowid);
      audit(user.id, 'piso_creado', { sede: sede.name, name });
      return send(res, 200, { piso: { id, name }, existed: false }), true;
    }

    if (p === '/api/recorridos' && m === 'GET') return send(res, 200, { recorridos: listWalks(url.searchParams) }), true;

    if (p === '/api/recorridos/export.csv' && m === 'GET') {
      const walks = listWalks(url.searchParams).reverse();
      const head = ['Fecha', 'Hora', 'Sede', 'Piso', 'Área', 'SSID', 'Ejecutor', 'Estado'];
      const cols = [];
      for (const t of P.TESTS) {
        if (t.type === 'evidence') continue;
        for (const f of P.fieldsOf(t)) cols.push({ t, key: f.key, label: `${t.short} · ${f.label}${f.unit ? ` (${f.unit})` : ''}` });
        if (t.type === 'ping') cols.push({ t, key: 'perdida', label: `${t.short} · % pérdida` });
        cols.push({ t, key: '_nivel', label: `${t.short} · nivel` }, { t, key: '_fuente', label: `${t.short} · captura` });
      }
      const rows = [[...head, ...cols.map((c) => c.label)]];
      for (const w of walks) {
        const row = [w.fecha, w.hora, w.sede, w.piso, w.area, w.ssid, w.ejecutor, w.status === 'completo' ? 'Completo' : 'En curso'];
        for (const c of cols) {
          const pr = w.pruebas[c.t.key];
          if (!pr) { row.push(''); continue; }
          if (pr.na) { row.push(c.key === '_nivel' ? 'No aplica' : ''); continue; }
          const ev = P.evaluate(c.t, pr.values);
          if (c.key === '_nivel') { const lv = P.worst(ev.map((e) => e.level)); row.push(lv ? P.LEVELS[lv].label : ''); }
          else if (c.key === '_fuente') row.push({ ocr: 'OCR', ocr_editado: 'OCR corregido', manual: 'Manual' }[pr.source] || '');
          else { const e = ev.find((x) => x.key === c.key); row.push(e ? e.value : ''); }
        }
        rows.push(row);
      }
      return send(res, 200, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="recorridos-proactivos.csv"' }), true;
    }

    if (p === '/api/recorridos' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar recorridos.');
      const h = headerInput(await readJson(req), user, null);
      const id = Number(db.prepare(`INSERT INTO recorridos (fecha, hora, sede_id, piso_id, area_id, ssid, ejecutor_id, notas, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(h.fecha, h.hora, h.sedeId, h.pisoId, h.areaId, h.ssid, h.ejecutorId, h.notas, user.id, now(), now()).lastInsertRowid);
      log(id, user.id, 'creado', { ejecutor: userName(h.ejecutorId), enNombreDeOtro: h.ejecutorId !== user.id });
      audit(user.id, 'recorrido_creado', { id, fecha: h.fecha });
      return send(res, 200, { id }), true;
    }

    if ((mm = p.match(/^\/api\/evidencias\/(\d+)$/)) && m === 'GET') {
      const row = db.prepare('SELECT evidence_file, evidence_mime FROM recorrido_pruebas WHERE id = ?').get(Number(mm[1]));
      if (!row || !row.evidence_file) throw new HttpError(404, 'La evidencia no existe.');
      const file = path.join(EVID_DIR, path.basename(row.evidence_file));
      if (!fs.existsSync(file)) throw new HttpError(404, 'El archivo de evidencia ya no está en el servidor.');
      res.writeHead(200, { 'Content-Type': row.evidence_mime || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      fs.createReadStream(file).pipe(res);
      return true;
    }

    if (!(mm = p.match(/^\/api\/recorridos\/(\d+)(?:\/(.+))?$/))) return false;
    const id = Number(mm[1]);
    const sub = mm[2] || '';

    if (!sub && m === 'GET') return send(res, 200, { recorrido: getWalk(id, true), faltantes: missing(getWalk(id, false)) }), true;

    const w = getWalk(id, false);

    if (!sub && m === 'PUT') {
      requireEdit(user, w);
      const h = headerInput(await readJson(req), user, w);
      db.prepare('UPDATE recorridos SET fecha=?, hora=?, sede_id=?, piso_id=?, area_id=?, ssid=?, ejecutor_id=?, notas=?, updated_at=? WHERE id=?')
        .run(h.fecha, h.hora, h.sedeId, h.pisoId, h.areaId, h.ssid, h.ejecutorId, h.notas, now(), id);
      if (h.ejecutorId !== w.ejecutorId) {
        log(id, user.id, 'reasignado', { de: w.ejecutor, a: userName(h.ejecutorId) });
        audit(user.id, 'recorrido_reasignado', { id, de: w.ejecutor, a: userName(h.ejecutorId) });
      }
      const after = getWalk(id, false);
      const changes = ['fecha', 'hora', 'sede', 'piso', 'area', 'ssid'].filter((k) => w[k] !== after[k]).map((k) => ({ campo: k, antes: w[k], despues: after[k] }));
      if (changes.length) log(id, user.id, 'datos_editados', { cambios: changes });
      return send(res, 200, { ok: true }), true;
    }
    if (!sub && m === 'DELETE') {
      if (!(user.role === 'admin' || (mayEdit(user, w) && w.status !== 'completo'))) throw new HttpError(403, 'Solo un administrador puede eliminar un recorrido completo.');
      for (const r of db.prepare('SELECT evidence_file FROM recorrido_pruebas WHERE recorrido_id = ?').all(id)) removeFile(r.evidence_file);
      db.prepare('DELETE FROM recorrido_pruebas WHERE recorrido_id = ?').run(id);
      db.prepare('DELETE FROM recorridos WHERE id = ?').run(id);
      log(id, user.id, 'eliminado', { fecha: w.fecha, sede: w.sede, piso: w.piso, ejecutor: w.ejecutor });
      audit(user.id, 'recorrido_eliminado', { id, fecha: w.fecha, sede: w.sede, ejecutor: w.ejecutor });
      return send(res, 200, { ok: true }), true;
    }
    if (sub === 'completar' && m === 'POST') {
      requireEdit(user, w);
      const falta = missing(w);
      if (falta.length) { const e = new HttpError(400, `Faltan ${falta.length} pruebas por completar.`, 'incompleto'); e.extra = { faltantes: falta }; throw e; }
      db.prepare("UPDATE recorridos SET status = 'completo', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
      log(id, user.id, 'completado');
      return send(res, 200, { ok: true }), true;
    }
    if (sub === 'reabrir' && m === 'POST') {
      requireEdit(user, w, true);
      db.prepare("UPDATE recorridos SET status = 'en_curso', completed_at = NULL, updated_at = ? WHERE id = ?").run(now(), id);
      log(id, user.id, 'reabierto');
      return send(res, 200, { ok: true }), true;
    }

    if (sub === 'evidencias' && m === 'POST') {
      requireEdit(user, w);
      const buf = await readRaw(req, 5 * 1024 * 1024);
      const type = imageType(buf);
      if (!type) throw new HttpError(400, 'El archivo no es una imagen JPG, PNG o WEBP.');
      const asked = url.searchParams.get('test');
      if (asked && !P.BY_KEY[asked]) throw new HttpError(400, 'La prueba indicada no existe.');
      const name = `${id}-${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
      const file = path.join(EVID_DIR, name);
      await fs.promises.writeFile(file, buf);
      try {
        const needOcr = !asked || P.BY_KEY[asked].type !== 'evidence';
        const read = needOcr ? await runOcr(file) : null;
        const parsed = read ? P.parse(read.text, asked || undefined) : { detected: null, test: asked || null, values: {}, doubts: [], complete: false };
        let key = asked || parsed.test;
        if (!key && parsed.detected === 'speed') key = ['speedtest1', 'speedtest2'].find((k) => !(w.pruebas[k] && (w.pruebas[k].hasEvidence || w.pruebas[k].na))) || null;
        if (!key) {
          await fs.promises.rm(file, { force: true });
          return send(res, 200, { unclassified: true, ocr: !!read, detected: parsed.detected }), true;
        }
        const test = P.BY_KEY[key];
        const prev = db.prepare('SELECT * FROM recorrido_pruebas WHERE recorrido_id = ? AND test_key = ?').get(id, key);
        const prevVals = prev ? JSON.parse(prev.vals || '{}') : {};
        const got = Object.keys(parsed.values).length > 0;
        const notes = [...(parsed.doubts || [])];
        if (read && read.conf < 70 && got) notes.push(`la imagen se leyó con poca confianza (${read.conf}%)`);
        if (asked && parsed.detected && P.BY_KEY[parsed.detected] && parsed.detected !== asked) notes.push(`la imagen parece corresponder a "${P.BY_KEY[parsed.detected].label}"`);
        if (got && !P.hasRequired(test, parsed.values)) notes.push('no se pudieron leer todos los resultados');
        let vals = prevVals; let source = prev ? prev.source : null; let review = prev ? prev.review : 0;
        if (test.type !== 'evidence' && got) { vals = parsed.values; source = 'ocr'; review = notes.length ? 1 : 0; }
        else if (test.type !== 'evidence' && !Object.keys(prevVals).length) { source = 'manual'; review = 0; }
        const args = [JSON.stringify(vals), source, review, got ? JSON.stringify(parsed.values) : null, read ? read.text : null, read ? read.conf : null, JSON.stringify(notes), name, type.mime, user.id, now()];
        if (prev) {
          db.prepare(`UPDATE recorrido_pruebas SET vals=?, source=?, review=?, ocr_vals=?, ocr_text=?, ocr_conf=?, ocr_notes=?, evidence_file=?, evidence_mime=?, na=0, na_motivo=NULL, updated_by=?, updated_at=? WHERE id=?`).run(...args, prev.id);
          removeFile(prev.evidence_file);
        } else {
          db.prepare(`INSERT INTO recorrido_pruebas (vals, source, review, ocr_vals, ocr_text, ocr_conf, ocr_notes, evidence_file, evidence_mime, updated_by, updated_at, recorrido_id, test_key)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...args, id, key);
        }
        touch(id);
        log(id, user.id, 'evidencia_cargada', { prueba: test.label, lectura: test.type === 'evidence' ? 'solo evidencia' : got ? 'OCR' : 'manual pendiente', valores: got ? parsed.values : undefined, reemplazo: !!(prev && prev.evidence_file) });
        return send(res, 200, { test: key, classified: !asked, read: got, complete: P.hasRequired(test, vals), notes, ocr: !!read, replaced: !!(prev && prev.evidence_file) }), true;
      } catch (err) {
        if (!db.prepare('SELECT 1 FROM recorrido_pruebas WHERE evidence_file = ?').get(name)) await fs.promises.rm(file, { force: true });
        throw err;
      }
    }

    if ((mm = sub.match(/^pruebas\/([a-z0-9_]+)$/))) {
      const test = P.BY_KEY[mm[1]];
      if (!test) throw new HttpError(404, 'La prueba no existe.');
      requireEdit(user, w);
      const prev = db.prepare('SELECT * FROM recorrido_pruebas WHERE recorrido_id = ? AND test_key = ?').get(id, test.key);
      if (m === 'PUT') {
        const body = await readJson(req);
        if (body.na) {
          const motivo = text(body.naMotivo, 200, 'Motivo', true);
          if (motivo.length < 5) throw new HttpError(400, 'Explica en pocas palabras por qué no aplica la prueba.');
          if (prev) { db.prepare("UPDATE recorrido_pruebas SET na=1, na_motivo=?, vals='{}', source=NULL, review=0, evidence_file=NULL, evidence_mime=NULL, updated_by=?, updated_at=? WHERE id=?").run(motivo, user.id, now(), prev.id); removeFile(prev.evidence_file); }
          else db.prepare('INSERT INTO recorrido_pruebas (recorrido_id, test_key, na, na_motivo, updated_by, updated_at) VALUES (?,?,1,?,?,?)').run(id, test.key, motivo, user.id, now());
          log(id, user.id, 'prueba_no_aplica', { prueba: test.label, motivo });
        } else {
          const vals = validateValues(test, body.values);
          const prevVals = prev ? JSON.parse(prev.vals || '{}') : {};
          const ocrVals = prev && prev.ocr_vals ? JSON.parse(prev.ocr_vals) : null;
          const source = ocrVals ? (sameValues(vals, ocrVals) ? 'ocr' : 'ocr_editado') : 'manual';
          if (prev) db.prepare('UPDATE recorrido_pruebas SET vals=?, source=?, review=0, na=0, na_motivo=NULL, updated_by=?, updated_at=? WHERE id=?').run(JSON.stringify(vals), source, user.id, now(), prev.id);
          else db.prepare('INSERT INTO recorrido_pruebas (recorrido_id, test_key, vals, source, updated_by, updated_at) VALUES (?,?,?,?,?,?)').run(id, test.key, JSON.stringify(vals), source, user.id, now());
          if (!sameValues(vals, prevVals) || (prev && prev.review)) {
            log(id, user.id, prev && prev.review && sameValues(vals, prevVals) ? 'lectura_confirmada' : 'resultado_capturado', { prueba: test.label, captura: { ocr: 'OCR', ocr_editado: 'OCR corregido', manual: 'manual' }[source], antes: Object.keys(prevVals).length ? prevVals : undefined, despues: vals });
          }
        }
        touch(id);
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (prev) { db.prepare('DELETE FROM recorrido_pruebas WHERE id = ?').run(prev.id); removeFile(prev.evidence_file); log(id, user.id, 'prueba_borrada', { prueba: test.label, valores: JSON.parse(prev.vals || '{}') }); touch(id); }
        return send(res, 200, { ok: true }), true;
      }
    }
    return false;
  }

  return { handle, weeklySummary };
};
