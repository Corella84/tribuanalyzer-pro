import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/setup-ga4
 *
 * Creates the google_analytics_connections table if it doesn't exist,
 * then reports current state. Hit this once after deploy.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json({
      ok: false,
      error: 'Missing SUPABASE_SERVICE_ROLE_KEY. Set it in Vercel → Settings → Environment Variables.',
      hint: 'Get it from Supabase Dashboard → Settings → API → service_role key',
    }, { status: 500 })
  }

  const supabase = createClient(url, serviceKey)
  const results: string[] = []

  // 1. Check if table exists by trying a query
  const { data: existing, error: checkError } = await supabase
    .from('google_analytics_connections')
    .select('user_id')
    .limit(1)

  if (checkError && checkError.message.includes('does not exist')) {
    // Table doesn't exist — create it via raw SQL
    const { error: createError } = await supabase.rpc('exec_sql', {
      query: `
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
        ALTER TABLE public.google_analytics_connections ENABLE ROW LEVEL SECURITY;
      `
    })

    if (createError) {
      results.push(`Table creation via RPC failed: ${createError.message}`)
      results.push('Run the SQL manually in Supabase Dashboard → SQL Editor')
      results.push('Copy from: supabase/migrations/002_google_analytics_connections.sql')
    } else {
      results.push('Table created successfully')
    }
  } else if (checkError) {
    results.push(`Table check error: ${checkError.message}`)
  } else {
    results.push(`Table exists. Current rows: ${existing?.length ?? 0}`)
  }

  // 2. Check if there are any connections
  const { data: connections, error: connError } = await supabase
    .from('google_analytics_connections')
    .select('user_id, selected_property_id, token_expires_at, updated_at, refresh_token')
    .order('updated_at', { ascending: false })

  if (connError) {
    results.push(`Connection query error: ${connError.message}`)
  } else if (!connections || connections.length === 0) {
    results.push('No GA4 connections found. Go to /dashboard and click "Connect Google Analytics"')
  } else {
    for (const c of connections) {
      const expired = new Date(c.token_expires_at).getTime() < Date.now()
      const hasRefresh = !!c.refresh_token && c.refresh_token !== ''
      results.push(
        `Connection for user ${c.user_id}: ` +
        `property=${c.selected_property_id || 'none'}, ` +
        `token_expired=${expired}, ` +
        `has_refresh_token=${hasRefresh}, ` +
        `last_updated=${c.updated_at}`
      )
    }
  }

  // 3. Check env vars
  const envCheck = {
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'not set',
  }

  return NextResponse.json({
    ok: true,
    results,
    env: envCheck,
    next_step: connections && connections.length > 0
      ? 'GA4 connection exists. Try calling get_ga4_properties from MCP.'
      : 'No connection. Visit /dashboard and click "Connect Google Analytics" to authorize.',
  })
}
