/**
 * classifier.js — Classificação de gravidade por IA (v2)
 * 
 * REGRA FUNDAMENTAL: só classificar reclamações onde o cliente
 * EXPLICITAMENTE menciona que a Leroy Merlin executou ou deveria
 * executar um serviço de instalação, montagem ou reforma.
 * 
 * Níveis:
 * - leve / grave / critico: reclamação confirmada sobre serviço LM
 * - duvida: menção a termos relacionados mas não é claro se LM executou o serviço
 * - descartado: não tem relação com serviço de instalação/reforma
 */
import { logger } from './logger.js';
import { getKeywordConfidence } from './keywords.js';

const CLASSIFICATION_PROMPT = `Você é um analista RIGOROSO do serviço de instalações e reformas da Leroy Merlin Brasil.

SUA ÚNICA MISSÃO: identificar reclamações onde a Leroy Merlin EXECUTOU ou DEVERIA TER EXECUTADO um serviço de instalação, montagem ou reforma para o cliente.

REGRA FUNDAMENTAL - LEIA COM ATENÇÃO:
A Leroy Merlin vende produtos E também oferece serviços de instalação/montagem/reforma. Você SÓ deve classificar reclamações sobre o SERVIÇO, não sobre produtos.

DESCARTAR (relevance: "descartado") se a reclamação é sobre:
- Entrega de produto (mesmo que o cliente mencione "obra" — ele comprou material, LM não instalou)
- Atendimento de funcionário em loja
- Defeito de produto comprado
- Preço, cobrança, frete
- Cliente que comprou material para obra própria e reclama do produto
- Qualquer situação onde LM apenas VENDEU algo, não EXECUTOU serviço

DÚVIDA (relevance: "duvida") se:
- O cliente menciona "instalação" ou "montagem" mas não fica claro se foi LM quem fez
- Pode ser que o cliente contratou externamente
- O texto é ambíguo

CONFIRMAR como relevante APENAS se o cliente EXPLICITAMENTE indica que:
- Contratou serviço de instalação/montagem/reforma DA Leroy Merlin
- Um técnico/prestador ENVIADO pela Leroy Merlin fez ou deveria fazer o serviço
- Houve agendamento técnico pela Leroy Merlin
- O serviço foi pago à Leroy Merlin

Se CONFIRMADO como relevante, classificar gravidade:
🟡 LEVE: Atraso leve no agendamento, pequena falha de comunicação sobre o serviço
🟠 GRAVE: Técnico não compareceu, serviço mal executado precisando refazer, múltiplas visitas sem solução, prazo muito ultrapassado
🔴 CRÍTICO: Dano material causado pelo serviço, risco de segurança (elétrico/estrutural/hidráulico), reforma abandonada, possível fraude

RECLAMAÇÃO PARA ANALISAR:
Título: {TITLE}
Texto: {TEXT}
Fonte: {SOURCE}
Loja: {STORE}

RESPONDA EXATAMENTE neste formato JSON, sem markdown:
{
  "relevance": "confirmado|duvida|descartado",
  "reason": "Explicação em 1 linha de por que é ou não relevante",
  "severity": "leve|grave|critico|null",
  "summary": "Resumo em até 3 linhas (só se relevante ou dúvida)",
  "service_type": "instalação|montagem|reforma|null"
}`;

/**
 * Classifica uma reclamação usando a API do Claude
 */
export async function classifyComplaint(complaint, apiKey) {
  if (!apiKey) {
    logger.warn('Claude API Key não configurada — classificação heurística');
    return fallbackClassification(complaint);
  }

  try {
    const prompt = CLASSIFICATION_PROMPT
      .replace('{TITLE}', complaint.title || 'Sem título')
      .replace('{TEXT}', (complaint.original_text || '').substring(0, 2000))
      .replace('{SOURCE}', complaint.source === 'reclame_aqui' ? 'Reclame Aqui' : 'Google Reviews')
      .replace('{STORE}', complaint.store_name || 'Não informada');

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
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Resposta IA sem JSON válido', { text });
      return fallbackClassification(complaint);
    }

    const result = JSON.parse(jsonMatch[0]);
    
    // Se descartado pela IA, retornar null para não inserir no DB
    if (result.relevance === 'descartado') {
      logger.info(`Descartado pela IA: ${complaint.title?.substring(0, 50)}`);
      return null;
    }

    // Se dúvida, marcar como tal
    if (result.relevance === 'duvida') {
      return {
        severity: 'duvida',
        summary: `[COM DÚVIDA] ${result.summary || result.reason || complaint.title}`,
        ai_analysis: JSON.stringify(result)
      };
    }

    // Confirmado — validar severity
    const validSeverities = ['leve', 'grave', 'critico'];
    const severity = validSeverities.includes(result.severity) ? result.severity : 'grave';

    return {
      severity,
      summary: result.summary || complaint.title || 'Sem resumo',
      ai_analysis: JSON.stringify(result)
    };

  } catch (error) {
    logger.error('Erro na classificação IA', { error: error.message });
    return fallbackClassification(complaint);
  }
}

/**
 * Classificação heurística sem IA
 */
function fallbackClassification(complaint) {
  const text = `${complaint.title || ''} ${complaint.original_text || ''}`.toLowerCase();
  const { confidence } = getKeywordConfidence(text);
  
  // Se confiança baixa, marcar como dúvida
  if (confidence === 'medium') {
    return {
      severity: 'duvida',
      summary: `[COM DÚVIDA] ${complaint.title || (complaint.original_text || '').substring(0, 200)}`,
      ai_analysis: JSON.stringify({ method: 'heuristic', relevance: 'duvida' })
    };
  }

  const criticWords = [
    'perigo', 'risco', 'choque', 'vazamento', 'infiltração',
    'desabou', 'fraude', 'abandonou', 'incêndio', 'curto-circuito',
    'estrutural', 'rachadura'
  ];
  
  const graveWords = [
    'não resolveu', 'sem solução', 'várias visitas', 'não compareceu',
    'refazer', 'péssimo', 'horrível', 'procon', 'justiça', 'indenização',
    'não apareceu', 'mal feito', 'mal executado'
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
 * Classifica um lote — descarta os não relevantes
 */
export async function classifyBatch(complaints, apiKey) {
  const results = [];
  
  for (const complaint of complaints) {
    const classification = await classifyComplaint(complaint, apiKey);
    
    // null = descartado pela IA, não inserir
    if (classification !== null) {
      results.push({ ...complaint, ...classification });
    }
    
    if (apiKey) await new Promise(r => setTimeout(r, 500));
  }
  
  logger.info(`Classificação: ${complaints.length} analisadas, ${results.length} relevantes, ${complaints.length - results.length} descartadas`);
  return results;
}
