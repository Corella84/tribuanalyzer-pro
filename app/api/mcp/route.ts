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
    // Log full request for debugging
    const debugBody = { ...formBody, access_token: '***' }
    console.error('[metaPost]', url, JSON.stringify(debugBody))
    console.error('[metaPost] response:', JSON.stringify(data.error))
    const detail = data.error.error_user_msg || data.error.message
    throw new Error(`Meta API: ${detail} (code ${data.error.code}, subcode ${data.error.error_subcode || 'none'}) | Sent: ${JSON.stringify(debugBody)}`)
  }
  return data
}

// ── Meta API DELETE helper ────────────────────────────────────────────
async function metaDelete(token: string, path: string) {
  const url = new URL(`${BASE_URL}/${path}`)
  url.searchParams.set('access_token', token)
  const res = await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(15000) })
  const data = await res.json()
  if (data.error) throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`)
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
  // ── Meta Ads read (detail) tools ──
  {
    name: 'get_account_info',
    description: 'Get detailed info for an ad account: name, status, currency, timezone, balance, spend cap, business info.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' } }, required: ['account_id'] },
  },
  {
    name: 'get_account_pages',
    description: 'Get Facebook Pages available for the ad account to use in ads.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' } }, required: ['account_id'] },
  },
  {
    name: 'get_instagram_accounts',
    description: 'Get Instagram accounts linked to the ad account.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' } }, required: ['account_id'] },
  },
  {
    name: 'get_pixels',
    description: 'Get Meta Pixels for the ad account.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' } }, required: ['account_id'] },
  },
  {
    name: 'get_custom_audiences',
    description: 'Get custom audiences for the ad account.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' }, limit: { type: 'string', default: '50' } }, required: ['account_id'] },
  },
  {
    name: 'get_campaign_details',
    description: 'Get full details for a single campaign by ID.',
    inputSchema: { type: 'object' as const, properties: { campaign_id: { type: 'string', description: 'Campaign ID' } }, required: ['campaign_id'] },
  },
  {
    name: 'get_adset_details',
    description: 'Get full details for a single ad set by ID, including targeting and promoted object.',
    inputSchema: { type: 'object' as const, properties: { adset_id: { type: 'string', description: 'Ad set ID' } }, required: ['adset_id'] },
  },
  {
    name: 'get_ad_details',
    description: 'Get full details for a single ad by ID, including creative and tracking specs.',
    inputSchema: { type: 'object' as const, properties: { ad_id: { type: 'string', description: 'Ad ID' } }, required: ['ad_id'] },
  },
  {
    name: 'get_ad_creatives',
    description: 'Get ad creatives for an ad account.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' }, limit: { type: 'string', default: '50' } }, required: ['account_id'] },
  },
  {
    name: 'get_creative_details',
    description: 'Get full details for a single ad creative by ID.',
    inputSchema: { type: 'object' as const, properties: { creative_id: { type: 'string', description: 'Creative ID' } }, required: ['creative_id'] },
  },
  {
    name: 'get_ad_image',
    description: 'Get ad images for an ad account. Optionally filter by hashes.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' }, hashes: { type: 'array', items: { type: 'string' }, description: 'Filter by image hashes' } }, required: ['account_id'] },
  },
  {
    name: 'get_ad_video',
    description: 'Get details for a specific ad video by ID.',
    inputSchema: { type: 'object' as const, properties: { video_id: { type: 'string', description: 'Video ID' } }, required: ['video_id'] },
  },
  {
    name: 'get_insights',
    description: 'Get performance insights for any object (campaign, adset, ad, or account). More flexible than get_campaign_insights.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        object_id: { type: 'string', description: 'Any Meta object ID (campaign, adset, ad, or act_xxx)' },
        fields: { type: 'string', description: 'Comma-separated fields (default: spend,impressions,clicks,ctr,cpc,cpm,actions,action_values)' },
        date_preset: { type: 'string', default: 'last_7d' },
        time_increment: { type: 'string', description: '"1" for daily, "monthly", or omit for aggregate' },
        breakdowns: { type: 'string', description: 'e.g. age, gender, country, publisher_platform' },
        level: { type: 'string', description: 'Aggregation level: ad, adset, campaign, account' },
      },
      required: ['object_id'],
    },
  },
  {
    name: 'get_lead_gen_forms',
    description: 'Get lead gen forms for a Facebook Page.',
    inputSchema: { type: 'object' as const, properties: { page_id: { type: 'string', description: 'Facebook Page ID' } }, required: ['page_id'] },
  },
  {
    name: 'list_catalogs',
    description: 'List product catalogs for a business.',
    inputSchema: { type: 'object' as const, properties: { business_id: { type: 'string', description: 'Business ID' } }, required: ['business_id'] },
  },
  {
    name: 'list_product_sets',
    description: 'List product sets within a catalog.',
    inputSchema: { type: 'object' as const, properties: { catalog_id: { type: 'string', description: 'Product catalog ID' } }, required: ['catalog_id'] },
  },
  {
    name: 'list_email_reports',
    description: 'List async ad report runs for an ad account.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' } }, required: ['account_id'] },
  },
  // ── Meta Ads search/research tools ──
  {
    name: 'search_interests',
    description: 'Search for ad targeting interests by keyword.',
    inputSchema: { type: 'object' as const, properties: { q: { type: 'string', description: 'Search query (e.g. "yoga", "fitness")' } }, required: ['q'] },
  },
  {
    name: 'get_interest_suggestions',
    description: 'Get suggested interests based on an existing interest.',
    inputSchema: { type: 'object' as const, properties: { interest_list: { type: 'array', items: { type: 'string' }, description: 'List of interest names to get suggestions for' } }, required: ['interest_list'] },
  },
  {
    name: 'search_behaviors',
    description: 'List available behavior targeting categories.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'search_demographics',
    description: 'List available demographic targeting categories.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'search_geo_locations',
    description: 'Search for geographic locations for ad targeting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Search query (e.g. "Costa Rica", "San José")' },
        location_types: { type: 'array', items: { type: 'string' }, description: 'e.g. ["country","region","city","zip","geo_market"]' },
      },
      required: ['q'],
    },
  },
  {
    name: 'search_pages_by_name',
    description: 'Search for Facebook Pages by name.',
    inputSchema: { type: 'object' as const, properties: { q: { type: 'string', description: 'Page name to search' } }, required: ['q'] },
  },
  {
    name: 'estimate_audience_size',
    description: 'Estimate the audience size for a targeting spec.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (act_xxx)' },
        targeting_spec: { type: 'object', description: 'Targeting spec object (same format as adset targeting)' },
        optimization_goal: { type: 'string', description: 'e.g. OFFSITE_CONVERSIONS, LINK_CLICKS' },
      },
      required: ['account_id', 'targeting_spec'],
    },
  },
  {
    name: 'search',
    description: 'Generic Meta API search. Use type parameter to search different entities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Search type: adinterest, adinterestsuggestion, adgeolocation, adTargetingCategory, adlocale' },
        q: { type: 'string', description: 'Search query' },
        class: { type: 'string', description: 'For adTargetingCategory: behaviors, demographics, life_events, etc.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'fetch',
    description: 'Generic Meta Graph API fetch. Fetch any endpoint with custom fields and params.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'API path (e.g. "me/adaccounts", "123456/insights", "act_xxx/campaigns")' },
        params: { type: 'object', description: 'Query parameters as key-value pairs (e.g. { fields: "id,name", limit: "10" })' },
      },
      required: ['path'],
    },
  },
  // ── Meta Ads write tools (additional) ──
  {
    name: 'create_ad_creative',
    description: 'Create an ad creative with object_story_spec (single image/video). Returns creative ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (act_xxx)' },
        name: { type: 'string', description: 'Creative name' },
        object_story_spec: { type: 'object', description: 'Story spec: { page_id, link_data: { link, message, image_hash, call_to_action } }' },
        url_tags: { type: 'string', description: 'URL tags for tracking (e.g. utm_source=facebook&utm_medium=cpc)' },
      },
      required: ['account_id', 'name', 'object_story_spec'],
    },
  },
  {
    name: 'create_carousel_ad_creative',
    description: 'Create a carousel ad creative with multiple cards via asset_feed_spec or object_story_spec with child_attachments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (act_xxx)' },
        name: { type: 'string', description: 'Creative name' },
        object_story_spec: { type: 'object', description: 'Story spec with child_attachments for carousel' },
      },
      required: ['account_id', 'name', 'object_story_spec'],
    },
  },
  {
    name: 'update_ad',
    description: 'Update an existing ad. Can change name, status, creative, or tracking_specs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ad_id: { type: 'string', description: 'Ad ID to update' },
        name: { type: 'string' }, status: { type: 'string' },
        creative: { type: 'object', description: '{ creative_id: "xxx" }' },
        tracking_specs: { type: 'array' },
      },
      required: ['ad_id'],
    },
  },
  {
    name: 'update_ad_creative',
    description: 'Update an existing ad creative.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        creative_id: { type: 'string', description: 'Creative ID to update' },
        name: { type: 'string' }, url_tags: { type: 'string' },
        object_story_spec: { type: 'object' },
      },
      required: ['creative_id'],
    },
  },
  {
    name: 'update_email_report',
    description: 'Update an async ad report run.',
    inputSchema: { type: 'object' as const, properties: { report_id: { type: 'string' }, is_bookmarked: { type: 'boolean' } }, required: ['report_id'] },
  },
  {
    name: 'update_lead_gen_form_status',
    description: 'Update the status of a lead gen form (activate/archive).',
    inputSchema: { type: 'object' as const, properties: { form_id: { type: 'string' }, status: { type: 'string', description: 'ACTIVE, ARCHIVED, or DRAFT' } }, required: ['form_id', 'status'] },
  },
  {
    name: 'duplicate_campaign',
    description: 'Duplicate an existing campaign.',
    inputSchema: {
      type: 'object' as const,
      properties: { campaign_id: { type: 'string' }, deep_copy: { type: 'boolean', description: 'Also duplicate child ad sets and ads (default true)' }, rename_options: { type: 'object', description: '{ rename_suffix: " - Copy" }' } },
      required: ['campaign_id'],
    },
  },
  {
    name: 'duplicate_adset',
    description: 'Duplicate an existing ad set.',
    inputSchema: {
      type: 'object' as const,
      properties: { adset_id: { type: 'string' }, deep_copy: { type: 'boolean', description: 'Also duplicate child ads (default true)' }, campaign_id: { type: 'string', description: 'Target campaign (default same campaign)' }, rename_options: { type: 'object' } },
      required: ['adset_id'],
    },
  },
  {
    name: 'duplicate_ad',
    description: 'Duplicate an existing ad.',
    inputSchema: {
      type: 'object' as const,
      properties: { ad_id: { type: 'string' }, adset_id: { type: 'string', description: 'Target ad set (default same ad set)' }, rename_options: { type: 'object' } },
      required: ['ad_id'],
    },
  },
  {
    name: 'duplicate_creative',
    description: 'Duplicate an existing ad creative under the same account.',
    inputSchema: { type: 'object' as const, properties: { creative_id: { type: 'string' }, account_id: { type: 'string', description: 'Ad account for the new creative' } }, required: ['creative_id', 'account_id'] },
  },
  {
    name: 'upload_ad_image',
    description: 'Upload an image to the ad account from a URL. Returns the image hash for use in creatives.',
    inputSchema: {
      type: 'object' as const,
      properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' }, url: { type: 'string', description: 'Public URL of the image' }, name: { type: 'string', description: 'Image name' } },
      required: ['account_id', 'url'],
    },
  },
  {
    name: 'upload_ad_video',
    description: 'Upload a video to the ad account from a URL. Returns the video ID for use in creatives.',
    inputSchema: {
      type: 'object' as const,
      properties: { account_id: { type: 'string', description: 'Ad account ID (act_xxx)' }, file_url: { type: 'string', description: 'Public URL of the video' }, title: { type: 'string' }, description: { type: 'string' } },
      required: ['account_id', 'file_url'],
    },
  },
  {
    name: 'create_budget_schedule',
    description: 'Create a high-demand period budget schedule for a campaign (budget scheduling).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        high_demand_periods: { type: 'array', description: 'Array of { budget_value, budget_value_type, time_start, time_end }' },
      },
      required: ['campaign_id', 'high_demand_periods'],
    },
  },
  {
    name: 'create_email_report',
    description: 'Create an async ad report run for an ad account.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Ad account ID (act_xxx)' },
        fields: { type: 'string', description: 'Comma-separated insight fields' },
        date_preset: { type: 'string', default: 'last_7d' },
        level: { type: 'string', description: 'ad, adset, campaign, or account' },
        breakdowns: { type: 'string' },
      },
      required: ['account_id', 'fields'],
    },
  },
  {
    name: 'delete_email_report',
    description: 'Delete an async ad report run.',
    inputSchema: { type: 'object' as const, properties: { report_id: { type: 'string' } }, required: ['report_id'] },
  },
  {
    name: 'create_lead_gen_form',
    description: 'Create a lead gen form on a Facebook Page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'Facebook Page ID' },
        name: { type: 'string' },
        questions: { type: 'array', description: 'Array of { type, key, label } question objects' },
        privacy_policy: { type: 'object', description: '{ url: "https://..." }' },
        follow_up_action_url: { type: 'string' },
      },
      required: ['page_id', 'name', 'questions', 'privacy_policy'],
    },
  },
  {
    name: 'publish_lead_gen_draft_form',
    description: 'Publish a draft lead gen form (change status to ACTIVE).',
    inputSchema: { type: 'object' as const, properties: { form_id: { type: 'string' } }, required: ['form_id'] },
  },
  {
    name: 'submit_feedback',
    description: 'Submit feedback about tool results or suggestions.',
    inputSchema: {
      type: 'object' as const,
      properties: { feedback: { type: 'string', description: 'Feedback text' }, tool_name: { type: 'string' }, rating: { type: 'number', description: '1-5' } },
      required: ['feedback'],
    },
  },
  // ── Meta Ads bulk tools ──
  {
    name: 'bulk_get_insights',
    description: 'Get insights for multiple objects at once. Returns an array of results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        object_ids: { type: 'array', items: { type: 'string' }, description: 'Array of object IDs' },
        fields: { type: 'string', default: 'spend,impressions,clicks,ctr,cpc,actions,action_values' },
        date_preset: { type: 'string', default: 'last_7d' },
      },
      required: ['object_ids'],
    },
  },
  {
    name: 'bulk_get_ad_creatives',
    description: 'Get details for multiple ad creatives at once.',
    inputSchema: { type: 'object' as const, properties: { creative_ids: { type: 'array', items: { type: 'string' } } }, required: ['creative_ids'] },
  },
  {
    name: 'bulk_search_interests',
    description: 'Search for multiple interest keywords at once.',
    inputSchema: { type: 'object' as const, properties: { queries: { type: 'array', items: { type: 'string' }, description: 'Array of search queries' } }, required: ['queries'] },
  },
  {
    name: 'bulk_update_campaigns',
    description: 'Update multiple campaigns at once. Each item should have campaign_id and fields to update.',
    inputSchema: { type: 'object' as const, properties: { updates: { type: 'array', items: { type: 'object' }, description: 'Array of { campaign_id, name?, daily_budget?, status? }' } }, required: ['updates'] },
  },
  {
    name: 'bulk_update_adsets',
    description: 'Update multiple ad sets at once.',
    inputSchema: { type: 'object' as const, properties: { updates: { type: 'array', items: { type: 'object' }, description: 'Array of { adset_id, name?, daily_budget?, status? }' } }, required: ['updates'] },
  },
  {
    name: 'bulk_update_ads',
    description: 'Update multiple ads at once.',
    inputSchema: { type: 'object' as const, properties: { updates: { type: 'array', items: { type: 'object' }, description: 'Array of { ad_id, name?, status?, creative? }' } }, required: ['updates'] },
  },
  {
    name: 'bulk_create_ad_creatives',
    description: 'Create multiple ad creatives at once.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string' }, creatives: { type: 'array', items: { type: 'object' }, description: 'Array of { name, object_story_spec, url_tags? }' } }, required: ['account_id', 'creatives'] },
  },
  {
    name: 'bulk_upload_ad_images',
    description: 'Upload multiple images from URLs at once.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string' }, images: { type: 'array', items: { type: 'object' }, description: 'Array of { url, name? }' } }, required: ['account_id', 'images'] },
  },
  {
    name: 'bulk_upload_ad_videos',
    description: 'Upload multiple videos from URLs at once.',
    inputSchema: { type: 'object' as const, properties: { account_id: { type: 'string' }, videos: { type: 'array', items: { type: 'object' }, description: 'Array of { file_url, title?, description? }' } }, required: ['account_id', 'videos'] },
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
    special_ad_categories = ['NONE'],
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

// ── Meta Ads read (detail) handlers ──────────────────────────────────
async function handleGetAccountInfo(token: string, args: any) {
  const data = await metaFetch(token, args.account_id, { fields: 'id,name,account_status,currency,timezone_name,balance,amount_spent,spend_cap,business_name,business,min_daily_budget,funding_source_details' })
  return data
}

async function handleGetAccountPages(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/promote_pages`, { fields: 'id,name,link,picture,fan_count,verification_status', limit: '100' })
  return { pages: data.data || [], total: (data.data || []).length }
}

