import { URL } from 'url';
import axios from 'axios';

const ML_AFFILIATE_TAG  = process.env.ML_AFFILIATE_TAG  ?? '';
const ML_AFFILIATE_TOOL = process.env.ML_AFFILIATE_TOOL ?? '';
const ML_ACCESS_TOKEN   = process.env.ML_ACCESS_TOKEN   ?? '';

// Injeta os parâmetros de rastreamento direto na URL do produto
function injectTrackingParams(originalUrl: string): string {
  try {
    const url = new URL(originalUrl);
    url.searchParams.set('matt_word', ML_AFFILIATE_TAG);
    url.searchParams.set('matt_tool', ML_AFFILIATE_TOOL);
    return url.toString();
  } catch {
    return originalUrl;
  }
}

// Tenta gerar link via API de afiliados — fallback para injeção direta
export async function buildMercadoLivreUrl(originalUrl: string): Promise<string> {
  if (!ML_ACCESS_TOKEN) {
    return injectTrackingParams(originalUrl);
  }

  try {
    const response = await axios.post(
      'https://api.mercadolibre.com/affiliates/link',
      { urls: [originalUrl], matt_word: ML_AFFILIATE_TAG, matt_tool: ML_AFFILIATE_TOOL },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ML_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      }
    );

    const result = response.data?.[0];
    if (result?.affiliate_url) return result.affiliate_url;
  } catch {
    // API indisponível — injeta parâmetros diretamente
  }

  return injectTrackingParams(originalUrl);
}
