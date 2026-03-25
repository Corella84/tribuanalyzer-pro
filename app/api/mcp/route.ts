import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const META_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// ── CORS ──────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-mcp-secret',
}

function corsJson(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

// ── Meta API helper ───────────────────────────────────────────────────
async function metaFetch(token: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE_URL}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
  const data = await res.json()

  if (data.error) {
    throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`)
  }
  return data
}

// ── Meta API POST helper (create/update) ─────────────────────────────
async function metaPost(token: string, path: string, body: Record<string, any> = {}) {
  const url = `${BASE_URL}/${path}`

  // Meta API expects form-encoded params; nested objects must be JSON strings
  const formBody: Record<string, string> = { access_token: token }
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue
    formBody[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(formBody),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json()

  if (data.error) {
    throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`)
  }
  return data
}

// ── Shopify API helper ────────────────────────────────────────────────
const SHOPIFY_API_VERSION = '2024-10'

async function getShopifyToken(): Promise<{ token: string; shop: string }> {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN?.trim()
  const clientId = process.env.SHOPIFY_API_KEY?.trim()
  const clientSecret = process.env.SHOPIFY_API_SECRET?.trim()

  if (!shop || !clientId || !clientSecret) {
    throw new Error('Shopify not configured: missing SHOPIFY_SHOP_DOMAIN, SHOPIFY_API_KEY, or SHOPIFY_API_SECRET')
  }

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
  if (!data.access_token) throw new Error('Shopify: failed to get access token')
  return { token: data.access_token, shop }
}