async function handleGetInstagramAccounts(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/instagram_accounts`, { fields: 'id,username,profile_pic,followers_count,media_count' })
  return { instagram_accounts: data.data || [], total: (data.data || []).length }
}

async function handleGetPixels(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/adspixels`, { fields: 'id,name,last_fired_time,creation_time,is_unavailable' })
  return { pixels: data.data || [], total: (data.data || []).length }
}

async function handleGetCustomAudiences(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/customaudiences`, { fields: 'id,name,approximate_count,subtype,description,time_created', limit: args.limit || '50' })
  return { audiences: data.data || [], total: (data.data || []).length }
}

async function handleGetCampaignDetails(token: string, args: any) {
  return metaFetch(token, args.campaign_id, { fields: 'id,name,status,objective,daily_budget,lifetime_budget,bid_strategy,buying_type,special_ad_categories,created_time,start_time,stop_time,budget_remaining' })
}

async function handleGetAdsetDetails(token: string, args: any) {
  return metaFetch(token, args.adset_id, { fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,promoted_object,bid_amount,bid_strategy,created_time,start_time,end_time,budget_remaining' })
}

async function handleGetAdDetails(token: string, args: any) {
  return metaFetch(token, args.ad_id, { fields: 'id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url,object_story_spec,url_tags},tracking_specs,conversion_specs,created_time' })
}

async function handleGetAdCreatives(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/adcreatives`, { fields: 'id,name,title,body,image_url,thumbnail_url,object_story_spec,url_tags,status', limit: args.limit || '50' })
  return { creatives: data.data || [], total: (data.data || []).length }
}

