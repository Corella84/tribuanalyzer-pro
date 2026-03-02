import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SHOPIFY_API_VERSION = '2024-10'

async function refreshShopifyToken(shop: string): Promise<string | null> {
  const clientId = process.env.SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET
  if (!clientId || !clientSecret) return null

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const data = await res.json()
  return data.access_token || null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const datePreset = searchParams.get('date_preset') || 'last_7d'

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Get Shopify connection
    const { data: connection } = await supabase
      .from('shopify_connections')
      .select('access_token, shop_domain, updated_at')
      .eq('user_id', user.id)
      .single()

    if (!connection?.access_token) {
      return NextResponse.json({ success: false, needsConnection: true })
    }

    let accessToken = connection.access_token
    const shop = connection.shop_domain

    // Refresh token if older than 23 hours
    const tokenAge = Date.now() - new Date(connection.updated_at).getTime()
    if (tokenAge > 23 * 60 * 60 * 1000) {
      const newToken = await refreshShopifyToken(shop)
      if (newToken) {
        accessToken = newToken
        await supabase
          .from('shopify_connections')
          .update({ access_token: newToken, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
      }
    }

    // Calculate date range
    const now = new Date()
    const days = datePreset === 'last_7d' ? 7 : datePreset === 'last_14d' ? 14 : 30
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const sinceStr = since.toISOString()

    // Fetch orders from Shopify
    const url = new URL(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json`
    )
    url.searchParams.set('status', 'any')
    url.searchParams.set('created_at_min', sinceStr)
    url.searchParams.set('limit', '250')
    url.searchParams.set('fields', 'id,name,created_at,total_price,subtotal_price,financial_status,line_items,source_name,referring_site,landing_site')

    const ordersResponse = await fetch(url.toString(), {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })

    if (!ordersResponse.ok) {
      // If 401, token might be invalid — try refreshing once
      if (ordersResponse.status === 401) {
        const newToken = await refreshShopifyToken(shop)
        if (newToken) {
          await supabase
            .from('shopify_connections')
            .update({ access_token: newToken, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
          // Retry with new token
          const retryResponse = await fetch(url.toString(), {
            headers: { 'X-Shopify-Access-Token': newToken, 'Content-Type': 'application/json' },
          })
          if (retryResponse.ok) {
            const { orders } = await retryResponse.json()
            return buildOrdersResponse(orders, shop)
          }
        }
      }
      const err = await ordersResponse.json()
      console.error('Shopify orders error:', err)
      return NextResponse.json({ success: false, error: 'Error fetching Shopify orders' })
    }

    const { orders } = await ordersResponse.json()
    return buildOrdersResponse(orders, shop)

  } catch (err) {
    console.error('Error in shopify/orders route:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}

function buildOrdersResponse(orders: any[], shopDomain: string) {
  const paidOrders = (orders || []).filter((o: any) =>
    ['paid', 'partially_paid'].includes(o.financial_status)
  )

  const totalRevenue = paidOrders.reduce((sum: number, o: any) =>
    sum + parseFloat(o.total_price || '0'), 0
  )
  const totalOrders = paidOrders.length
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  const revenueByDay: Record<string, number> = {}
  paidOrders.forEach((o: any) => {
    const day = o.created_at?.slice(0, 10)
    if (day) revenueByDay[day] = (revenueByDay[day] || 0) + parseFloat(o.total_price || '0')
  })

  return NextResponse.json({
    success: true,
    shopDomain,
    summary: { totalOrders, totalRevenue, avgOrderValue, period: `last_${totalOrders}d` },
    revenueByDay,
    orders: paidOrders.slice(0, 50).map((o: any) => ({
      id: o.name,
      date: o.created_at?.slice(0, 10),
      total: parseFloat(o.total_price || '0'),
      status: o.financial_status,
      source: o.source_name,
    })),
  })
}
