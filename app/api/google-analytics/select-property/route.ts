import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { property_id } = await request.json()

    if (!property_id) {
      return NextResponse.json({ success: false, error: 'property_id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('google_analytics_connections')
      .update({
        selected_property_id: property_id,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (error) {
      console.error('Error updating selected property:', error)
      return NextResponse.json({ success: false, error: 'Failed to update property' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error selecting GA property:', err)
    return NextResponse.json({ success: false, error: 'Failed to select property' }, { status: 500 })
  }
}
