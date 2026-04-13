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
      .from('google_analytics_connections')
      .select('ga4_properties, selected_property_id')
      .eq('user_id', user.id)
      .single()

    if (!connection) {
      return NextResponse.json({
        success: false,
        properties: [],
        needsConnection: true
      })
    }

    return NextResponse.json({
      success: true,
      properties: connection.ga4_properties || [],
      selectedPropertyId: connection.selected_property_id,
    })

  } catch (err) {
    console.error('Error fetching GA properties:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch properties'
    }, { status: 500 })
  }
}
