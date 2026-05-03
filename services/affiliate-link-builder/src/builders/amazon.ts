import { URL } from 'url';

const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG ?? '';

export function buildAmazonUrl(originalUrl: string): string {
  const url = new URL(originalUrl);

  // Remove qualquer tag existente e injeta a nossa
  url.searchParams.set('tag', PARTNER_TAG);

  // Garante domínio BR
  if (!url.hostname.includes('amazon.com.br')) {
    url.hostname = 'www.amazon.com.br';
  }

  return url.toString();
}
