// ── Google Ads MCP Tools (REST API) ───────────────────────────────────

const GOOGLE_ADS_API_VERSION = 'v21'
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`

const DATE_PRESET_MAP: Record<string, string> = {
  today: 'TODAY',
  yesterday: 'YESTERDAY',
  last_7d: 'LAST_7_DAYS',
  last_30d: 'LAST_30_DAYS',
  this_month: 'THIS_MONTH',
  last_month: 'LAST_MONTH',
}

// ── Helpers ───────────────────────────────────────────────────────────

async function getGoogleAdsAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Ads: missing GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, or GOOGLE_ADS_REFRESH_TOKEN')
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
  if (!data.access_token) throw new Error('Google Ads: failed to refresh access token')
  return data.access_token
}

async function googleAdsQuery(accessToken: string, customerId: string, gaqlQuery: string): Promise<any[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  if (!developerToken) throw new Error('Google Ads: missing GOOGLE_ADS_DEVELOPER_TOKEN')

  const url = `${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: gaqlQuery }),
    signal: AbortSignal.timeout(15000),
  })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Google Ads API: unexpected response (status ${res.status}): ${text.slice(0, 200)}`)
  }
  if (data.error) {
    throw new Error(`Google Ads API: ${data.error.message} (code ${data.error.code})`)
  }

  return data.results || []
}

function getCustomerId(argsId?: string): string {
  const id = argsId || process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()
  if (!id) throw new Error('Google Ads: no customer ID provided and GOOGLE_ADS_CUSTOMER_ID not set')
  return id.replace(/-/g, '')
}

// ── Tool definitions ──────────────────────────────────────────────────

export const GOOGLE_ADS_TOOLS = [
  {
    name: 'get_google_campaigns',
    description: 'Get campaigns from Google Ads. Returns campaign name, status, and budget. Excludes removed campaigns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Google Ads customer ID (e.g. 123-456-7890). If omitted, uses env var.' },
      },
    },
  },
  {
    name: 'get_google_insights',
    description: 'Get performance insights for Google Ads campaigns. Returns spend, impressions, clicks, CTR, CPC, conversions, conversion value, and ROAS.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Google Ads customer ID. If omitted, uses env var.' },
        date_preset: { type: 'string', description: 'Date range: today, yesterday, last_7d, last_30d, this_month, last_month', default: 'last_7d' },
      },
    },
  },
  {
    name: 'get_google_keywords',
    description: 'Get keyword performance from Google Ads. Returns keyword text, match type, campaign, impressions, clicks, cost, CPC, and conversions. Top 100 keywords.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Google Ads customer ID. If omitted, uses env var.' },
        date_preset: { type: 'string', description: 'Date range: today, yesterday, last_7d, last_30d, this_month, last_month', default: 'last_7d' },
        campaign_id: { type: 'string', description: 'Filter by campaign ID (optional)' },
      },
    },
  },
  {
    name: 'get_google_campaign_breakdown',
    description: 'Get campaign performance broken down by ad network type (SEARCH, DISPLAY, YOUTUBE, etc). Returns cost, impressions, clicks, conversions, and conversion value per network.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'Google Ads customer ID. If omitted, uses env var.' },
        campaign_id: { type: 'string', description: 'Campaign ID to break down (optional — if omitted, all campaigns)' },
        date_preset: { type: 'string', description: 'Date range: today, yesterday, last_7d, last_30d, this_month, last_month', default: 'last_7d' },
      },
    },
  },
  {
    name: 'get_pmax_asset_groups',
    description: 'Get asset groups from a Performance Max campaign with their assets (headlines, descriptions, images, videos, logos) and Ad Strength.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID (required) — the PMax campaign to inspect' },
        customer_id: { type: 'string', description: 'Google Ads customer ID. If omitted, uses env var.' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_pmax_audience_signals',
    description: 'Get audience signals assigned to each asset group in a Performance Max campaign. Returns audience names and descriptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID (required) — the PMax campaign to inspect' },
        customer_id: { type: 'string', description: 'Google Ads customer ID. If omitted, uses env var.' },
      },
      required: ['campaign_id'],
    },
  },
]

// ── Handler implementations ───────────────────────────────────────────

async function handleGetGoogleCampaigns(args: any) {
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)

  const query = `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`
  const results = await googleAdsQuery(accessToken, customerId, query)

  const campaigns = results.map((r: any) => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    budget: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1_000_000 : 0,
  }))

  return { campaigns, total: campaigns.length }
}

async function handleGetGoogleInsights(args: any) {
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)
  const preset = DATE_PRESET_MAP[args.date_preset || 'last_7d'] || 'LAST_7_DAYS'

  const query = `SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING ${preset} AND campaign.status != 'REMOVED'`
  const results = await googleAdsQuery(accessToken, customerId, query)

  const insights = results.map((r: any) => {
    const cost = r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0
    const impressions = Number(r.metrics?.impressions || 0)
    const clicks = Number(r.metrics?.clicks || 0)
    const conversions = Number(r.metrics?.conversions || 0)
    const conversionsValue = Number(r.metrics?.conversionsValue || 0)

    return {
      campaign_id: r.campaign?.id,
      campaign_name: r.campaign?.name,
      cost: +cost.toFixed(2),
      impressions,
      clicks,
      ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
      cpc: clicks > 0 ? +(cost / clicks).toFixed(2) : 0,
      conversions: +conversions.toFixed(2),
      conversions_value: +conversionsValue.toFixed(2),
      roas: cost > 0 ? +(conversionsValue / cost).toFixed(2) : 0,
    }
  })

  return { insights, total: insights.length, date_preset: args.date_preset || 'last_7d' }
}

async function handleGetGoogleKeywords(args: any) {
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)
  const preset = DATE_PRESET_MAP[args.date_preset || 'last_7d'] || 'LAST_7_DAYS'

  let query = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date DURING ${preset}`
  if (args.campaign_id) {
    query += ` AND campaign.id = ${args.campaign_id}`
  }
  query += ` LIMIT 100`

  const results = await googleAdsQuery(accessToken, customerId, query)

  const keywords = results.map((r: any) => {
    const cost = r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0
    const clicks = Number(r.metrics?.clicks || 0)

    return {
      keyword: r.adGroupCriterion?.keyword?.text,
      match_type: r.adGroupCriterion?.keyword?.matchType,
      campaign_name: r.campaign?.name,
      impressions: Number(r.metrics?.impressions || 0),
      clicks,
      cost: +cost.toFixed(2),
      cpc: clicks > 0 ? +(cost / clicks).toFixed(2) : 0,
      conversions: Number(r.metrics?.conversions || 0),
    }
  })

  return { keywords, total: keywords.length, date_preset: args.date_preset || 'last_7d' }
}

