import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID
const META_APP_SECRET = process.env.META_APP_SECRET
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`
  : 'http://localhost:3001/api/auth/meta/callback'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${origin}/dashboard?error=meta_auth_failed`)
  }

  try {
    // Exchange code for access token
    const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
    tokenUrl.searchParams.set('client_id', META_APP_ID!)
    tokenUrl.searchParams.set('client_secret', META_APP_SECRET!)
    tokenUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    tokenUrl.searchParams.set('code', code)

    const tokenResponse = await fetch(tokenUrl.toString())
    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      console.error('No access token received:', tokenData)
      return NextResponse.redirect(`${origin}/dashboard?error=no_token`)
    }

    const accessToken = tokenData.access_token

    // Get user's ad accounts
    const accountsResponse = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=id,name,account_status,currency`
    )
    const accountsData = await accountsResponse.json()

    // Get Supabase user
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(`${origin}/login`)
    }

    // Save Meta connection to Supabase
    const { error: upsertError } = await supabase
      .from('meta_connections')
      .upsert({
        user_id: user.id,
        access_token: accessToken,
        ad_accounts: accountsData.data || [],
        connected_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })

    if (upsertError) {
      console.error('Error saving Meta connection:', upsertError)
      // Continue anyway - token will be in memory for this session
    }

    return NextResponse.redirect(`${origin}/dashboard?meta=connected`)

  } catch (err) {
    console.error('Meta OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard?error=meta_auth_error`)
  }
}
