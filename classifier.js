/**
 * classifier.js — Classificação de gravidade por IA (Claude API)
 * 
 * Analisa cada reclamação filtrada e atribui nível de gravidade:
 * - leve: insatisfação menor, atraso leve
 * - grave: problema sério não resolvido, múltiplas visitas sem solução
 * - critico: dano material, risco de segurança, fraude, abandono de reforma
 */
import { logger } from './logger.js';

const CLASSIFICATION_PROMPT = `Você é um analista de qualidade do serviço de instalações e reformas da Leroy Merlin Brasil. Analise a reclamação abaixo e classifique conforme as regras:

NÍVEIS DE GRAVIDADE:
🟡 LEVE: Insatisfação menor, atraso leve, pequeno mal-entendido, demora no agendamento, falta de comunicação pontual.
🟠 GRAVE: Problema sério não resolvido, múltiplas visitas sem solução, dano menor à propriedade, prestador não compareceu, serviço mal feito precisando refazer, prazo muito ultrapassado.
🔴 CRÍTICO: Dano material significativo, risco de segurança (exposição elétrica, estrutural, hidráulica), possível fraude, reforma abandonada no meio, infiltração/vazamento causado pelo serviço, risco à integridade física.

RECLAMAÇÃO:
Título: {TITLE}
Texto: {TEXT}
Fonte: {SOURCE}

RESPONDA EXATAMENTE neste formato JSON, sem markdown:
{
  "severity": "leve|grave|critico",
  "summary": "Resumo em até 3 linhas objetivas do problema",
  "risk_factors": ["fator1", "fator2"],
  "recommended_action": "Ação recomendada em 1 linha"
}`;

/**
 * Classifica uma reclamação usando a API do Claude
 */
export async function classifyComplaint(complaint, apiKey) {
  if (!apiKey) {
    logger.warn('Claude API Key não configurada — classificação manual');
    return fallbackClassification(complaint);
  }

  try {
    const prompt = CLASSIFICATION_PROMPT
      .replace('{TITLE}', complaint.title || 'Sem título')
      .replace('{TEXT}', (complaint.original_text || '').substring(0, 2000))
      .replace('{SOURCE}', complaint.source === 'reclame_aqui' ? 'Reclame Aqui' : 'Google Reviews');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    // Parsear JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Resposta da IA não contém JSON válido', { text });
      return fallbackClassification(complaint);
    }

    const result = JSON.parse(jsonMatch[0]);
    
    // Validar severity
    const validSeverities = ['leve', 'grave', 'critico'];
    if (!validSeverities.includes(result.severity)) {
      result.severity = 'grave'; // default conservador
    }

    return {
      severity: result.severity,
      summary: result.summary || complaint.title || 'Sem resumo disponível',
      ai_analysis: JSON.stringify(result)
    };

  } catch (error) {
    logger.error('Erro na classificação IA', { error: error.message });
    return fallbackClassification(complaint);
  }
}

/**
 * Classificação por heurística quando a IA não está disponível.
 * Usa palavras-chave de alto risco para determinar gravidade.
 */
function fallbackClassification(complaint) {
  const text = `${complaint.title || ''} ${complaint.original_text || ''}`.toLowerCase();
  
  const criticWords = [
    'perigo', 'perigoso', 'risco', 'elétric', 'eletric', 'choque',
    'vazamento', 'infiltração', 'infiltracao', 'desabou', 'desmoron',
    'fraude', 'golpe', 'abandonou', 'abandonaram', 'sumiu', 'sumiram',
    'incêndio', 'incendio', 'curto-circuito', 'curto circuito',
    'estrutural', 'rachadur', 'trinca'
  ];
  
  const graveWords = [
    'não resolveu', 'nao resolveu', 'sem solução', 'sem solucao',
    'várias visitas', 'varias visitas', 'múltiplas', 'multiplas',
    'dano', 'estrago', 'quebrou', 'quebraram', 'refazer',
    'nunca mais', 'péssimo', 'pessimo', 'horrível', 'horrivel',
    'absurdo', 'inadmissível', 'inadmissivel', 'processo',
    'procon', 'justiça', 'justica', 'advogado', 'indenização'
  ];

  if (criticWords.some(w => text.includes(w))) {
    return {
      severity: 'critico',
      summary: complaint.title || (complaint.original_text || '').substring(0, 200),
      ai_analysis: JSON.stringify({ method: 'heuristic', severity: 'critico' })
    };
  }
  
  if (graveWords.some(w => text.includes(w))) {
    return {
      severity: 'grave',
      summary: complaint.title || (complaint.original_text || '').substring(0, 200),
      ai_analysis: JSON.stringify({ method: 'heuristic', severity: 'grave' })
    };
  }

  return {
    severity: 'leve',
    summary: complaint.title || (complaint.original_text || '').substring(0, 200),
    ai_analysis: JSON.stringify({ method: 'heuristic', severity: 'leve' })
  };
}

/**
 * Classifica um lote de reclamações com rate limiting
 */
export async function classifyBatch(complaints, apiKey) {
  const results = [];
  
  for (const complaint of complaints) {
    const classification = await classifyComplaint(complaint, apiKey);
    results.push({ ...complaint, ...classification });
    
    // Rate limiting: 500ms entre chamadas para Haiku
    if (apiKey) await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}
