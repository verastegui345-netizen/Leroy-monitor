/**
 * notifier.js — Notificações WhatsApp (Twilio) e Web Push
 */
import { logger } from './logger.js';
import { markWhatsAppSent } from './database.js';

const SEVERITY_EMOJI = { critico: '🔴', grave: '🟠', leve: '🟡' };
const SEVERITY_LABEL = { critico: 'CRÍTICO', grave: 'GRAVE', leve: 'LEVE' };
const SOURCE_LABEL = { reclame_aqui: 'Reclame Aqui', google_reviews: 'Google Reviews' };

/**
 * Envia alerta WhatsApp via Twilio para uma reclamação
 */
export async function sendWhatsAppAlert(complaint, config) {
  const { twilioSid, twilioToken, twilioFrom, whatsappTo } = config;
  
  if (!twilioSid || !twilioToken || !whatsappTo) {
    logger.warn('Twilio não configurado — alerta WhatsApp ignorado');
    return false;
  }

  try {
    const emoji = SEVERITY_EMOJI[complaint.severity] || '⚪';
    const level = SEVERITY_LABEL[complaint.severity] || complaint.severity;
    const source = SOURCE_LABEL[complaint.source] || complaint.source;
    
    const message = [
      `${emoji} *ALERTA ${level}* — Monitor Leroy Merlin`,
      ``,
      `📌 *Fonte:* ${source}`,
      complaint.store_name ? `🏪 *Loja:* ${complaint.store_name}` : '',
      `📅 *Data:* ${complaint.published_at || 'N/D'}`,
      ``,
      `📋 *Resumo:*`,
      complaint.summary,
      ``,
      complaint.url ? `🔗 ${complaint.url}` : '',
    ].filter(Boolean).join('\n');

    const from = twilioFrom || 'whatsapp:+14155238886';
    
    // Twilio API via fetch (sem SDK para simplificar)
    const authString = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: from,
          To: whatsappTo,
          Body: message
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`Twilio ${response.status}: ${errData.message || JSON.stringify(errData)}`);
    }

    const result = await response.json();
    logger.info('WhatsApp enviado', { sid: result.sid, to: whatsappTo, severity: complaint.severity });
    
    // Marcar como enviado no DB
    markWhatsAppSent(complaint.id);
    return true;

  } catch (error) {
    logger.error('Erro ao enviar WhatsApp', { error: error.message, complaintId: complaint.id });
    return false;
  }
}

/**
 * Envia alertas para um lote de reclamações
 */
export async function sendBatchAlerts(complaints, config) {
  let sent = 0;
  let failed = 0;

  for (const complaint of complaints) {
    const success = await sendWhatsAppAlert(complaint, config);
    if (success) sent++;
    else failed++;
    
    // Rate limiting Twilio: 1 msg/s
    await new Promise(r => setTimeout(r, 1200));
  }

  logger.info(`Alertas WhatsApp: ${sent} enviados, ${failed} falharam`);
  return { sent, failed };
}

/**
 * Formata mensagem para web push notification
 */
export function formatPushNotification(complaint) {
  const emoji = SEVERITY_EMOJI[complaint.severity] || '⚪';
  const level = SEVERITY_LABEL[complaint.severity] || complaint.severity;
  const source = SOURCE_LABEL[complaint.source] || complaint.source;
  
  return {
    title: `${emoji} ${level} — ${source}`,
    body: complaint.summary?.substring(0, 150) || 'Nova reclamação detectada',
    url: complaint.url || '/',
    severity: complaint.severity,
    id: complaint.id
  };
}

// Lista de subscriptions push (em memória, persistir via DB em produção)
let pushSubscriptions = [];

export function addPushSubscription(sub) {
  pushSubscriptions.push(sub);
}

export function getPushSubscriptions() {
  return [...pushSubscriptions];
}
