-- Track apakah user sudah dapat first-contact welcome message.
-- Dipakai oleh core/middleware/welcome.ts.

ALTER TABLE users ADD COLUMN welcomed BOOLEAN NOT NULL DEFAULT false;
