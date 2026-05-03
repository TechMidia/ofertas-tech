import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.PG_DSN });
const GATEWAY = process.env.DEEPSEEK_GATEWAY ?? 'http://localhost:18789';
const MODEL = 'deepseek/deepseek-chat';
const THRESHOLD = Number(process.env.CURATOR_SCORE_THRESHOLD ?? 70);

const systemPrompt = fs.readFileSync(
  path.join(__dirname, 'prompts', 'system.md'),
  'utf-8'
);

interface OfferRaw {
  id: number;
  hash_dedup: string;
  title: string;
  description: string | null;
  url_original: string;
  store: string;
  category: string | null;
  brand: string | null;
  price_current: number;
  price_original: number | null;
  discount_pct: number | null;
  rating: number | null;
  reviews_count: number | null;
  image_url: string | null;
}

interface CuratorResult {
  score: number;
  approve: boolean;
  reasoning: string;
  category_normalized: string;
  priority_tier: 'high' | 'normal' | 'low';
  red_flags: string[];
  hook: string;
  product_line: string;
  extra_note: string;
}

async function getPriceHistory(hashDedup: string): Promise<{ price: number; observed_at: string }[]> {
  const result = await pool.query(
    `SELECT price::float, observed_at::text FROM affiliate.price_history
     WHERE hash_dedup = $1 AND observed_at > NOW() - INTERVAL '30 days'
     ORDER BY observed_at DESC`,
    [hashDedup]
  );
  return result.rows;
}

async function getBrandStatus(brand: string | null): Promise<string> {
  if (!brand) return 'unknown';
  const result = await pool.query(
    'SELECT status FROM affiliate.brand_rules WHERE LOWER(brand) = LOWER($1)',
    [brand]
  );
  return result.rows[0]?.status ?? 'unknown';
}

