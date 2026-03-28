/**
 * scheduler.js — Agendamento de barridos com node-cron
 * 
 * Executa barridos automáticos no intervalo configurado,
 * respeitando o horário de operação (08:00-00:00 BRT).
 */
import cron from 'node-cron';
import { logger } from './logger.js';
import { runFullScan } from './scanner.js';

let scheduledTask = null;
let nextScanTime = null;
let isScanning = false;

/**
 * Inicia o agendamento de barridos automáticos
 */
export function startScheduler(intervalHours = 4) {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  // Cron expression: a cada N horas
  // "0 */4 * * *" = minuto 0, a cada 4 horas
  const cronExpr = `0 */${intervalHours} * * *`;
  
  scheduledTask = cron.schedule(cronExpr, async () => {
    // Verificar horário de operação (08:00-00:00 BRT)
    const now = new Date();
    const brTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hour = brTime.getHours();
    
    if (hour < 8) {
      logger.info(`Fora do horário de operação (${hour}h BRT) — barrido ignorado`);
      updateNextScanTime(intervalHours);
      return;
    }

    await executeScan();
    updateNextScanTime(intervalHours);
    
  }, {
    timezone: 'America/Sao_Paulo'
  });

  updateNextScanTime(intervalHours);
  logger.info(`Scheduler iniciado: barrido a cada ${intervalHours}h (08:00-00:00 BRT)`);
}

/**
 * Executa um barrido completo com lock para evitar execuções simultâneas
 */
async function executeScan() {
  if (isScanning) {
    logger.warn('Barrido já em andamento — ignorando');
    return null;
  }
  
  isScanning = true;
  try {
    const result = await runFullScan();
    return result;
  } catch (error) {
    logger.error('Erro no barrido agendado', { error: error.message });
    return null;
  } finally {
    isScanning = false;
  }
}

/**
 * Executa barrido manual (chamado via API)
 */
export async function triggerManualScan() {
  logger.info('Barrido manual iniciado pelo usuário');
  return executeScan();
}

/**
 * Calcula o próximo horário de barrido
 */
function updateNextScanTime(intervalHours) {
  const now = new Date();
  const next = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
  
  // Se cair fora do horário de operação, ajustar para 08:00
  const brNext = new Date(next.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (brNext.getHours() < 8) {
    brNext.setHours(8, 0, 0, 0);
    nextScanTime = brNext;
  } else {
    nextScanTime = next;
  }
}

export function getNextScanTime() {
  return nextScanTime;
}

export function getScanStatus() {
  return {
    isScanning,
    nextScan: nextScanTime?.toISOString() || null,
    schedulerActive: !!scheduledTask
  };
}

export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler parado');
  }
}
