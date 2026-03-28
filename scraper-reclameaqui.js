/**
 * scraper-reclameaqui.js — Scraper do Reclame Aqui
 * 
 * Estratégias de fallback múltiplas para lidar com proteções anti-bot.
 */
import * as cheerio from 'cheerio';
import { logger } from './logger.js';
import { matchKeywords } from './keywords.js';
import { v4 as uuidv4 } from 'uuid';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Origin': 'https://www.reclameaqui.com.br',
  'Referer': 'https://www.reclameaqui.com.br/',
};

export async function scrapeReclameAqui() {
  logger.info('Iniciando scraping Reclame Aqui');
  const startTime = Date.now();
  
  try {
    // Estratégia 1: API de busca interna
    let complaints = await fetchFromSearchAPI();
    
    // Estratégia 2: HTML scraping direto
    if (!complaints || complaints.length === 0) {
      logger.warn('API de busca RA falhou, tentando HTML');
      complaints = await fetchFromHTML();
    }
    
    if (!complaints || complaints.length === 0) {
      logger.warn('Nenhuma reclamação encontrada no RA');
      return { complaints: [], duration: Date.now() - startTime };
    }

    // Filtrar por keywords
    const filtered = complaints.filter(c => {
      const text = `${c.title || ''} ${c.original_text || ''}`;
      const matches = matchKeywords(text);
      if (matches.length > 0) { c.keywords_matched = matches; return true; }
      return false;
    });

    logger.info(`RA: ${complaints.length} total, ${filtered.length} com keywords`);
    return { complaints: filtered, duration: Date.now() - startTime };

  } catch (error) {
    logger.error('Erro scraping RA', { error: error.message });
    return { complaints: [], duration: Date.now() - startTime, error: error.message };
  }
}

async function fetchFromSearchAPI() {
  try {
    const url = `https://iosearch.reclameaqui.com.br/raichu-io-site-search-v1/query/companyComplains/20/0?company=leroy-merlin`;
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;

    const data = await response.json();
    const items = data?.complainResult?.complains?.data || data?.data || [];
    if (!Array.isArray(items) || items.length === 0) return null;

    return items.map(item => ({
      id: uuidv4(),
      source: 'reclame_aqui',
      external_id: String(item.id || item._id || item.complainId || uuidv4()),
      title: item.title || item.subject || '',
      original_text: item.description || item.complain || item.text || '',
      author: item.userName || item.user?.name || 'Anônimo',
      published_at: item.created || item.createDate || null,
      url: item.id ? `https://www.reclameaqui.com.br/leroy-merlin/${item.id}` : 'https://www.reclameaqui.com.br/empresa/leroy-merlin',
      store_name: item.location || null,
      keywords_matched: []
    }));
  } catch (error) {
    logger.warn('API busca RA falhou', { error: error.message });
    return null;
  }
}

async function fetchFromHTML() {
  try {
    const url = 'https://www.reclameaqui.com.br/empresa/leroy-merlin/lista-reclamacoes/';
    const response = await fetch(url, { 
      headers: { ...HEADERS, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow'
    });
    if (!response.ok) return null;

    const html = await response.text();
    const complaints = [];

    // Tentar __NEXT_DATA__ primeiro (mais confiável)
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        const props = nextData?.props?.pageProps;
        const items = props?.complaints?.data || props?.complains || [];
        for (const item of items) {
          complaints.push({
            id: uuidv4(),
            source: 'reclame_aqui',
            external_id: String(item.id || item._id),
            title: item.title || item.subject || '',
            original_text: item.description || item.complain || '',
            author: item.userName || 'Anônimo',
            published_at: item.created || null,
            url: `https://www.reclameaqui.com.br/leroy-merlin/${item.id || item._id}`,
            store_name: null,
            keywords_matched: []
          });
        }
      } catch (e) {
        logger.warn('Parse __NEXT_DATA__ falhou', { error: e.message });
      }
    }

    // Fallback: cheerio HTML parse
    if (complaints.length === 0) {
      const $ = cheerio.load(html);
      const selectors = [
        '[data-testid="complaint-item"]', '.complaint-item',
        'a[href*="/leroy-merlin/"]'
      ];
      
      let $items;
      for (const sel of selectors) {
        $items = $(sel);
        if ($items.length > 0) break;
      }

      if ($items && $items.length > 0) {
        $items.each((_, el) => {
          const $el = $(el);
          const title = $el.find('h4, .complaint-title').text().trim();
          const text = $el.find('p, .complaint-text').text().trim();
          const href = $el.attr('href') || $el.find('a').attr('href') || '';
          const idMatch = href.match(/\/([a-zA-Z0-9_-]+)\/?$/);
          
          if (title || text) {
            complaints.push({
              id: uuidv4(),
              source: 'reclame_aqui',
              external_id: idMatch ? idMatch[1] : uuidv4(),
              title, original_text: text || title,
              author: 'Anônimo', published_at: null,
              url: href.startsWith('http') ? href : `https://www.reclameaqui.com.br${href}`,
              store_name: null, keywords_matched: []
            });
          }
        });
      }
    }

    return complaints.length > 0 ? complaints : null;
  } catch (error) {
    logger.warn('HTML scraping RA falhou', { error: error.message });
    return null;
  }
}
