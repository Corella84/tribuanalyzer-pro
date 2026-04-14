import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' })
    }

    const { data: connection } = await supabase
      .from('google_analytics_connections')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!connection) {
      return NextResponse.json({ error: 'No GA connection found' })
    }

    // Call Admin API with stored token
    const res = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
      { headers: { Authorization: `Bearer ${connection.access_token}` } }
    )
    const adminApiResponse = await res.json()

    return NextResponse.json({
      connectionExists: true,
      storedProperties: connection.ga4_properties,
      selectedPropertyId: connection.selected_property_id,
      tokenExpiresAt: connection.token_expires_at,
      tokenExpired: new Date(connection.token_expires_at) < new Date(),
      adminApiStatus: res.status,
      adminApiResponse,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message })
  }
}
