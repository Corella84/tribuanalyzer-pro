import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const META_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// ── Auth ──────────────────────────────────────────────────────────────
function authenticate(request: NextRequest): boolean {
  const secret = request.headers.get('x-mcp-secret') || request.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.MCP_SECRET
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
          name: 'tribuanalyzer-meta-ads',
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

      // Get Meta token from Supabase (same as app/api/meta/campaigns/route.ts)
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return jsonrpcError(id, -32000, 'Not authenticated: no Supabase user session')
      }

      const { data: connection } = await supabase
        .from('meta_connections')
        .select('access_token')
        .eq('user_id', user.id)
        .single()

      if (!connection?.access_token) {
        return jsonrpcError(id, -32000, 'Meta not connected: no access_token found for user')
      }

      const accessToken = connection.access_token.trim()

      try {
        let result: any
        switch (toolName) {
          case 'get_ad_accounts':
            result = await handleGetAdAccounts(accessToken)
            break
          case 'get_campaigns':
            result = await handleGetCampaigns(accessToken, args)
            break
          case 'get_campaign_insights':
            result = await handleGetCampaignInsights(accessToken, args)
            break
          case 'get_adsets':
            result = await handleGetAdsets(accessToken, args)
            break
          case 'get_ads':
            result = await handleGetAds(accessToken, args)
            break
          default:
            return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`)
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
export async function POST(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json(
      jsonrpcError(null, -32000, 'Unauthorized: invalid or missing MCP_SECRET'),
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(handleMcpMessage))
      return NextResponse.json(results.filter(Boolean))
    }

    const result = await handleMcpMessage(body)
    if (!result) {
      return new NextResponse(null, { status: 204 })
    }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      jsonrpcError(null, -32700, `Parse error: ${err.message}`),
      { status: 400 }
    )
  }
}

export async function GET(request: NextRequest) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    name: 'tribuanalyzer-meta-ads',
    version: '1.0.0',
    protocol: 'MCP 2024-11-05',
    tools: TOOLS.map(t => t.name),
    status: 'ok',
  })
}
