'use strict';
/*
 * Encuestas a usuarios finales: experiencia WiFi en Polanco y Reforma.
 * Meta: 100 encuestas por día hábil (50 por sede) durante 4 semanas. Tablas nuevas; no modifica las existentes.
 */
const P = require('./public/js/encuestas-comun.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;

  db.exec(`
    CREATE TABLE IF NOT EXISTS enc_encuestas (
      id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, hora TEXT, sede_id INTEGER NOT NULL REFERENCES sedes(id), piso_id INTEGER REFERENCES pisos(id),
      referencia TEXT, encuestador_id INTEGER REFERENCES users(id), resultado TEXT NOT NULL,
      cumple INTEGER, comentario TEXT, inconveniente TEXT, inconveniente_otro TEXT, frecuencia TEXT, actividad TEXT, actividad_otro TEXT, regreso TEXT,
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS enc_fecha ON enc_encuestas(fecha);
  `);

  // La iniciativa se agrega una sola vez (las demás vienen del documento base).
  // Se llama al arrancar, después de sembrar la base (en una base nueva, primero van las 6 iniciativas del documento).
  function ensure() {
    if (db.prepare("SELECT 1 FROM initiatives WHERE slug = 'encuestas'").get()) return;
    if (!db.prepare('SELECT COUNT(*) AS n FROM initiatives').get().n) return;
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM initiatives').get().n;
    db.prepare('INSERT INTO initiatives (slug, sort, def) VALUES (?,?,?)').run('encuestas', sort, JSON.stringify(P.INICIATIVA));
    audit(null, 'iniciativa_creada', { slug: 'encuestas' });
  }

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const today = () => { const d = new Date(Date.now() - 6 * 3600e3); return d.toISOString().slice(0, 10); }; // hora del centro de México
  const mondayOf = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const txt = (v, max) => { const t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
  const ini = () => db.prepare("SELECT id, def FROM initiatives WHERE slug = 'encuestas'").get();

  /** Sedes del levantamiento (Polanco y Reforma) con sus pisos, tomadas del catálogo de recorridos. */
  function sedes() {
    return db.prepare('SELECT id, name FROM sedes ORDER BY sort, id').all()
      .filter((s) => P.SEDES.some((k) => P.plain(s.name).includes(k)))
      .map((s) => ({ ...s, meta: P.META.porSede, pisos: db.prepare('SELECT id, name FROM pisos WHERE sede_id = ? ORDER BY sort, id').all(s.id) }));
  }
  function config() {
    const row = ini(); const def = row ? JSON.parse(row.def) : {};
    const first = db.prepare("SELECT MIN(fecha) AS f FROM enc_encuestas WHERE resultado = 'completa'").get().f;
    const inicio = (def.levantamiento && def.levantamiento.inicio) || first || null;
    return { inicio, fin: inicio ? P.finDe(inicio) : null, definido: !!(def.levantamiento && def.levantamiento.inicio), ...P.META };
  }

  const COLS = `e.id, e.fecha, e.hora, e.sede_id AS sedeId, s.name AS sede, e.piso_id AS pisoId, p.name AS piso, e.referencia, e.encuestador_id AS encuestadorId, u.name AS encuestador,
    e.resultado, e.cumple, e.comentario, e.inconveniente, e.inconveniente_otro AS inconvenienteOtro, e.frecuencia, e.actividad, e.actividad_otro AS actividadOtro, e.regreso, e.created_by AS createdBy, e.created_at AS createdAt`;
  const FROM = 'FROM enc_encuestas e JOIN sedes s ON s.id = e.sede_id LEFT JOIN pisos p ON p.id = e.piso_id LEFT JOIN users u ON u.id = e.encuestador_id';
  function list(desde, hasta) { return db.prepare(`SELECT ${COLS} ${FROM} WHERE e.fecha BETWEEN ? AND ? ORDER BY e.fecha, e.hora, e.id`).all(desde, hasta); }

  function validate(body, user) {
    const sede = sedes().find((s) => s.id === Number(body.sedeId));
    if (!sede) throw new HttpError(400, 'Selecciona la sede (Polanco o Reforma).');
    if (!isDate(body.fecha) || body.fecha > today()) throw new HttpError(400, 'La fecha de la encuesta no es válida.');
    const piso = body.pisoId ? sede.pisos.find((x) => x.id === Number(body.pisoId)) : null;
    if (!piso) throw new HttpError(400, 'Selecciona el piso.');
    const resultado = P.RESULTADOS.find((r) => r.key === body.resultado);
    if (!resultado) throw new HttpError(400, 'Indica si el usuario aceptó la encuesta.');
    const out = { fecha: body.fecha, hora: /^\d{2}:\d{2}$/.test(body.hora || '') ? body.hora : null, sedeId: sede.id, pisoId: piso.id, referencia: txt(body.referencia, 120),
      resultado: resultado.key, cumple: null, comentario: null, inconveniente: null, inconvenienteOtro: null, frecuencia: null, actividad: null, actividadOtro: null, regreso: txt(body.regreso, 120) };
    if (resultado.key === 'completa') {
      if (body.cumple !== true && body.cumple !== false) throw new HttpError(400, 'Falta la respuesta a la pregunta 1.');
      out.cumple = body.cumple ? 1 : 0;
      out.comentario = txt(body.comentario, 1000);
      if (!body.cumple) {
        const opt = (list, v, label) => { if (!list.some((o) => o.key === v)) throw new HttpError(400, `Falta la respuesta: ${label}.`); return v; };
        out.inconveniente = opt(P.INCONVENIENTES, body.inconveniente, 'principal inconveniente');
        out.inconvenienteOtro = out.inconveniente === 'otro' ? txt(body.inconvenienteOtro, 200) : null;
        if (out.inconveniente === 'otro' && !out.inconvenienteOtro) throw new HttpError(400, 'Describe el otro inconveniente.');
        out.frecuencia = opt(P.FRECUENCIAS, body.frecuencia, 'frecuencia');
        out.actividad = opt(P.ACTIVIDADES, body.actividad, 'tipo de actividad');
        out.actividadOtro = out.actividad === 'otro' ? txt(body.actividadOtro, 200) : null;
      }
    }
    let encuestador = user.id;
    if (body.encuestadorId && Number(body.encuestadorId) !== user.id) {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede registrar a nombre de otra persona.');
      if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(Number(body.encuestadorId))) throw new HttpError(400, 'El encuestador no existe.');
      encuestador = Number(body.encuestadorId);
    }
    out.encuestadorId = encuestador;
    return out;
  }

  function weeklySummary() {
    const weeks = new Map();
    for (const r of db.prepare("SELECT e.fecha, e.cumple, e.updated_at AS u, s.name AS sede FROM enc_encuestas e JOIN sedes s ON s.id = e.sede_id WHERE e.resultado = 'completa'").all()) {
      const wk = mondayOf(r.fecha);
      const w = weeks.get(wk) || { week: wk, encuestas: 0, satisfechos: 0, porSede: {}, updatedAt: r.u };
      w.encuestas += 1; if (r.cumple) w.satisfechos += 1;
      const k = r.sede.replace(/^BBVA\s+/i, ''); w.porSede[k] = (w.porSede[k] || 0) + 1;
      if (r.u > w.updatedAt) w.updatedAt = r.u;
      weeks.set(wk, w);
    }
    return [...weeks.values()];
  }

  const csv = (res, name, head, rows) => {
    const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.end('﻿' + [head.join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n'));
  };

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/encuestas')) return false;
    let mm;
    const qd = (k, d) => (isDate(url.searchParams.get(k)) ? url.searchParams.get(k) : d);

    if (p === '/api/encuestas/catalogo' && m === 'GET') {
      return send(res, 200, { sedes: sedes(), config: config(), hoy: today(),
        encuestadores: db.prepare("SELECT id, name FROM users WHERE role IN ('admin','ingeniero') AND active = 1 ORDER BY name").all() }), true;
    }
    if (p === '/api/encuestas' && m === 'GET') {
      const c = config();
      const desde = qd('desde', c.inicio || today()), hasta = qd('hasta', today());
      return send(res, 200, { desde, hasta, encuestas: list(desde, hasta) }), true;
    }
    if (p === '/api/encuestas' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar encuestas.');
      const v = validate(await readJson(req), user); const ts = now();
      const id = Number(db.prepare(`INSERT INTO enc_encuestas (fecha, hora, sede_id, piso_id, referencia, encuestador_id, resultado, cumple, comentario, inconveniente, inconveniente_otro, frecuencia, actividad, actividad_otro, regreso, created_by, created_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.fecha, v.hora, v.sedeId, v.pisoId, v.referencia, v.encuestadorId, v.resultado, v.cumple, v.comentario, v.inconveniente, v.inconvenienteOtro, v.frecuencia, v.actividad, v.actividadOtro, v.regreso, user.id, ts, user.id, ts).lastInsertRowid);
      audit(user.id, 'encuesta_registrada', { id, resultado: v.resultado, fecha: v.fecha });
      const hoy = db.prepare("SELECT s.name AS sede, COUNT(*) AS n FROM enc_encuestas e JOIN sedes s ON s.id = e.sede_id WHERE e.fecha = ? AND e.resultado = 'completa' GROUP BY s.name").all(v.fecha);
      const mias = db.prepare("SELECT COUNT(*) AS n FROM enc_encuestas WHERE fecha = ? AND resultado = 'completa' AND encuestador_id = ?").get(v.fecha, v.encuestadorId).n;
      return send(res, 200, { id, hoy, mias }), true;
    }
    if ((mm = p.match(/^\/api\/encuestas\/(\d+)$/)) && m === 'DELETE') {
      const e = db.prepare('SELECT * FROM enc_encuestas WHERE id = ?').get(Number(mm[1]));
      if (!e) throw new HttpError(404, 'La encuesta no existe.');
      if (!(user.role === 'admin' || (user.role === 'ingeniero' && e.created_by === user.id && e.fecha === today()))) throw new HttpError(403, 'Solo puedes borrar tus encuestas del día; las anteriores las borra un administrador.');
      db.prepare('DELETE FROM enc_encuestas WHERE id = ?').run(e.id);
      audit(user.id, 'encuesta_eliminada', { id: e.id, fecha: e.fecha });
      return send(res, 200, { ok: true }), true;
    }
    if (p === '/api/encuestas/config' && m === 'PUT') {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador cambia la fecha de inicio.');
      const body = await readJson(req);
      if (body.inicio !== null && !isDate(body.inicio)) throw new HttpError(400, 'Fecha de inicio no válida.');
      const row = ini(); const def = JSON.parse(row.def);
      def.levantamiento = { ...(def.levantamiento || {}), inicio: body.inicio };
      db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(def), row.id);
      audit(user.id, 'encuestas_inicio', { inicio: body.inicio });
      return send(res, 200, { ok: true, config: config() }), true;
    }

    // ---------- reportes para BBVA (CSV) ----------
    const c = config(); const desde = qd('desde', c.inicio || today()), hasta = qd('hasta', today());
    const sedeF = url.searchParams.get('sede'); const rows = list(desde, hasta).filter((e) => !sedeF || String(e.sedeId) === sedeF);
    const lab = (arr, k) => (arr.find((x) => x.key === k) || {}).label || '';
    const tag = `${desde}_a_${hasta}`;
    if (p === '/api/encuestas/reportes/respuestas.csv' && m === 'GET') {
      return csv(res, `encuestas-respuestas-${tag}.csv`, ['Fecha', 'Hora', 'Sede', 'Piso', 'Referencia', 'Encuestador', 'Resultado del contacto', '¿Cumple expectativas?', 'Principal inconveniente', 'Frecuencia', 'Actividad afectada', 'Comentario o sugerencia'],
        rows.map((e) => [e.fecha, e.hora, e.sede, e.piso, e.referencia, e.encuestador, lab(P.RESULTADOS, e.resultado), e.cumple === null ? '' : e.cumple ? 'Sí' : 'No',
          e.inconveniente === 'otro' ? `Otro: ${e.inconvenienteOtro}` : lab(P.INCONVENIENTES, e.inconveniente), lab(P.FRECUENCIAS, e.frecuencia),
          e.actividad === 'otro' ? `Otro: ${e.actividadOtro || ''}` : lab(P.ACTIVIDADES, e.actividad), e.comentario])), true;
    }
    if (p === '/api/encuestas/reportes/avance.csv' && m === 'GET') {
      const S = sedes(); const days = P.diasHabiles(desde, hasta);
      return csv(res, `encuestas-avance-diario-${tag}.csv`, ['Fecha', ...S.flatMap((s) => [`${s.name} realizadas`, `${s.name} meta`]), 'Total realizadas', 'Meta del día', 'Cumplimiento %', 'Satisfechos %'],
        days.map((d) => { const l = rows.filter((e) => e.fecha === d && e.resultado === 'completa'); const per = S.map((s) => l.filter((e) => e.sedeId === s.id).length);
          return [d, ...per.flatMap((n) => [n, P.META.porSede]), l.length, P.META.porDia, Math.round((l.length / P.META.porDia) * 100), l.length ? Math.round((l.filter((e) => e.cumple).length / l.length) * 100) : '']; })), true;
    }
    if (p === '/api/encuestas/reportes/comentarios.csv' && m === 'GET') {
      const l = rows.filter((e) => e.comentario || e.inconvenienteOtro || e.actividadOtro);
      return csv(res, `encuestas-comentarios-${tag}.csv`, ['Fecha', 'Sede', 'Piso', 'Referencia', '¿Cumple expectativas?', 'Comentario', 'Otro inconveniente', 'Otra actividad'],
        l.map((e) => [e.fecha, e.sede, e.piso, e.referencia, e.cumple ? 'Sí' : 'No', e.comentario, e.inconvenienteOtro, e.actividadOtro])), true;
    }
    if (p === '/api/encuestas/reportes/pisos.csv' && m === 'GET') {
      const g = new Map();
      rows.filter((e) => e.resultado === 'completa').forEach((e) => { const k = `${e.sede}|${e.piso}`; const x = g.get(k) || { sede: e.sede, piso: e.piso, n: 0, no: 0, inc: {} }; x.n += 1; if (!e.cumple) { x.no += 1; x.inc[e.inconveniente] = (x.inc[e.inconveniente] || 0) + 1; } g.set(k, x); });
      return csv(res, `encuestas-por-piso-${tag}.csv`, ['Sede', 'Piso', 'Encuestas', 'No cumple expectativas', '% insatisfechos', 'Inconveniente más mencionado'],
        [...g.values()].sort((a, b) => b.no / b.n - a.no / a.n).map((x) => { const top = Object.entries(x.inc).sort((a, b) => b[1] - a[1])[0]; return [x.sede, x.piso, x.n, x.no, Math.round((x.no / x.n) * 100), top ? lab(P.INCONVENIENTES, top[0]) : '']; })), true;
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  return { handle, weeklySummary, ensure };
};
