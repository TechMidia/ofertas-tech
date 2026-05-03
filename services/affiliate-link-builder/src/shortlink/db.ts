import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.PG_DSN });

export async function saveShortlink(code: string, affiliateUrl: string, approvedId?: number): Promise<void> {
  await pool.query(
    `INSERT INTO affiliate.shortlinks (code, affiliate_url, approved_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (code) DO NOTHING`,
    [code, affiliateUrl, approvedId ?? null]
  );
}

export async function resolveShortlink(code: string): Promise<{ affiliateUrl: string; approvedId: number | null } | null> {
  const result = await pool.query<{ affiliate_url: string; approved_id: number | null }>(
    'SELECT affiliate_url, approved_id FROM affiliate.shortlinks WHERE code = $1',
    [code]
  );
  if (result.rows.length === 0) return null;
  return { affiliateUrl: result.rows[0].affiliate_url, approvedId: result.rows[0].approved_id };
}

export async function logClick(
  code: string,
  approvedId: number | null,
  userAgent: string,
  ipHash: string,
  referrer: string
): Promise<void> {
  await pool.query(
    `INSERT INTO affiliate.click_events (approved_id, shortlink_code, user_agent, ip_hash, referrer)
     VALUES ($1, $2, $3, $4, $5)`,
    [approvedId, code, userAgent, ipHash, referrer]
  );
}
