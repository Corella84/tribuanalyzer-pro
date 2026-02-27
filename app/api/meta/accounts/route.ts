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
      .from('meta_connections')
      .select('ad_accounts')
      .eq('user_id', user.id)
      .single()

    if (!connection) {
      return NextResponse.json({
        success: false,
        accounts: [],
        needsConnection: true
      })
    }

    const accounts = (connection.ad_accounts || [])
      .filter((acc: any) => acc.account_status === 1)
      .map((acc: any) => ({
        id: acc.id,
        name: acc.name || acc.id,
        currency: acc.currency,
      }))

    return NextResponse.json({
      success: true,
      accounts,
    })

  } catch (err) {
    console.error('Error fetching accounts:', err)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch accounts'
    }, { status: 500 })
  }
}
