import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID?.trim()
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET?.trim()

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const authCode = searchParams.get('auth_code')
  const error = searchParams.get('error')

  if (error || !authCode) {
    console.error('TikTok auth error:', error)
    return NextResponse.redirect(`${origin}/dashboard?error=tiktok_auth_failed`)
  }

  try {
    // Exchange auth_code for access_token
    const tokenResponse = await fetch(`${TIKTOK_API_BASE}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: TIKTOK_APP_ID,
        secret: TIKTOK_APP_SECRET,
        auth_code: authCode,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.code !== 0 || !tokenData.data?.access_token) {
      console.error('TikTok token error:', tokenData)
      return NextResponse.redirect(`${origin}/dashboard?error=tiktok_no_token`)
    }

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      advertiser_ids: advertiserIds,
      expires_in: expiresIn,
      refresh_token_expires_in: refreshExpiresIn,
    } = tokenData.data

    // Fetch advertiser info
    let advertisers: any[] = []
    if (advertiserIds && advertiserIds.length > 0) {
      const advResponse = await fetch(
        `${TIKTOK_API_BASE}/advertiser/info/?advertiser_ids=${JSON.stringify(advertiserIds)}`,
        {
          headers: { 'Access-Token': accessToken },
        }
      )
      const advData = await advResponse.json()
      if (advData.code === 0 && advData.data?.list) {
        advertisers = advData.data.list.map((adv: any) => ({
          id: adv.advertiser_id,
          name: adv.advertiser_name || adv.advertiser_id,
          currency: adv.currency || 'USD',
          status: adv.status,
        }))
      }
    }

    // Get Supabase user
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(`${origin}/login`)
    }

    // Save TikTok connection
    const now = new Date()
    const { error: upsertError } = await supabase
      .from('tiktok_connections')
      .upsert({
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken || null,
        advertiser_ids: advertiserIds || [],
        advertisers: advertisers,
        expires_at: expiresIn ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null,
        refresh_expires_at: refreshExpiresIn ? new Date(now.getTime() + refreshExpiresIn * 1000).toISOString() : null,
        connected_at: now.toISOString(),
      }, {
        onConflict: 'user_id'
      })

    if (upsertError) {
      console.error('Error saving TikTok connection:', upsertError)
    }

    return NextResponse.redirect(`${origin}/dashboard?tiktok=connected`)

  } catch (err) {
    console.error('TikTok OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard?error=tiktok_auth_error`)
  }
}
