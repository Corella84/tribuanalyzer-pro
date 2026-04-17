import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: connection } = await supabase
      .from('tiktok_connections')
      .select('advertisers, advertiser_ids, access_token, expires_at')
      .eq('user_id', user.id)
      .single()

    if (!connection) {
      return NextResponse.json({
        success: false,
        accounts: [],
        needsConnection: true
      })
    }

    // Check if token is expired
    if (connection.expires_at && new Date(connection.expires_at) < new Date()) {
      return NextResponse.json({
        success: false,
        accounts: [],
        needsConnection: true,
        error: 'TikTok token expired, please reconnect'
      })
    }

    const accounts = (connection.advertisers || []).map((adv: any) => ({
      id: String(adv.id || adv.advertiser_id),
      name: adv.name || adv.advertiser_name || String(adv.id),
      currency: adv.currency || 'USD',
    }))

    return NextResponse.json({
      success: true,
      accounts,
    })

  } catch (err) {
    console.error('Error fetching TikTok advertisers:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch advertisers'
    }, { status: 500 })
  }
}