async function handleGetCreativeDetails(token: string, args: any) {
  return metaFetch(token, args.creative_id, { fields: 'id,name,title,body,image_url,thumbnail_url,object_story_spec,asset_feed_spec,url_tags,effective_object_story_id' })
}

async function handleGetAdImage(token: string, args: any) {
  const params: Record<string, string> = { fields: 'hash,name,url,url_128,width,height,created_time' }
  if (args.hashes?.length) params.hashes = JSON.stringify(args.hashes)
  const data = await metaFetch(token, `${args.account_id}/adimages`, params)
  return { images: data.data || [], total: (data.data || []).length }
}

async function handleGetAdVideo(token: string, args: any) {
  return metaFetch(token, args.video_id, { fields: 'id,title,source,picture,length,created_time,updated_time' })
}

async function handleGetInsights(token: string, args: any) {
  const params: Record<string, string> = {
    fields: args.fields || 'spend,impressions,clicks,ctr,cpc,cpm,actions,action_values',
    date_preset: args.date_preset || 'last_7d',
  }
  if (args.time_increment) params.time_increment = args.time_increment
  if (args.breakdowns) params.breakdowns = args.breakdowns
  if (args.level) params.level = args.level
  const data = await metaFetch(token, `${args.object_id}/insights`, params)
  return { insights: data.data || [], total: (data.data || []).length }
}

