import { NextResponse } from 'next/server'

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`
  : 'http://localhost:3001/api/auth/meta/callback'

export async function GET() {
  const scopes = [
    'public_profile',
    'ads_read',
    'ads_management',
    'business_management'
  ].join(',')

  const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  authUrl.searchParams.set('client_id', META_APP_ID!)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('response_type', 'code')

  return NextResponse.redirect(authUrl.toString())
}
