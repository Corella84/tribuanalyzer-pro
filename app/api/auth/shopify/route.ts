import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const debug = searchParams.get('debug') === '1'

  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET
  const shop = process.env.SHOPIFY_SHOP_DOMAIN

  // Debug mode: return diagnostic JSON
  if (debug) {
    const diag: Record<string, any> = {
      hasApiKey: !!SHOPIFY_API_KEY,
      apiKeyPrefix: SHOPIFY_API_KEY?.slice(0, 6) || 'MISSING',
      hasApiSecret: !!SHOPIFY_API_SECRET,
      secretPrefix: SHOPIFY_API_SECRET?.slice(0, 6) || 'MISSING',
      shopDomain: shop || 'MISSING',
    }

    if (shop && SHOPIFY_API_KEY && SHOPIFY_API_SECRET) {
      try {
        const tokenUrl = `https://${shop}/admin/oauth/access_token`
        const body = new URLSearchParams({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          grant_type: 'client_credentials',
        })
        diag.requestUrl = tokenUrl
        diag.requestBody = body.toString().replace(SHOPIFY_API_SECRET, '***')

        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })

        diag.responseStatus = tokenResponse.status
        diag.responseHeaders = Object.fromEntries(tokenResponse.headers.entries())
        const responseText = await tokenResponse.text()
        diag.responseBody = responseText.slice(0, 1000)
        diag.responseLength = responseText.length

        try {
          const parsed = JSON.parse(responseText)
          diag.parsed = true
          diag.hasAccessToken = !!parsed.access_token
        } catch {
          diag.parsed = false
        }
      } catch (err: any) {
        diag.fetchError = err.message
      }
    }

    return NextResponse.json(diag, { status: 200 })
  }

  // Require auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  if (!shop || !SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return NextResponse.redirect(`${origin}/dashboard?error=shopify_not_configured`)
  }

  try {
    // Client credentials grant (Shopify Dev Dashboard apps, post-Jan 2026)
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