async function handleGetLeadGenForms(token: string, args: any) {
  const data = await metaFetch(token, `${args.page_id}/leadgen_forms`, { fields: 'id,name,status,leads_count,created_time,expired_leads_count' })
  return { forms: data.data || [], total: (data.data || []).length }
}

async function handleListCatalogs(token: string, args: any) {
  const data = await metaFetch(token, `${args.business_id}/owned_product_catalogs`, { fields: 'id,name,product_count,vertical' })
  return { catalogs: data.data || [], total: (data.data || []).length }
}

async function handleListProductSets(token: string, args: any) {
  const data = await metaFetch(token, `${args.catalog_id}/product_sets`, { fields: 'id,name,filter,product_count' })
  return { product_sets: data.data || [], total: (data.data || []).length }
}

async function handleListEmailReports(token: string, args: any) {
  const data = await metaFetch(token, `${args.account_id}/adreportruns`, { fields: 'id,async_status,async_percent_completion,date_start,date_stop,time_completed', limit: '50' })
  return { reports: data.data || [], total: (data.data || []).length }
}

// ── Meta Ads search/research handlers ────────────────────────────────
async function handleSearchInterests(token: string, args: any) {
  const data = await metaFetch(token, 'search', { type: 'adinterest', q: args.q })
  return { interests: data.data || [], total: (data.data || []).length }
}

