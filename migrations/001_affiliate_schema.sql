-- Migration 001: Schema affiliate para canal de ofertas tech
-- Projeto: tech-deals-affiliate-v1
-- Owner: TechMidia

BEGIN;

CREATE SCHEMA IF NOT EXISTS affiliate;

-- ─── Ofertas brutas coletadas ─────────────────────────────────────────────────
CREATE TABLE affiliate.offers_raw (
  id              BIGSERIAL PRIMARY KEY,
  source          VARCHAR(32) NOT NULL,          -- 'promobit'|'amazon'|'mercadolivre'|'shopee'|'pelando'
  external_id     VARCHAR(255),                  -- id do produto na origem
  hash_dedup      VARCHAR(64) UNIQUE NOT NULL,   -- sha256(url_canonical + sku)
  title           TEXT NOT NULL,
  description     TEXT,
  url_original    TEXT NOT NULL,
  store           VARCHAR(64) NOT NULL,          -- 'amazon'|'mercadolivre'|'shopee'|outras
  category        VARCHAR(64),                   -- 'smartphone'|'notebook'|'periferico'|...
  brand           VARCHAR(128),
  price_current   NUMERIC(10,2) NOT NULL,
  price_original  NUMERIC(10,2),
  discount_pct    NUMERIC(5,2),
  rating          NUMERIC(3,2),
  reviews_count   INTEGER,
  image_url       TEXT,
  raw_payload     JSONB,                         -- payload completo da fonte
  collected_at    TIMESTAMPTZ DEFAULT NOW(),
  processed       BOOLEAN DEFAULT FALSE,
  processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_offers_raw_processed ON affiliate.offers_raw(processed, collected_at);
CREATE INDEX idx_offers_raw_store_cat ON affiliate.offers_raw(store, category);

-- ─── Ofertas aprovadas pela curadoria ─────────────────────────────────────────
CREATE TABLE affiliate.offers_approved (
  id              BIGSERIAL PRIMARY KEY,
  raw_id          BIGINT REFERENCES affiliate.offers_raw(id),
  score           INTEGER NOT NULL,              -- 0-100 do curador
  score_reasoning TEXT,                          -- justificativa do agente
  affiliate_url   TEXT NOT NULL,
  shortlink       TEXT,                          -- https://jao.lol/d/{code}
  copy_generated  TEXT NOT NULL,                 -- texto pronto pra postar
  priority_tier   VARCHAR(8) DEFAULT 'normal',   -- 'high'|'normal'|'low'
  approved_at     TIMESTAMPTZ DEFAULT NOW(),
  posted          BOOLEAN DEFAULT FALSE,
  posted_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ                    -- ofertas vencem em 24h se não postadas
);

CREATE INDEX idx_offers_approved_posted ON affiliate.offers_approved(posted, priority_tier, approved_at);

-- ─── Log de posts publicados ──────────────────────────────────────────────────
CREATE TABLE affiliate.posts_log (
  id              BIGSERIAL PRIMARY KEY,
  approved_id     BIGINT REFERENCES affiliate.offers_approved(id),
  telegram_msg_id BIGINT,
  channel_id      VARCHAR(64),
  posted_at       TIMESTAMPTZ DEFAULT NOW(),
  views           INTEGER DEFAULT 0,
  views_updated_at TIMESTAMPTZ
);

-- ─── Eventos de clique (via shortlink próprio) ────────────────────────────────
CREATE TABLE affiliate.click_events (
  id              BIGSERIAL PRIMARY KEY,
  approved_id     BIGINT REFERENCES affiliate.offers_approved(id),
  shortlink_code  VARCHAR(16) NOT NULL,
  clicked_at      TIMESTAMPTZ DEFAULT NOW(),
  user_agent      TEXT,
  ip_hash         VARCHAR(64),                   -- sha256 do IP (LGPD)
  referrer        TEXT
);

CREATE INDEX idx_click_events_approved ON affiliate.click_events(approved_id, clicked_at);

-- ─── Cache de produtos já postados (dedup 30 dias) ────────────────────────────
CREATE TABLE affiliate.posted_cache (
  hash_dedup      VARCHAR(64) PRIMARY KEY,
  posted_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

-- ─── Slot de publicidade futura (preparação v2) ───────────────────────────────
CREATE TABLE affiliate.sponsored_campaigns (
  id              BIGSERIAL PRIMARY KEY,
  advertiser      VARCHAR(128) NOT NULL,
  content         TEXT NOT NULL,                 -- markdown do bloco patrocinado
  active          BOOLEAN DEFAULT FALSE,         -- v1 sempre FALSE
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  posts_remaining INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Whitelist/Blacklist de marcas ────────────────────────────────────────────
CREATE TABLE affiliate.brand_rules (
  brand           VARCHAR(128) PRIMARY KEY,
  status          VARCHAR(16) NOT NULL,          -- 'whitelist'|'blacklist'|'neutral'
  notes           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Tabela de shortlinks (mapeamento code → affiliate_url) ──────────────────
CREATE TABLE affiliate.shortlinks (
  code            VARCHAR(16) PRIMARY KEY,
  affiliate_url   TEXT NOT NULL,
  approved_id     BIGINT REFERENCES affiliate.offers_approved(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Histórico de preços (detectar fake discount) ────────────────────────────
CREATE TABLE affiliate.price_history (
  id              BIGSERIAL PRIMARY KEY,
  hash_dedup      VARCHAR(64) NOT NULL,
  price           NUMERIC(10,2) NOT NULL,
  observed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_hash ON affiliate.price_history(hash_dedup, observed_at);

-- ─── Seeds: marcas confiáveis ─────────────────────────────────────────────────
INSERT INTO affiliate.brand_rules (brand, status) VALUES
  ('Apple','whitelist'),('Samsung','whitelist'),('Xiaomi','whitelist'),
  ('Logitech','whitelist'),('Razer','whitelist'),('Corsair','whitelist'),
  ('AMD','whitelist'),('Intel','whitelist'),('NVIDIA','whitelist'),
  ('Kingston','whitelist'),('Crucial','whitelist'),('WD','whitelist'),('Seagate','whitelist'),
  ('LG','whitelist'),('Sony','whitelist'),('JBL','whitelist'),('Anker','whitelist'),
  ('Asus','whitelist'),('Acer','whitelist'),('Dell','whitelist'),('Lenovo','whitelist'),('HP','whitelist'),
  ('Motorola','whitelist'),('Realme','whitelist'),('Poco','whitelist');

-- ─── Seeds: blacklist genéricos/dropshipping ──────────────────────────────────
INSERT INTO affiliate.brand_rules (brand, status) VALUES
  ('Generic','blacklist'),('No Brand','blacklist'),('Importado','blacklist');

COMMIT;
