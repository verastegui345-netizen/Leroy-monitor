/**
 * pdf-report.js — Gerador de relatorios PDF (v2)
 * Correcoes: emojis removidos, dados reais, texto limpo
 */
import PDFDocument from 'pdfkit';
import { getComplaints, getStats } from './database.js';
import { logger } from './logger.js';

const SEVERITY_CONFIG = {
  critico: { symbol: '[!!!]', label: 'CRITICO', color: '#DC2626' },
  grave:   { symbol: '[!!]',  label: 'GRAVE',   color: '#EA580C' },
  leve:    { symbol: '[!]',   label: 'LEVE',    color: '#CA8A04' }
};

const SOURCE_LABEL = {
  reclame_aqui: 'Reclame Aqui',
  google_reviews: 'Google Reviews'
};

function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[\u{E000}-\u{F8FF}]/gu, '')
    .trim();
}

function drawLine(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y)
    .strokeColor('#ccc').lineWidth(1).stroke();
}

export async function generateReport({ period = 'all', severity, source } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', margin: 50,
        info: { Title: 'Relatorio de Reclamacoes - Leroy Merlin Brasil' }
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const complaints = getComplaints({ severity, source, limit: 200 });
      logger.info('PDF: gerando com ' + complaints.length + ' reclamacoes');

      // CABECALHO
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('MONITOR DE RECLAMACOES', { align: 'center' });
      doc.fontSize(14).font('Helvetica').fillColor('#4a4a6a')
        .text('Instalacoes e Reformas - Leroy Merlin Brasil', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666')
        .text('Relatorio gerado em: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), { align: 'center' })
        .text('Total no sistema: ' + complaints.length, { align: 'center' });
      doc.moveDown(1);
      drawLine(doc);
      doc.moveDown(1);

      // RESUMO
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e').text('Resumo Executivo');
      doc.moveDown(0.5);

      const countBySev = { critico: 0, grave: 0, leve: 0 };
      complaints.forEach(c => { if (countBySev[c.severity] !== undefined) countBySev[c.severity]++; });

      doc.fontSize(12).font('Helvetica').fillColor('#333')
        .text('Total: ' + complaints.length);
      doc.font('Helvetica-Bold')
        .fillColor('#DC2626').text('  [!!!] Criticas: ' + countBySev.critico)
        .fillColor('#EA580C').text('  [!!]  Graves: ' + countBySev.grave)
        .fillColor('#CA8A04').text('  [!]   Leves: ' + countBySev.leve);

      const countBySrc = {};
      complaints.forEach(c => { countBySrc[c.source] = (countBySrc[c.source] || 0) + 1; });
      if (Object.keys(countBySrc).length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text('Por fonte:');
        for (const [src, count] of Object.entries(countBySrc)) {
          doc.fontSize(11).font('Helvetica').fillColor('#555')
            .text('  ' + (SOURCE_LABEL[src] || src) + ': ' + count);
        }
      }

      doc.moveDown(1);
      drawLine(doc);
      doc.moveDown(1);

      // LISTA
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e').text('Reclamacoes Detalhadas');
      doc.moveDown(0.5);

      if (complaints.length === 0) {
        doc.fontSize(12).font('Helvetica').fillColor('#666')
          .text('Nenhuma reclamacao encontrada.');
      } else {
        for (let i = 0; i < complaints.length; i++) {
          const c = complaints[i];
          const sev = SEVERITY_CONFIG[c.severity] || SEVERITY_CONFIG.leve;
          if (doc.y > 700) doc.addPage();

          doc.fontSize(11).font('Helvetica-Bold')
            .fillColor(sev.color).text(sev.symbol + ' [' + sev.label + '] ', { continued: true })
            .fillColor('#333').text(cleanText(c.title || 'Sem titulo'));

          const meta = [
            'Fonte: ' + (SOURCE_LABEL[c.source] || c.source),
            c.store_name ? 'Loja: ' + cleanText(c.store_name) : null,
            'Data: ' + (c.published_at || c.created_at || 'N/D'),
            c.author ? 'Autor: ' + cleanText(c.author) : null
          ].filter(Boolean).join(' | ');
          doc.fontSize(9).font('Helvetica').fillColor('#888').text(meta);

          if (c.summary) {
            doc.fontSize(10).font('Helvetica').fillColor('#444')
              .text(cleanText(c.summary), { indent: 10 });
          }

          if (c.url) {
            doc.fontSize(8).fillColor('#2563EB').text(c.url, { link: c.url, underline: true });
          }

          doc.moveDown(0.8);
          if (i < complaints.length - 1) {
            doc.moveTo(80, doc.y).lineTo(515, doc.y).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
            doc.moveDown(0.4);
          }
        }
      }

      doc.moveDown(2);
      drawLine(doc);
      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica').fillColor('#999')
        .text('Relatorio gerado automaticamente pelo Monitor de Instalacoes e Reformas.', { align: 'center' })
        .text('Classificacoes geradas por IA - validar com a equipe.', { align: 'center' });

      doc.end();
    } catch (error) {
      logger.error('Erro ao gerar PDF', { error: error.message });
      reject(error);
    }
  });
}