async function handleGetGoogleCampaignBreakdown(args: any) {
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)
  const preset = DATE_PRESET_MAP[args.date_preset || 'last_7d'] || 'LAST_7_DAYS'

  let query = `SELECT segments.ad_network_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING ${preset} AND campaign.status != 'REMOVED'`
  if (args.campaign_id) {
    query += ` AND campaign.id = ${args.campaign_id}`
  }

  const results = await googleAdsQuery(accessToken, customerId, query)

  const breakdown = results.map((r: any) => {
    const cost = r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0
    const impressions = Number(r.metrics?.impressions || 0)
    const clicks = Number(r.metrics?.clicks || 0)
    const conversions = Number(r.metrics?.conversions || 0)
    const conversionsValue = Number(r.metrics?.conversionsValue || 0)

    return {
      ad_network_type: r.segments?.adNetworkType,
      cost: +cost.toFixed(2),
      impressions,
      clicks,
      ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
      cpc: clicks > 0 ? +(cost / clicks).toFixed(2) : 0,
      conversions: +conversions.toFixed(2),
      conversions_value: +conversionsValue.toFixed(2),
      roas: cost > 0 ? +(conversionsValue / cost).toFixed(2) : 0,
    }
  })

  return { breakdown, total: breakdown.length, date_preset: args.date_preset || 'last_7d', campaign_id: args.campaign_id || 'all' }
}

