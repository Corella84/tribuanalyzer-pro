import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

function getDateRange(preset: string): { start: string; end: string } {
  const end = new Date()
  const start = new Date()

  switch (preset) {
    case 'last_7d':
      start.setDate(end.getDate() - 7)
      break
    case 'last_14d':
      start.setDate(end.getDate() - 14)
      break
    case 'last_30d':
      start.setDate(end.getDate() - 30)
      break
    default:
      start.setDate(end.getDate() - 7)
  }

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const advertiserId = searchParams.get('advertiser_id')
  const datePreset = searchParams.get('date_preset') || 'last_7d'
  const statusFilter = searchParams.get('status')

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: connection } = await supabase
      .from('tiktok_connections')
      .select('access_token, advertiser_ids, advertisers, expires_at')
      .eq('user_id', user.id)
      .single()

    if (!connection?.access_token) {
      return NextResponse.json({
        success: false,
        error: 'TikTok not connected',
        needsConnection: true
      }, { status: 400 })
    }

    if (connection.expires_at && new Date(connection.expires_at) < new Date()) {
      return NextResponse.json({
        success: false,
        error: 'TikTok token expired',
        needsConnection: true
      }, { status: 400 })
    }

    const accessToken = connection.access_token
    const advId = advertiserId || connection.advertiser_ids?.[0]

    if (!advId) {
      return NextResponse.json({
        success: false,
        error: 'No advertiser account found'
      }, { status: 400 })
    }

    // Use reporting endpoint only (works with Reporting scope, no Ads Management needed)
    const { start, end } = getDateRange(datePreset)

    const dimensions = encodeURIComponent(JSON.stringify(['campaign_id']))
    const metrics = encodeURIComponent(JSON.stringify([
      'campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
      'frequency', 'conversion', 'cost_per_conversion',
      'complete_payment', 'complete_payment_roas',
    ]))

    const reportUrl = `${TIKTOK_API_BASE}/report/integrated/get/?advertiser_id=${advId}&report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=${dimensions}&metrics=${metrics}&start_date=${start}&end_date=${end}&page_size=100`

    const reportResponse = await fetch(reportUrl, {
      headers: { 'Access-Token': accessToken },
    })
    const reportData = await reportResponse.json()

    if (reportData.code !== 0) {
      console.error('TikTok report error:', reportData)
      return NextResponse.json({
        success: false,
        error: reportData.message || 'Failed to fetch TikTok data'
      }, { status: 400 })
    }

    const rows = reportData.data?.list || []

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        currency: 'USD',
        total: 0,
      })
    }

    // Transform report rows to campaign format (same shape as Meta)
    const campaigns = rows.map((row: any) => {
      const m = row.metrics || {}
      const spend = parseFloat(m.spend || '0')
      const clicks = parseInt(m.clicks || '0')
      const impressions = parseInt(m.impressions || '0')
      const purchases = parseInt(m.complete_payment || '0')
      const roas = parseFloat(m.complete_payment_roas || '0')
      const revenue = spend * roas
      const ctr = parseFloat(m.ctr || '0') * 100

      return {
        name: m.campaign_name || row.dimensions?.campaign_id || 'Unknown',
        status: spend > 0 ? 'ACTIVE' : 'PAUSED',
        budget: 0,
        spend,
        impressions,
        clicks,
        ctr,
        frequency: parseFloat(m.frequency || '0'),
        cpc: parseFloat(m.cpc || '0'),
        cpm: parseFloat(m.cpm || '0'),
        cpa: parseFloat(m.cost_per_conversion || '0'),
        purchases,
        addToCart: 0,
        initiateCheckout: 0,
        revenue,
        roas,
      }
    })

    // Filter by status if needed
    const filtered = statusFilter && statusFilter !== 'ALL'
      ? campaigns.filter((c: any) => c.status === statusFilter)
      : campaigns

    // Get currency from advertiser info
    const advInfo = (connection.advertisers || []).find(
      (a: any) => String(a.id || a.advertiser_id) === String(advId)
    )
    const currency = advInfo?.currency || 'USD'

    return NextResponse.json({
      success: true,
      data: filtered,
      currency,
      total: filtered.length,
    })

  } catch (err) {
    console.error('Error fetching TikTok campaigns:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch campaigns'
    }, { status: 500 })
  }
}
