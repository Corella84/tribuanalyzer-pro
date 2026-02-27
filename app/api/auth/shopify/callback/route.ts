import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  if (!code || !shop || !hmac) {
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_invalid_callback`)
  }

  // Verify HMAC signature from Shopify
  if (SHOPIFY_API_SECRET) {
    const params = new URLSearchParams(searchParams)
    params.delete('hmac')
    params.sort()
    const message = params.toString()
    const digest = createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex')

    if (digest !== hmac) {
      console.error('Shopify HMAC verification failed')
      return NextResponse.redirect(`${origin}/dashboard?error=shopify_hmac_failed`)
    }
  }

  try {
    // Exchange code for permanent access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      console.error('Shopify: no access_token received', tokenData)
      return NextResponse.redirect(`${origin}/dashboard?error=shopify_no_token`)
    }

    // Get authenticated user
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${origin}/login`)

    // Save connection to Supabase
    const { error: upsertError } = await supabase
      .from('shopify_connections')
      .upsert({
        user_id: user.id,
        shop_domain: shop,
        access_token: tokenData.access_token,
        scope: tokenData.scope,
        connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) {
      console.error('Error saving Shopify connection:', upsertError)
      // Continue — not fatal
    }

    const response = NextResponse.redirect(`${origin}/dashboard?shopify=connected`)
    response.cookies.delete('shopify_oauth_nonce')
    return response

  } catch (err) {
    console.error('Shopify OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_auth_error`)
  }
}
