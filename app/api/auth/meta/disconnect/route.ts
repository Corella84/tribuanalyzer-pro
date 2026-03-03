import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { error } = await supabase
      .from('meta_connections')
      .delete()
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting meta connection:', error)
      return NextResponse.json({ success: false, error: 'Failed to disconnect' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error disconnecting Meta:', err)
    return NextResponse.json({ success: false, error: 'Failed to disconnect' }, { status: 500 })
  }
}