async function handleGetInterestSuggestions(token: string, args: any) {
  const data = await metaFetch(token, 'search', { type: 'adinterestsuggestion', interest_list: JSON.stringify(args.interest_list) })
  return { suggestions: data.data || [], total: (data.data || []).length }
}

async function handleSearchBehaviors(token: string) {
  const data = await metaFetch(token, 'search', { type: 'adTargetingCategory', class: 'behaviors' })
  return { behaviors: data.data || [], total: (data.data || []).length }
}

async function handleSearchDemographics(token: string) {
  const data = await metaFetch(token, 'search', { type: 'adTargetingCategory', class: 'demographics' })
  return { demographics: data.data || [], total: (data.data || []).length }
}

async function handleSearchGeoLocations(token: string, args: any) {
  const params: Record<string, string> = { type: 'adgeolocation', q: args.q }
  if (args.location_types) params.location_types = JSON.stringify(args.location_types)
  const data = await metaFetch(token, 'search', params)
  return { locations: data.data || [], total: (data.data || []).length }
}

async function handleSearchPagesByName(token: string, args: any) {
  const data = await metaFetch(token, 'pages/search', { q: args.q, fields: 'id,name,link,fan_count,verification_status,picture' })
  return { pages: data.data || [], total: (data.data || []).length }
}

