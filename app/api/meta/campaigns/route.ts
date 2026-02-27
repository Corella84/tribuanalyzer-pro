import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const META_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account_id')
  const datePreset = searchParams.get('date_preset') || 'last_7d'
  const status = searchParams.get('status')

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Get Meta connection
    const { data: connection } = await supabase
      .from('meta_connections')
      .select('access_token, ad_accounts')
      .eq('user_id', user.id)
      .single()

    if (!connection?.access_token) {
      return NextResponse.json({
        success: false,
        error: 'Meta not connected',
        needsConnection: true
      }, { status: 400 })
    }

    const accessToken = connection.access_token
    const adAccountId = accountId || connection.ad_accounts?.[0]?.id

    if (!adAccountId) {
      return NextResponse.json({
        success: false,
        error: 'No ad account found'
      }, { status: 400 })
    }

    // Get campaigns
    let campaignsUrl = `${BASE_URL}/${adAccountId}/campaigns?access_token=${accessToken}&fields=id,name,status&limit=100`

    const campaignsResponse = await fetch(campaignsUrl)
    const campaignsData = await campaignsResponse.json()

    if (campaignsData.error) {
      console.error('Meta API error:', campaignsData.error)
      return NextResponse.json({
        success: false,
        error: campaignsData.error.message
      }, { status: 400 })
    }

    let campaigns = campaignsData.data || []

    // Filter by status if specified
    if (status && status !== 'ALL') {
      campaigns = campaigns.filter((c: any) => c.status === status)
    }

    // Get insights for each campaign
    const campaignsWithInsights = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          const insightsUrl = `${BASE_URL}/${campaign.id}/insights?access_token=${accessToken}&fields=campaign_name,spend,impressions,clicks,ctr,frequency,actions,action_values&date_preset=${datePreset}`

          const insightsResponse = await fetch(insightsUrl, {
            signal: AbortSignal.timeout(5000)
          })
          const insightsData = await insightsResponse.json()
          const insights = insightsData.data?.[0]

          if (insights) {
            const spend = parseFloat(insights.spend || '0')
            const revenue = extractRevenue(insights.action_values)
            const roas = spend > 0 ? revenue / spend : 0

            return {
              name: insights.campaign_name || campaign.name,
              status: campaign.status,
              spend: spend,
              impressions: parseInt(insights.impressions || '0'),
              ctr: parseFloat(insights.ctr || '0'),
              frequency: parseFloat(insights.frequency || '0'),
              purchases: extractPurchases(insights.actions),
              addToCart: extractAction(insights.actions, ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']),
              initiateCheckout: extractAction(insights.actions, ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']),
              revenue: revenue,
              roas: roas,
            }
          }

          return {
            name: campaign.name,
            status: campaign.status,
            spend: 0,
            impressions: 0,
            ctr: 0,
            frequency: 0,
            purchases: 0,
            addToCart: 0,
            initiateCheckout: 0,
            revenue: 0,
            roas: 0,
          }
        } catch {
          return {
            name: campaign.name,
            status: campaign.status,
            spend: 0,
            impressions: 0,
            ctr: 0,
            frequency: 0,
            purchases: 0,
            addToCart: 0,
            initiateCheckout: 0,
            revenue: 0,
            roas: 0,
          }
        }
      })
    )

    // Get account currency
    const accountResponse = await fetch(
      `${BASE_URL}/${adAccountId}?access_token=${accessToken}&fields=currency`
    )
    const accountData = await accountResponse.json()
    const currency = accountData.currency || 'USD'

    return NextResponse.json({
      success: true,
      data: campaignsWithInsights,
      currency,
      total: campaignsWithInsights.length,
    })

  } catch (err) {
    console.error('Error fetching campaigns:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch campaigns'
    }, { status: 500 })
  }
}

function extractPurchases(actions: any[]): number {
  if (!actions) return 0

  for (const action of actions) {
    if (['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'].includes(action.action_type)) {
      return parseInt(action.value || '0')
    }
  }
  return 0
}

function extractAction(actions: any[], actionTypes: string[]): number {
  if (!actions) return 0

  for (const action of actions) {
    if (actionTypes.includes(action.action_type)) {
      return parseInt(action.value || '0')
    }
  }
  return 0
}

function extractRevenue(actionValues: any[]): number {
  if (!actionValues) return 0

  for (const action of actionValues) {
    if (['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'].includes(action.action_type)) {
      return parseFloat(action.value || '0')
    }
  }
  return 0
}
