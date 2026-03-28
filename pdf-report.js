/**
 * pdf-report.js — Gerador de relatórios PDF
 * 
 * Gera relatório consolidado das reclamações com:
 * - Resumo executivo
 * - Contadores por gravidade
 * - Lista detalhada de reclamações
 */
import PDFDocument from 'pdfkit';
import { getComplaints, getStats } from './database.js';
import { logger } from './logger.js';

const SEVERITY_CONFIG = {
  critico: { emoji: '🔴', label: 'CRÍTICO', color: '#DC2626' },
  grave: { emoji: '🟠', label: 'GRAVE', color: '#EA580C' },
  leve: { emoji: '🟡', label: 'LEVE', color: '#CA8A04' }
};

const SOURCE_LABEL = {
  reclame_aqui: 'Reclame Aqui',
  google_reviews: 'Google Reviews'
};

/**
 * Gera PDF de relatório e retorna como Buffer
 */
export async function generateReport({ period = '24h', severity, source } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 50,
        info: {
          Title: 'Relatório de Reclamações — Leroy Merlin Brasil',
          Author: 'Monitor de Instalações e Reformas',
          Subject: `Período: ${period}`
        }
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const stats = getStats(period);
      const complaints = getComplaints({ severity, source, limit: 200 });
      const now = new Date();

      // === CABEÇALHO ===
      doc.fontSize(22).font('Helvetica-Bold')
        .fillColor('#1a1a2e')
        .text('MONITOR DE RECLAMAÇÕES', { align: 'center' });
      
      doc.fontSize(14).font('Helvetica')
        .fillColor('#4a4a6a')
        .text('Instalações e Reformas — Leroy Merlin Brasil', { align: 'center' });
      
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666')
        .text(`Relatório gerado em: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, { align: 'center' })
        .text(`Período: ${formatPeriod(period)}`, { align: 'center' });
      
      doc.moveDown(1);
      drawLine(doc);
      doc.moveDown(1);

      // === RESUMO EXECUTIVO ===
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('Resumo Executivo');
      doc.moveDown(0.5);

      const sevCounts = stats.bySeverity;
      const summaryData = [
        { label: 'Total de reclamações', value: String(stats.total) },
        { label: '🔴 Críticas', value: String(sevCounts.critico || 0), color: '#DC2626' },
        { label: '🟠 Graves', value: String(sevCounts.grave || 0), color: '#EA580C' },
        { label: '🟡 Leves', value: String(sevCounts.leve || 0), color: '#CA8A04' },
      ];

      for (const item of summaryData) {
        doc.fontSize(12).font('Helvetica')
          .fillColor(item.color || '#333')
          .text(`${item.label}: `, { continued: true })
          .font('Helvetica-Bold')
          .text(item.value);
      }

      if (Object.keys(stats.bySource).length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#333')
          .text('Por fonte:');
        for (const [src, count] of Object.entries(stats.bySource)) {
          doc.fontSize(11).font('Helvetica').fillColor('#555')
            .text(`  ${SOURCE_LABEL[src] || src}: ${count}`);
        }
      }

      doc.moveDown(1);
      drawLine(doc);
      doc.moveDown(1);

      // === LISTA DE RECLAMAÇÕES ===
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('Reclamações Detalhadas');
      doc.moveDown(0.5);

      if (complaints.length === 0) {
        doc.fontSize(12).font('Helvetica').fillColor('#666')
          .text('Nenhuma reclamação encontrada no período selecionado.');
      } else {
        for (let i = 0; i < complaints.length; i++) {
          const c = complaints[i];
          const sev = SEVERITY_CONFIG[c.severity] || SEVERITY_CONFIG.leve;
          
          // Verificar se precisa de nova página
          if (doc.y > 700) {
            doc.addPage();
          }

          // Header da reclamação
          doc.fontSize(11).font('Helvetica-Bold')
            .fillColor(sev.color)
            .text(`${sev.emoji} [${sev.label}] `, { continued: true })
            .fillColor('#333')
            .text(c.title || 'Sem título', { continued: false });
          
          // Metadados
          doc.fontSize(9).font('Helvetica').fillColor('#888')
            .text([
              `Fonte: ${SOURCE_LABEL[c.source] || c.source}`,
              c.store_name ? `Loja: ${c.store_name}` : null,
              `Data: ${c.published_at || c.created_at || 'N/D'}`,
              c.author ? `Autor: ${c.author}` : null
            ].filter(Boolean).join(' | '));
          
          // Resumo
          doc.fontSize(10).font('Helvetica').fillColor('#444')
            .text(c.summary || '(sem resumo)', { indent: 10 });
          
          // Link
          if (c.url) {
            doc.fontSize(8).fillColor('#2563EB')
              .text(c.url, { link: c.url, underline: true });
          }

          doc.moveDown(0.8);
          
          // Separador leve entre reclamações
          if (i < complaints.length - 1) {
            doc.moveTo(80, doc.y).lineTo(515, doc.y)
              .strokeColor('#e5e5e5').lineWidth(0.5).stroke();
            doc.moveDown(0.4);
          }
        }
      }

      // === RODAPÉ ===
      doc.moveDown(2);
      drawLine(doc);
      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica').fillColor('#999')
        .text('Relatório gerado automaticamente pelo Monitor de Instalações e Reformas.', { align: 'center' })
        .text('As classificações de gravidade são geradas por IA e devem ser validadas pela equipe.', { align: 'center' });

      doc.end();
      
    } catch (error) {
      logger.error('Erro ao gerar PDF', { error: error.message });
      reject(error);
    }
  });
}

function drawLine(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y)
    .strokeColor('#ccc').lineWidth(1).stroke();
}

function formatPeriod(period) {
  const labels = { '24h': 'Últimas 24 horas', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', 'all': 'Todo o período' };
  return labels[period] || period;
}
