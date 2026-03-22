-- ═══════════════════════════════════════════════════════════
-- TransportLedger — Supabase Schema
-- Run this entire file in Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── Master Data ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transport_owners (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  contact           TEXT,
  commission_rate   NUMERIC(10,2) NOT NULL DEFAULT 0,
  accidental_rate   NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_owner_id    UUID NOT NULL REFERENCES transport_owners(id) ON DELETE CASCADE,
  reg_number            TEXT NOT NULL,
  owner_name            TEXT NOT NULL,
  owner_contact         TEXT,
  gst_commission_rate   NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  rate_per_tonne  NUMERIC(10,2) NOT NULL,
  effective_from  DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Monthly Records ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trip_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id       UUID NOT NULL REFERENCES routes(id),
  month          TEXT NOT NULL,       -- YYYY-MM
  tonnes         NUMERIC(10,2) NOT NULL,
  rate_snapshot  NUMERIC(10,2) NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diesel_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  month         TEXT NOT NULL,
  fortnight     SMALLINT NOT NULL CHECK (fortnight IN (1,2)),
  litres        NUMERIC(10,2) NOT NULL,
  buy_rate      NUMERIC(8,2) NOT NULL,
  sell_rate     NUMERIC(8,2) NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  buy_amount    NUMERIC(12,2) NOT NULL,
  profit        NUMERIC(12,2) NOT NULL,
  deleted_at    TIMESTAMPTZ,
  delete_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gst_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id            UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  belongs_to_month      TEXT NOT NULL,
  entered_in_month      TEXT NOT NULL,
  gross_gst             NUMERIC(12,2) NOT NULL,
  gst_commission_rate   NUMERIC(5,4) NOT NULL,
  commission_on_gst     NUMERIC(12,2) NOT NULL,
  net_gst               NUMERIC(12,2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS other_deductions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  label       TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transport_income (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_owner_id  UUID NOT NULL REFERENCES transport_owners(id) ON DELETE CASCADE,
  month               TEXT NOT NULL,
  transport_payment   NUMERIC(12,2) NOT NULL DEFAULT 0,
  diesel_payment      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(transport_owner_id, month)
);

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_owner_id  UUID REFERENCES transport_owners(id) ON DELETE CASCADE,
  vehicle_id          UUID REFERENCES vehicles(id),
  paid_to             TEXT NOT NULL,
  amount              NUMERIC(12,2) NOT NULL,
  date                DATE NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('cheque','upi')),
  reference           TEXT,
  note                TEXT,
  month               TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_trip_vehicle_month    ON trip_entries(vehicle_id, month);
CREATE INDEX IF NOT EXISTS idx_diesel_vehicle_month  ON diesel_logs(vehicle_id, month);
CREATE INDEX IF NOT EXISTS idx_diesel_active         ON diesel_logs(vehicle_id, month) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gst_vehicle           ON gst_entries(vehicle_id, belongs_to_month);
CREATE INDEX IF NOT EXISTS idx_payments_transport    ON payments(transport_owner_id, month);
CREATE INDEX IF NOT EXISTS idx_payments_vehicle      ON payments(vehicle_id, month);
CREATE INDEX IF NOT EXISTS idx_deductions_vehicle    ON other_deductions(vehicle_id, month);
CREATE INDEX IF NOT EXISTS idx_income_transport      ON transport_income(transport_owner_id, month);

-- ── Portal Views (hide admin-only fields) ─────────────────────

CREATE OR REPLACE VIEW portal_diesel_logs AS
  SELECT id, vehicle_id, date, month, fortnight,
         litres,
         sell_rate AS rate,
         amount
  FROM diesel_logs
  WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW portal_gst_entries AS
  SELECT id, vehicle_id, belongs_to_month, net_gst
  FROM gst_entries;

-- ── Disable RLS for now (admin-only app, no public access) ────
-- Enable and configure RLS when building the owner portal

ALTER TABLE transport_owners    DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles            DISABLE ROW LEVEL SECURITY;
ALTER TABLE routes              DISABLE ROW LEVEL SECURITY;
ALTER TABLE trip_entries        DISABLE ROW LEVEL SECURITY;
ALTER TABLE diesel_logs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE gst_entries         DISABLE ROW LEVEL SECURITY;
ALTER TABLE other_deductions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE transport_income    DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments            DISABLE ROW LEVEL SECURITY;

-- Done! All tables created.
-- Next step: go back to the app and run yarn install
