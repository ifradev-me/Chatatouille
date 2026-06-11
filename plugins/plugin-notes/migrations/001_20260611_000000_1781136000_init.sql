-- Tabel milik plugin-notes.
--
-- File ini dijalankan migration runner dengan search_path = plugin_notes, public
-- — semua object TANPA schema qualifier otomatis masuk schema "plugin_notes".
-- JANGAN tulis "CREATE TABLE public.notes" atau qualifier schema lain.
--
-- Uninstall bersih (semua data plugin di satu schema):
--   DROP SCHEMA plugin_notes CASCADE;
--   DELETE FROM _migrations WHERE filename LIKE 'plugin-notes/%';

CREATE TABLE notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id    TEXT NOT NULL,
  platform   TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notes_user_idx ON notes (from_id, platform, created_at DESC);
