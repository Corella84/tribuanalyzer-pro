// ── TikTok Ads MCP Tools ──────────────────────────────────────────────

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

// ── Helpers ───────────────────────────────────────────────────────────

function getTikTokConfig(): { accessToken: string; advertiserId: string } {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN?.trim()
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID?.trim()

  if (!accessToken || !advertiserId) {
    throw new Error('TikTok Ads: missing TIKTOK_ACCESS_TOKEN or TIKTOK_ADVERTISER_ID')
  }

  return { accessToken, advertiserId }
}

async function tiktokFetch(accessToken: string, endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`${TIKTOK_API_BASE}/${endpoint}`)

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }

  const res = await fetch(url.toString(), {
    headers: { 'Access-Token': accessToken },
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json()
  if (data.code !== 0) {
    throw new Error(`TikTok API: ${data.message} (code ${data.code})`)
  }

  return data.data
}

function getTikTokDateRange(preset: string): { start_date: string; end_date: string } {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const end_date = fmt(now)

  let start: Date
  switch (preset) {
    case 'today':
      start = new Date(now)
      break
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { start_date: fmt(y), end_date: fmt(y) }
    }
    case 'last_7d':
      start = new Date(now)
      start.setDate(start.getDate() - 6)
      break
    case 'last_14d':
      start = new Date(now)
      start.setDate(start.getDate() - 13)
      break
    case 'last_30d':
      start = new Date(now)
      start.setDate(start.getDate() - 29)
      break
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start_date: fmt(first), end_date: fmt(last) }
    }
    default:
      start = new Date(now)
      start.setDate(start.getDate() - 6)
  }

  return { start_date: fmt(start), end_date }
}

// ── Tool definitions ──────────────────────────────────────────────────

export const TIKTOK_TOOLS = [
  {
    name: 'get_tiktok_campaigns',
    description: 'Get campaigns from TikTok Ads. Returns campaign name, status, budget, budget mode, and objective type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        advertiser_id: { type: 'string', description: 'TikTok advertiser ID. If omitted, uses env var.' },
      },
    },
  },
  {
    name: 'get_tiktok_insights',
    description: 'Get campaign-level performance insights from TikTok Ads. Returns spend, impressions, clicks, CPM, CPC, conversions, cost per conversion, and conversion rate.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        advertiser_id: { type: 'string', description: 'TikTok advertiser ID. If omitted, uses env var.' },
        date_preset: { type: 'string', description: 'Date range: today, yesterday, last_7d, last_14d, last_30d, this_month, last_month', default: 'last_7d' },
      },
    },
  },
  {
    name: 'get_tiktok_ads',
    description: 'Get ad-level performance insights from TikTok Ads. Returns ad name, campaign name, spend, impressions, clicks, CTR, conversions, and cost per conversion.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        advertiser_id: { type: 'string', description: 'TikTok advertiser ID. If omitted, uses env var.' },
        date_preset: { type: 'string', description: 'Date range: today, yesterday, last_7d, last_14d, last_30d, this_month, last_month', default: 'last_7d' },
      },
    },
  },
]

// ── Handler implementations ───────────────────────────────────────────

async function handleGetTikTokCampaigns(args: any) {
  const { accessToken, advertiserId } = getTikTokConfig()
  const advId = args.advertiser_id || advertiserId

  const data = await tiktokFetch(accessToken, 'campaign/get/', {
    advertiser_id: advId,
    page_size: 100,
  })

  const campaigns = (data.list || []).map((c: any) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    status: c.operation_status || c.status,
    budget: c.budget,
    budget_mode: c.budget_mode,
    objective_type: c.objective_type,
  }))

  return { campaigns, total: campaigns.length }
}

async function handleGetTikTokInsights(args: any) {
  const { accessToken, advertiserId } = getTikTokConfig()
  const advId = args.advertiser_id || advertiserId
  const { start_date, end_date } = getTikTokDateRange(args.date_preset || 'last_7d')

  const data = await tiktokFetch(accessToken, 'report/integrated/get/', {
    advertiser_id: advId,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: ['campaign_id'],
    metrics: ['campaign_name', 'spend', 'impressions', 'clicks', 'cpm', 'cpc', 'conversion', 'cost_per_conversion', 'conversion_rate'],
    start_date,
    end_date,
  })

  const insights = (data.list || []).map((r: any) => {
    const dims = r.dimensions || {}
    const m = r.metrics || {}
    return {
      campaign_id: dims.campaign_id,
      campaign_name: m.campaign_name,
      spend: parseFloat(m.spend || '0'),
      impressions: parseInt(m.impressions || '0'),
      clicks: parseInt(m.clicks || '0'),
      cpm: parseFloat(m.cpm || '0'),
      cpc: parseFloat(m.cpc || '0'),
      conversions: parseInt(m.conversion || '0'),
      cost_per_conversion: parseFloat(m.cost_per_conversion || '0'),
      conversion_rate: parseFloat(m.conversion_rate || '0'),
    }
  })

  return { insights, total: insights.length, date_preset: args.date_preset || 'last_7d' }
}

async function handleGetTikTokAds(args: any) {
  const { accessToken, advertiserId } = getTikTokConfig()
  const advId = args.advertiser_id || advertiserId
  const { start_date, end_date } = getTikTokDateRange(args.date_preset || 'last_7d')

  const data = await tiktokFetch(accessToken, 'report/integrated/get/', {
    advertiser_id: advId,
    report_type: 'BASIC',
    data_level: 'AUCTION_AD',
    dimensions: ['ad_id'],
    metrics: ['ad_name', 'campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'conversion', 'cost_per_conversion'],
    start_date,
    end_date,
  })

  const ads = (data.list || []).map((r: any) => {
    const dims = r.dimensions || {}
    const m = r.metrics || {}
    return {
      ad_id: dims.ad_id,
      ad_name: m.ad_name,
      campaign_name: m.campaign_name,
      spend: parseFloat(m.spend || '0'),
      impressions: parseInt(m.impressions || '0'),
      clicks: parseInt(m.clicks || '0'),
      ctr: parseFloat(m.ctr || '0'),
      conversions: parseInt(m.conversion || '0'),
      cost_per_conversion: parseFloat(m.cost_per_conversion || '0'),
    }
  })

  return { ads, total: ads.length, date_preset: args.date_preset || 'last_7d' }
}

// ── Exports ───────────────────────────────────────────────────────────

export const TIKTOK_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  get_tiktok_campaigns: handleGetTikTokCampaigns,
  get_tiktok_insights: handleGetTikTokInsights,
  get_tiktok_ads: handleGetTikTokAds,
}
