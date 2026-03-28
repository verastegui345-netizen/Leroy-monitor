/**
 * server.js — Servidor principal do Monitor Leroy Merlin
 * 
 * Express app que serve:
 * - API REST para o frontend
 * - Frontend PWA como arquivos estáticos
 * - Scheduler de barridos automáticos
 * - SSE para atualizações em tempo real
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './modules/logger.js';
import { initDatabase, getComplaints, getComplaintById, getStats, getRecentScans, getAllSettings, setSetting, getSetting } from './modules/database.js';
import { startScheduler, triggerManualScan, getScanStatus, stopScheduler } from './modules/scheduler.js';
import { addScanListener, removeScanListener } from './modules/scanner.js';
import { generateReport } from './modules/pdf-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// === MIDDLEWARE ===
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === INICIALIZAÇÃO (async — sql.js needs WASM init) ===
await initDatabase();

// Inicializar settings padrão a partir das env vars
const envDefaults = {
  google_api_key: process.env.GOOGLE_PLACES_API_KEY || '',
  claude_api_key: process.env.CLAUDE_API_KEY || '',
  twilio_sid: process.env.TWILIO_ACCOUNT_SID || '',
  twilio_token: process.env.TWILIO_AUTH_TOKEN || '',
  twilio_from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  whatsapp_to: process.env.WHATSAPP_DESTINATION || '',
  scan_interval: process.env.SCAN_INTERVAL_HOURS || '4',
  monitoring_active: 'true'
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (value && !getSetting(key)) {
    setSetting(key, value);
  }
}

// Iniciar scheduler
const interval = parseInt(getSetting('scan_interval') || '4', 10);
if (getSetting('monitoring_active') !== 'false') {
  startScheduler(interval);
}

// === API ROUTES ===

// Status geral
app.get('/api/status', (req, res) => {
  const scanStatus = getScanStatus();
  const stats24h = getStats('24h');
  res.json({ ok: true, scan: scanStatus, stats: stats24h, timestamp: new Date().toISOString() });
});

// Listar reclamações com filtros
app.get('/api/complaints', (req, res) => {
  const { severity, source, limit, offset, startDate, endDate } = req.query;
  const complaints = getComplaints({
    severity, source,
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0,
    startDate, endDate
  });
  res.json({ complaints, count: complaints.length });
});

// Detalhe de uma reclamação
app.get('/api/complaints/:id', (req, res) => {
  const complaint = getComplaintById(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Reclamação não encontrada' });
  res.json(complaint);
});

// Estatísticas
app.get('/api/stats', (req, res) => {
  const period = req.query.period || '24h';
  res.json(getStats(period));
});

// Histórico de barridos
app.get('/api/scans', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json(getRecentScans(limit));
});

// Barrido manual
app.post('/api/scan', async (req, res) => {
  try {
    res.json({ message: 'Barrido iniciado', timestamp: new Date().toISOString() });
    // Executar em background (resposta já enviada)
    triggerManualScan().catch(err => logger.error('Erro no barrido manual', { error: err.message }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gerar relatório PDF
app.get('/api/report', async (req, res) => {
  try {
    const { period, severity, source } = req.query;
    const pdf = await generateReport({ period: period || '24h', severity, source });
    
    const filename = `relatorio-leroy-${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (error) {
    logger.error('Erro ao gerar relatório', { error: error.message });
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Configurações — GET
app.get('/api/settings', (req, res) => {
  const settings = getAllSettings();
  // Mascarar tokens sensíveis
  const masked = { ...settings };
  for (const key of ['claude_api_key', 'twilio_token', 'twilio_sid', 'google_api_key']) {
    if (masked[key]) {
      masked[key] = masked[key].substring(0, 8) + '...' + masked[key].substring(masked[key].length - 4);
    }
  }
  res.json(masked);
});

// Configurações — POST
app.post('/api/settings', (req, res) => {
  const allowed = [
    'google_api_key', 'claude_api_key', 'twilio_sid', 'twilio_token',
    'twilio_from', 'whatsapp_to', 'scan_interval', 'monitoring_active'
  ];
  
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      setSetting(key, req.body[key]);
      updates[key] = true;
    }
  }
  
  // Reiniciar scheduler se intervalo mudou
  if (updates.scan_interval || updates.monitoring_active) {
    const active = getSetting('monitoring_active');
    if (active === 'false') {
      stopScheduler();
    } else {
      const newInterval = parseInt(getSetting('scan_interval') || '4', 10);
      startScheduler(newInterval);
    }
  }
  
  res.json({ ok: true, updated: Object.keys(updates) });
});

// SSE — Server-Sent Events para atualizações em tempo real
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  addScanListener(listener);
  
  req.on('close', () => {
    removeScanListener(listener);
  });
});

// Fallback: servir index.html para rotas SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === START ===
app.listen(PORT, () => {
  logger.info(`🚀 Monitor Leroy Merlin rodando na porta ${PORT}`);
  logger.info(`📱 Acesse: http://localhost:${PORT}`);
});
