import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY
const SHOPIFY_SCOPES = 'read_orders,read_products,read_analytics'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  // Require auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  // Get shop from query param or env (single-store mode)
  const { searchParams } = new URL(request.url)
  const shop = searchParams.get('shop') || process.env.SHOPIFY_SHOP_DOMAIN

  if (!shop) {
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_no_shop`)
  }

  if (!SHOPIFY_API_KEY) {
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_not_configured`)
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/shopify/callback`
  const nonce = crypto.randomUUID().replace(/-/g, '')

  // Store nonce in cookie for verification
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`)
  authUrl.searchParams.set('client_id', SHOPIFY_API_KEY)
  authUrl.searchParams.set('scope', SHOPIFY_SCOPES)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', nonce)

  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('shopify_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 300, // 5 min
  })
  return response
}
