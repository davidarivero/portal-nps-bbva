'use strict';
/*
 * Monitoreo proactivo de indicadores clave 2.0: conexiones diarias a BBVA_GLOBAL y BBVA por sede, con el universo
 * en investigación (fallidos que no son ID Authentication 12303) atendido caso por caso.
 * Tablas nuevas; no modifica las existentes.
 */
const C = require('./public/js/conexiones-comun.js');
const { readXlsx } = require('./xlsx-lite.js');

module.exports = function init(ctx) {
  const { db, HttpError, send, readJson, audit, now } = ctx;

  db.exec(`
    CREATE TABLE IF NOT EXISTS cx_cargas (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER REFERENCES users(id), tipo TEXT NOT NULL, archivo TEXT, resumen TEXT
    );
    CREATE TABLE IF NOT EXISTS cx_lecturas (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, ssid TEXT NOT NULL,
      dispositivos INTEGER NOT NULL, exitosos INTEGER NOT NULL, fallidos INTEGER NOT NULL, auth12303 INTEGER NOT NULL,
      carga_id INTEGER REFERENCES cx_cargas(id), created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL, UNIQUE (sede, fecha, ssid)
    );
    CREATE TABLE IF NOT EXISTS cx_casos (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, ssid TEXT, username TEXT, nombre TEXT, dispositivo TEXT, ap TEXT,
      causa TEXT, codigo TEXT, estado TEXT NOT NULL, accion TEXT, comentario TEXT, ingeniero_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cx_casos_hist (
      id INTEGER PRIMARY KEY, caso_id INTEGER NOT NULL REFERENCES cx_casos(id) ON DELETE CASCADE, ts TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id), estado TEXT, nota TEXT
    );
    CREATE TABLE IF NOT EXISTS cx_dispositivos (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, mac TEXT NOT NULL, tipo TEXT NOT NULL, codigo TEXT, log_ise TEXT, categoria TEXT,
      identidad TEXT, usuario TEXT, equipo TEXT, fabricante TEXT, so TEXT, fallos INTEGER, tipos TEXT, motivo TEXT, aps TEXT, primer TEXT, ultimo TEXT, ultima_ok TEXT,
      recuperado INTEGER NOT NULL DEFAULT 0, carga_id INTEGER REFERENCES cx_cargas(id), UNIQUE (sede, fecha, mac)
    );
    CREATE INDEX IF NOT EXISTS cx_dispositivos_fecha ON cx_dispositivos(fecha);
    CREATE TABLE IF NOT EXISTS cx_ise_codigo (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, codigo TEXT NOT NULL, eventos INTEGER NOT NULL, macs INTEGER NOT NULL, carga_id INTEGER REFERENCES cx_cargas(id),
      UNIQUE (sede, fecha, codigo)
    );
    CREATE TABLE IF NOT EXISTS cx_ise_lugar (
      id INTEGER PRIMARY KEY, sede TEXT NOT NULL, fecha TEXT NOT NULL, piso TEXT, ap TEXT, eventos INTEGER NOT NULL, macs INTEGER NOT NULL, macs12303 INTEGER NOT NULL,
      carga_id INTEGER REFERENCES cx_cargas(id)
    );
    CREATE INDEX IF NOT EXISTS cx_ise_lugar_fecha ON cx_ise_lugar(sede, fecha);
  `);
  // v3.25: datos de detalle en los casos (origen Abaton, prioridad, días y fallos)
  {
    const cols = db.prepare('PRAGMA table_info(cx_casos)').all().map((c) => c.name);
    for (const [c, t] of [['origen', 'TEXT'], ['prioridad', 'TEXT'], ['categoria', 'TEXT'], ['dias', 'INTEGER'], ['fallos', 'INTEGER'], ['ultimo', 'TEXT'], ['detalle', 'TEXT']]) {
      if (!cols.includes(c)) db.exec(`ALTER TABLE cx_casos ADD COLUMN ${c} ${t}`);
    }
  }

  /** Crea la iniciativa si no existe y deja el orden pedido: esta primero y Monitoreo (1.0) al final. */
  function ensure() {
    if (!db.prepare('SELECT COUNT(*) AS n FROM initiatives').get().n) return;
    const cur = db.prepare("SELECT id, def FROM initiatives WHERE slug = 'conexiones'").get();
    if (cur) {
      // eje de la gráfica acercado (88 % a 100 %) para que se note la mejora semana a semana
      const def = JSON.parse(cur.def); const k = (def.kpis || []).find((x) => x.key === 'exitosas');
      if (k && k.yMin === undefined) { k.yMin = 88; db.prepare('UPDATE initiatives SET def = ? WHERE id = ?').run(JSON.stringify(def), cur.id); }
    }
    if (!cur) {
      db.prepare('INSERT INTO initiatives (slug, sort, def) VALUES (?,?,?)').run('conexiones', -1, JSON.stringify(C.INICIATIVA));
      audit(null, 'iniciativa_creada', { slug: 'conexiones' });
      // orden: 2.0 primero, después las demás en su orden actual y Monitoreo proactivo (1.0) al final
      const rows = db.prepare("SELECT id, slug FROM initiatives WHERE slug <> 'conexiones' ORDER BY sort, id").all();
      const order = ['conexiones', ...rows.filter((r) => r.slug !== 'monitoreo').map((r) => r.slug), 'monitoreo'];
      const up = db.prepare('UPDATE initiatives SET sort = ? WHERE slug = ?');
      order.forEach((slug, i) => up.run(i, slug));
      audit(null, 'iniciativas_reordenadas', { orden: order });
    }
  }

  const canWrite = (u) => u.role === 'admin' || u.role === 'ingeniero';
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const today = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // hora del centro de México
  const txt = (v, max) => { const t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
  const need = (v, msg) => { if (v === null || v === undefined || v === '') throw new HttpError(400, msg); return v; };

  /** Normaliza una lectura diaria; devuelve los avisos de corrección. */
  function lectura(r, where) {
    const avisos = [];
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const sede = C.SEDE[r.sede] ? r.sede : null;
    if (!sede) throw new HttpError(400, `${where}: la sede no es válida.`);
    if (!isDate(r.fecha) || r.fecha > today()) throw new HttpError(400, `${where}: la fecha no es válida o es futura.`);
    const ssid = C.SSIDS.includes(r.ssid) ? r.ssid : null;
    if (!ssid) throw new HttpError(400, `${where}: el SSID debe ser BBVA_GLOBAL o BBVA.`);
    let disp = n(r.dispositivos), ok = n(r.exitosos), fail = n(r.fallidos), auth = n(r.auth12303) ?? 0;
    for (const [k, v] of [['dispositivos', disp], ['exitosos', ok], ['fallidos', fail], ['ID Authentication 12303', auth]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10000000)) throw new HttpError(400, `${where}: ${k} debe ser un número entero.`);
    }
    if (disp === null) { if (ok === null || fail === null) throw new HttpError(400, `${where}: escribe el total de dispositivos.`); disp = ok + fail; }
    if (ok === null && fail === null) throw new HttpError(400, `${where}: escribe los exitosos o los fallidos.`);
    if (ok === null) ok = disp - fail;
    if (fail === null) fail = disp - ok;
    if (ok + fail !== disp) { avisos.push(`${where}: exitosos (${ok}) + fallidos (${fail}) no suman el total (${disp}); se tomaron fallidos = total − exitosos (${disp - ok}).`); fail = disp - ok; }
    if (ok > disp || fail < 0) throw new HttpError(400, `${where}: los exitosos no pueden ser más que el total de dispositivos.`);
    if (auth > fail) throw new HttpError(400, `${where}: las fallas ID Authentication 12303 (${auth}) no pueden ser más que los fallidos (${fail}).`);
    return { row: { sede, fecha: r.fecha, ssid, dispositivos: disp, exitosos: ok, fallidos: fail, auth12303: auth }, avisos };
  }

  /** Guarda (o compara, si commit = false) un lote de lecturas; nuevas, que cambian y sin cambio. */
  function aplicar(rows, user, tipo, archivo, commit) {
    const get = db.prepare('SELECT * FROM cx_lecturas WHERE sede = ? AND fecha = ? AND ssid = ?');
    const res = { nuevas: 0, actualizadas: 0, sinCambio: 0, cambios: [] };
    const plan = rows.map((r) => {
      const prev = get.get(r.sede, r.fecha, r.ssid);
      if (!prev) { res.nuevas += 1; return { r, op: 'ins' }; }
      if (['dispositivos', 'exitosos', 'fallidos', 'auth12303'].every((k) => prev[k] === r[k])) { res.sinCambio += 1; return { r, op: null }; }
      res.actualizadas += 1;
      if (res.cambios.length < 40) res.cambios.push(`${C.SEDE[r.sede].name} · ${r.ssid} · ${r.fecha}: ${prev.exitosos}/${prev.dispositivos} → ${r.exitosos}/${r.dispositivos}`);
      return { r, op: 'upd', prev };
    });
    if (!commit || (!res.nuevas && !res.actualizadas)) return res;
    const ts = now();
    db.exec('BEGIN');
    try {
      const carga = Number(db.prepare('INSERT INTO cx_cargas (ts, user_id, tipo, archivo, resumen) VALUES (?,?,?,?,?)').run(ts, user.id, tipo, archivo, JSON.stringify({ nuevas: res.nuevas, actualizadas: res.actualizadas })).lastInsertRowid);
      const ins = db.prepare('INSERT INTO cx_lecturas (sede, fecha, ssid, dispositivos, exitosos, fallidos, auth12303, carga_id, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      const upd = db.prepare('UPDATE cx_lecturas SET dispositivos = ?, exitosos = ?, fallidos = ?, auth12303 = ?, carga_id = ?, updated_by = ?, updated_at = ? WHERE id = ?');
      for (const p of plan) {
        if (p.op === 'ins') ins.run(p.r.sede, p.r.fecha, p.r.ssid, p.r.dispositivos, p.r.exitosos, p.r.fallidos, p.r.auth12303, carga, user.id, ts, user.id, ts);
        if (p.op === 'upd') upd.run(p.r.dispositivos, p.r.exitosos, p.r.fallidos, p.r.auth12303, carga, user.id, ts, p.prev.id);
      }
      db.exec('COMMIT');
      res.carga = carga;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user.id, 'conexiones_carga', { tipo, archivo, nuevas: res.nuevas, actualizadas: res.actualizadas });
    return res;
  }

  /** Lee el Excel con el formato del ejercicio: una hoja por sede, título con el SSID, un renglón por día. */
  function parseExcel(buf) {
    const { sheets, date1904 } = readXlsx(buf);
    const epoch = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 864e5 : 0);
    const out = { hojas: [], filas: [], avisos: [], errores: [] };
    const fechaDe = (v) => {
      if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(epoch + Math.round(v * 864e5)).toISOString().slice(0, 10);
      const s = String(v || '').trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return null;
    };
    for (const sh of sheets) {
      const get = (r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : undefined; };
      // encabezados: el renglón que tiene "Fecha" y "Dispositivos"
      let hr = null; const head = [];
      for (let r = 1; r <= Math.min(sh.maxRow, 12) && !hr; r++) {
        const cells = []; for (let c = 1; c <= Math.min(sh.maxCol, 30); c++) cells.push(C.plain(get(r, c) || '').replace(/\s+/g, ' ').trim());
        if (cells.some((x) => x === 'fecha') && cells.some((x) => /dispositivos/.test(x))) { hr = r; head.push(...cells); }
      }
      if (!hr) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'No tiene la tabla de conexiones (Fecha, Total dispositivos…); se omitió.' }); continue; }
      const col = (re) => { const i = head.findIndex((h) => re.test(h)); return i < 0 ? null : i + 1; };
      const cF = col(/^fecha$/), cD = col(/total dispositivos/), cOk = col(/^total exitosos/), cFail = col(/^total fallidos/), cAuth = col(/^id auth\w* 12303$/) || col(/12303/);
      let titulo = ''; for (let r = 1; r < hr; r++) for (let c = 1; c <= 3; c++) if (typeof get(r, c) === 'string') titulo += ' ' + get(r, c);
      const sede = C.sedeDe(sh.name) || C.sedeDe(titulo);
      const ssid = C.ssidDe(titulo) || C.ssidDe(sh.name) || 'BBVA_GLOBAL';
      if (!sede) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'El nombre de la hoja no corresponde a una sede de la iniciativa; se omitió.' }); continue; }
      if (!cD || (!cOk && !cFail)) { out.hojas.push({ hoja: sh.name, filas: 0, nota: 'Faltan las columnas de total de dispositivos y exitosos o fallidos.' }); continue; }
      let n = 0;
      for (let r = hr + 1; r <= sh.maxRow; r++) {
        const fv = get(r, cF);
        if (fv === undefined) continue;
        if (typeof fv === 'string' && /promedio|total/i.test(fv)) continue; // renglones de resumen: el portal calcula los suyos
        const fecha = fechaDe(fv);
        if (!fecha) continue;
        const where = `${sh.name}, fila ${r}`;
        const v = (c) => { const x = c ? get(r, c) : undefined; return typeof x === 'number' ? Math.round(x) : x === undefined ? null : Number(x); };
        try {
          const { row, avisos } = lectura({ sede: sede.key, fecha, ssid, dispositivos: v(cD), exitosos: v(cOk), fallidos: v(cFail), auth12303: cAuth ? v(cAuth) : 0 }, where);
          out.filas.push(row); out.avisos.push(...avisos); n += 1;
        } catch (e) { out.errores.push(e.message); }
      }
      out.hojas.push({ hoja: sh.name, sede: sede.name, ssid, filas: n, nota: cAuth ? '' : 'Sin columna ID Authentication 12303: todos los fallidos quedan en investigación.' });
    }
    // un mismo día, sede y SSID repetido dentro del archivo: queda el último
    const seen = new Map(); out.filas.forEach((f) => seen.set(`${f.sede}|${f.fecha}|${f.ssid}`, f));
    if (seen.size < out.filas.length) out.avisos.push(`${out.filas.length - seen.size} renglones repetidos (misma sede, día y SSID): se tomó el último.`);
    out.filas = [...seen.values()];
    return out;
  }

  /* ---------- reportes de detalle: Abaton (equipos sin conexión) e ISE (RADIUS Authentications) ---------- */
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  /** Fecha del archivo: Polanco_26102026, equipos_sin_conexion_2026-10-280300, REPORTE_ISE_25-26_Octubre_Reforma (el último día). */
  function fechaArchivo(nombre, anioDefault) {
    const n = String(nombre || '');
    let m = n.match(/(20\d{2})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = n.match(/(?:^|[^\d])(\d{2})(\d{2})(20\d{2})(?:[^\d]|$)/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = n.match(/(\d{1,2})(?:-(\d{1,2}))?[_ -]+([A-Za-zé]+)/);
    if (m && MESES[C.plain(m[3])]) return `${anioDefault}-${pad(MESES[C.plain(m[3])])}-${pad(m[2] || m[1])}`;
    return null;
  }
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const sinConteo = (v) => (v === undefined || v === null ? null : String(v).replace(/\s*\(\d+\)\s*$/, '').trim() || null);
  /** "26/10/2026, 9:05:00 a.m." → "2026-10-26T09:05" */
  function fechaHora(v) {
    const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/i);
    if (!m) return null;
    let hh = Number(m[4]); if (m[6]) hh = (hh % 12) + (/p/i.test(m[6]) ? 12 : 0);
    return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(hh)}:${m[5]}`;
  }
  /** Fecha de un evento de ISE: "26-OCT-26 08.57.44.995000 PM". */
  function fechaIse(v) { const m = String(v || '').match(/^(\d{2})-([A-Z]{3})-(\d{2})/i); return m && MON[m[2].toUpperCase()] ? `20${m[3]}-${pad(MON[m[2].toUpperCase()])}-${m[1]}` : null; }

  function parseDetalle(buf, nombre) {
    const { sheets } = readXlsx(buf);
    const anio = String(new Date().getFullYear());
    for (const sh of sheets) {
      const get = (r, c) => { const x = sh.cells.get(`${r},${c}`); return x ? x.v : undefined; };
      for (let hr = 1; hr <= 3; hr++) {
        const head = []; for (let c = 1; c <= Math.min(sh.maxCol, 40); c++) head.push(String(get(hr, c) ?? '').trim());
        const ix = (name) => { const i = head.findIndex((x) => C.plain(x) === C.plain(name)); return i < 0 ? null : i + 1; };
        // Abaton: equipos sin conexión, un renglón por dispositivo
        if (ix('MAC') && ix('Log ISE') && ix('Fallos')) {
          const fecha = fechaArchivo(nombre, anio) || fechaArchivo(get(1, 1), anio) || fechaArchivo(sh.name, anio);
          const filas = [];
          for (let r = hr + 1; r <= sh.maxRow; r++) {
            const mac = String(get(r, ix('MAC')) || '').trim().toLowerCase();
            if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) continue;
            const log = String(get(r, ix('Log ISE')) || '').trim();
            const codigo = C.codigoDe(log);
            const tipos = String(get(r, ix('Tipos de falla')) || '');
            const ultimo = fechaHora(get(r, ix('Ultimo intento'))), ok = fechaHora(get(r, ix('Ultima conexion exitosa')));
            filas.push({ sede: (C.sedeDe(get(r, ix('Sede'))) || C.sedeDe(nombre) || {}).key || null, mac, codigo, log_ise: log && log !== '#N/A' ? log.slice(0, 200) : null,
              tipo: codigo === '12303' ? '12303' : 'investigacion', categoria: codigo === '12303' ? null : C.categoria(codigo, tipos),
              identidad: sinConteo(get(r, ix('Identidad RADIUS'))), usuario: sinConteo(get(r, ix('Usuario'))), equipo: sinConteo(get(r, ix('Equipo'))), fabricante: sinConteo(get(r, ix('Fabricante'))), so: sinConteo(get(r, ix('Sistema operativo'))),
              fallos: num(get(r, ix('Fallos'))), tipos: tipos.slice(0, 300) || null, motivo: String(get(r, ix('Motivo del rechazo')) || '').slice(0, 300) || null, aps: String(get(r, ix('APs')) || '').slice(0, 600) || null,
              primer: fechaHora(get(r, ix('Primer intento'))), ultimo, ultima_ok: ok, recuperado: ok && ultimo && ok > ultimo ? 1 : 0 });
          }
          const sedes = [...new Set(filas.map((f) => f.sede).filter(Boolean))];
          return { tipo: 'abaton', hoja: sh.name, fecha, sede: sedes.length === 1 ? sedes[0] : null, sedes, filas };
        }
        // ISE: RADIUS Authentications (fallas), un renglón por evento
        if (ix('FAILURE_REASON') && ix('CALLING_STATION_ID') && ix('ACSVIEW_TIMESTAMP')) {
          const cL = ix('LOCATION'), cAp = ix('NETWORK_DEVICE_NAME'), cF = ix('FAILURE_REASON'), cM = ix('CALLING_STATION_ID'), cT = ix('ACSVIEW_TIMESTAMP');
          const ev = [];
          for (let r = hr + 1; r <= sh.maxRow; r++) {
            const fr = get(r, cF); if (!fr) continue;
            const loc = String(get(r, cL) || '').split('#');
            ev.push({ codigo: C.codigoDe(fr) || 'otro', mac: String(get(r, cM) || '').toLowerCase().replace(/-/g, ':'), sedeTxt: loc[1] || '', piso: loc[2] || null, ap: String(get(r, cAp) || '') || null, dia: fechaIse(get(r, cT)) });
          }
          const cnt = new Map(); ev.forEach((e) => e.dia && cnt.set(e.dia, (cnt.get(e.dia) || 0) + 1));
          const fecha = fechaArchivo(nombre, anio) || [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
          const sedes = [...new Set(ev.map((e) => (C.sedeDe(e.sedeTxt) || {}).key).filter(Boolean))];
          const sede = sedes.length === 1 ? sedes[0] : (C.sedeDe(nombre) || {}).key || null;
          return { tipo: 'ise', hoja: sh.name, fecha, sede, sedes, eventos: ev };
        }
      }
    }
    return { tipo: null };
  }

  /** Revisa (y si commit, guarda) un reporte de detalle. Abaton reemplaza el detalle de esa sede y día; ISE igual. */
  function aplicarDetalle(rep, user, archivo, commit) {
    const out = { tipo: rep.tipo, archivo, sede: rep.sede, fecha: rep.fecha, avisos: [], errores: [] };
    if (!rep.tipo) { out.errores.push('No se reconoce el formato: se esperaba el reporte de equipos sin conexión (Abaton) o el de RADIUS Authentications de ISE.'); return out; }
    if (!rep.sede) out.errores.push(rep.sedes && rep.sedes.length > 1 ? `El archivo trae varias sedes (${rep.sedes.join(', ')}); carga un archivo por sede.` : 'No se pudo identificar la sede (ni en los datos ni en el nombre del archivo).');
    if (!rep.fecha) out.errores.push('No se pudo identificar la fecha (usa el nombre original del archivo, por ejemplo Polanco_26102026 o REPORTE_ISE_26_Octubre_Polanco).');
    else if (rep.fecha > today()) out.errores.push(`La fecha ${rep.fecha} es futura.`);
    if (out.errores.length) return out;
    const ts = now();
    if (rep.tipo === 'abaton') {
      const filas = rep.filas.map((f) => ({ ...f, sede: rep.sede }));
      const inv = filas.filter((f) => f.tipo === 'investigacion');
      Object.assign(out, { dispositivos: filas.length, a12303: filas.length - inv.length, investigacion: inv.length, recuperados: inv.filter((f) => f.recuperado).length,
        categorias: Object.fromEntries(C.CATEGORIAS.map((c) => [c.key, inv.filter((f) => f.categoria === c.key).length])) });
      const lect = db.prepare("SELECT SUM(fallidos) AS f, SUM(auth12303) AS a FROM cx_lecturas WHERE sede = ? AND fecha = ?").get(rep.sede, rep.fecha);
      out.lectura = lect && lect.f !== null ? { fallidos: lect.f, a12303: lect.a } : null;
      if (!out.lectura) out.avisos.push('Aún no hay lectura diaria (totales) de esa sede y día: el detalle se guarda, pero el % de exitosas necesita el total de dispositivos.');
      else if (lect.f !== filas.length || lect.a !== out.a12303) out.avisos.push(`No cuadra con la lectura diaria: lectura ${lect.f} fallidos y ${lect.a} de 12303; el reporte trae ${filas.length} y ${out.a12303}.`);
      // casos: uno por sede y MAC del universo en investigación
      const prevCase = db.prepare('SELECT * FROM cx_casos WHERE sede = ? AND lower(dispositivo) = ?');
      let nuevos = 0, act = 0;
      const planCasos = inv.map((f) => { const c = prevCase.get(rep.sede, f.mac); if (c) act += 1; else nuevos += 1; return { f, c }; });
      Object.assign(out, { casosNuevos: nuevos, casosActualizados: act });
      if (!commit) return out;
      db.exec('BEGIN');
      try {
        const carga = Number(db.prepare('INSERT INTO cx_cargas (ts, user_id, tipo, archivo, resumen) VALUES (?,?,?,?,?)').run(ts, user.id, 'abaton', archivo, JSON.stringify({ sede: rep.sede, fecha: rep.fecha, dispositivos: filas.length, investigacion: inv.length, casosNuevos: nuevos })).lastInsertRowid);
        db.prepare('DELETE FROM cx_dispositivos WHERE sede = ? AND fecha = ?').run(rep.sede, rep.fecha);
        const ins = db.prepare(`INSERT INTO cx_dispositivos (sede, fecha, mac, tipo, codigo, log_ise, categoria, identidad, usuario, equipo, fabricante, so, fallos, tipos, motivo, aps, primer, ultimo, ultima_ok, recuperado, carga_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sede, fecha, mac) DO NOTHING`);
        for (const f of filas) ins.run(rep.sede, rep.fecha, f.mac, f.tipo, f.codigo, f.log_ise, f.categoria, f.identidad, f.usuario, f.equipo, f.fabricante, f.so, f.fallos, f.tipos, f.motivo, f.aps, f.primer, f.ultimo, f.ultima_ok, f.recuperado, carga);
        for (const { f, c } of planCasos) {
          // historial del dispositivo con todos los días cargados
          const dias = db.prepare("SELECT fecha, fallos, recuperado, codigo, categoria, ultimo FROM cx_dispositivos WHERE sede = ? AND mac = ? AND tipo = 'investigacion' ORDER BY fecha").all(rep.sede, f.mac);
          const last = dias[dias.length - 1];
          const fallos = dias.reduce((a, d) => a + (d.fallos || 0), 0);
          const pr = C.prioridad({ recuperado: !!last.recuperado, dias: dias.length, fallos, codigo: last.codigo });
          const ident = f.identidad && !/anonymous/i.test(f.identidad) ? f.identidad : null;
          const det = JSON.stringify({ log: f.log_ise, tipos: f.tipos, motivo: f.motivo, fabricante: f.fabricante, so: f.so, equipo: f.equipo, identidad: f.identidad, aps: f.aps, ultimaOk: f.ultima_ok, recuperado: !!last.recuperado, dias: dias.map((d) => d.fecha) });
          const ap = f.aps ? f.aps.split(';')[0].replace(/\s*\(\d+\)\s*$/, '').trim().slice(0, 60) : null;
          if (!c) {
            const id = Number(db.prepare(`INSERT INTO cx_casos (sede, fecha, ssid, username, nombre, dispositivo, ap, causa, codigo, estado, accion, comentario, ingeniero_id, created_by, created_at, updated_by, updated_at, origen, prioridad, categoria, dias, fallos, ultimo, detalle)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(rep.sede, dias[0].fecha, 'BBVA_GLOBAL', ident ? ident.toUpperCase().slice(0, 60) : null, f.usuario, f.mac, ap, C.CATEGORIA[f.categoria].label, f.codigo, 'nuevo', null, null, null, user.id, ts, user.id, ts,
              'abaton', pr, f.categoria, dias.length, fallos, last.ultimo, det).lastInsertRowid);
            db.prepare('INSERT INTO cx_casos_hist (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)').run(id, ts, user.id, 'nuevo', `Creado desde el reporte de equipos sin conexión (${archivo || rep.fecha}).`);
          } else {
            db.prepare('UPDATE cx_casos SET prioridad = ?, categoria = COALESCE(categoria, ?), dias = ?, fallos = ?, ultimo = ?, detalle = ?, origen = COALESCE(origen, ?), updated_at = ? WHERE id = ?')
              .run(pr, f.categoria, dias.length, fallos, last.ultimo, det, 'abaton', ts, c.id);
          }
        }
        db.exec('COMMIT');
        out.carga = carga;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      audit(user.id, 'conexiones_detalle_abaton', { sede: rep.sede, fecha: rep.fecha, dispositivos: filas.length, casosNuevos: nuevos });
      return out;
    }
    // ISE
    const ev = rep.eventos;
    const byCod = new Map(); const byLugar = new Map();
    for (const e of ev) {
      const a = byCod.get(e.codigo) || { eventos: 0, macs: new Set() }; a.eventos += 1; a.macs.add(e.mac); byCod.set(e.codigo, a);
      const k = `${e.piso}|${e.ap}`; const b = byLugar.get(k) || { piso: e.piso, ap: e.ap, eventos: 0, macs: new Set(), m12: new Set() }; b.eventos += 1; b.macs.add(e.mac); if (e.codigo === '12303') b.m12.add(e.mac); byLugar.set(k, b);
    }
    Object.assign(out, { eventos: ev.length, dispositivos: new Set(ev.map((e) => e.mac)).size, codigos: Object.fromEntries([...byCod.entries()].map(([k, v]) => [k, { eventos: v.eventos, dispositivos: v.macs.size }])) });
    const otros = [...new Set(ev.map((e) => e.dia).filter((d) => d && d !== rep.fecha))];
    if (otros.length) out.avisos.push(`El reporte incluye eventos de ${[rep.fecha, ...otros].sort().join(' y ')} (corte de ISE a las 21:00); se cargan como del ${rep.fecha}.`);
    if (!commit) return out;
    db.exec('BEGIN');
    try {
      const carga = Number(db.prepare('INSERT INTO cx_cargas (ts, user_id, tipo, archivo, resumen) VALUES (?,?,?,?,?)').run(ts, user.id, 'ise', archivo, JSON.stringify({ sede: rep.sede, fecha: rep.fecha, eventos: ev.length })).lastInsertRowid);
      db.prepare('DELETE FROM cx_ise_codigo WHERE sede = ? AND fecha = ?').run(rep.sede, rep.fecha);
      db.prepare('DELETE FROM cx_ise_lugar WHERE sede = ? AND fecha = ?').run(rep.sede, rep.fecha);
      const i1 = db.prepare('INSERT INTO cx_ise_codigo (sede, fecha, codigo, eventos, macs, carga_id) VALUES (?,?,?,?,?,?)');
      for (const [k, v] of byCod) i1.run(rep.sede, rep.fecha, k, v.eventos, v.macs.size, carga);
      const i2 = db.prepare('INSERT INTO cx_ise_lugar (sede, fecha, piso, ap, eventos, macs, macs12303, carga_id) VALUES (?,?,?,?,?,?,?,?)');
      for (const v of byLugar.values()) i2.run(rep.sede, rep.fecha, v.piso, v.ap, v.eventos, v.macs.size, v.m12.size, carga);
      db.exec('COMMIT');
      out.carga = carga;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user.id, 'conexiones_detalle_ise', { sede: rep.sede, fecha: rep.fecha, eventos: ev.length });
    return out;
  }

  /** Análisis del detalle para el reporte ejecutivo (respeta periodo y sede). */
  function analisis(q) {
    const desde = isDate(q.get('desde')) ? q.get('desde') : '0000-01-01', hasta = isDate(q.get('hasta')) ? q.get('hasta') : '9999-12-31';
    const sede = C.SEDE[q.get('sede')] ? q.get('sede') : null;
    const w = `fecha BETWEEN ? AND ?${sede ? ' AND sede = ?' : ''}`; const args = sede ? [desde, hasta, sede] : [desde, hasta];
    const disp = db.prepare(`SELECT tipo, categoria, recuperado, COUNT(*) AS n FROM cx_dispositivos WHERE ${w} GROUP BY tipo, categoria, recuperado`).all(...args);
    const rec = db.prepare(`SELECT tipo, COUNT(*) AS macs, SUM(d >= 2) AS multi FROM (SELECT tipo, sede, mac, COUNT(DISTINCT fecha) AS d FROM cx_dispositivos WHERE ${w} GROUP BY tipo, sede, mac) GROUP BY tipo`).all(...args);
    const codigos = db.prepare(`SELECT codigo, SUM(eventos) AS eventos, SUM(macs) AS dispositivos FROM cx_ise_codigo WHERE ${w} GROUP BY codigo ORDER BY eventos DESC`).all(...args);
    const pisos = db.prepare(`SELECT sede, piso, SUM(eventos) AS eventos, SUM(macs) AS dispositivos, SUM(macs12303) AS d12303 FROM cx_ise_lugar WHERE ${w} GROUP BY sede, piso ORDER BY eventos DESC LIMIT 10`).all(...args);
    const aps = db.prepare(`SELECT sede, ap, SUM(eventos) AS eventos, SUM(macs) AS dispositivos FROM cx_ise_lugar WHERE ${w} GROUP BY sede, ap ORDER BY eventos DESC LIMIT 8`).all(...args);
    const dias = db.prepare(`SELECT COUNT(DISTINCT sede || fecha) AS n FROM cx_dispositivos WHERE ${w}`).get(...args).n;
    const diasIse = db.prepare(`SELECT COUNT(DISTINCT sede || fecha) AS n FROM cx_ise_codigo WHERE ${w}`).get(...args).n;
    return { disp, rec, codigos, pisos, aps, dias, diasIse };
  }

  function datos() {
    const lect = db.prepare('SELECT id, sede, fecha, ssid, dispositivos, exitosos, fallidos, auth12303, carga_id AS cargaId FROM cx_lecturas ORDER BY fecha DESC, sede, ssid').all();
    const cargas = db.prepare('SELECT c.id, c.ts, c.tipo, c.archivo, c.resumen, c.user_id AS userId, u.name AS user, ((SELECT COUNT(*) FROM cx_lecturas l WHERE l.carga_id = c.id) + (SELECT COUNT(*) FROM cx_dispositivos d WHERE d.carga_id = c.id) + (SELECT COUNT(*) FROM cx_ise_codigo i WHERE i.carga_id = c.id)) AS vigentes FROM cx_cargas c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 40').all()
      .map((c) => ({ ...c, resumen: JSON.parse(c.resumen || '{}') }));
    const hist = db.prepare('SELECT h.caso_id, h.ts, h.estado, h.nota, u.name AS user FROM cx_casos_hist h LEFT JOIN users u ON u.id = h.user_id ORDER BY h.id').all();
    const casos = db.prepare('SELECT c.*, i.name AS ingeniero FROM cx_casos c LEFT JOIN users i ON i.id = c.ingeniero_id ORDER BY c.fecha DESC, c.id DESC').all()
      .map((c) => ({ id: c.id, sede: c.sede, fecha: c.fecha, ssid: c.ssid, username: c.username, nombre: c.nombre, dispositivo: c.dispositivo, ap: c.ap, causa: c.causa, codigo: c.codigo,
        estado: c.estado, accion: c.accion, comentario: c.comentario, ingenieroId: c.ingeniero_id, ingeniero: c.ingeniero, createdBy: c.created_by, updatedAt: c.updated_at,
        origen: c.origen, prioridad: c.prioridad, categoria: c.categoria, dias: c.dias, fallos: c.fallos, ultimo: c.ultimo, detalle: c.detalle ? JSON.parse(c.detalle) : null,
        historial: hist.filter((h) => h.caso_id === c.id).map((h) => ({ ts: h.ts, estado: h.estado, nota: h.nota, user: h.user || 'Sistema' })) }));
    const cobertura = db.prepare(`SELECT sede, fecha, 'abaton' AS fuente, COUNT(*) AS n, SUM(tipo = '12303') AS a12303 FROM cx_dispositivos GROUP BY sede, fecha
      UNION ALL SELECT sede, fecha, 'ise' AS fuente, SUM(eventos) AS n, SUM(CASE WHEN codigo = '12303' THEN eventos ELSE 0 END) AS a12303 FROM cx_ise_codigo GROUP BY sede, fecha`).all();
    return { hoy: today(), lecturas: lect, cargas, casos, cobertura, ingenieros: db.prepare("SELECT id, name FROM users WHERE role IN ('admin','ingeniero') AND active = 1 ORDER BY name").all() };
  }

  function weeklySummary() {
    const rows = db.prepare('SELECT sede, fecha, dispositivos, exitosos, fallidos, auth12303, updated_at FROM cx_lecturas').all();
    const by = new Map();
    for (const r of rows) { const w = C.mondayOf(r.fecha); if (!by.has(w)) by.set(w, []); by.get(w).push(r); }
    const casos = db.prepare('SELECT fecha, estado FROM cx_casos').all();
    return [...by.entries()].map(([week, list]) => {
      const t = C.totales(list); const end = C.addDays(week, 6);
      const cs = casos.filter((c) => c.fecha >= week && c.fecha <= end);
      return { week, t, sedes: new Set(list.map((r) => r.sede)).size, casos: cs.length, resueltos: cs.filter((c) => !C.ESTADO[c.estado].abierto).length,
        updatedAt: list.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') };
    });
  }

  function casoInput(body, user, prev) {
    const sede = C.SEDE[body.sede] ? body.sede : null; if (!sede) throw new HttpError(400, 'Selecciona la sede.');
    const fecha = need(isDate(body.fecha) && body.fecha <= today() ? body.fecha : null, 'Selecciona la fecha (no puede ser futura).');
    const username = txt(body.username, 60), dispositivo = txt(body.dispositivo, 80);
    if (!username && !dispositivo) throw new HttpError(400, 'Escribe el username o la MAC del dispositivo.');
    let ing = prev ? prev.ingeniero_id : user.id;
    if (body.ingenieroId !== undefined && body.ingenieroId !== null && body.ingenieroId !== '' && Number(body.ingenieroId) !== ing) {
      if (user.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede asignar el caso a otro ingeniero.');
      if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','ingeniero')").get(Number(body.ingenieroId))) throw new HttpError(400, 'El ingeniero seleccionado no existe.');
      ing = Number(body.ingenieroId);
    }
    return { sede, fecha, ssid: C.SSIDS.includes(body.ssid) ? body.ssid : null, username: username ? username.toUpperCase().replace(/\s+/g, '') : null, nombre: txt(body.nombre, 120),
      dispositivo: dispositivo && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(dispositivo) ? dispositivo.toLowerCase().replace(/-/g, ':') : dispositivo, ap: txt(body.ap, 60), causa: txt(body.causa, 160), codigo: txt(body.codigo, 20),
      estado: C.ESTADO[body.estado] ? body.estado : 'nuevo', accion: txt(body.accion, 2000), comentario: txt(body.comentario, 2000), ingeniero_id: ing };
  }

  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (res, name, head, rows) => { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.end('﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')); return true; };
  const pct = (a, b, d = 2) => (b ? Math.round((a / b) * 100 * 10 ** d) / 10 ** d : '');

  async function handle(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/conexiones')) return false;
    let mm;
    if (p === '/api/conexiones/datos' && m === 'GET') return send(res, 200, datos()), true;

    if (p === '/api/conexiones/lecturas' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede capturar lecturas.');
      const body = await readJson(req);
      const list = Array.isArray(body.lecturas) ? body.lecturas.slice(0, 40) : [];
      if (!list.length) throw new HttpError(400, 'Captura al menos un SSID.');
      const rows = []; const avisos = [];
      list.forEach((r) => { const x = lectura({ ...r, sede: body.sede, fecha: body.fecha }, `${r.ssid || 'SSID'}`); rows.push(x.row); avisos.push(...x.avisos); });
      const r = aplicar(rows, user, 'manual', null, true);
      return send(res, 200, { ...r, avisos }), true;
    }

    if (p === '/api/conexiones/importar' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede cargar información.');
      const buf = await new Promise((resolve, reject) => { let size = 0; const ch = []; req.on('data', (c) => { size += c.length; if (size > 15 * 1024 * 1024) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 15 MB).')); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
      let parsed; try { parsed = parseExcel(buf); } catch (e) { throw new HttpError(400, e.message || 'No se pudo leer el archivo.'); }
      if (!parsed.filas.length) return send(res, 200, { hojas: parsed.hojas, avisos: parsed.avisos, errores: parsed.errores, nuevas: 0, actualizadas: 0, sinCambio: 0, cambios: [], guardado: false }), true;
      const commit = url.searchParams.get('modo') === 'guardar';
      if (commit && parsed.errores.length) throw new HttpError(400, 'Corrige los errores del archivo antes de guardar.');
      const r = aplicar(parsed.filas, user, 'excel', txt(url.searchParams.get('nombre'), 120), commit);
      return send(res, 200, { ...r, hojas: parsed.hojas, avisos: parsed.avisos, errores: parsed.errores, guardado: commit }), true;
    }

    if (p === '/api/conexiones/analisis' && m === 'GET') return send(res, 200, analisis(url.searchParams)), true;
    if (p === '/api/conexiones/detalle' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede cargar información.');
      const buf = await new Promise((resolve, reject) => { let size = 0; const ch = []; req.on('data', (c) => { size += c.length; if (size > 20 * 1024 * 1024) { reject(new HttpError(413, 'El archivo es demasiado grande (máximo 20 MB).')); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); });
      const nombre = txt(url.searchParams.get('nombre'), 160);
      let rep; try { rep = parseDetalle(buf, nombre); } catch (e) { throw new HttpError(400, e.message || 'No se pudo leer el archivo.'); }
      const commit = url.searchParams.get('modo') === 'guardar';
      const r = aplicarDetalle(rep, user, nombre, commit);
      if (commit && r.errores.length) throw new HttpError(400, r.errores[0]);
      return send(res, 200, { ...r, guardado: commit && !r.errores.length }), true;
    }

    if ((mm = p.match(/^\/api\/conexiones\/cargas\/(\d+)$/)) && m === 'DELETE') {
      const c = db.prepare('SELECT * FROM cx_cargas WHERE id = ?').get(Number(mm[1]));
      if (!c) throw new HttpError(404, 'La carga no existe.');
      if (!(user.role === 'admin' || (user.role === 'ingeniero' && c.user_id === user.id && c.tipo === 'manual'))) throw new HttpError(403, 'Solo un administrador puede deshacer cargas de Excel o de otras personas.');
      const r = db.prepare('DELETE FROM cx_lecturas WHERE carga_id = ?').run(c.id);
      r.changes = Number(r.changes) + Number(db.prepare('DELETE FROM cx_dispositivos WHERE carga_id = ?').run(c.id).changes) + Number(db.prepare('DELETE FROM cx_ise_codigo WHERE carga_id = ?').run(c.id).changes);
      db.prepare('DELETE FROM cx_ise_lugar WHERE carga_id = ?').run(c.id);
      const resumen = { ...JSON.parse(c.resumen || '{}'), deshecha: { por: user.name || user.username, ts: now(), lecturas: Number(r.changes) } };
      db.prepare('UPDATE cx_cargas SET resumen = ? WHERE id = ?').run(JSON.stringify(resumen), c.id);
      audit(user.id, 'conexiones_carga_deshecha', { carga: c.id, lecturas: Number(r.changes) });
      return send(res, 200, { lecturas: Number(r.changes) }), true;
    }

    if (p === '/api/conexiones/casos' && m === 'POST') {
      if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede registrar casos.');
      const row = casoInput(await readJson(req), user, null);
      const ts = now();
      const id = Number(db.prepare(`INSERT INTO cx_casos (sede, fecha, ssid, username, nombre, dispositivo, ap, causa, codigo, estado, accion, comentario, ingeniero_id, created_by, created_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.sede, row.fecha, row.ssid, row.username, row.nombre, row.dispositivo, row.ap, row.causa, row.codigo, row.estado, row.accion, row.comentario, row.ingeniero_id, user.id, ts, user.id, ts).lastInsertRowid);
      db.prepare('INSERT INTO cx_casos_hist (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)').run(id, ts, user.id, row.estado, row.comentario || 'Caso registrado');
      audit(user.id, 'conexiones_caso_registrado', { id, sede: row.sede });
      return send(res, 200, { id }), true;
    }
    if ((mm = p.match(/^\/api\/conexiones\/casos\/(\d+)$/))) {
      const c = db.prepare('SELECT * FROM cx_casos WHERE id = ?').get(Number(mm[1]));
      if (!c) throw new HttpError(404, 'El caso no existe.');
      if (m === 'PUT') {
        if (!canWrite(user)) throw new HttpError(403, 'Tu usuario es de consulta: no puede actualizar casos.');
        const body = await readJson(req);
        const estado = C.ESTADO[body.estado] ? body.estado : c.estado;
        const nota = txt(body.nota, 2000);
        const causa = body.causa !== undefined ? txt(body.causa, 160) : c.causa;
        const accion = body.accion !== undefined ? txt(body.accion, 2000) : c.accion;
        let ing = c.ingeniero_id;
        if (body.ingenieroId !== undefined && Number(body.ingenieroId || 0) !== (c.ingeniero_id || 0)) {
          const to = body.ingenieroId ? Number(body.ingenieroId) : null;
          if (user.role !== 'admin' && !(to === user.id && !c.ingeniero_id)) throw new HttpError(403, 'Solo un administrador puede reasignar casos. Puedes tomar los que no tienen ingeniero.');
          ing = to;
        }
        if (estado === c.estado && !nota && causa === c.causa && accion === c.accion && ing === c.ingeniero_id) throw new HttpError(400, 'No hay cambios que guardar.');
        const ts = now();
        db.prepare('UPDATE cx_casos SET estado = ?, causa = ?, accion = ?, ingeniero_id = ?, comentario = COALESCE(?, comentario), updated_by = ?, updated_at = ? WHERE id = ?').run(estado, causa, accion, ing, nota, user.id, ts, c.id);
        db.prepare('INSERT INTO cx_casos_hist (caso_id, ts, user_id, estado, nota) VALUES (?,?,?,?,?)').run(c.id, ts, user.id, estado !== c.estado ? estado : null, nota || (ing !== c.ingeniero_id ? 'Caso reasignado' : null));
        audit(user.id, 'conexiones_caso_seguimiento', { id: c.id, antes: c.estado, despues: estado });
        return send(res, 200, { ok: true }), true;
      }
      if (m === 'DELETE') {
        if (!(user.role === 'admin' || (user.role === 'ingeniero' && c.created_by === user.id))) throw new HttpError(403, 'Solo quien registró el caso o un administrador puede eliminarlo.');
        db.prepare('DELETE FROM cx_casos_hist WHERE caso_id = ?').run(c.id);
        db.prepare('DELETE FROM cx_casos WHERE id = ?').run(c.id);
        audit(user.id, 'conexiones_caso_eliminado', { id: c.id });
        return send(res, 200, { ok: true }), true;
      }
    }

    if ((mm = p.match(/^\/api\/conexiones\/export\/(lecturas|semanal|casos)\.csv$/)) && m === 'GET') {
      const D = datos();
      if (mm[1] === 'lecturas') return csv(res, 'conexiones-diarias.csv', ['Fecha', 'Sede', 'SSID', 'Total dispositivos', 'Total exitosos', '% exitosos', 'Total fallidos', '% fallidos', 'ID Authentication 12303', '% 12303', 'En investigación', '% en investigación'],
        D.lecturas.slice().reverse().map((r) => [r.fecha, C.SEDE[r.sede].name, r.ssid, r.dispositivos, r.exitosos, pct(r.exitosos, r.dispositivos), r.fallidos, pct(r.fallidos, r.dispositivos), r.auth12303, pct(r.auth12303, r.dispositivos), r.fallidos - r.auth12303, pct(r.fallidos - r.auth12303, r.dispositivos)]));
      if (mm[1] === 'semanal') {
        const rows = [];
        const weeks = [...new Set(D.lecturas.map((r) => C.mondayOf(r.fecha)))].sort();
        for (const w of weeks) {
          const l = D.lecturas.filter((r) => C.mondayOf(r.fecha) === w);
          for (const s of [null, ...C.SEDES]) {
            const ls = s ? l.filter((r) => r.sede === s.key) : l; if (!ls.length) continue;
            const t = C.totales(ls);
            rows.push([w, C.addDays(w, 6), s ? s.name : 'Todas las sedes', t.dias, t.disp, t.ok, pct(t.ok, t.disp), t.auth, pct(t.auth, t.disp), t.inv, pct(t.inv, t.disp), Math.round((pct(t.ok, t.disp) - C.META.inicial) * 100) / 100]);
          }
        }
        return csv(res, 'conexiones-semanal.csv', ['Semana (lunes)', 'Al', 'Sede', 'Lecturas', 'Dispositivos', 'Exitosos', '% exitosos (ponderado)', 'ID Authentication 12303', '% 12303', 'En investigación', '% en investigación', 'Puntos vs 91.3 %'], rows);
      }
      return csv(res, 'conexiones-casos-en-investigacion.csv', ['Fecha', 'Sede', 'SSID', 'Username', 'Nombre', 'MAC / dispositivo', 'AP', 'Causa', 'Código de falla', 'Estado', 'Acción', 'Último comentario', 'Ingeniero', 'Última actualización'],
        D.casos.map((c) => [c.fecha, C.SEDE[c.sede].name, c.ssid, c.username, c.nombre, c.dispositivo, c.ap, c.causa, c.codigo, C.ESTADO[c.estado].label, c.accion, c.comentario, c.ingeniero, c.updatedAt ? c.updatedAt.slice(0, 10) : '']));
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  }

  return { handle, weeklySummary, ensure };
};
