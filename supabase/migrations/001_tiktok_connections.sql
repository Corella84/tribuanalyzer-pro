-- TikTok connections table (mirrors meta_connections pattern)
CREATE TABLE IF NOT EXISTS public.tiktok_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  advertiser_ids JSONB DEFAULT '[]'::jsonb,
  advertisers JSONB DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tiktok_connections_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_connections_user_id
  ON public.tiktok_connections(user_id);

ALTER TABLE public.tiktok_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tiktok connection"
  ON public.tiktok_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tiktok connection"
  ON public.tiktok_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tiktok connection"
  ON public.tiktok_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tiktok connection"
  ON public.tiktok_connections FOR DELETE
  USING (auth.uid() = user_id);
