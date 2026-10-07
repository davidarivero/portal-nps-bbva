'use strict';
/*
 * Alta masiva de usuarios desde un CSV con columnas: usuario,nombre,rol,contrasena_temporal
 *   npm run usuarios -- usuarios.csv
 * Roles válidos: admin, ingeniero, consulta. Los usuarios que ya existen se omiten.
 * Cada persona debe cambiar su contraseña temporal en el primer acceso.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file) { console.error('Uso: npm run usuarios -- usuarios.csv'); process.exit(1); }
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL)`);

const ROLES = { admin: 'admin', administrador: 'admin', ingeniero: 'ingeniero', consulta: 'consulta' };
const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const insert = db.prepare('INSERT INTO users (username, name, role, pass_hash, salt, must_change, created_at) VALUES (?,?,?,?,?,1,?)');
let created = 0, skipped = 0, errors = 0;
for (const [i, line] of lines.entries()) {
  const [username, name, roleRaw, password] = line.split(',').map((c) => c.trim());
  if (i === 0 && username.toLowerCase() === 'usuario') continue;
  const u = (username || '').toLowerCase();
  const role = ROLES[(roleRaw || '').toLowerCase()];
  const problem = !/^[a-z0-9._@-]{3,40}$/.test(u) ? 'usuario no válido'
    : !name ? 'falta el nombre' : !role ? `rol no válido "${roleRaw}"`
    : !password || password.length < 10 ? 'la contraseña debe tener al menos 10 caracteres' : null;
  if (problem) { console.error(`  Línea ${i + 1} (${username || '?'}): ${problem}`); errors++; continue; }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) { console.log(`  Ya existe, se omite: ${u}`); skipped++; continue; }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  insert.run(u, name, role, hash, salt, new Date().toISOString());
  created++;
}
console.log(`\nUsuarios creados: ${created} · omitidos: ${skipped} · con error: ${errors}`);
if (created) console.log('Entrega a cada persona su contraseña temporal por un canal privado y elimina el CSV.');
process.exit(errors ? 1 : 0);
