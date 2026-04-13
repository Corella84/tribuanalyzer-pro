import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

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
  if (data.access_token) {
    return { access_token: data.access_token, expires_in: data.expires_in || 3600 }
  }
  return null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const propertyId = searchParams.get('property_id')
  const datePreset = searchParams.get('date_preset') || 'last_7d'

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: connection } = await supabase
      .from('google_analytics_connections')
      .select('access_token, refresh_token, token_expires_at, selected_property_id')
      .eq('user_id', user.id)
      .single()

    if (!connection?.access_token) {
      return NextResponse.json({ success: false, needsConnection: true })
    }

    let accessToken = connection.access_token
    const selectedProperty = propertyId || connection.selected_property_id

    if (!selectedProperty) {
      return NextResponse.json({ success: false, error: 'No GA4 property selected' }, { status: 400 })
    }

    // Proactively refresh token if expiring within 5 minutes
    const expiresAt = new Date(connection.token_expires_at).getTime()
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshGoogleToken(connection.refresh_token)
      if (refreshed) {
        accessToken = refreshed.access_token
        await supabase
          .from('google_analytics_connections')
          .update({
            access_token: refreshed.access_token,
            token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
      }
    }

    // Date range based on preset
    const startDate = datePreset === 'last_7d' ? '7daysAgo'
      : datePreset === 'last_14d' ? '14daysAgo' : '30daysAgo'

    // Extract numeric property ID from "properties/XXXXXXX"
    const numericPropertyId = selectedProperty.replace('properties/', '')
    const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${numericPropertyId}:runReport`

    // Two parallel calls: overview + traffic sources
    const fetchReport = async (body: object) => {
      const res = await fetch(reportUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      // If 401, try refreshing token and retry once
      if (res.status === 401) {
        const refreshed = await refreshGoogleToken(connection.refresh_token)
        if (refreshed) {
          accessToken = refreshed.access_token
          await supabase
            .from('google_analytics_connections')
            .update({
              access_token: refreshed.access_token,
              token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id)

          const retryRes = await fetch(reportUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${refreshed.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          })
          return retryRes.json()
        }
      }

      return res.json()
    }

    const [overviewData, trafficData] = await Promise.all([
      // Overview - totals without dimensions
      fetchReport({
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViews' },
          { name: 'engagementRate' },
          { name: 'conversions' },
          { name: 'totalRevenue' },
        ],
      }),
      // Traffic Sources - with dimensions
      fetchReport({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' },
          { name: 'totalRevenue' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
    ])

    // Parse overview
    const overviewRow = overviewData.rows?.[0]?.metricValues || []
    const overview = {
      sessions: parseInt(overviewRow[0]?.value || '0'),
      totalUsers: parseInt(overviewRow[1]?.value || '0'),
      newUsers: parseInt(overviewRow[2]?.value || '0'),
      bounceRate: parseFloat(overviewRow[3]?.value || '0'),
      avgSessionDuration: parseFloat(overviewRow[4]?.value || '0'),
      pageViews: parseInt(overviewRow[5]?.value || '0'),
      engagementRate: parseFloat(overviewRow[6]?.value || '0'),
      conversions: parseInt(overviewRow[7]?.value || '0'),
      revenue: parseFloat(overviewRow[8]?.value || '0'),
    }

    // Parse traffic sources
    const trafficSources = (trafficData.rows || []).map((row: any) => ({
      source: row.dimensionValues?.[0]?.value || '(unknown)',
      medium: row.dimensionValues?.[1]?.value || '(unknown)',
      sessions: parseInt(row.metricValues?.[0]?.value || '0'),
      users: parseInt(row.metricValues?.[1]?.value || '0'),
      conversions: parseInt(row.metricValues?.[2]?.value || '0'),
      revenue: parseFloat(row.metricValues?.[3]?.value || '0'),
    }))

    return NextResponse.json({
      success: true,
      overview,
      trafficSources,
    })

  } catch (err) {
    console.error('Error fetching GA4 report:', err)
    return NextResponse.json({ success: false, error: 'Failed to fetch GA4 report' }, { status: 500 })
  }
}
