// ── Google Ads MCP Tools (REST API) ───────────────────────────────────

const GOOGLE_ADS_API_VERSION = 'v17'
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

  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || process.env.GOOGLE_ADS_MCC_ID || '').replace(/-/g, '').trim()

  const url = `${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:searchStream`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId
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

  // searchStream returns an array of batches, each with a results array
  const batches = Array.isArray(data) ? data : [data]
  const results: any[] = []
  for (const batch of batches) {
    if (batch.results) results.push(...batch.results)
  }
  return results
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

// ── Exports ───────────────────────────────────────────────────────────

export const GOOGLE_ADS_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  get_google_campaigns: handleGetGoogleCampaigns,
  get_google_insights: handleGetGoogleInsights,
  get_google_keywords: handleGetGoogleKeywords,
}