async function handleEstimateAudienceSize(token: string, args: any) {
  const body: Record<string, any> = { targeting_spec: args.targeting_spec }
  if (args.optimization_goal) body.optimization_goal = args.optimization_goal
  return metaPost(token, `${args.account_id}/delivery_estimate`, body)
}

async function handleSearch(token: string, args: any) {
  const params: Record<string, string> = { type: args.type }
  if (args.q) params.q = args.q
  if (args.class) params.class = args.class
  const data = await metaFetch(token, 'search', params)
  return { data: data.data || [], total: (data.data || []).length }
}

async function handleFetch(token: string, args: any) {
  const params: Record<string, string> = {}
  if (args.params) {
    for (const [k, v] of Object.entries(args.params)) {
      params[k] = String(v)
    }
  }
  return metaFetch(token, args.path, params)
}

// ── Meta Ads additional write handlers ───────────────────────────────
async function handleCreateAdCreative(token: string, args: any) {
  const body: Record<string, any> = { name: args.name, object_story_spec: args.object_story_spec }
  if (args.url_tags) body.url_tags = args.url_tags
  const data = await metaPost(token, `${args.account_id}/adcreatives`, body)
  return { success: true, creative_id: data.id, message: `Creative "${args.name}" created` }
}

async function handleCreateCarouselAdCreative(token: string, args: any) {
  const body: Record<string, any> = { name: args.name, object_story_spec: args.object_story_spec }
  const data = await metaPost(token, `${args.account_id}/adcreatives`, body)
  return { success: true, creative_id: data.id, message: `Carousel creative "${args.name}" created` }
}

async function handleUpdateAd(token: string, args: any) {
  const { ad_id, ...fields } = args
  const body: Record<string, any> = {}
  if (fields.name !== undefined) body.name = fields.name
  if (fields.status !== undefined) body.status = fields.status
  if (fields.creative !== undefined) body.creative = fields.creative
  if (fields.tracking_specs !== undefined) body.tracking_specs = fields.tracking_specs
  if (Object.keys(body).length === 0) return { success: false, message: 'No fields to update' }
  await metaPost(token, ad_id, body)
  return { success: true, ad_id, updated_fields: Object.keys(body) }
}

async function handleUpdateAdCreative(token: string, args: any) {
  const { creative_id, ...fields } = args
  const body: Record<string, any> = {}
  if (fields.name !== undefined) body.name = fields.name
  if (fields.url_tags !== undefined) body.url_tags = fields.url_tags
  if (fields.object_story_spec !== undefined) body.object_story_spec = fields.object_story_spec
  if (Object.keys(body).length === 0) return { success: false, message: 'No fields to update' }
  await metaPost(token, creative_id, body)
  return { success: true, creative_id, updated_fields: Object.keys(body) }
}

async function handleUpdateEmailReport(token: string, args: any) {
  const body: Record<string, any> = {}
  if (args.is_bookmarked !== undefined) body.is_bookmarked = args.is_bookmarked
  await metaPost(token, args.report_id, body)
  return { success: true, report_id: args.report_id }
}

async function handleUpdateLeadGenFormStatus(token: string, args: any) {
  await metaPost(token, args.form_id, { status: args.status })
  return { success: true, form_id: args.form_id, status: args.status }
}

async function handleDuplicateCampaign(token: string, args: any) {
  const body: Record<string, any> = { deep_copy: args.deep_copy !== false }
  if (args.rename_options) body.rename_options = args.rename_options
  const data = await metaPost(token, `${args.campaign_id}/copies`, body)
  return { success: true, new_campaign_id: data.copied_campaign_id || data.id, original: args.campaign_id }
}

async function handleDuplicateAdset(token: string, args: any) {
  const body: Record<string, any> = { deep_copy: args.deep_copy !== false }
  if (args.campaign_id) body.campaign_id = args.campaign_id
  if (args.rename_options) body.rename_options = args.rename_options
  const data = await metaPost(token, `${args.adset_id}/copies`, body)
  return { success: true, new_adset_id: data.copied_adset_id || data.id, original: args.adset_id }
}

async function handleDuplicateAd(token: string, args: any) {
  const body: Record<string, any> = {}
  if (args.adset_id) body.adset_id = args.adset_id
  if (args.rename_options) body.rename_options = args.rename_options
  const data = await metaPost(token, `${args.ad_id}/copies`, body)
  return { success: true, new_ad_id: data.copied_ad_id || data.id, original: args.ad_id }
}

