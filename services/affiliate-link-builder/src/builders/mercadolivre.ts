import axios from 'axios';

const ML_AFFILIATE_TAG = process.env.ML_AFFILIATE_TAG ?? '';

// Chama a API de afiliados do ML para gerar link rastreado
export async function buildMercadoLivreUrl(originalUrl: string): Promise<string> {
  try {
    const response = await axios.post(
      'https://api.mercadolibre.com/affiliates/link',
      { urls: [originalUrl] },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-affiliate-tag': ML_AFFILIATE_TAG,
        },
        timeout: 5000,
      }
    );

    const result = response.data?.[0];
    if (result?.affiliate_url) {
      return result.affiliate_url;
    }
  } catch {
    // Fallback: retorna URL original se API falhar
  }

  return originalUrl;
}