async function handleGetPMaxAssetGroups(args: any) {
  if (!args.campaign_id) throw new Error('campaign_id is required')
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)

  const query = `SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength, asset_group_asset.field_type, asset_group_asset.status, asset.name, asset.type, asset.text_asset.text, asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id FROM asset_group_asset WHERE campaign.id = '${args.campaign_id}'`

  const results = await googleAdsQuery(accessToken, customerId, query)

  // Group by asset group
  const groupMap: Record<string, any> = {}
  for (const r of results) {
    const agId = r.assetGroup?.id
    if (!agId) continue

    if (!groupMap[agId]) {
      groupMap[agId] = {
        id: agId,
        name: r.assetGroup?.name || 'Unknown',
        status: r.assetGroup?.status || 'UNKNOWN',
        ad_strength: r.assetGroup?.adStrength || 'UNKNOWN',
        assets: {} as Record<string, string[]>,
      }
    }

    const fieldType = r.assetGroupAsset?.fieldType
    if (!fieldType) continue

    if (!groupMap[agId].assets[fieldType]) {
      groupMap[agId].assets[fieldType] = []
    }

    // Pick the right asset value based on type
    const assetType = r.asset?.type
    let value = ''
    if (assetType === 'TEXT' || r.asset?.textAsset?.text) {
      value = r.asset?.textAsset?.text || r.asset?.name || ''
    } else if (assetType === 'IMAGE' || r.asset?.imageAsset?.fullSize?.url) {
      value = r.asset?.imageAsset?.fullSize?.url || r.asset?.name || ''
    } else if (assetType === 'YOUTUBE_VIDEO' || r.asset?.youtubeVideoAsset?.youtubeVideoId) {
      value = r.asset?.youtubeVideoAsset?.youtubeVideoId || r.asset?.name || ''
    } else {
      value = r.asset?.name || r.asset?.type || 'unknown'
    }

    if (value && !groupMap[agId].assets[fieldType].includes(value)) {
      groupMap[agId].assets[fieldType].push(value)
    }
  }

  const assetGroups = Object.values(groupMap)
  return { campaign_id: args.campaign_id, asset_groups: assetGroups, total: assetGroups.length }
}

async function handleGetPMaxAudienceSignals(args: any) {
  if (!args.campaign_id) throw new Error('campaign_id is required')
  const accessToken = await getGoogleAdsAccessToken()
  const customerId = getCustomerId(args.customer_id)

  // Get audience signals per asset group
  const signalQuery = `SELECT asset_group.id, asset_group.name, asset_group_signal.audience_signal.audiences FROM asset_group_signal WHERE campaign.id = '${args.campaign_id}'`

  let results: any[]
  try {
    results = await googleAdsQuery(accessToken, customerId, signalQuery)
  } catch (err: any) {
    // asset_group_signal might not exist for some campaigns
    if (err.message?.includes('not found') || err.message?.includes('INVALID')) {
      return { campaign_id: args.campaign_id, asset_groups: [], total: 0, note: 'No audience signals found for this campaign' }
    }
    throw err
  }

  // Collect all audience resource names
  const allAudienceIds = new Set<string>()
  const groupMap: Record<string, any> = {}

  for (const r of results) {
    const agId = r.assetGroup?.id
    if (!agId) continue

    if (!groupMap[agId]) {
      groupMap[agId] = {
        id: agId,
        name: r.assetGroup?.name || 'Unknown',
        audience_ids: [] as string[],
      }
    }

    const audiences = r.assetGroupSignal?.audienceSignal?.audiences || []
    for (const aud of audiences) {
      const audienceRef = aud.audience || aud
      if (typeof audienceRef === 'string') {
        // Extract ID from resource name like "customers/123/audiences/456"
        const match = audienceRef.match(/audiences\/(\d+)/)
        if (match) {
          allAudienceIds.add(match[1])
          groupMap[agId].audience_ids.push(match[1])
        }
      }
    }
  }

  // Resolve audience names
  const audienceMap: Record<string, { name: string; description: string }> = {}
  if (allAudienceIds.size > 0) {
    const ids = Array.from(allAudienceIds).join(',')
    try {
      const audQuery = `SELECT audience.id, audience.name, audience.description FROM audience WHERE audience.id IN (${ids})`
      const audResults = await googleAdsQuery(accessToken, customerId, audQuery)
      for (const r of audResults) {
        if (r.audience?.id) {
          audienceMap[r.audience.id] = {
            name: r.audience?.name || 'Unknown',
            description: r.audience?.description || '',
          }
        }
      }
    } catch {
      // If audience lookup fails, continue with IDs only
    }
  }

  // Build final response
  const assetGroups = Object.values(groupMap).map((g: any) => ({
    id: g.id,
    name: g.name,
    signals: g.audience_ids.map((id: string) => ({
      audience_id: id,
      audience_name: audienceMap[id]?.name || `Audience ${id}`,
      description: audienceMap[id]?.description || '',
    })),
  }))

  return { campaign_id: args.campaign_id, asset_groups: assetGroups, total: assetGroups.length }
}

// ── Exports ───────────────────────────────────────────────────────────

export const GOOGLE_ADS_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  get_google_campaigns: handleGetGoogleCampaigns,
  get_google_insights: handleGetGoogleInsights,
  get_google_keywords: handleGetGoogleKeywords,
  get_google_campaign_breakdown: handleGetGoogleCampaignBreakdown,
  get_pmax_asset_groups: handleGetPMaxAssetGroups,
  get_pmax_audience_signals: handleGetPMaxAudienceSignals,
}
