#!/usr/bin/env npx tsx
/**
 * Probe TikTok Reporting API for valid metric names.
 *
 * Tests each candidate metric individually against /report/integrated/get/
 * to determine which ones the account accepts.
 *
 * Usage:
 *   TIKTOK_ACCESS_TOKEN=xxx TIKTOK_ADVERTISER_ID=yyy npx tsx scripts/probe-tiktok-metrics.ts
 *
 * This script is NOT part of the MCP server. It's a one-off diagnostic tool.
 */

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

const accessToken = process.env.TIKTOK_ACCESS_TOKEN?.trim()
const advertiserId = process.env.TIKTOK_ADVERTISER_ID?.trim()

if (!accessToken || !advertiserId) {
  console.error('Set TIKTOK_ACCESS_TOKEN and TIKTOK_ADVERTISER_ID env vars')
  process.exit(1)
}

// Known-good baseline metric (always include so the API has something to return)
const BASELINE = 'spend'

// Candidates to probe — one call per candidate
// Candidates sourced from TikTok API reference (CData/DataVirtuality docs) + original plan.
// Each is probed individually — an invalid name won't break anything.
const CANDIDATES = [
  // complete_payment family
  'complete_payment_roas',
  'complete_payment',
  'complete_payment_rate',
  'cost_per_complete_payment',
  'value_per_complete_payment',
  // purchase family
  'purchase',
  'cost_per_purchase',
  'purchase_rate',
  'total_purchase',
  'cost_per_total_purchase',
  'value_per_total_purchase',
  'total_purchase_value',
  'total_active_pay_roas',
  // onsite shopping
  'cost_per_onsite_shopping',
  'onsite_shopping_rate',
  'value_per_onsite_shopping',
  'total_onsite_shopping_value',
  // payment info
  'add_payment_info',
  // names from original plan (known invalid, kept to confirm)
  'total_complete_payment',
  'total_complete_payment_rate',
  'value_per_total_complete_payment',
  'cost_per_total_complete_payment',
]

// Use a short, recent date range to minimize data but still get a valid response
const now = new Date()
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const end_date = fmt(now)
const start = new Date(now)
start.setDate(start.getDate() - 1)
const start_date = fmt(start)

async function probeMetric(metric: string): Promise<{ metric: string; valid: boolean; error?: string }> {
  const url = new URL(`${TIKTOK_API_BASE}/report/integrated/get/`)
  const params: Record<string, any> = {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: ['campaign_id'],
    metrics: [BASELINE, metric],
    start_date,
    end_date,
  }

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }

  const res = await fetch(url.toString(), {
    headers: { 'Access-Token': accessToken! },
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json()

  if (data.code === 0) {
    return { metric, valid: true }
  }

  return { metric, valid: false, error: `${data.message} (code ${data.code})` }
}

async function main() {
  console.log(`Probing TikTok metrics for advertiser ${advertiserId}`)
  console.log(`Date range: ${start_date} to ${end_date}`)
  console.log(`Testing ${CANDIDATES.length} candidates...\n`)

  const results: { metric: string; valid: boolean; error?: string }[] = []

  // Run sequentially to avoid rate limits
  for (const metric of CANDIDATES) {
    const result = await probeMetric(metric)
    const status = result.valid ? '✓ VALID' : '✗ INVALID'
    console.log(`  ${status.padEnd(12)} ${metric}${result.error ? `  — ${result.error}` : ''}`)
    results.push(result)
  }

  const valid = results.filter(r => r.valid).map(r => r.metric)
  const invalid = results.filter(r => !r.valid).map(r => r.metric)

  console.log('\n=== SUMMARY ===')
  console.log(`Valid (${valid.length}):   ${valid.join(', ') || '(none)'}`)
  console.log(`Invalid (${invalid.length}): ${invalid.join(', ') || '(none)'}`)

  if (valid.length > 0) {
    console.log('\nTo add to OPTIONAL_VALUE_METRICS in tiktok.ts:')
    console.log(`  const OPTIONAL_VALUE_METRICS = [${valid.map(m => `'${m}'`).join(', ')}]`)
  }
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