async function handleDuplicateCreative(token: string, args: any) {
  const original = await metaFetch(token, args.creative_id, { fields: 'name,object_story_spec,url_tags' })
  const body: Record<string, any> = { name: `${original.name} - Copy`, object_story_spec: original.object_story_spec }
  if (original.url_tags) body.url_tags = original.url_tags
  const data = await metaPost(token, `${args.account_id}/adcreatives`, body)
  return { success: true, new_creative_id: data.id, original: args.creative_id }
}

async function handleUploadAdImage(token: string, args: any) {
  const body: Record<string, any> = { url: args.url }
  if (args.name) body.name = args.name
  const data = await metaPost(token, `${args.account_id}/adimages`, body)
  const images = data.images || {}
  const first = Object.values(images)[0] as any
  return { success: true, hash: first?.hash, url: first?.url, name: first?.name }
}

async function handleUploadAdVideo(token: string, args: any) {
  const body: Record<string, any> = { file_url: args.file_url }
  if (args.title) body.title = args.title
  if (args.description) body.description = args.description
  const data = await metaPost(token, `${args.account_id}/advideos`, body)
  return { success: true, video_id: data.id }
}

async function handleCreateBudgetSchedule(token: string, args: any) {
  return metaPost(token, `${args.campaign_id}/budget_schedules`, { high_demand_periods: args.high_demand_periods })
}

async function handleCreateEmailReport(token: string, args: any) {
  const body: Record<string, any> = { fields: args.fields, date_preset: args.date_preset || 'last_7d' }
  if (args.level) body.level = args.level
  if (args.breakdowns) body.breakdowns = args.breakdowns
  const data = await metaPost(token, `${args.account_id}/adreportrun`, body)
  return { success: true, report_run_id: data.report_run_id || data.id }
}

async function handleDeleteEmailReport(token: string, args: any) {
  await metaDelete(token, args.report_id)
  return { success: true, deleted: args.report_id }
}

async function handleCreateLeadGenForm(token: string, args: any) {
  const body: Record<string, any> = { name: args.name, questions: args.questions, privacy_policy: args.privacy_policy }
  if (args.follow_up_action_url) body.follow_up_action_url = args.follow_up_action_url
  const data = await metaPost(token, `${args.page_id}/leadgen_forms`, body)
  return { success: true, form_id: data.id }
}

async function handlePublishLeadGenDraftForm(token: string, args: any) {
  await metaPost(token, args.form_id, { status: 'ACTIVE' })
  return { success: true, form_id: args.form_id, status: 'ACTIVE' }
}

async function handleSubmitFeedback(_token: string, args: any) {
  return { success: true, message: 'Feedback received', feedback: args.feedback, tool_name: args.tool_name || null, rating: args.rating || null }
}

