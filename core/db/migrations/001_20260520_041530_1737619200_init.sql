-- Initial schema. UUID via gen_random_uuid() (built-in di Postgres 13+).

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id      TEXT NOT NULL,
  platform     TEXT NOT NULL,
  name         TEXT,
  phone_number TEXT,
  lid          TEXT,
  banned       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, platform)
);

CREATE INDEX users_platform_idx ON users (platform);

CREATE TABLE history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id    TEXT NOT NULL,
  platform   TEXT NOT NULL,
  text       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'bot')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX history_user_idx ON history (from_id, platform, created_at DESC);

-- Generic ad-hoc storage untuk ctx.db.save("collection", data).
-- Plugin yang butuh schema sendiri sebaiknya tambah migration terpisah.
CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_collection_idx ON events (collection, created_at DESC);
