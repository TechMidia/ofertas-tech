import crypto from 'crypto';
import axios from 'axios';

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID ?? '';
const SHOPEE_SECRET = process.env.SHOPEE_SECRET ?? '';
const GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

function buildSignature(timestamp: number, payload: string): string {
  const raw = `${SHOPEE_APP_ID}${timestamp}${payload}${SHOPEE_SECRET}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function buildShopeeUrl(originalUrl: string, subId = ''): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);

  const query = `
    mutation GenerateShortLink($input: GenerateShortLinkInput!) {
      generateShortLink(input: $input) {
        shortLink
        lifetimeLink
      }
    }
  `;

  const variables = {
    input: {
      originUrl: originalUrl,
      subIds: subId ? [subId] : [],
    },
  };

  const payload = JSON.stringify({ query, variables });
  const signature = buildSignature(timestamp, payload);

  try {
    const response = await axios.post(GRAPHQL_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': SHOPEE_APP_ID,
        'Timestamp': String(timestamp),
        'Signature': signature,
      },
      timeout: 5000,
    });

    const link = response.data?.data?.generateShortLink?.shortLink;
    if (link) return link;
  } catch {
    // Fallback para URL original
  }

  return originalUrl;
}
