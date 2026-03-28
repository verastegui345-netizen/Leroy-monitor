/**
 * keywords.js — Palavras-chave para filtro de reclamações
 * Relacionadas a instalações e reformas.
 */
export const KEYWORDS = [
  'instalação', 'instalacion', 'instalação',
  'reforma', 'reformas',
  'montagem', 'montaje',
  'técnico', 'tecnico',
  'serviço de instalação', 'servico de instalacao',
  'obra', 'pedreiro',
  'mão de obra', 'mao de obra', 'mano de obra',
  'instalador',
  'agendamento técnico', 'agendamento tecnico',
  'visita técnica', 'visita tecnica',
  'prestador', 'prestadora',
  'manutenção', 'manutencao',
  'encanador', 'eletricista', 'pintor',
  'desmontagem', 'remontagem'
];

/**
 * Verifica se o texto contém pelo menos uma keyword.
 * Retorna as keywords encontradas.
 */
export function matchKeywords(text) {
  if (!text) return [];
  const lower = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  return KEYWORDS.filter(kw => {
    const kwNorm = kw.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return lower.includes(kwNorm);
  });
}
