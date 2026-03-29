/**
 * keywords.js — Palavras-chave para filtro de reclamações (v2)
 * 
 * REGRA: só capturar reclamações onde o cliente EXPLICITAMENTE
 * menciona que a Leroy Merlin estava EXECUTANDO um serviço
 * de instalação ou reforma. Não capturar:
 * - Problemas de entrega de material
 * - Atendimento de funcionários em loja
 * - Defeito de produto comprado
 * - Cliente que comprou material para obra própria
 */

// Keywords de alta confiança: indicam serviço executado pela LM
export const KEYWORDS_HIGH = [
  'serviço de instalação',
  'servico de instalacao',
  'serviço de montagem',
  'servico de montagem',
  'agendamento técnico',
  'agendamento tecnico',
  'visita técnica',
  'visita tecnica',
  'prestador de serviço',
  'prestador de servico',
  'prestadora',
  'instalador da leroy',
  'instalador enviado',
  'técnico da leroy',
  'tecnico da leroy',
  'técnico enviado',
  'tecnico enviado',
  'equipe de instalação',
  'equipe de instalacao',
  'equipe de montagem',
  'contratei a instalação',
  'contratei a instalacao',
  'contratei o serviço',
  'contratei o servico',
  'contratei a montagem',
  'paguei pela instalação',
  'paguei pela instalacao',
  'paguei pela montagem',
  'paguei pelo serviço',
  'paguei pelo servico',
  'serviço contratado',
  'servico contratado',
  'serviço de reforma',
  'servico de reforma',
  'reforma contratada',
  'instalação contratada',
  'instalacao contratada',
  'montagem contratada',
  'reagendamento',
  'reagendaram',
  'não vieram instalar',
  'nao vieram instalar',
  'não apareceu para instalar',
  'nao apareceu para instalar',
  'não veio montar',
  'nao veio montar',
  'instalação mal feita',
  'instalacao mal feita',
  'montagem mal feita',
  'instalaram errado',
  'montaram errado',
  'serviço mal executado',
  'servico mal executado',
];

// Keywords de confiança média: podem indicar serviço, mas precisam de contexto
export const KEYWORDS_MEDIUM = [
  'instalação',
  'instalacao',
  'montagem',
  'reforma',
  'técnico',
  'tecnico',
  'instalador',
  'mão de obra',
  'mao de obra',
];

/**
 * Verifica se o texto contém keywords de ALTA confiança (serviço executado pela LM).
 * Retorna { confidence: 'high'|'medium'|'none', keywords: [...] }
 */
export function matchKeywords(text) {
  if (!text) return [];
  const lower = normalize(text);
  
  // Primeiro: verificar keywords de alta confiança
  const highMatches = KEYWORDS_HIGH.filter(kw => lower.includes(normalize(kw)));
  if (highMatches.length > 0) return highMatches;
  
  // Segundo: verificar keywords médias (serão marcadas como "dúvida" pelo classificador)
  const mediumMatches = KEYWORDS_MEDIUM.filter(kw => lower.includes(normalize(kw)));
  if (mediumMatches.length > 0) return mediumMatches;
  
  return [];
}

/**
 * Retorna nível de confiança das keywords encontradas
 */
export function getKeywordConfidence(text) {
  if (!text) return { confidence: 'none', keywords: [] };
  const lower = normalize(text);
  
  const highMatches = KEYWORDS_HIGH.filter(kw => lower.includes(normalize(kw)));
  if (highMatches.length > 0) return { confidence: 'high', keywords: highMatches };
  
  const mediumMatches = KEYWORDS_MEDIUM.filter(kw => lower.includes(normalize(kw)));
  if (mediumMatches.length > 0) return { confidence: 'medium', keywords: mediumMatches };
  
  return { confidence: 'none', keywords: [] };
}

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
