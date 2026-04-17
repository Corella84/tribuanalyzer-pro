import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID?.trim()
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL?.trim()
  ? `${process.env.NEXT_PUBLIC_APP_URL.trim()}/api/auth/tiktok/callback`
  : 'http://localhost:3001/api/auth/tiktok/callback'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login'))
  }

  const state = user.id

  const authUrl = new URL('https://business-api.tiktok.com/portal/auth')
  authUrl.searchParams.set('app_id', TIKTOK_APP_ID!)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)

  return NextResponse.redirect(authUrl.toString())
}
