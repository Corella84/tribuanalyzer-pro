import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-analytics/callback`
  : 'http://localhost:3000/api/auth/google-analytics/callback'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${origin}/dashboard?error=ga_auth_failed`)
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      console.error('No access token received:', tokenData)
      return NextResponse.redirect(`${origin}/dashboard?error=ga_no_token`)
    }

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresIn = tokenData.expires_in || 3600
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    // Fetch GA4 properties
    const accountsResponse = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const accountsData = await accountsResponse.json()

    // Parse properties from account summaries
    const properties: { property: string; displayName: string }[] = []
    if (accountsData.accountSummaries) {
      for (const account of accountsData.accountSummaries) {
        if (account.propertySummaries) {
          for (const prop of account.propertySummaries) {
            properties.push({
              property: prop.property,
              displayName: prop.displayName,
            })
          }
        }
      }
    }

    // Get Supabase user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    console.log('GA callback - user:', user?.id, 'authError:', authError?.message)
    console.log('GA callback - properties found:', properties.length)
    console.log('GA callback - has refresh_token:', !!refreshToken)

    if (!user) {
      console.error('GA callback - No user found, redirecting to login')
      return NextResponse.redirect(`${origin}/dashboard?error=ga_no_user`)
    }

    // Save GA connection to Supabase
    const { error: upsertError } = await supabase
      .from('google_analytics_connections')
      .upsert({
        user_id: user.id,
        access_token: accessToken,
        refresh_token: refreshToken || '',
        token_expires_at: tokenExpiresAt,
        ga4_properties: properties,
        selected_property_id: properties.length > 0 ? properties[0].property : null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })

    if (upsertError) {
      console.error('Error saving GA connection:', upsertError.message, upsertError.details)
      return NextResponse.redirect(`${origin}/dashboard?error=ga_save_failed`)
    }

    console.log('GA callback - Connection saved successfully for user:', user.id)
    return NextResponse.redirect(`${origin}/dashboard?ga=connected`)

  } catch (err) {
    console.error('Google Analytics OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard?error=ga_auth_error`)
  }
}
