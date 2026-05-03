import 'dotenv/config';
import { Pool } from 'pg';
import { sendPhoto, sendMessage } from './telegram';
import { renderSponsoredBlock, SponsoredCampaign } from './template';

const pool = new Pool({ connectionString: process.env.PG_DSN });
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID ?? '';

// Mínimo de ofertas no buffer antes de disparar coleta extra
const BUFFER_MIN = 12;

// Determina o tier desejado com base na hora atual (BRT = UTC-3)
function getDesiredTier(hourUtc: number): 'high' | 'normal' | 'low' {
  const hourBrt = (hourUtc - 3 + 24) % 24;

  if (hourBrt === 12 || (hourBrt >= 19 && hourBrt <= 22)) return 'high';
  if ((hourBrt >= 8 && hourBrt <= 11) || (hourBrt >= 14 && hourBrt <= 18)) return 'normal';
  return 'low';
}

async function checkBuffer(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM affiliate.offers_approved
     WHERE posted = FALSE AND expires_at > NOW()`
  );
  return Number(result.rows[0].count);
}

interface ApprovedOffer {
  id: number;
  raw_id: number;
  affiliate_url: string;
  shortlink: string | null;
  copy_generated: string;
  priority_tier: string;
  image_url: string | null;
}

async function getNextOffer(tier: string): Promise<ApprovedOffer | null> {
  // Tenta primeiro o tier desejado, depois desce a prioridade
  const tiers =
    tier === 'high' ? ['high', 'normal', 'low'] :
    tier === 'normal' ? ['normal', 'high', 'low'] :
    ['low', 'normal', 'high'];

  for (const t of tiers) {
    const result = await pool.query<ApprovedOffer>(
      `SELECT oa.id, oa.raw_id, oa.affiliate_url, oa.shortlink, oa.copy_generated, oa.priority_tier,
              r.image_url
       FROM affiliate.offers_approved oa
       JOIN affiliate.offers_raw r ON r.id = oa.raw_id
       WHERE oa.posted = FALSE
         AND oa.expires_at > NOW()
         AND oa.priority_tier = $1
       ORDER BY oa.approved_at ASC
       LIMIT 1`,
      [t]
    );

    if (result.rows.length > 0) return result.rows[0];
  }

  return null;
}

async function getActiveCampaign(): Promise<SponsoredCampaign | null> {
  const result = await pool.query<SponsoredCampaign>(
    `SELECT id, content FROM affiliate.sponsored_campaigns
     WHERE active = TRUE
       AND starts_at <= NOW()
       AND ends_at >= NOW()
       AND posts_remaining > 0
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

async function markPosted(offerId: number, telegramMsgId: number): Promise<void> {
  await pool.query(
    'UPDATE affiliate.offers_approved SET posted=TRUE, posted_at=NOW() WHERE id=$1',
    [offerId]
  );

  await pool.query(
    `INSERT INTO affiliate.posts_log (approved_id, telegram_msg_id, channel_id)
     VALUES ($1, $2, $3)`,
    [offerId, telegramMsgId, CHANNEL_ID]
  );

  // Adiciona ao cache de deduplicação (30 dias)
  await pool.query(
    `INSERT INTO affiliate.posted_cache (hash_dedup, expires_at)
     SELECT r.hash_dedup, NOW() + INTERVAL '30 days'
     FROM affiliate.offers_approved oa
     JOIN affiliate.offers_raw r ON r.id = oa.raw_id
     WHERE oa.id = $1
     ON CONFLICT (hash_dedup) DO NOTHING`,
    [offerId]
  );
}

async function decrementCampaignSlot(campaignId: number): Promise<void> {
  await pool.query(
    `UPDATE affiliate.sponsored_campaigns
     SET posts_remaining = posts_remaining - 1
     WHERE id = $1 AND posts_remaining > 0`,
    [campaignId]
  );
}

export async function runScheduler(): Promise<void> {
  const nowUtc = new Date().getUTCHours();
  const tier = getDesiredTier(nowUtc);

  console.log(JSON.stringify({
    level: 'info', event: 'scheduler_run', tier, hourUtc: nowUtc,
    timestamp: new Date().toISOString(),
  }));

  // Verifica buffer — alerta se insuficiente
  const bufferCount = await checkBuffer();
  if (bufferCount < BUFFER_MIN) {
    console.log(JSON.stringify({
      level: 'warn', event: 'low_buffer', count: bufferCount, threshold: BUFFER_MIN,
    }));
    // Em produção: disparar webhook/n8n para coletar + curar mais ofertas
  }

  const offer = await getNextOffer(tier);
  if (!offer) {
    console.log(JSON.stringify({ level: 'warn', event: 'no_offer_available', tier }));
    return;
  }

  const campaign = await getActiveCampaign();
  const sponsoredBlock = renderSponsoredBlock(campaign);
  const finalCopy = offer.copy_generated + sponsoredBlock;

  let messageId: number;

  try {
    if (offer.image_url) {
      const result = await sendPhoto(offer.image_url, finalCopy);
      messageId = result.message_id;
    } else {
      const result = await sendMessage(finalCopy);
      messageId = result.message_id;
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error', event: 'telegram_send_error', offerId: offer.id, err: String(err),
    }));
    return;
  }

  await markPosted(offer.id, messageId);

  if (campaign) {
    await decrementCampaignSlot(campaign.id);
  }

  console.log(JSON.stringify({
    level: 'info', event: 'offer_posted', offerId: offer.id, messageId, tier: offer.priority_tier,
  }));
}

// Execução direta (chamado pelo cron `0 * * * *`)
runScheduler()
  .catch((err) => {
    console.error(JSON.stringify({ level: 'error', event: 'fatal', err: String(err) }));
    process.exit(1);
  })
  .finally(() => pool.end());
