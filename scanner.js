/**
 * scanner.js — Orquestrador do barrido completo
 * 
 * Coordena: scraping → filtro → classificação → persistência → notificação
 */
import { logger } from './logger.js';
import { scrapeReclameAqui } from './scraper-reclameaqui.js';
import { scrapeGoogleReviews } from './scraper-google.js';
import { classifyBatch } from './classifier.js';
import { sendBatchAlerts, formatPushNotification } from './notifier.js';
import { 
  insertComplaint, complaintExists, insertScanLog, 
  getUnsentComplaints, getSetting, getAllSettings 
} from './database.js';

// Event emitter simples para SSE
const listeners = new Set();

export function addScanListener(cb) { listeners.add(cb); }
export function removeScanListener(cb) { listeners.delete(cb); }
function emit(event, data) { listeners.forEach(cb => cb(event, data)); }

/**
 * Executa barrido completo em todas as fontes
 */
export async function runFullScan() {
  const startTime = Date.now();
  const results = { 
    reclameAqui: null, googleReviews: null,
    totalFound: 0, totalNew: 0, totalAlerts: 0,
    errors: [] 
  };
  
  emit('scan:start', { timestamp: new Date().toISOString() });
  logger.info('=== BARRIDO COMPLETO INICIADO ===');

  const settings = getAllSettings();
  const claudeKey = settings.claude_api_key || process.env.CLAUDE_API_KEY;
  const googleKey = settings.google_api_key || process.env.GOOGLE_PLACES_API_KEY;

  // === 1. RECLAME AQUI ===
  try {
    const raResult = await scrapeReclameAqui();
    results.reclameAqui = raResult;
    
    if (raResult.error) {
      results.errors.push({ source: 'reclame_aqui', error: raResult.error });
      insertScanLog({ source: 'reclame_aqui', status: 'error', error_message: raResult.error, duration_ms: raResult.duration });
    } else {
      // Filtrar duplicatas
      const newComplaints = raResult.complaints.filter(
        c => !complaintExists('reclame_aqui', c.external_id)
      );
      
      // Classificar novas reclamações
      if (newComplaints.length > 0) {
        const classified = await classifyBatch(newComplaints, claudeKey);
        for (const c of classified) {
          insertComplaint(c);
          results.totalNew++;
        }
      }
      
      results.totalFound += raResult.complaints.length;
      insertScanLog({ 
        source: 'reclame_aqui', status: 'success',
        complaints_found: raResult.complaints.length,
        complaints_new: newComplaints.length,
        duration_ms: raResult.duration 
      });
      
      emit('scan:source', { source: 'reclame_aqui', found: raResult.complaints.length, new: newComplaints.length });
    }
  } catch (error) {
    logger.error('Erro no barrido Reclame Aqui', { error: error.message });
    results.errors.push({ source: 'reclame_aqui', error: error.message });
    insertScanLog({ source: 'reclame_aqui', status: 'error', error_message: error.message });
  }

  // === 2. GOOGLE REVIEWS ===
  try {
    const grResult = await scrapeGoogleReviews(googleKey);
    results.googleReviews = grResult;
    
    if (grResult.error) {
      results.errors.push({ source: 'google_reviews', error: grResult.error });
      insertScanLog({ source: 'google_reviews', status: grResult.error === 'API Key ausente' ? 'error' : 'partial', error_message: grResult.error, duration_ms: grResult.duration });
    } else {
      const newComplaints = grResult.complaints.filter(
        c => !complaintExists('google_reviews', c.external_id)
      );
      
      if (newComplaints.length > 0) {
        const classified = await classifyBatch(newComplaints, claudeKey);
        for (const c of classified) {
          insertComplaint(c);
          results.totalNew++;
        }
      }
      
      results.totalFound += grResult.complaints.length;
      insertScanLog({ 
        source: 'google_reviews', status: 'success',
        complaints_found: grResult.complaints.length,
        complaints_new: newComplaints.length,
        duration_ms: grResult.duration 
      });
      
      emit('scan:source', { source: 'google_reviews', found: grResult.complaints.length, new: newComplaints.length });
    }
  } catch (error) {
    logger.error('Erro no barrido Google Reviews', { error: error.message });
    results.errors.push({ source: 'google_reviews', error: error.message });
    insertScanLog({ source: 'google_reviews', status: 'error', error_message: error.message });
  }

  // === 3. ENVIAR ALERTAS WHATSAPP ===
  const unsent = getUnsentComplaints();
  if (unsent.length > 0) {
    const twilioConfig = {
      twilioSid: settings.twilio_sid || process.env.TWILIO_ACCOUNT_SID,
      twilioToken: settings.twilio_token || process.env.TWILIO_AUTH_TOKEN,
      twilioFrom: settings.twilio_from || process.env.TWILIO_WHATSAPP_FROM,
      whatsappTo: settings.whatsapp_to || process.env.WHATSAPP_DESTINATION
    };
    
    const alertResult = await sendBatchAlerts(unsent, twilioConfig);
    results.totalAlerts = alertResult.sent;
  }

  const duration = Date.now() - startTime;
  logger.info(`=== BARRIDO COMPLETO: ${results.totalFound} encontradas, ${results.totalNew} novas, ${results.totalAlerts} alertas, ${duration}ms ===`);
  
  emit('scan:complete', { ...results, duration });
  return results;
}
