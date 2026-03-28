/**
 * scraper-google.js — Google Reviews via Places API
 * 
 * LIMITAÇÃO CONHECIDA: Google Places API retorna máximo 5 reviews
 * por local (10 com Places API New). Não há workaround oficial.
 * Para monitoramento mais completo, considerar usar a Places API (New)
 * com field mask reviews.
 */
import { logger } from './logger.js';
import { matchKeywords } from './keywords.js';
import { v4 as uuidv4 } from 'uuid';

// Lista de lojas conhecidas (pode ser expandida via API)
// Será populada dinamicamente na primeira execução
let knownStores = [];

/**
 * Busca reviews do Google Places para todas as lojas Leroy Merlin Brasil.
 */
export async function scrapeGoogleReviews(apiKey) {
  if (!apiKey) {
    logger.warn('Google Places API Key não configurada');
    return { complaints: [], duration: 0, error: 'API Key ausente' };
  }

  const startTime = Date.now();
  logger.info('Iniciando busca Google Reviews');

  try {
    // 1. Descobrir lojas se ainda não temos
    if (knownStores.length === 0) {
      knownStores = await discoverStores(apiKey);
      logger.info(`Descobertas ${knownStores.length} lojas Leroy Merlin`);
    }

    // 2. Buscar reviews de cada loja
    const allComplaints = [];
    
    for (const store of knownStores) {
      try {
        const reviews = await getPlaceReviews(store.place_id, apiKey);
        
        // Filtrar reviews negativas (rating <= 3)
        const negative = reviews.filter(r => r.rating <= 3);
        
        for (const review of negative) {
          const text = review.text || '';
          const matches = matchKeywords(text);
          
          if (matches.length > 0) {
            allComplaints.push({
              id: uuidv4(),
              source: 'google_reviews',
              external_id: `${store.place_id}_${review.time}`,
              title: `Review ${review.rating}★ - ${store.name}`,
              original_text: text,
              summary: '',
              author: review.author_name || 'Anônimo',
              published_at: review.time ? new Date(review.time * 1000).toISOString() : null,
              url: `https://search.google.com/local/reviews?placeid=${store.place_id}`,
              store_name: store.name,
              keywords_matched: matches
            });
          }
        }
        
        // Rate limiting: esperar 200ms entre requests
        await sleep(200);
        
      } catch (error) {
        logger.warn(`Erro ao buscar reviews da loja ${store.name}`, { error: error.message });
      }
    }

    logger.info(`Google Reviews: ${allComplaints.length} reclamações com keywords encontradas`);
    return { complaints: allComplaints, duration: Date.now() - startTime };

  } catch (error) {
    logger.error('Erro no scraping Google Reviews', { error: error.message });
    return { complaints: [], duration: Date.now() - startTime, error: error.message };
  }
}

/**
 * Descobre todas as lojas Leroy Merlin no Brasil via Text Search
 */
async function discoverStores(apiKey) {
  const stores = [];
  
  // Buscar em várias regiões para cobertura máxima
  const queries = [
    'Leroy Merlin Brasil',
    'Leroy Merlin São Paulo',
    'Leroy Merlin Rio de Janeiro',
    'Leroy Merlin Minas Gerais',
    'Leroy Merlin Brasília',
    'Leroy Merlin Curitiba',
    'Leroy Merlin Porto Alegre',
    'Leroy Merlin Recife',
    'Leroy Merlin Salvador',
    'Leroy Merlin Goiânia',
    'Leroy Merlin Belo Horizonte'
  ];

  const seenIds = new Set();

  for (const query of queries) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}&language=pt-BR&region=br`;
      
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          if (!seenIds.has(place.place_id) && 
              place.name.toLowerCase().includes('leroy merlin')) {
            seenIds.add(place.place_id);
            stores.push({
              place_id: place.place_id,
              name: place.name,
              address: place.formatted_address
            });
          }
        }
      }
      
      // Paginação: next_page_token
      if (data.next_page_token) {
        await sleep(2000); // Google exige 2s entre páginas
        const nextUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${data.next_page_token}&key=${apiKey}`;
        const nextRes = await fetch(nextUrl, { signal: AbortSignal.timeout(10000) });
        const nextData = await nextRes.json();
        if (nextData.results) {
          for (const place of nextData.results) {
            if (!seenIds.has(place.place_id) && 
                place.name.toLowerCase().includes('leroy merlin')) {
              seenIds.add(place.place_id);
              stores.push({ place_id: place.place_id, name: place.name, address: place.formatted_address });
            }
          }
        }
      }

      await sleep(300);
    } catch (error) {
      logger.warn(`Erro na busca "${query}"`, { error: error.message });
    }
  }

  return stores;
}

/**
 * Busca reviews de um local específico via Place Details
 */
async function getPlaceReviews(placeId, apiKey) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&key=${apiKey}&language=pt-BR&reviews_sort=newest`;
    
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    
    if (data.status === 'OK' && data.result?.reviews) {
      return data.result.reviews;
    }
    return [];
    
  } catch (error) {
    logger.warn(`Erro ao buscar reviews de ${placeId}`, { error: error.message });
    return [];
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Permite atualizar a lista de lojas manualmente
 */
export function setKnownStores(stores) {
  knownStores = stores;
}

export function getKnownStores() {
  return [...knownStores];
}
