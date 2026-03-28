/**
 * database.js — Persistência SQLite via sql.js (pure JS, no native deps)
 * 
 * sql.js carrega SQLite via WASM. Queries são síncronas após init.
 * Persistência manual: salvamos o DB em disco após cada write.
 */
import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'monitor.db');
let db;
let saveTimeout = null;

export async function initDatabase() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();
  
  // Carregar DB existente ou criar novo
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('reclame_aqui','google_reviews')),
      external_id TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('leve','grave','critico')),
      title TEXT, summary TEXT NOT NULL, original_text TEXT,
      author TEXT, published_at TEXT, url TEXT, store_name TEXT,
      keywords_matched TEXT, ai_analysis TEXT,
      whatsapp_sent INTEGER DEFAULT 0, whatsapp_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs ON complaints(source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cv ON complaints(severity)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cc ON complaints(created_at)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ce ON complaints(source, external_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success','error','partial')),
      complaints_found INTEGER DEFAULT 0, complaints_new INTEGER DEFAULT 0,
      error_message TEXT, duration_ms INTEGER,
      started_at TEXT DEFAULT (datetime('now')), completed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  logger.info('DB inicializado', { path: DB_PATH });
  persist();
  return db;
}

/** Salva DB em disco (debounced) */
function persist() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      logger.error('Erro ao salvar DB', { error: e.message });
    }
  }, 500);
}

/** Força persistência imediata */
export function forcePersist() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    logger.error('Erro ao forçar persistência', { error: e.message });
  }
}

// === Helper: run SELECT and get array of objects ===
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

// ==========================================
// COMPLAINTS
// ==========================================

export function insertComplaint(c) {
  try {
    db.run(`
      INSERT OR IGNORE INTO complaints 
      (id,source,external_id,severity,title,summary,original_text,author,published_at,url,store_name,keywords_matched,ai_analysis)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      c.id, c.source, c.external_id||null, c.severity,
      c.title||null, c.summary, c.original_text||null,
      c.author||null, c.published_at||null, c.url||null,
      c.store_name||null, JSON.stringify(c.keywords_matched||[]),
      c.ai_analysis||null
    ]);
    persist();
    return db.getRowsModified() > 0;
  } catch (e) {
    logger.warn('Insert complaint error', { error: e.message, id: c.id });
    return false;
  }
}

export function complaintExists(source, externalId) {
  return !!queryOne('SELECT 1 as x FROM complaints WHERE source=? AND external_id=?', [source, externalId]);
}

export function markWhatsAppSent(id) {
  run(`UPDATE complaints SET whatsapp_sent=1, whatsapp_sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`, [id]);
}

export function getComplaints({ severity, source, limit=50, offset=0, startDate, endDate } = {}) {
  let q = 'SELECT * FROM complaints WHERE 1=1';
  const p = [];
  if (severity) { q += ' AND severity=?'; p.push(severity); }
  if (source) { q += ' AND source=?'; p.push(source); }
  if (startDate) { q += ' AND created_at>=?'; p.push(startDate); }
  if (endDate) { q += ' AND created_at<=?'; p.push(endDate); }
  q += ` ORDER BY CASE severity WHEN 'critico' THEN 1 WHEN 'grave' THEN 2 WHEN 'leve' THEN 3 END, created_at DESC LIMIT ? OFFSET ?`;
  p.push(limit, offset);
  return query(q, p);
}

export function getComplaintById(id) {
  return queryOne('SELECT * FROM complaints WHERE id=?', [id]);
}

export function getStats(period='24h') {
  const m = { '24h':'-1 day','7d':'-7 days','30d':'-30 days','all':'-100 years' };
  const iv = m[period]||m['24h'];
  const bySev = query(`SELECT severity,COUNT(*) as count FROM complaints WHERE created_at>=datetime('now',?) GROUP BY severity`, [iv]);
  const bySrc = query(`SELECT source,COUNT(*) as count FROM complaints WHERE created_at>=datetime('now',?) GROUP BY source`, [iv]);
  const total = queryOne(`SELECT COUNT(*) as total FROM complaints WHERE created_at>=datetime('now',?)`, [iv]);
  return {
    total: total?.total || 0,
    bySeverity: Object.fromEntries(bySev.map(s=>[s.severity,s.count])),
    bySource: Object.fromEntries(bySrc.map(s=>[s.source,s.count])),
    period
  };
}

export function getUnsentComplaints() {
  return query('SELECT * FROM complaints WHERE whatsapp_sent=0 ORDER BY created_at DESC');
}

export function getComplaintsForReport(since) {
  return query(`SELECT * FROM complaints WHERE created_at>=? ORDER BY CASE severity WHEN 'critico' THEN 1 WHEN 'grave' THEN 2 WHEN 'leve' THEN 3 END, created_at DESC`, [since]);
}

// ==========================================
// SCAN LOGS
// ==========================================

export function insertScanLog(log) {
  run(`INSERT INTO scan_logs (source,status,complaints_found,complaints_new,error_message,duration_ms,completed_at) VALUES (?,?,?,?,?,?,datetime('now'))`,
    [log.source, log.status, log.complaints_found||0, log.complaints_new||0, log.error_message||null, log.duration_ms||0]);
}

export function getRecentScans(limit=10) {
  return query('SELECT * FROM scan_logs ORDER BY started_at DESC LIMIT ?', [limit]);
}

export function getLastScanTime(source) {
  const r = queryOne(`SELECT completed_at FROM scan_logs WHERE source=? AND status!='error' ORDER BY started_at DESC LIMIT 1`, [source]);
  return r ? r.completed_at : null;
}

// ==========================================
// SETTINGS
// ==========================================

export function getSetting(key) {
  const r = queryOne('SELECT value FROM settings WHERE key=?', [key]);
  return r ? r.value : null;
}

export function setSetting(key, value) {
  run(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`, [key, value]);
}

export function getAllSettings() {
  const rows = query('SELECT key,value FROM settings');
  return Object.fromEntries(rows.map(r=>[r.key,r.value]));
}

export function getDatabase() { return db; }
