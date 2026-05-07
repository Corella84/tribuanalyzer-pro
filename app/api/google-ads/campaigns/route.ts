import { NextResponse } from 'next/server'

const GOOGLE_ADS_API_VERSION = 'v21'
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`

const DATE_PRESET_MAP: Record<string, string> = {
  last_7d: 'LAST_7_DAYS',
  last_14d: 'LAST_14_DAYS',
  last_30d: 'LAST_30_DAYS',
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google Ads credentials')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to refresh Google Ads token')
  return data.access_token
}

async function gaqlQuery(accessToken: string, customerId: string, query: string): Promise<any[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  if (!developerToken) throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN')

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }

  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  })

  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`Google Ads: unexpected response: ${text.slice(0, 200)}`) }
  if (data.error) throw new Error(`Google Ads: ${data.error.message}`)

  return data.results || []
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const datePreset = searchParams.get('date_preset') || 'last_7d'
  const statusFilter = searchParams.get('status')
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')

  try {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()?.replace(/-/g, '')
    if (!customerId) {
      return NextResponse.json({ success: false, error: 'Google Ads not configured', needsConnection: true }, { status: 400 })
    }

    const accessToken = await getAccessToken()

    // Build date filter: custom range or preset
    const dateFilter = startDate && endDate
      ? `segments.date BETWEEN '${startDate}' AND '${endDate}'`
      : `segments.date DURING ${DATE_PRESET_MAP[datePreset] || 'LAST_7_DAYS'}`

    // Check account currency and set exchange rate
    const currencyQuery = `SELECT customer.currency_code FROM customer LIMIT 1`
    const currencyResults = await gaqlQuery(accessToken, customerId, currencyQuery)
    const accountCurrency = currencyResults[0]?.customer?.currencyCode || 'USD'
    // Convert USD to CRC at 500 colones per dollar
    const exchangeRate = accountCurrency === 'USD' ? 500 : 1

    // Single query: campaigns + metrics
    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${dateFilter} AND campaign.status != 'REMOVED'`

    const results = await gaqlQuery(accessToken, customerId, query)

    // Aggregate by campaign (Google returns one row per segment)
    const campaignMap: Record<string, any> = {}
    for (const r of results) {
      const id = r.campaign?.id
      if (!id) continue

      if (!campaignMap[id]) {
        const status = r.campaign?.status === 'ENABLED' ? 'ACTIVE' : r.campaign?.status === 'PAUSED' ? 'PAUSED' : 'ARCHIVED'
        campaignMap[id] = {
          name: r.campaign?.name || 'Unknown',
          status,
          budget: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1_000_000 : 0,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionsValue: 0,
        }
      }

      const c = campaignMap[id]
      c.spend += r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0
      c.impressions += Number(r.metrics?.impressions || 0)
      c.clicks += Number(r.metrics?.clicks || 0)
      c.conversions += Number(r.metrics?.conversions || 0)
      c.conversionsValue += Number(r.metrics?.conversionsValue || 0)
    }

    // Transform to standard format (apply exchange rate to monetary values)
    let campaigns = Object.values(campaignMap).map((c: any) => {
      const spend = c.spend * exchangeRate
      const revenue = c.conversionsValue * exchangeRate
      const budget = c.budget * exchangeRate
      return {
        name: c.name,
        status: c.status,
        budget: +budget.toFixed(2),
        spend: +spend.toFixed(2),
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: c.impressions > 0 ? +((c.clicks / c.impressions) * 100).toFixed(2) : 0,
        frequency: 0,
        cpc: c.clicks > 0 ? +(spend / c.clicks).toFixed(2) : 0,
        cpm: c.impressions > 0 ? +((spend / c.impressions) * 1000).toFixed(2) : 0,
        cpa: c.conversions > 0 ? +(spend / c.conversions).toFixed(2) : 0,
        purchases: Math.round(c.conversions),
        addToCart: 0,
        initiateCheckout: 0,
        revenue: +revenue.toFixed(2),
        roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
      }
    })

    // Filter by status
    if (statusFilter && statusFilter !== 'ALL') {
      campaigns = campaigns.filter(c => c.status === statusFilter)
    }

    return NextResponse.json({
      success: true,
      data: campaigns,
      currency: 'CRC',
      total: campaigns.length,
    })

  } catch (err: any) {
    console.error('Error fetching Google Ads campaigns:', err?.message || err)
    return NextResponse.json({
      success: false,
      error: err?.message || 'Failed to fetch Google Ads campaigns',
      needsConnection: true,
    }, { status: 500 })
  }
}
