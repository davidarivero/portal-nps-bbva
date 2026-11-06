'use strict';
/*
 * Debugging periódico de firmware: análisis previo de Known Issues, registro de actualizaciones y reportes de fallos.
 * Los indicadores semanales de la iniciativa (defectos activos y fallas evaluadas) se calculan solos con los reportes.
 * Tablas nuevas; no modifica las existentes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./public/js/firmware-comun.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now, DATA_DIR } = ctx;
  const EVID_DIR = path.join(DATA_DIR, 'firmware');
  fs.mkdirSync(EVID_DIR, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS fw_analisis (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, responsable_id INTEGER REFERENCES users(id),
      modelo TEXT NOT NULL, fw_actual TEXT NOT NULL, fw_objetivo TEXT NOT NULL, referencias TEXT, liga TEXT, problemas_actuales TEXT,
      sin_issues INTEGER NOT NULL DEFAULT 0, issues TEXT NOT NULL DEFAULT '[]', puntaje INTEGER NOT NULL DEFAULT 0, aplicables INTEGER NOT NULL DEFAULT 0,
      decision TEXT NOT NULL, piloto_aprobado INTEGER NOT NULL DEFAULT 0, piloto_nota TEXT, piloto_por INTEGER REFERENCES users(id), piloto_ts TEXT,
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fw_actualizaciones (
      id INTEGER PRIMARY KEY, analisis_id INTEGER REFERENCES fw_analisis(id), excepcion TEXT, sede TEXT NOT NULL, fecha TEXT NOT NULL,
      responsable_id INTEGER REFERENCES users(id), folio TEXT, modelo TEXT NOT NULL, alcance INTEGER NOT NULL, fw_actual TEXT NOT NULL, fw_objetivo TEXT NOT NULL,
      ventana_inicio TEXT, ventana_fin TEXT, checklist TEXT NOT NULL DEFAULT '{}', notas_previas TEXT, hora_inicio TEXT, hora_fin TEXT,
      actualizados INTEGER NOT NULL DEFAULT 0, fallidos INTEGER NOT NULL DEFAULT 0, incidentes TEXT, disponibilidad REAL, conectividad TEXT,
      impacto_post TEXT, impacto_post_notas TEXT, notas_finales TEXT, resultado TEXT NOT NULL, evidencia_file TEXT, evidencia_mime TEXT, evidencia_nombre TEXT,
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fw_reportes (
      id INTEGER PRIMARY KEY, actualizacion_id INTEGER REFERENCES fw_actualizaciones(id), sede TEXT NOT NULL, fecha TEXT NOT NULL,
      firmware TEXT NOT NULL, modelo TEXT, categoria TEXT NOT NULL, subtipo TEXT, patron TEXT NOT NULL, severidad TEXT NOT NULL, estado TEXT NOT NULL,
      impacto TEXT NOT NULL, alcance TEXT NOT NULL, alcance_detalle TEXT, sintoma TEXT NOT NULL, reproduccion TEXT, evidencia TEXT, mitigacion TEXT,
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fw_reportes_fecha ON fw_reportes(fecha);
    CREATE TABLE IF NOT EXISTS fw_reportes_hist (
      id INTEGER PRIMARY KEY, reporte_id INTEGER NOT NULL REFERENCES fw_reportes(id) ON DELETE CASCADE, ts TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), estado TEXT, nota TEXT
    );
  `);

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const today = () => new Date().toISOString().slice(0, 10);
  const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const txt = (v, max) => { const t = String(v === null || v === undefined ? '' : v).trim(); return t ? t.slice(0, max) : null; };
  const line = (v, max) => { const t = txt(v, max); return t ? t.replace(/\s+/g, ' ') : null; };
  const need = (v, msg) => { if (v === null || v === undefined || v === '') throw new HttpError(400, msg); return v; };
  const int = (v, min, max, msg) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, msg); return n; };
  const sede = (k) => { if (!C.SEDE[k]) throw new HttpError(400, 'Selecciona la sede.'); return k; };
  const owner = (body, user) => {
    const id = Number(body.responsableId || user.id);
    if (id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede registrar a nombre de otra persona.');
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(id)) throw new HttpError(400, 'El responsable seleccionado no existe.');
    return id;
  };
  const canEdit = (user, row) => user.role === 'admin' || (user.role === 'ingeniero' && row.created_by === user.id);
  const linkable = (a) => a && (a.decision === 'migrar' || (a.decision === 'piloto' && a.piloto_aprobado));

  /* ---------- lectura ---------- */
  function datos() {
    const analisis = db.prepare(`SELECT a.*, u.name AS responsable, p.name AS piloto_por_nombre FROM fw_analisis a LEFT JOIN users u ON u.id = a.responsable_id LEFT JOIN users p ON p.id = a.piloto_por ORDER BY a.fecha DESC, a.id DESC`).all()
      .map((a) => ({ id: a.id, sede: a.sede, fecha: a.fecha, responsableId: a.responsable_id, responsable: a.responsable, modelo: a.modelo, fwActual: a.fw_actual, fwObjetivo: a.fw_objetivo,
        referencias: a.referencias, liga: a.liga, problemasActuales: a.problemas_actuales, sinIssues: !!a.sin_issues, issues: JSON.parse(a.issues || '[]'), puntaje: a.puntaje, aplicables: a.aplicables,
        decision: a.decision, pilotoAprobado: !!a.piloto_aprobado, pilotoNota: a.piloto_nota, pilotoPor: a.piloto_por_nombre, pilotoTs: a.piloto_ts, vinculable: !!linkable(a), createdBy: a.created_by,
        usos: db.prepare('SELECT COUNT(*) AS n FROM fw_actualizaciones WHERE analisis_id = ?').get(a.id).n }));
    const actualizaciones = db.prepare(`SELECT x.*, u.name AS responsable FROM fw_actualizaciones x LEFT JOIN users u ON u.id = x.responsable_id ORDER BY x.fecha DESC, x.id DESC`).all()
      .map((x) => ({ id: x.id, analisisId: x.analisis_id, excepcion: x.excepcion, sede: x.sede, fecha: x.fecha, responsableId: x.responsable_id, responsable: x.responsable, folio: x.folio, modelo: x.modelo,
        alcance: x.alcance, fwActual: x.fw_actual, fwObjetivo: x.fw_objetivo, ventanaInicio: x.ventana_inicio, ventanaFin: x.ventana_fin, checklist: JSON.parse(x.checklist || '{}'), notasPrevias: x.notas_previas,
        horaInicio: x.hora_inicio, horaFin: x.hora_fin, actualizados: x.actualizados, fallidos: x.fallidos, incidentes: x.incidentes, disponibilidad: x.disponibilidad, conectividad: x.conectividad,
        impactoPost: x.impacto_post, impactoPostNotas: x.impacto_post_notas, notasFinales: x.notas_finales, resultado: x.resultado, evidencia: x.evidencia_file ? x.evidencia_nombre || 'evidencia' : null, createdBy: x.created_by }));
    const hist = db.prepare('SELECT h.reporte_id, h.ts, h.estado, h.nota, u.name AS user FROM fw_reportes_hist h LEFT JOIN users u ON u.id = h.user_id ORDER BY h.id').all();
    const reportes = db.prepare(`SELECT r.*, u.name AS autor FROM fw_reportes r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.fecha DESC, r.id DESC`).all()
      .map((r) => ({ id: r.id, actualizacionId: r.actualizacion_id, sede: r.sede, fecha: r.fecha, firmware: r.firmware, modelo: r.modelo, categoria: r.categoria, subtipo: r.subtipo, patron: r.patron,
        severidad: r.severidad, estado: r.estado, impacto: r.impacto, alcance: r.alcance, alcanceDetalle: r.alcance_detalle, sintoma: r.sintoma, reproduccion: r.reproduccion, evidencia: r.evidencia,
        mitigacion: r.mitigacion, autor: r.autor, createdBy: r.created_by, updatedAt: r.updated_at,
        historial: hist.filter((h) => h.reporte_id === r.id).map((h) => ({ ts: h.ts, estado: h.estado, nota: h.nota, user: h.user || 'Sistema' })) }));
    return { hoy: today(), analisis, actualizaciones, reportes, ingenieros: db.prepare("SELECT id, name FROM users WHERE role IN ('admin','ingeniero') AND active = 1 ORDER BY name").all() };
  }

  /* ---------- indicadores semanales ---------- */
  function weeklySummary() {
    const reps = db.prepare('SELECT id, fecha, estado, created_at FROM fw_reportes').all();
    if (!reps.length) return [];
    const hist = db.prepare('SELECT reporte_id, ts, estado FROM fw_reportes_hist WHERE estado IS NOT NULL ORDER BY id').all();
    const byRep = new Map(); hist.forEach((h) => { if (!byRep.has(h.reporte_id)) byRep.set(h.reporte_id, []); byRep.get(h.reporte_id).push(h); });
    const first = mondayOf(reps.reduce((m, r) => (r.fecha < m ? r.fecha : m), reps[0].fecha));
    const last = mondayOf(today());
    const out = [];
    for (let w = first; w <= last; w = C.addDays(w, 7)) {
      const end = C.addDays(w, 6), endTs = end + 'T23:59:59.999Z';
      let identificadas = 0, evaluadas = 0, activos = 0, nuevas = 0;
      for (const r of reps) {
        if (r.fecha > end) continue;
        identificadas += 1; if (r.fecha >= w) nuevas += 1;
        // estado al cierre de la semana; si el cambio se hizo después, cuenta el estado que tenía entonces
        const hs = (byRep.get(r.id) || []).filter((h) => h.ts <= endTs);
        const st = hs.length ? hs[hs.length - 1].estado : (byRep.get(r.id) || [])[0]?.estado || r.estado;
        if (st !== 'nuevo') evaluadas += 1;
        if (C.ESTADO[st] && C.ESTADO[st].abierto) activos += 1;
      }
      out.push({ week: w, defectos_activos: activos, fallas_identificadas: identificadas, fallas_evaluadas: evaluadas, nuevas, updatedAt: now() });
    }
    return out;
  }

  /* ---------- validación ---------- */
  function analisisInput(body, user) {
    const issues = Array.isArray(body.issues) ? body.issues.slice(0, 40).map((i) => ({
      descripcion: line(i.descripcion, 300), severidad: C.SEV_KI[i.severidad] ? i.severidad : 'bajo', aplica: ['si', 'no', 'pendiente'].includes(i.aplica) ? i.aplica : 'pendiente', referencia: line(i.referencia, 300),
    })).filter((i) => i.descripcion) : [];
    const sinIssues = !!body.sinIssues;
    if (!sinIssues && !issues.length) throw new HttpError(400, 'Agrega al menos un Known Issue o marca que no se detectaron Known Issues relevantes.');
    const ev = C.evaluar(sinIssues ? [] : issues, sinIssues);
    if (ev.decision === 'pendiente') throw new HttpError(400, 'Valida si cada Known Issue aplica a nuestros modelos antes de guardar el análisis.');
    const fecha = need(isDate(body.fecha) && body.fecha <= today() ? body.fecha : null, 'Selecciona la fecha del análisis (no puede ser futura).');
    return {
      sede: sede(body.sede), fecha, responsable_id: owner(body, user), modelo: need(line(body.modelo, 40), 'Escribe el modelo de AP.').toUpperCase(),
      fw_actual: need(line(body.fwActual, 40), 'Escribe el firmware actual.'), fw_objetivo: need(line(body.fwObjetivo, 40), 'Escribe el firmware objetivo.'),
      referencias: need(txt(body.referencias, 4000), 'Escribe el resumen de Known Issues o la referencia del fabricante.'), liga: /^https?:\/\//i.test(body.liga || '') ? line(body.liga, 500) : null,
      problemas_actuales: txt(body.problemasActuales, 4000), sin_issues: sinIssues ? 1 : 0, issues: JSON.stringify(sinIssues ? [] : issues), puntaje: ev.puntaje, aplicables: ev.aplicables, decision: ev.decision,
    };
  }

  function actualizacionInput(body, user) {
    const alcance = int(body.alcance, 1, 5000, 'Escribe cuántos AP incluye el alcance (1 o más).');
    const actualizados = int(body.actualizados ?? 0, 0, 5000, 'Los AP actualizados deben ser un número entero.');
    const fallidos = int(body.fallidos ?? 0, 0, 5000, 'Los AP con error o pendientes deben ser un número entero.');
    if (actualizados + fallidos > alcance) throw new HttpError(400, `Los AP actualizados más los AP con error (${actualizados + fallidos}) no pueden superar el alcance de ${alcance} AP.`);
    const resultado = need(C.RESULTADO[body.resultado] ? body.resultado : null, 'Selecciona el resultado final.');
    if (!isTime(body.ventanaInicio) || !isTime(body.ventanaFin)) throw new HttpError(400, 'Escribe el horario de inicio y fin de la ventana de mantenimiento.');
    let disponibilidad = null;
    if (body.disponibilidad !== '' && body.disponibilidad !== null && body.disponibilidad !== undefined) {
      disponibilidad = Number(body.disponibilidad);
      if (!Number.isFinite(disponibilidad) || disponibilidad < 0 || disponibilidad > 100) throw new HttpError(400, 'La disponibilidad debe estar entre 0 y 100 %.');
    }
    const check = {};
    for (const fase of ['pre', 'durante', 'post']) for (const [k] of C.CHECK[fase]) check[k] = !!(body.checklist && body.checklist[k]);
    const instalada = C.RESULTADO[resultado].instalada;
    const out = {
      sede: sede(body.sede), fecha: need(isDate(body.fecha) && body.fecha <= today() ? body.fecha : null, 'Selecciona la fecha de la intervención (no puede ser futura).'),
      responsable_id: owner(body, user), folio: line(body.folio, 60), modelo: need(line(body.modelo, 40), 'Escribe el modelo de AP.').toUpperCase(), alcance,
      fw_actual: need(line(body.fwActual, 40), 'Escribe el firmware actual.'), fw_objetivo: need(line(body.fwObjetivo, 40), 'Escribe el firmware objetivo.'),
      ventana_inicio: body.ventanaInicio, ventana_fin: body.ventanaFin, checklist: JSON.stringify(check), notas_previas: txt(body.notasPrevias, 2000),
      hora_inicio: isTime(body.horaInicio) ? body.horaInicio : null, hora_fin: isTime(body.horaFin) ? body.horaFin : null, actualizados, fallidos, incidentes: txt(body.incidentes, 2000),
      disponibilidad, conectividad: C.CONECTIVIDAD.includes(body.conectividad) ? body.conectividad : null,
      impacto_post: instalada && C.IMPACTO_POST.some((i) => i.key === body.impactoPost) ? body.impactoPost : null, impacto_post_notas: instalada ? txt(body.impactoPostNotas, 2000) : null,
      notas_finales: txt(body.notasFinales, 2000), resultado,
    };
    // análisis previo: obligatorio y coincidente; solo un administrador puede registrar una excepción justificada
    const a = body.analisisId ? db.prepare('SELECT * FROM fw_analisis WHERE id = ?').get(Number(body.analisisId)) : null;
    if (a) {
      if (!linkable(a)) throw new HttpError(400, 'El análisis seleccionado no recomienda migrar. Solo se vinculan análisis con recomendación de migrar o con piloto aprobado.');
      if (a.sede !== out.sede || a.modelo.toUpperCase() !== out.modelo || a.fw_objetivo !== out.fw_objetivo) throw new HttpError(400, 'El análisis debe coincidir con la sede, el modelo de AP y el firmware objetivo de la actualización.');
      out.analisis_id = a.id; out.excepcion = null;
    } else {
      if (user.role !== 'admin') throw new HttpError(400, 'Selecciona un análisis previo aprobado. Sin análisis, solo un administrador puede registrar la actualización como excepción.');
      out.analisis_id = null; out.excepcion = need(line(body.excepcion, 500), 'Escribe la justificación de la excepción (actualización sin análisis previo).');
    }
    return out;
  }

  function reporteInput(body) {
    const cat = C.CATEGORIA[body.categoria];
    if (!cat) throw new HttpError(400, 'Selecciona el tipo de reporte.');
    let actualizacion = null;
    if (body.actualizacionId) {
      actualizacion = db.prepare('SELECT id FROM fw_actualizaciones WHERE id = ?').get(Number(body.actualizacionId));
      if (!actualizacion) throw new HttpError(400, 'La actualización relacionada no existe.');
    }
    return {
      actualizacion_id: actualizacion ? actualizacion.id : null, sede: sede(body.sede),
      fecha: need(isDate(body.fecha) && body.fecha <= today() ? body.fecha : null, 'Selecciona la fecha de detección (no puede ser futura).'),
      firmware: need(line(body.firmware, 40), 'Escribe la versión de firmware.'), modelo: line(body.modelo, 40) ? line(body.modelo, 40).toUpperCase() : null,
      categoria: cat.key, subtipo: cat.subtipos.includes(body.subtipo) || body.subtipo === 'Otro punto de verificación' ? body.subtipo : null,
      patron: need(line(body.patron, 160), 'Escribe el patrón corto del fallo.'), severidad: need(C.SEVERIDAD[body.severidad] ? body.severidad : null, 'Selecciona la severidad.'),
      estado: need(C.ESTADO[body.estado] ? body.estado : null, 'Selecciona el estado de investigación.'),
      impacto: need(C.IMPACTOS.includes(body.impacto) ? body.impacto : null, 'Selecciona la categoría de impacto.'),
      alcance: need(C.ALCANCES.includes(body.alcance) ? body.alcance : null, 'Selecciona el alcance de la afectación.'), alcance_detalle: line(body.alcanceDetalle, 300),
      sintoma: need(txt(body.sintoma, 3000), 'Describe el síntoma y su impacto.'), reproduccion: txt(body.reproduccion, 3000), evidencia: txt(body.evidencia, 3000), mitigacion: txt(body.mitigacion, 3000),
    };
  }

  const insert = (table, row) => { const k = Object.keys(row); return Number(db.prepare(`INSERT INTO ${table} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...k.map((x) => row[x])).lastInsertRowid); };
  const update = (table, id, row) => { const k = Object.keys(row); db.prepare(`UPDATE ${table} SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...k.map((x) => row[x]), id); };
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 5 MB).')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
    });
  }
  function fileType(buf) {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
    if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    if (buf.length > 5 && buf.subarray(0, 5).toString() === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
    return null;
  }
  const removeFile = (name) => { if (name) fs.rm(path.join(EVID_DIR, path.basename(name)), { force: true }, () => {}); };

  /* ---------- CSV ---------- */
  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(res, name, head, rows) {
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.end('﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n'));
    return true;
  }
  const sedeN = (k) => (C.SEDE[k] ? C.SEDE[k].name : k);

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/firmware')) return false;
    let mm;
    if (p === '/api/firmware/datos' && m === 'GET') return send(res, 200, datos()), true;

    /* ----- análisis ----- */
    if (p === '/api/firmware/analisis' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar análisis.');
      const row = analisisInput(await readJson(req), user);
      const ts = now();
      const id = insert('fw_analisis', { ...row, created_by: user.id, created_at: ts, updated_at: ts });
      audit(user.id, 'firmware_analisis_registrado', { id, sede: row.sede, modelo: row.modelo, objetivo: row.fw_objetivo, decision: row.decision });
      return send(res, 200, { id, decision: row.decision }), true;
    }
    if ((mm = p.match(/^\/api\/firmware\/analisis\/(\d+)(\/piloto)?$/))) {
      const a = db.prepare('SELECT * FROM fw_analisis WHERE id = ?').get(Number(mm[1]));
      if (!a) throw new HttpError(404, 'El análisis no existe.');
      if (mm[2] && m === 'POST') {
        if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede aprobar el resultado del piloto.');
        if (a.decision !== 'piloto') throw new HttpError(400, 'Solo los análisis que requieren piloto se aprueban por esta vía.');
        const body = await readJson(req);
        const ok = !!body.aprobado;
        const nota = need(line(body.nota, 600), 'Escribe el resultado del piloto o laboratorio.');
        update('fw_analisis', a.id, { piloto_aprobado: ok ? 1 : 0, piloto_nota: nota, piloto_por: user.id, piloto_ts: now(), updated_at: now() });
        audit(user.id, 'firmware_piloto', { id: a.id, aprobado: ok, nota });
        return send(res, 200, { ok: true }), true;
      }
      if (!mm[2] && m === 'DELETE') {
        if (!canEdit(user, a)) throw new HttpError(403, 'Solo quien registró el análisis o un administrador puede eliminarlo.');
        if (db.prepare('SELECT 1 FROM fw_actualizaciones WHERE analisis_id = ?').get(a.id)) throw new HttpError(400, 'El análisis ya está vinculado a una actualización; no se puede eliminar.');
        db.prepare('DELETE FROM fw_analisis WHERE id = ?').run(a.id);
        audit(user.id, 'firmware_analisis_eliminado', { id: a.id, sede: a.sede, objetivo: a.fw_objetivo });
        return send(res, 200, { ok: true }), true;
      }
    }

    /* ----- actualizaciones ----- */
    if (p === '/api/firmware/actualizaciones' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar actualizaciones.');
      const row = actualizacionInput(await readJson(req), user);
      const ts = now();
      const id = insert('fw_actualizaciones', { ...row, created_by: user.id, created_at: ts, updated_at: ts });
      audit(user.id, 'firmware_actualizacion_registrada', { id, sede: row.sede, objetivo: row.fw_objetivo, resultado: row.resultado, excepcion: !!row.excepcion });
      return send(res, 200, { id }), true;
    }
    if ((mm = p.match(/^\/api\/firmware\/actualizaciones\/(\d+)(\/evidencia)?$/))) {
      const x = db.prepare('SELECT * FROM fw_actualizaciones WHERE id = ?').get(Number(mm[1]));
      if (!x) throw new HttpError(404, 'La actualización no existe.');
      if (mm[2] && m === 'GET') {
        if (!x.evidencia_file) throw new HttpError(404, 'La actualización no tiene evidencia.');
        const file = path.join(EVID_DIR, path.basename(x.evidencia_file));
        if (!fs.existsSync(file)) throw new HttpError(404, 'El archivo de evidencia ya no está en el servidor.');
        res.writeHead(200, { 'Content-Type': x.evidencia_mime || 'application/octet-stream', 'Content-Disposition': `inline; filename="${String(x.evidencia_nombre || 'evidencia').replace(/[^\w.-]+/g, '_')}"`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        fs.createReadStream(file).pipe(res);
        return true;
      }
      if (mm[2] && m === 'POST') {
        if (!canEdit(user, x)) throw new HttpError(403, 'Solo quien registró la actualización o un administrador puede subir su evidencia.');
        const buf = await readRaw(req, 5 * 1024 * 1024);
        const type = fileType(buf);
        if (!type) throw new HttpError(400, 'La evidencia debe ser una imagen (JPG, PNG o WEBP) o un PDF.');
        const name = `act-${x.id}-${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
        await fs.promises.writeFile(path.join(EVID_DIR, name), buf);
        removeFile(x.evidencia_file);
        update('fw_actualizaciones', x.id, { evidencia_file: name, evidencia_mime: type.mime, evidencia_nombre: line(url.searchParams.get('nombre'), 120) || `evidencia.${type.ext}`, updated_at: now() });
        audit(user.id, 'firmware_evidencia', { actualizacion: x.id, bytes: buf.length });
        return send(res, 200, { ok: true }), true;
      }
      if (!mm[2] && m === 'DELETE') {
        if (!canEdit(user, x)) throw new HttpError(403, 'Solo quien registró la actualización o un administrador puede eliminarla.');
        db.prepare('UPDATE fw_reportes SET actualizacion_id = NULL WHERE actualizacion_id = ?').run(x.id);
        db.prepare('DELETE FROM fw_actualizaciones WHERE id = ?').run(x.id);
        removeFile(x.evidencia_file);
        audit(user.id, 'firmware_actualizacion_eliminada', { id: x.id, sede: x.sede, objetivo: x.fw_objetivo });
        return send(res, 200, { ok: true }), true;
      }
    }

    /* ----- reportes de fallos ----- */
    if (p === '/api/firmware/reportes' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar reportes.');
      const row = reporteInput(await readJson(req));
      const ts = now();
      const id = insert('fw_reportes', { ...row, created_by: user.id, created_at: ts, updated_by: user.id, updated_at: ts });
      db.prepare('INSERT INTO fw_reportes_hist (reporte_id, ts, user_id, estado, nota) VALUES (?, ?, ?, ?, ?)').run(id, ts, user.id, row.estado, 'Reporte registrado');
      const rec = C.recurrencias(db.prepare('SELECT id, fecha, categoria, patron, sede FROM fw_reportes').all(), today()).find((g) => g.ids.includes(id));
      audit(user.id, 'firmware_reporte_registrado', { id, sede: row.sede, severidad: row.severidad, patron: row.patron });
      return send(res, 200, { id, recurrencia: rec && rec.n >= C.RECURRENCIA.reportes ? rec.n : 0 }), true;
    }
    if ((mm = p.match(/^\/api\/firmware\/reportes\/(\d+)$/))) {
      const r = db.prepare('SELECT * FROM fw_reportes WHERE id = ?').get(Number(mm[1]));
      if (!r) throw new HttpError(404, 'El reporte no existe.');
      if (m === 'PUT') {
        if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede actualizar reportes.');
        const body = await readJson(req);
        const estado = C.ESTADO[body.estado] ? body.estado : r.estado;
        const nota = txt(body.nota, 2000);
        const mitigacion = body.mitigacion !== undefined ? txt(body.mitigacion, 3000) : r.mitigacion;
        if (estado === r.estado && !nota && mitigacion === r.mitigacion) throw new HttpError(400, 'No hay cambios que guardar.');
        const ts = now();
        update('fw_reportes', r.id, { estado, mitigacion, updated_by: user.id, updated_at: ts });
        db.prepare('INSERT INTO fw_reportes_hist (reporte_id, ts, user_id, estado, nota) VALUES (?, ?, ?, ?, ?)').run(r.id, ts, user.id, estado !== r.estado ? estado : null, nota);
        audit(user.id, 'firmware_reporte_seguimiento', { id: r.id, antes: r.estado, despues: estado });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (!canEdit(user, r)) throw new HttpError(403, 'Solo quien registró el reporte o un administrador puede eliminarlo.');
        db.prepare('DELETE FROM fw_reportes_hist WHERE reporte_id = ?').run(r.id);
        db.prepare('DELETE FROM fw_reportes WHERE id = ?').run(r.id);
        audit(user.id, 'firmware_reporte_eliminado', { id: r.id, patron: r.patron });
        return send(res, 200, { ok: true }), true;
      }
    }

    /* ----- exportación ----- */
    if ((mm = p.match(/^\/api\/firmware\/export\/(analisis|actualizaciones|reportes)\.csv$/)) && m === 'GET') {
      const D = datos();
      if (mm[1] === 'analisis') return csv(res, 'firmware-analisis.csv',
        ['Fecha', 'Sede', 'Responsable', 'Modelo AP', 'Firmware actual', 'Firmware objetivo', 'Known Issues aplicables', 'Puntaje', 'Recomendación', 'Piloto aprobado', 'Resultado del piloto', 'Known Issues (descripción · severidad · aplica)', 'Referencias', 'Liga', 'Problemas de la versión actual'],
        D.analisis.map((a) => [a.fecha, sedeN(a.sede), a.responsable, a.modelo, a.fwActual, a.fwObjetivo, a.aplicables, a.puntaje, C.DECISIONES[a.decision].label, a.pilotoAprobado ? 'Sí' : '', a.pilotoNota,
          a.sinIssues ? 'Sin Known Issues relevantes' : a.issues.map((i) => `${i.descripcion} · ${C.SEV_KI[i.severidad].label} · ${C.APLICA.find((x) => x.key === i.aplica).label}`).join(' | '), a.referencias, a.liga, a.problemasActuales]));
      if (mm[1] === 'actualizaciones') return csv(res, 'firmware-actualizaciones.csv',
        ['Fecha', 'Sede', 'Responsable', 'Folio', 'Modelo AP', 'AP en alcance', 'Firmware actual', 'Firmware objetivo', 'Ventana', 'Análisis previo', 'Excepción', 'Checklist antes', 'Checklist durante', 'Checklist después', 'AP actualizados', 'AP con error o pendientes', 'Éxito %', 'Disponibilidad %', 'Prueba de conectividad', 'Resultado', 'Incidentes', 'Impacto posterior', 'Detalle del impacto', 'Observaciones finales', 'Reportes de fallo vinculados'],
        D.actualizaciones.map((x) => {
          const a = D.analisis.find((y) => y.id === x.analisisId);
          const ck = (f) => `${C.CHECK[f].filter(([k]) => x.checklist[k]).length}/${C.CHECK[f].length}`;
          return [x.fecha, sedeN(x.sede), x.responsable, x.folio, x.modelo, x.alcance, x.fwActual, x.fwObjetivo, `${x.ventanaInicio || ''}–${x.ventanaFin || ''}`, a ? `${a.fecha} · ${C.DECISIONES[a.decision].short}` : '', x.excepcion,
            ck('pre'), ck('durante'), ck('post'), x.actualizados, x.fallidos, x.alcance ? Math.round((x.actualizados / x.alcance) * 1000) / 10 : '', x.disponibilidad, x.conectividad, C.RESULTADO[x.resultado].label, x.incidentes,
            x.impactoPost ? C.IMPACTO_POST.find((i) => i.key === x.impactoPost).label : '', x.impactoPostNotas, x.notasFinales, D.reportes.filter((r) => r.actualizacionId === x.id).length];
        }));
      return csv(res, 'firmware-reportes-de-fallos.csv',
        ['Fecha', 'Sede', 'Firmware', 'Modelo AP', 'Actualización vinculada', 'Días desde la actualización', 'Tipo de reporte', 'Subtipo', 'Patrón', 'Severidad', 'Estado', 'Categoría de impacto', 'Alcance', 'Área, piso o equipos', 'Síntoma e impacto', 'Pasos para reproducir', 'Evidencia', 'Mitigación', 'Registró', 'Última actualización'],
        D.reportes.map((r) => {
          const x = D.actualizaciones.find((y) => y.id === r.actualizacionId);
          return [r.fecha, sedeN(r.sede), r.firmware, r.modelo, x ? `${x.fecha} · ${x.fwActual} → ${x.fwObjetivo}` : '', x ? C.diasEntre(x.fecha, r.fecha) : '', C.CATEGORIA[r.categoria].label, r.subtipo, r.patron,
            C.SEVERIDAD[r.severidad].label, C.ESTADO[r.estado].label, r.impacto, r.alcance, r.alcanceDetalle, r.sintoma, r.reproduccion, r.evidencia, r.mitigacion, r.autor, r.updatedAt ? r.updatedAt.slice(0, 10) : ''];
        }));
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  return { handle, weeklySummary };
};