// ── Meta Ads bulk handlers ───────────────────────────────────────────
async function handleBulkGetInsights(token: string, args: any) {
  const results = await Promise.all((args.object_ids || []).map(async (id: string) => {
    try {
      const r = await handleGetInsights(token, { object_id: id, fields: args.fields, date_preset: args.date_preset })
      return { object_id: id, ...r }
    } catch (e: any) { return { object_id: id, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkGetAdCreatives(token: string, args: any) {
  const results = await Promise.all((args.creative_ids || []).map(async (id: string) => {
    try { return await handleGetCreativeDetails(token, { creative_id: id }) }
    catch (e: any) { return { creative_id: id, error: e.message } }
  }))
  return { creatives: results, total: results.length }
}

async function handleBulkSearchInterests(token: string, args: any) {
  const results = await Promise.all((args.queries || []).map(async (q: string) => {
    try {
      const r = await handleSearchInterests(token, { q })
      return { query: q, ...r }
    } catch (e: any) { return { query: q, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkUpdateCampaigns(token: string, args: any) {
  const results = await Promise.all((args.updates || []).map(async (u: any) => {
    try { return await handleUpdateCampaign(token, u) }
    catch (e: any) { return { campaign_id: u.campaign_id, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkUpdateAdsets(token: string, args: any) {
  const results = await Promise.all((args.updates || []).map(async (u: any) => {
    try { return await handleUpdateAdset(token, u) }
    catch (e: any) { return { adset_id: u.adset_id, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkUpdateAds(token: string, args: any) {
  const results = await Promise.all((args.updates || []).map(async (u: any) => {
    try { return await handleUpdateAd(token, u) }
    catch (e: any) { return { ad_id: u.ad_id, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkCreateAdCreatives(token: string, args: any) {
  const results = await Promise.all((args.creatives || []).map(async (c: any) => {
    try { return await handleCreateAdCreative(token, { account_id: args.account_id, ...c }) }
    catch (e: any) { return { name: c.name, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkUploadAdImages(token: string, args: any) {
  const results = await Promise.all((args.images || []).map(async (img: any) => {
    try { return await handleUploadAdImage(token, { account_id: args.account_id, ...img }) }
    catch (e: any) { return { url: img.url, error: e.message } }
  }))
  return { results, total: results.length }
}

async function handleBulkUploadAdVideos(token: string, args: any) {
  const results = await Promise.all((args.videos || []).map(async (vid: any) => {
    try { return await handleUploadAdVideo(token, { account_id: args.account_id, ...vid }) }
    catch (e: any) { return { file_url: vid.file_url, error: e.message } }
  }))
  return { results, total: results.length }
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

      // Handler maps for clean routing
      const META_HANDLERS: Record<string, (t: string, a: any) => Promise<any>> = {
        get_ad_accounts: handleGetAdAccounts,
        get_campaigns: handleGetCampaigns,
        get_campaign_insights: handleGetCampaignInsights,
        get_adsets: handleGetAdsets,
        get_ads: handleGetAds,
        get_account_info: handleGetAccountInfo,
        get_account_pages: handleGetAccountPages,
        get_instagram_accounts: handleGetInstagramAccounts,
        get_pixels: handleGetPixels,
        get_custom_audiences: handleGetCustomAudiences,
        get_campaign_details: handleGetCampaignDetails,
        get_adset_details: handleGetAdsetDetails,
        get_ad_details: handleGetAdDetails,
        get_ad_creatives: handleGetAdCreatives,
        get_creative_details: handleGetCreativeDetails,
        get_ad_image: handleGetAdImage,
        get_ad_video: handleGetAdVideo,
        get_insights: handleGetInsights,
        get_lead_gen_forms: handleGetLeadGenForms,
        get_interest_suggestions: handleGetInterestSuggestions,
        list_catalogs: handleListCatalogs,
        list_product_sets: handleListProductSets,
        list_email_reports: handleListEmailReports,
        search_interests: handleSearchInterests,
        search_behaviors: (t) => handleSearchBehaviors(t),
        search_demographics: (t) => handleSearchDemographics(t),
        search_geo_locations: handleSearchGeoLocations,
        search_pages_by_name: handleSearchPagesByName,
        search: handleSearch,
        fetch: handleFetch,
        estimate_audience_size: handleEstimateAudienceSize,
        create_campaign: handleCreateCampaign,
        create_adset: handleCreateAdset,
        create_ad: handleCreateAd,
        create_ad_creative: handleCreateAdCreative,
        create_carousel_ad_creative: handleCreateCarouselAdCreative,
        create_budget_schedule: handleCreateBudgetSchedule,
        create_email_report: handleCreateEmailReport,
        create_lead_gen_form: handleCreateLeadGenForm,
        update_campaign: handleUpdateCampaign,
        update_adset: handleUpdateAdset,
        update_ad: handleUpdateAd,
        update_ad_creative: handleUpdateAdCreative,
        update_email_report: handleUpdateEmailReport,
        update_lead_gen_form_status: handleUpdateLeadGenFormStatus,
        duplicate_campaign: handleDuplicateCampaign,
        duplicate_adset: handleDuplicateAdset,
        duplicate_ad: handleDuplicateAd,
        duplicate_creative: handleDuplicateCreative,
        upload_ad_image: handleUploadAdImage,
        upload_ad_video: handleUploadAdVideo,
        delete_email_report: handleDeleteEmailReport,
        publish_lead_gen_draft_form: handlePublishLeadGenDraftForm,
        submit_feedback: handleSubmitFeedback,
        bulk_get_insights: handleBulkGetInsights,
        bulk_get_ad_creatives: handleBulkGetAdCreatives,
        bulk_search_interests: handleBulkSearchInterests,
        bulk_update_campaigns: handleBulkUpdateCampaigns,
        bulk_update_adsets: handleBulkUpdateAdsets,
        bulk_update_ads: handleBulkUpdateAds,
        bulk_create_ad_creatives: handleBulkCreateAdCreatives,
        bulk_upload_ad_images: handleBulkUploadAdImages,
        bulk_upload_ad_videos: handleBulkUploadAdVideos,
      }

      const SHOPIFY_HANDLERS: Record<string, (a: any) => Promise<any>> = {
        get_products: handleGetProducts,
        get_orders: handleGetOrders,
        get_collections: () => handleGetCollections(),
      }

      try {
        let result: any

        if (toolName in META_HANDLERS) {
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

          result = await META_HANDLERS[toolName](accessToken, args)
        } else if (toolName in SHOPIFY_HANDLERS) {
          result = await SHOPIFY_HANDLERS[toolName](args)
        } else {
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
