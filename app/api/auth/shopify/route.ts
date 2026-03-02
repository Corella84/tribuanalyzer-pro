import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET

export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  // Require auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const shop = process.env.SHOPIFY_SHOP_DOMAIN
  if (!shop || !SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_not_configured`)
  }

  try {
    // Client credentials grant (Shopify Dev Dashboard apps, post-Jan 2026)
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'follow',
      body: new URLSearchParams({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        grant_type: 'client_credentials',
      }),
    })

    const responseText = await tokenResponse.text()
    let tokenData: any
    try {
      tokenData = JSON.parse(responseText)
    } catch {
      console.error('Shopify non-JSON response:', tokenResponse.status, responseText.slice(0, 500))
      return NextResponse.redirect(`${origin}/dashboard?error=shopify_auth_error`)
    }

    if (!tokenData.access_token) {
      console.error('Shopify client credentials error:', tokenData)
      return NextResponse.redirect(`${origin}/dashboard?error=shopify_no_token`)
    }

    // Save connection to Supabase
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 86399) * 1000).toISOString()

    const { error: upsertError } = await supabase
      .from('shopify_connections')
      .upsert({
        user_id: user.id,
        shop_domain: shop,
        access_token: tokenData.access_token,
        scope: tokenData.scope || '',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) {
      console.error('Error saving Shopify connection:', upsertError)
    }

    return NextResponse.redirect(`${origin}/dashboard?shopify=connected`)

  } catch (err) {
    console.error('Shopify auth error:', err)
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_auth_error`)
  }
}
