-- Migration: Create google_analytics_connections table
-- This table stores Google Analytics OAuth tokens and GA4 property references

CREATE TABLE IF NOT EXISTS public.google_analytics_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT DEFAULT '',
  token_expires_at TIMESTAMPTZ NOT NULL,
  ga4_properties JSONB DEFAULT '[]'::jsonb,
  selected_property_id TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT google_analytics_connections_user_id_unique UNIQUE (user_id)
);

-- RLS policies
ALTER TABLE public.google_analytics_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'google_analytics_connections' AND policyname = 'Users can manage own GA connections'
  ) THEN
    CREATE POLICY "Users can manage own GA connections"
      ON public.google_analytics_connections
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