// Cache S2: pula se este produto já foi curado e aprovado nos últimos 30 dias
async function isCached(hashDedup: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM affiliate.offers_approved oa
     JOIN affiliate.offers_raw r ON r.id = oa.raw_id
     WHERE r.hash_dedup = $1 AND oa.approved_at > NOW() - INTERVAL '30 days'`,
    [hashDedup]
  );
  return result.rows.length > 0;
}

async function callDeepseek(userMessage: string): Promise<string> {
  const response = await axios.post(
    `${GATEWAY}/v1/chat/completions`,
    {
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,  // um pouco de criatividade para os hooks
      max_tokens: 600,
    },
    { timeout: 30000 }
  );
  return response.data.choices[0].message.content as string;
}

async function buildShortlink(originalUrl: string, store: string): Promise<string> {
  try {
    const res = await axios.post('http://localhost:18790/api/build', {
      url: originalUrl,
      store,
    }, { timeout: 5000 });
    return res.data.shortlink as string;
  } catch {
    return originalUrl;
  }
}

// Monta o copy final no formato do canal Tech Ofertas
function generateCopy(offer: OfferRaw, result: CuratorResult, shortlink: string): string {
  // Escapa apenas os caracteres que o Telegram MarkdownV2 exige fora de blocos bold/italic
  const escV2 = (s: string) => s.replace(/[_[\]()~`>#+\-=|{}.!]/g, '\\$&');

  // Linha de preço: ~DE X~ | *POR Y* no pix
  const priceOriginal = offer.price_original
    ? `~DE ${fmt(offer.price_original)}~ \\| `
    : '';
  const priceLine = `🔥 ${priceOriginal}*POR ${fmt(offer.price_current)}* no pix`;

  // Nota extra (cupom, cashback, frete) — em itálico se presente
  const extraLine = result.extra_note?.trim()
    ? `✅ _${escV2(result.extra_note.trim())}_`
    : '';

  const lines = [
    result.hook,                // ex: NOTEBOOK DE DEV SEM VENDER RIM
    '',
    result.product_line,        // ex: 💻 *Dell Inspiron 15, i5 12ª gen, 16GB, SSD 512GB*
    '',
    priceLine,
    ...(extraLine ? [extraLine] : []),
    '',
    `🔗${shortlink}`,
  ];

  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function processOffer(offer: OfferRaw): Promise<void> {
  const cached = await isCached(offer.hash_dedup);
  if (cached) {
    console.log(JSON.stringify({ level: 'info', event: 'cache_hit', hash: offer.hash_dedup }));
    await pool.query('UPDATE affiliate.offers_raw SET processed=true, processed_at=NOW() WHERE id=$1', [offer.id]);
    return;
  }

  const [priceHistory, brandStatus] = await Promise.all([
    getPriceHistory(offer.hash_dedup),
    getBrandStatus(offer.brand),
  ]);

  const userMessage = JSON.stringify({
    offer: {
      title: offer.title,
      description: offer.description,
      store: offer.store,
      category: offer.category,
      brand: offer.brand,
      price_current: offer.price_current,
      price_original: offer.price_original,
      discount_pct: offer.discount_pct,
      rating: offer.rating,
      reviews_count: offer.reviews_count,
    },
    price_history: priceHistory,
    brand_status: brandStatus,
    current_date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
  });

  let result: CuratorResult;
  try {
    const raw = await callDeepseek(userMessage);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta sem JSON válido');
    result = JSON.parse(jsonMatch[0]) as CuratorResult;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'curator_parse_error', id: offer.id, err: String(err) }));
    await pool.query('UPDATE affiliate.offers_raw SET processed=true, processed_at=NOW() WHERE id=$1', [offer.id]);
    return;
  }

  // Salva histórico de preço independente de aprovação (para detectar fake discount futuro)
  await pool.query(
    'INSERT INTO affiliate.price_history (hash_dedup, price) VALUES ($1, $2)',
    [offer.hash_dedup, offer.price_current]
  );

  if (!result.approve || result.score < THRESHOLD) {
    console.log(JSON.stringify({
      level: 'info', event: 'offer_rejected', id: offer.id, score: result.score,
      flags: result.red_flags,
    }));
    await pool.query('UPDATE affiliate.offers_raw SET processed=true, processed_at=NOW() WHERE id=$1', [offer.id]);
    return;
  }

  const shortlink = await buildShortlink(offer.url_original, offer.store);
  const copy = generateCopy(offer, result, shortlink);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await pool.query(
    `INSERT INTO affiliate.offers_approved
       (raw_id, score, score_reasoning, affiliate_url, shortlink, copy_generated, priority_tier, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      offer.id,
      result.score,
      result.reasoning,
      shortlink,
      shortlink,
      copy,
      result.priority_tier,
      expiresAt,
    ]
  );

  await pool.query('UPDATE affiliate.offers_raw SET processed=true, processed_at=NOW() WHERE id=$1', [offer.id]);

  console.log(JSON.stringify({
    level: 'info', event: 'offer_approved',
    id: offer.id, score: result.score, tier: result.priority_tier, hook: result.hook,
  }));
}

async function run(): Promise<void> {
  const { rows } = await pool.query<OfferRaw>(
    `SELECT id, hash_dedup, title, description, url_original, store, category,
            brand, price_current::float, price_original::float, discount_pct::float,
            rating::float, reviews_count, image_url
     FROM affiliate.offers_raw
     WHERE processed = FALSE
     ORDER BY collected_at ASC
     LIMIT 50`
  );

  if (rows.length === 0) {
    console.log(JSON.stringify({ level: 'info', event: 'no_offers_to_process' }));
    return;
  }

  console.log(JSON.stringify({ level: 'info', event: 'processing_batch', count: rows.length }));

  for (const offer of rows) {
    await processOffer(offer);
  }
}

run()
  .catch((err) => {
    console.error(JSON.stringify({ level: 'error', event: 'fatal', err: String(err) }));
    process.exit(1);
  })
  .finally(() => pool.end());
