import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

// TikTok date presets map to actual date ranges
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

    // Check expiry
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

    // Fetch campaigns
    const campaignParams = new URLSearchParams({
      advertiser_id: String(advId),
      page_size: '100',
    })

    // TikTok status filter mapping
    if (statusFilter && statusFilter !== 'ALL') {
      const tiktokStatus: Record<string, string> = {
        'ACTIVE': 'CAMPAIGN_STATUS_ENABLE',
        'PAUSED': 'CAMPAIGN_STATUS_DISABLE',
      }
      if (tiktokStatus[statusFilter]) {
        campaignParams.append('filtering', JSON.stringify({
          campaign_status: tiktokStatus[statusFilter]
        }))
      }
    }

    const campaignsResponse = await fetch(
      `${TIKTOK_API_BASE}/campaign/get/?${campaignParams}`,
      {
        headers: { 'Access-Token': accessToken },
      }
    )
    const campaignsData = await campaignsResponse.json()

    if (campaignsData.code !== 0) {
      console.error('TikTok campaigns error:', campaignsData)
      return NextResponse.json({
        success: false,
        error: campaignsData.message || 'Failed to fetch TikTok campaigns'
      }, { status: 400 })
    }

    const campaigns = campaignsData.data?.list || []

    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        currency: 'USD',
        total: 0,
      })
    }

    // Fetch insights report for all campaigns
    const { start, end } = getDateRange(datePreset)
    const campaignIds = campaigns.map((c: any) => String(c.campaign_id))

    const reportBody = {
      advertiser_id: String(advId),
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id'],
      metrics: [
        'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
        'frequency', 'conversion', 'cost_per_conversion',
        'total_complete_payment_rate', 'complete_payment',
        'total_initiate_checkout', 'total_add_to_wishlist',
        'value_per_complete_payment', 'complete_payment_roas',
      ],
      start_date: start,
      end_date: end,
      page_size: 100,
      filtering: {
        campaign_ids: campaignIds,
      },
    }

    const reportResponse = await fetch(
      `${TIKTOK_API_BASE}/report/integrated/get/`,
      {
        method: 'POST',
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportBody),
      }
    )
    const reportData = await reportResponse.json()

    // Build insights map by campaign_id
    const insightsMap: Record<string, any> = {}
    if (reportData.code === 0 && reportData.data?.list) {
      for (const row of reportData.data.list) {
        const cid = row.dimensions?.campaign_id
        if (cid) {
          insightsMap[String(cid)] = row.metrics
        }
      }
    }

    // Merge campaigns with insights (same format as Meta)
    const campaignsWithInsights = campaigns.map((campaign: any) => {
      const cid = String(campaign.campaign_id)
      const metrics = insightsMap[cid]

      // Map TikTok status to Meta-style status
      const statusMap: Record<string, string> = {
        'CAMPAIGN_STATUS_ENABLE': 'ACTIVE',
        'CAMPAIGN_STATUS_DISABLE': 'PAUSED',
        'CAMPAIGN_STATUS_DELETE': 'ARCHIVED',
        'CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY': 'PAUSED',
        'CAMPAIGN_STATUS_ADVERTISER_AUDIT': 'PAUSED',
      }
      const normalizedStatus = statusMap[campaign.operation_status] || statusMap[campaign.secondary_status] || 'PAUSED'

      // Budget: TikTok returns as float already
      const budget = parseFloat(campaign.budget || '0')

      if (metrics) {
        const spend = parseFloat(metrics.spend || '0')
        const clicks = parseInt(metrics.clicks || '0')
        const impressions = parseInt(metrics.impressions || '0')
        const purchases = parseInt(metrics.complete_payment || '0')
        const revenue = parseFloat(metrics.value_per_complete_payment || '0') * purchases
        const roas = parseFloat(metrics.complete_payment_roas || '0')
        const cpc = parseFloat(metrics.cpc || '0')
        const cpm = parseFloat(metrics.cpm || '0')
        const cpa = parseFloat(metrics.cost_per_conversion || '0')
        const addToCart = parseInt(metrics.total_add_to_wishlist || '0')
        const initiateCheckout = parseInt(metrics.total_initiate_checkout || '0')

        return {
          name: campaign.campaign_name,
          status: normalizedStatus,
          budget,
          spend,
          impressions,
          clicks,
          ctr: parseFloat(metrics.ctr || '0') * 100,
          frequency: parseFloat(metrics.frequency || '0'),
          cpc,
          cpm,
          cpa,
          purchases,
          addToCart,
          initiateCheckout,
          revenue,
          roas,
        }
      }

      return {
        name: campaign.campaign_name,
        status: normalizedStatus,
        budget,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        frequency: 0,
        cpc: 0,
        cpm: 0,
        cpa: 0,
        purchases: 0,
        addToCart: 0,
        initiateCheckout: 0,
        revenue: 0,
        roas: 0,
      }
    })

    // Get currency from advertiser info
    const advInfo = (connection.advertisers || []).find(
      (a: any) => String(a.id || a.advertiser_id) === String(advId)
    )
    const currency = advInfo?.currency || 'USD'

    return NextResponse.json({
      success: true,
      data: campaignsWithInsights,
      currency,
      total: campaignsWithInsights.length,
    })

  } catch (err) {
    console.error('Error fetching TikTok campaigns:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch campaigns'
    }, { status: 500 })
  }
}