async function shopifyFetch(token: string, shop: string, endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Shopify API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

// ── Tool definitions ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_ad_accounts',
    description: 'List all ad accounts accessible with the configured token. Returns account id, name, currency, and status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_campaigns',
    description: 'Get campaigns for a given ad account. Returns name, status, budget, and basic spend/impressions/clicks if date_preset is provided.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (e.g. act_123456789)' },
        status_filter: { type: 'string', description: 'Filter by status: ACTIVE, PAUSED, or ALL (default ALL)', default: 'ALL' },
        date_preset: { type: 'string', description: 'Date preset for insights: today, yesterday, last_7d, last_30d, this_month, last_month', default: 'last_7d' },
      },
      required: ['account_id'],
    },
  },
  {
    name: 'get_campaign_insights',
    description: 'Get detailed performance insights for a specific campaign. Includes spend, impressions, clicks, CTR, CPC, CPM, purchases, ROAS, revenue, add_to_cart, initiate_checkout.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID' },
        date_preset: { type: 'string', description: 'Date preset: today, yesterday, last_7d, last_30d, this_month, last_month', default: 'last_7d' },
        time_increment: { type: 'string', description: 'Break down by day: "1" for daily, "monthly", or omit for aggregate' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_adsets',
    description: 'Get ad sets for a campaign or ad account. Returns name, status, budget, targeting summary, and optimization goal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        parent_id: { type: 'string', description: 'Campaign ID or Ad Account ID (act_xxx)' },
        date_preset: { type: 'string', description: 'Date preset for insights', default: 'last_7d' },
      },
      required: ['parent_id'],
    },
  },
  {
    name: 'get_ads',
    description: 'Get individual ads for an ad set or campaign. Returns ad name, status, creative preview URL, and basic metrics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        parent_id: { type: 'string', description: 'Ad Set ID or Campaign ID' },
        date_preset: { type: 'string', description: 'Date preset for insights', default: 'last_7d' },
      },
      required: ['parent_id'],
    },
  },
  // ── Meta Ads write tools ──
  {
    name: 'create_campaign',
    description: 'Create a campaign in an ad account. Returns the new campaign ID. When use_adset_level_budgets is true, budget is managed per ad set (no campaign-level budget sent).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (e.g. act_1240971087279618)' },
        name: { type: 'string', description: 'Campaign name' },
        objective: { type: 'string', description: 'e.g. OUTCOME_SALES, OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_LEADS, OUTCOME_ENGAGEMENT' },
        status: { type: 'string', description: 'PAUSED or ACTIVE (default PAUSED)' },
        special_ad_categories: { type: 'array', description: 'e.g. [] or ["HOUSING","CREDIT","EMPLOYMENT"]', items: { type: 'string' } },
        buying_type: { type: 'string', description: 'AUCTION (default) or RESERVED' },
        bid_strategy: { type: 'string', description: 'e.g. LOWEST_COST_WITHOUT_CAP, LOWEST_COST_WITH_BID_CAP, COST_CAP. Ignored when use_adset_level_budgets is true.' },
        daily_budget: { type: 'number', description: 'Daily budget in cents (e.g. 8000 = $80.00). Ignored when use_adset_level_budgets is true.' },
        use_adset_level_budgets: { type: 'boolean', description: 'If true, budget is set per ad set — no campaign-level budget, bid_strategy, or CBO sent (default false)' },
      },
      required: ['account_id', 'name', 'objective'],
    },
  },
  {
    name: 'create_adset',
    description: 'Create an ad set within an existing campaign. Budget is in cents (e.g. 8000 = $80.00). Returns the new ad set ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (e.g. act_1240971087279618)' },
        campaign_id: { type: 'string', description: 'Campaign ID to create the ad set under' },
        name: { type: 'string', description: 'Ad set name' },
        optimization_goal: { type: 'string', description: 'e.g. OFFSITE_CONVERSIONS, LINK_CLICKS, IMPRESSIONS, REACH' },
        billing_event: { type: 'string', description: 'e.g. IMPRESSIONS, LINK_CLICKS' },
        daily_budget: { type: 'number', description: 'Daily budget in cents (e.g. 8000 = $80.00)' },
        status: { type: 'string', description: 'PAUSED or ACTIVE (default PAUSED)' },
        targeting: { type: 'object', description: 'Targeting spec: { geo_locations: { countries: ["CR"] }, age_min, age_max, targeting_automation, etc. }' },
        promoted_object: { type: 'object', description: 'Promoted object: { pixel_id, custom_event_type } for conversion campaigns' },
      },
      required: ['account_id', 'campaign_id', 'name', 'optimization_goal', 'billing_event', 'daily_budget', 'targeting'],
    },
  },
  {
    name: 'create_ad',
    description: 'Create an ad within an existing ad set using an existing creative ID. Returns the new ad ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (e.g. act_1240971087279618)' },
        adset_id: { type: 'string', description: 'Ad set ID to place the ad in' },
        name: { type: 'string', description: 'Ad name' },
        creative_id: { type: 'string', description: 'Existing creative ID to use' },
        status: { type: 'string', description: 'PAUSED or ACTIVE (default PAUSED)' },
        tracking_specs: { type: 'array', description: 'Tracking specs array, e.g. [{"action.type":["offsite_conversion"],"fb_pixel":["PIXEL_ID"]}]' },
      },
      required: ['account_id', 'adset_id', 'name', 'creative_id'],
    },
  },
  {
    name: 'update_adset',
    description: 'Update an existing ad set. Can change name, daily_budget (in cents), and/or status (ACTIVE, PAUSED, ARCHIVED).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        adset_id: { type: 'string', description: 'Ad set ID to update' },
        name: { type: 'string', description: 'New name' },
        daily_budget: { type: 'number', description: 'New daily budget in cents' },
        status: { type: 'string', description: 'ACTIVE, PAUSED, or ARCHIVED' },
      },
      required: ['adset_id'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update an existing campaign. Can change name, daily_budget (in cents), and/or status (ACTIVE, PAUSED, ARCHIVED).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Campaign ID to update' },
        name: { type: 'string', description: 'New name' },
        daily_budget: { type: 'number', description: 'New daily budget in cents' },
        status: { type: 'string', description: 'ACTIVE, PAUSED, or ARCHIVED' },
      },
      required: ['campaign_id'],
    },
  },
  // ── Shopify tools ──
  {
    name: 'get_products',
    description: 'Get products from the Shopify store. Returns title, status, vendor, product_type, variants with prices and inventory, and tags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'string', description: 'Number of products to return (max 250, default 50)', default: '50' },
        collection_id: { type: 'string', description: 'Filter by collection ID' },
        status: { type: 'string', description: 'Filter by status: active, draft, archived (default active)', default: 'active' },
      },
    },
  },
  {
    name: 'get_orders',
    description: 'Get orders from the Shopify store. Returns order name, date, total, financial status, line items, and source. Defaults to last 7 days.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'string', description: 'Number of days to look back (default 7)', default: '7' },
        status: { type: 'string', description: 'Order status: any, open, closed, cancelled (default any)', default: 'any' },
        limit: { type: 'string', description: 'Number of orders to return (max 250, default 50)', default: '50' },
      },
    },
  },
  {
    name: 'get_collections',
    description: 'Get collections (custom/manual) from the Shopify store. Returns collection id, title, and product count.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

// ── Tool implementations ──────────────────────────────────────────────
async function handleGetAdAccounts(token: string) {
  const data = await metaFetch(token, 'me/adaccounts', {
    fields: 'id,name,account_status,currency,timezone_name,amount_spent',
    limit: '100',
  })

  const accounts = (data.data || []).map((acc: any) => ({
    id: acc.id,
    name: acc.name || acc.id,
    status: acc.account_status === 1 ? 'ACTIVE' : acc.account_status === 2 ? 'DISABLED' : `STATUS_${acc.account_status}`,
    currency: acc.currency,
    timezone: acc.timezone_name,
    total_spent: acc.amount_spent ? (parseFloat(acc.amount_spent) / 100).toFixed(2) : '0.00',
  }))

  return { accounts, total: accounts.length }
}

async function handleGetCampaigns(token: string, args: any) {
  const { account_id, status_filter = 'ALL', date_preset = 'last_7d' } = args

  const data = await metaFetch(token, `${account_id}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget',
    limit: '100',
  })

  let campaigns = data.data || []
  if (status_filter && status_filter !== 'ALL') {
    campaigns = campaigns.filter((c: any) => c.status === status_filter)
  }

  const results = await Promise.all(
    campaigns.map(async (c: any) => {
      const dailyBudget = c.daily_budget ? parseFloat(c.daily_budget) / 100 : 0
      const lifetimeBudget = c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : 0

      let insights: any = {}
      try {
        const insData = await metaFetch(token, `${c.id}/insights`, {
          fields: 'spend,impressions,clicks,actions,action_values',
          date_preset,
        })
        insights = insData.data?.[0] || {}
      } catch { /* no insights available */ }

      const spend = parseFloat(insights.spend || '0')
      const revenue = extractRevenue(insights.action_values)

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        budget: dailyBudget || lifetimeBudget,
        budget_type: dailyBudget ? 'daily' : 'lifetime',
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases: extractPurchases(insights.actions),
        revenue,
        roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
      }
    })
  )

  return { campaigns: results, total: results.length, date_preset }
}

async function handleGetCampaignInsights(token: string, args: any) {
  const { campaign_id, date_preset = 'last_7d', time_increment } = args

  const params: Record<string, string> = {
    fields: 'campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions,action_values,cost_per_action_type',
    date_preset,
  }
  if (time_increment) params.time_increment = time_increment

  const data = await metaFetch(token, `${campaign_id}/insights`, params)
  const rows = data.data || []

  const insights = rows.map((row: any) => {
    const spend = parseFloat(row.spend || '0')
    const clicks = parseInt(row.clicks || '0')
    const impressions = parseInt(row.impressions || '0')
    const revenue = extractRevenue(row.action_values)
    const purchases = extractPurchases(row.actions)

    return {
      campaign_name: row.campaign_name,
      date_start: row.date_start,
      date_stop: row.date_stop,
      spend,
      impressions,
      reach: parseInt(row.reach || '0'),
      clicks,
      ctr: parseFloat(row.ctr || '0'),
      cpc: parseFloat(row.cpc || '0'),
      cpm: parseFloat(row.cpm || '0'),
      frequency: parseFloat(row.frequency || '0'),
      purchases,
      add_to_cart: extractAction(row.actions, ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']),
      initiate_checkout: extractAction(row.actions, ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']),
      revenue,
      roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
      cpa: purchases > 0 ? +(spend / purchases).toFixed(2) : 0,
    }
  })

  return { insights, total: insights.length, date_preset }
}

async function handleGetAdsets(token: string, args: any) {
  const { parent_id, date_preset = 'last_7d' } = args

  const data = await metaFetch(token, `${parent_id}/adsets`, {
    fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,targeting',
    limit: '100',
  })

  const adsets = await Promise.all(
    (data.data || []).map(async (as: any) => {
      const dailyBudget = as.daily_budget ? parseFloat(as.daily_budget) / 100 : 0
      const lifetimeBudget = as.lifetime_budget ? parseFloat(as.lifetime_budget) / 100 : 0

      let insights: any = {}
      try {
        const insData = await metaFetch(token, `${as.id}/insights`, {
          fields: 'spend,impressions,clicks,actions,action_values',
          date_preset,
        })
        insights = insData.data?.[0] || {}
      } catch { /* no data */ }

      const spend = parseFloat(insights.spend || '0')
      const revenue = extractRevenue(insights.action_values)

      return {
        id: as.id,
        name: as.name,
        status: as.status,
        budget: dailyBudget || lifetimeBudget,
        budget_type: dailyBudget ? 'daily' : 'lifetime',
        optimization_goal: as.optimization_goal,
        targeting_summary: summarizeTargeting(as.targeting),
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases: extractPurchases(insights.actions),
        revenue,
        roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
      }
    })
  )

  return { adsets, total: adsets.length, date_preset }
}

async function handleGetAds(token: string, args: any) {
  const { parent_id, date_preset = 'last_7d' } = args

  const data = await metaFetch(token, `${parent_id}/ads`, {
    fields: 'id,name,status,creative{id,thumbnail_url,effective_object_story_id}',
    limit: '50',
  })

  const ads = await Promise.all(
    (data.data || []).map(async (ad: any) => {
      let insights: any = {}
      try {
        const insData = await metaFetch(token, `${ad.id}/insights`, {
          fields: 'spend,impressions,clicks,actions,action_values',
          date_preset,
        })
        insights = insData.data?.[0] || {}
      } catch { /* no data */ }

      const spend = parseFloat(insights.spend || '0')
      const revenue = extractRevenue(insights.action_values)

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        thumbnail_url: ad.creative?.thumbnail_url || null,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases: extractPurchases(insights.actions),
        revenue,
        roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
      }
    })
  )

  return { ads, total: ads.length, date_preset }
}

// ── Meta Ads write tool implementations ──────────────────────────────
async function handleCreateCampaign(token: string, args: any) {
  const {
    account_id, name, objective,
    status = 'PAUSED',
    special_ad_categories = [],
    buying_type = 'AUCTION',
    bid_strategy, daily_budget,
    use_adset_level_budgets = false,
  } = args

  const body: Record<string, any> = {
    name,
    objective,
    status,
    special_ad_categories,
    buying_type,
  }

  if (!use_adset_level_budgets) {
    if (daily_budget !== undefined) body.daily_budget = daily_budget
    if (bid_strategy !== undefined) body.bid_strategy = bid_strategy
  }

  const data = await metaPost(token, `${account_id}/campaigns`, body)
  return { success: true, campaign_id: data.id, message: `Campaign "${name}" created successfully` }
}

async function handleCreateAdset(token: string, args: any) {
  const { account_id, campaign_id, name, optimization_goal, billing_event, daily_budget, status = 'PAUSED', targeting, promoted_object } = args

  const body: Record<string, any> = {
    campaign_id,
    name,
    optimization_goal,
    billing_event,
    daily_budget,
    status,
    targeting,
  }
  if (promoted_object) body.promoted_object = promoted_object

  const data = await metaPost(token, `${account_id}/adsets`, body)
  return { success: true, adset_id: data.id, message: `Ad set "${name}" created successfully` }
}

async function handleCreateAd(token: string, args: any) {
  const { account_id, adset_id, name, creative_id, status = 'PAUSED', tracking_specs } = args

  const body: Record<string, any> = {
    adset_id,
    name,
    creative: { creative_id },
    status,
  }
  if (tracking_specs) body.tracking_specs = tracking_specs

  const data = await metaPost(token, `${account_id}/ads`, body)
  return { success: true, ad_id: data.id, message: `Ad "${name}" created successfully` }
}

async function handleUpdateAdset(token: string, args: any) {
  const { adset_id, name, daily_budget, status } = args

  const body: Record<string, any> = {}
  if (name !== undefined) body.name = name
  if (daily_budget !== undefined) body.daily_budget = daily_budget
  if (status !== undefined) body.status = status

  if (Object.keys(body).length === 0) {
    return { success: false, message: 'No fields to update. Provide at least one of: name, daily_budget, status' }
  }

  await metaPost(token, adset_id, body)
  return { success: true, adset_id, updated_fields: Object.keys(body), message: `Ad set ${adset_id} updated successfully` }
}

async function handleUpdateCampaign(token: string, args: any) {
  const { campaign_id, name, daily_budget, status } = args

  const body: Record<string, any> = {}
  if (name !== undefined) body.name = name
  if (daily_budget !== undefined) body.daily_budget = daily_budget
  if (status !== undefined) body.status = status

  if (Object.keys(body).length === 0) {
    return { success: false, message: 'No fields to update. Provide at least one of: name, daily_budget, status' }
  }

  await metaPost(token, campaign_id, body)
  return { success: true, campaign_id, updated_fields: Object.keys(body), message: `Campaign ${campaign_id} updated successfully` }
}

// ── Shopify tool implementations ──────────────────────────────────────
async function handleGetProducts(args: any) {
  const { token, shop } = await getShopifyToken()
  const { limit = '50', collection_id, status = 'active' } = args

  const params: Record<string, string> = {
    limit,
    status,
    fields: 'id,title,status,vendor,product_type,tags,variants,images',
  }
  if (collection_id) params.collection_id = collection_id

  const data = await shopifyFetch(token, shop, 'products.json', params)
  const products = (data.products || []).map((p: any) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    vendor: p.vendor,
    product_type: p.product_type,
    tags: p.tags,
    image: p.images?.[0]?.src || null,
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compare_at_price: v.compare_at_price,
      sku: v.sku,
      inventory_quantity: v.inventory_quantity,
    })),
  }))

  return { products, total: products.length, shop }
}

async function handleGetOrders(args: any) {
  const { token, shop } = await getShopifyToken()
  const { days = '7', status = 'any', limit = '50' } = args

  const since = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString()

  const data = await shopifyFetch(token, shop, 'orders.json', {
    status,
    created_at_min: since,
    limit,
    fields: 'id,name,created_at,total_price,subtotal_price,financial_status,line_items,source_name',
  })

  const orders = (data.orders || []).map((o: any) => ({
    id: o.name,
    date: o.created_at?.slice(0, 10),
    total: parseFloat(o.total_price || '0'),
    subtotal: parseFloat(o.subtotal_price || '0'),
    status: o.financial_status,
    source: o.source_name,
    items: (o.line_items || []).map((li: any) => ({
      title: li.title,
      quantity: li.quantity,
      price: li.price,
    })),
  }))

  const paidOrders = orders.filter((o: any) => ['paid', 'partially_paid'].includes(o.status))
  const totalRevenue = paidOrders.reduce((sum: number, o: any) => sum + o.total, 0)

  return {
    orders,
    total: orders.length,
    summary: {
      total_orders: orders.length,
      paid_orders: paidOrders.length,
      total_revenue: +totalRevenue.toFixed(2),
      avg_order_value: paidOrders.length > 0 ? +(totalRevenue / paidOrders.length).toFixed(2) : 0,
      period_days: days,
    },
    shop,
  }
}

async function handleGetCollections() {
  const { token, shop } = await getShopifyToken()

  const data = await shopifyFetch(token, shop, 'custom_collections.json', {
    limit: '100',
    fields: 'id,title,body_html,products_count,published_at',
  })

  const collections = (data.custom_collections || []).map((c: any) => ({
    id: c.id,
    title: c.title,
    products_count: c.products_count,
    published: !!c.published_at,
  }))

  return { collections, total: collections.length, shop }
}

// ── Helpers ───────────────────────────────────────────────────────────
function extractPurchases(actions: any[]): number {
  if (!actions) return 0
  for (const a of actions) {
    if (['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'].includes(a.action_type)) {
      return parseInt(a.value || '0')
    }
  }
  return 0
}

function extractAction(actions: any[], types: string[]): number {
  if (!actions) return 0
  for (const a of actions) {
    if (types.includes(a.action_type)) return parseInt(a.value || '0')
  }
  return 0
}

function extractRevenue(actionValues: any[]): number {
  if (!actionValues) return 0
  for (const a of actionValues) {
    if (['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'].includes(a.action_type)) {
      return parseFloat(a.value || '0')
    }
  }
  return 0
}

function summarizeTargeting(targeting: any): string {
  if (!targeting) return 'No targeting data'
  const parts: string[] = []
  if (targeting.age_min || targeting.age_max) parts.push(`Age ${targeting.age_min || '?'}-${targeting.age_max || '?'}`)
  if (targeting.genders?.length) parts.push(`Gender: ${targeting.genders.map((g: number) => g === 1 ? 'Male' : g === 2 ? 'Female' : 'All').join(',')}`)
  if (targeting.geo_locations?.countries?.length) parts.push(`Countries: ${targeting.geo_locations.countries.join(',')}`)
  return parts.join(' | ') || 'Broad targeting'
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────
function jsonrpc(id: string | number | null, result: any) {
  return { jsonrpc: '2.0', id, result }
}

function jsonrpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// ── MCP Protocol handler ──────────────────────────────────────────────
async function handleMcpMessage(msg: any) {
  const { method, params, id } = msg

  switch (method) {
    case 'initialize':
      return jsonrpc(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'tribuanalyzer-pro',
          version: '1.0.0',
        },
      })

    case 'notifications/initialized':
      return null // no response needed for notifications

    case 'ping':
      return jsonrpc(id, {})

    case 'tools/list':
      return jsonrpc(id, { tools: TOOLS })

    case 'tools/call': {
      const toolName = params?.name
      const args = params?.arguments || {}
      const isMetaTool = ['get_ad_accounts', 'get_campaigns', 'get_campaign_insights', 'get_adsets', 'get_ads', 'create_campaign', 'create_adset', 'create_ad', 'update_adset', 'update_campaign'].includes(toolName)

      try {
        let result: any

        if (isMetaTool) {
          // Get Meta token: Supabase session first, fallback to env var
          let accessToken: string | null = null
          try {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
              const { data: connection } = await supabase
                .from('meta_connections')
                .select('access_token')
                .eq('user_id', user.id)
                .single()
              if (connection?.access_token) {
                accessToken = connection.access_token.trim()
              }
            }
          } catch { /* no browser session available */ }

          if (!accessToken) {
            accessToken = process.env.META_ACCESS_TOKEN?.trim() || null
          }
          if (!accessToken) {
            return jsonrpcError(id, -32000, 'No Meta token: no Supabase session and META_ACCESS_TOKEN not set')
          }

          switch (toolName) {
            case 'get_ad_accounts': result = await handleGetAdAccounts(accessToken); break
            case 'get_campaigns': result = await handleGetCampaigns(accessToken, args); break
            case 'get_campaign_insights': result = await handleGetCampaignInsights(accessToken, args); break
            case 'get_adsets': result = await handleGetAdsets(accessToken, args); break
            case 'get_ads': result = await handleGetAds(accessToken, args); break
            case 'create_campaign': result = await handleCreateCampaign(accessToken, args); break
            case 'create_adset': result = await handleCreateAdset(accessToken, args); break
            case 'create_ad': result = await handleCreateAd(accessToken, args); break
            case 'update_adset': result = await handleUpdateAdset(accessToken, args); break
            case 'update_campaign': result = await handleUpdateCampaign(accessToken, args); break
          }
        } else {
          // Shopify tools (get their own token via client_credentials)
          switch (toolName) {
            case 'get_products': result = await handleGetProducts(args); break
            case 'get_orders': result = await handleGetOrders(args); break
            case 'get_collections': result = await handleGetCollections(); break
            default:
              return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`)
          }
        }

        return jsonrpc(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        })
      } catch (err: any) {
        return jsonrpc(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        })
      }
    }

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`)
  }
}

// ── HTTP handlers ─────────────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(handleMcpMessage))
      return corsJson(results.filter(Boolean))
    }

    const result = await handleMcpMessage(body)
    if (!result) {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
    }
    return corsJson(result)
  } catch (err: any) {
    return corsJson(
      jsonrpcError(null, -32700, `Parse error: ${err.message}`),
      400
    )
  }
}

export async function GET(_request: NextRequest) {
  return corsJson({
    name: 'tribuanalyzer-meta-ads',
    version: '1.0.0',
    protocol: 'MCP 2024-11-05',
    tools: TOOLS.map(t => t.name),
    status: 'ok',
  })
}
