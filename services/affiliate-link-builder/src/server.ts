import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { customAlphabet } from 'nanoid';
import { buildAmazonUrl } from './builders/amazon';
import { buildMercadoLivreUrl } from './builders/mercadolivre';
import { buildShopeeUrl } from './builders/shopee';
import { saveShortlink, resolveShortlink, logClick } from './shortlink/db';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const app = express();
app.use(express.json());

// Endpoint de redirecionamento do shortlink
app.get('/d/:code', async (req: Request, res: Response) => {
  const { code } = req.params;
  const record = await resolveShortlink(code);

  if (!record) {
    res.status(404).send('Link não encontrado');
    return;
  }

  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ?? req.ip ?? '';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
  const userAgent = req.headers['user-agent'] ?? '';
  const referrer = req.headers['referer'] ?? '';

  await logClick(code, record.approvedId, userAgent, ipHash, referrer);

  res.redirect(302, record.affiliateUrl);
});

// Endpoint para construir link afiliado + shortlink
app.post('/api/build', async (req: Request, res: Response) => {
  const { url, store, approved_id } = req.body as {
    url: string;
    store: 'amazon' | 'mercadolivre' | 'shopee' | string;
    approved_id?: number;
  };

  if (!url || !store) {
    res.status(400).json({ error: 'url e store são obrigatórios' });
    return;
  }

  let affiliateUrl: string;

  switch (store.toLowerCase()) {
    case 'amazon':
      affiliateUrl = buildAmazonUrl(url);
      break;
    case 'mercadolivre':
      affiliateUrl = await buildMercadoLivreUrl(url);
      break;
    case 'shopee':
      affiliateUrl = await buildShopeeUrl(url);
      break;
    default:
      // Lojas sem integração específica: retorna a URL original
      affiliateUrl = url;
  }

  const code = nanoid();
  const baseUrl = process.env.SHORTLINK_BASE_URL ?? 'https://go.techmidia.com/d';
  const shortlink = `${baseUrl}/${code}`;

  await saveShortlink(code, affiliateUrl, approved_id);

  res.json({ affiliate_url: affiliateUrl, shortlink, code });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'affiliate-link-builder' });
});

export default app;
