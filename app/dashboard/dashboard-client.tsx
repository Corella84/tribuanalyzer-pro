'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface DashboardClientProps {
  user: User
}

type DatePreset = 'last_7d' | 'last_14d' | 'last_30d'
type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

interface Campaign {
  name: string
  status: string
  budget: number
  spend: number
  impressions: number
  clicks: number
  ctr: number
  frequency: number
  cpc: number
  cpm: number
  cpa: number
  purchases: number
  addToCart: number
  initiateCheckout: number
  revenue: number
  roas: number
}

interface AdAccount {
  id: string
  name: string
  currency: string
}

interface ShopifyData {
  shopDomain: string
  summary: {
    totalOrders: number
    totalRevenue: number
    avgOrderValue: number
    period: string
  }
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const currencySymbols: Record<string, string> = {
  USD: '$', CRC: '₡', MXN: 'MX$', COP: 'COL$', EUR: '€',
  GBP: '£', ARS: 'AR$', BRL: 'R$', CLP: 'CL$', PEN: 'S/',
}

function getCampaignHealth(c: Campaign): 'green' | 'yellow' | 'red' | 'gray' {
  if (c.spend === 0 && c.impressions === 0) return 'gray'
  if (c.roas >= 2 && c.ctr >= 1.5 && c.frequency <= 3) return 'green'
  if (c.roas < 1 || c.ctr < 0.8 || c.frequency > 5) return 'red'
  return 'yellow'
}

const healthConfig = {
  green: { emoji: '🟢', label: 'Escalar', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  yellow: { emoji: '🟡', label: 'Optimizar', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  red: { emoji: '🔴', label: 'Revisar', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  gray: { emoji: '⚪', label: 'Sin datos', bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
}

const quickQuestions = [
  { label: '📊 Diagnóstico completo', prompt: 'Dame un diagnóstico completo de todas mis campañas.' },
  { label: '🔴 Campañas con fatiga', prompt: '¿Cuáles campañas muestran señales de fatiga creativa? Analiza frecuencia, CTR y ROAS.' },
  { label: '🟢 Qué escalar', prompt: '¿Cuáles campañas debería escalar y cuánto presupuesto recomiendas agregar?' },
  { label: '🔻 Embudo ATC→IC→Compra', prompt: 'Analiza el embudo de conversión: ATC → IC → Compra. ¿Dónde hay caídas?' },
  { label: '💰 Optimizar CPA', prompt: '¿Cómo puedo reducir el CPA en las campañas de peor rendimiento?' },
]

export default function DashboardClient({ user }: DashboardClientProps) {
  const [datePreset, setDatePreset] = useState<DatePreset>('last_7d')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(true)
  const [needsConnection, setNeedsConnection] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shopify state
  const [shopifyData, setShopifyData] = useState<ShopifyData | null>(null)
  const [needsShopifyConnection, setNeedsShopifyConnection] = useState(false)
  const [shopifyLoading, setShopifyLoading] = useState(true)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const chatEndRef = useRef<HTMLDivElement>(null)

  const currencySymbol = currencySymbols[currency] || '$'

  const filteredCampaigns = statusFilter === 'ALL' ? campaigns : campaigns.filter(c => c.status === statusFilter)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const sendChatMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || isAnalyzing) return

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: userMessage }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setIsAnalyzing(true)

    const assistantId = (Date.now() + 1).toString()
    setChatMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          campaigns: filteredCampaigns,
          currency,
          datePreset,
          shopifyData: shopifyData?.summary ?? null,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('Error del servidor')
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setChatMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m)
        )
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setChatMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: '# ⚠️ Error\n\n' + (err.message || 'Error desconocido') } : m)
        )
      }
    } finally {
      setIsAnalyzing(false)
      abortRef.current = null
    }
  }, [chatMessages, isAnalyzing, filteredCampaigns, currency, datePreset])

  useEffect(() => {
    const metaStatus = searchParams.get('meta')
    const shopifyStatus = searchParams.get('shopify')
    const errorParam = searchParams.get('error')
    if (metaStatus === 'connected') loadAccounts()
    if (shopifyStatus === 'connected') loadShopifyOrders()
    if (errorParam) setError(`Error de conexión: ${errorParam}`)
  }, [searchParams])

  useEffect(() => { loadAccounts() }, [])
  useEffect(() => { loadShopifyOrders() }, [datePreset])

  useEffect(() => {
    if (selectedAccount) loadCampaigns()
  }, [selectedAccount, datePreset, statusFilter])

  async function loadAccounts() {
    try {
      const response = await fetch('/api/meta/accounts')
      const data = await response.json()
      if (data.needsConnection) { setNeedsConnection(true); setLoading(false); return }
      if (data.success && data.accounts.length > 0) {
        setAccounts(data.accounts)
        setSelectedAccount(data.accounts[0].id)
        setNeedsConnection(false)
      } else { setNeedsConnection(true) }
    } catch { setNeedsConnection(true) }
    setLoading(false)
  }

  async function loadCampaigns() {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ account_id: selectedAccount, date_preset: datePreset, status: statusFilter })
      const response = await fetch(`/api/meta/campaigns?${params}`)
      const data = await response.json()
      if (data.success) { setCampaigns(data.data); setCurrency(data.currency || 'USD') }
      else if (data.needsConnection) setNeedsConnection(true)
      else setError(data.error)
    } catch { setError('Error cargando campañas') }
    setLoading(false)
  }

  async function loadShopifyOrders() {
    setShopifyLoading(true)
    try {
      const res = await fetch(`/api/shopify/orders?date_preset=${datePreset}`)
      const data = await res.json()
      if (data.success) {
        setShopifyData(data)
        setNeedsShopifyConnection(false)
      } else {
        setNeedsShopifyConnection(true)
      }
    } catch {
      setNeedsShopifyConnection(true)
    }
    setShopifyLoading(false)
  }

  const handleConnectMeta = () => { window.location.href = '/api/auth/meta' }
  const handleConnectShopify = () => { window.location.href = '/api/auth/shopify' }
  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/login'); router.refresh() }

  const totals = filteredCampaigns.reduce((acc, c) => ({
    spend: acc.spend + c.spend,
    impressions: acc.impressions + c.impressions,
    revenue: acc.revenue + c.revenue,
    purchases: acc.purchases + c.purchases,
    addToCart: acc.addToCart + (c.addToCart || 0),
    initiateCheckout: acc.initiateCheckout + (c.initiateCheckout || 0),
  }), { spend: 0, impressions: 0, revenue: 0, purchases: 0, addToCart: 0, initiateCheckout: 0 })

  const roasGeneral = totals.spend > 0 ? totals.revenue / totals.spend : 0
  const cpaGeneral = totals.purchases > 0 ? totals.spend / totals.purchases : 0
  const ctrPromedio = filteredCampaigns.length > 0
    ? filteredCampaigns.reduce((sum, c) => sum + c.ctr, 0) / filteredCampaigns.length : 0

  const healthCounts = filteredCampaigns.reduce((acc, c) => {
    const h = getCampaignHealth(c)
    acc[h] = (acc[h] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  function getRoasColor(roas: number) {
    if (roas >= 2) return 'text-emerald-600'
    if (roas >= 1) return 'text-amber-600'
    return 'text-red-600'
  }

  function getCtrColor(ctr: number) {
    if (ctr >= 1.5) return 'text-emerald-600'
    if (ctr >= 0.8) return 'text-amber-600'
    return 'text-red-500'
  }

  function renderMarkdown(text: string) {
    return text.split('\n').map((line: string, i: number) => {
      if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold text-slate-800 mt-4 mb-2">{line.slice(4)}</h3>
      if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-slate-900 mt-5 mb-2">{line.slice(3)}</h2>
      if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-slate-900 mt-6 mb-3">{line.slice(2)}</h1>
      if (line.startsWith('---')) return <hr key={i} className="my-4 border-slate-200" />
      if (line.startsWith('- **')) {
        const match = line.match(/^- \*\*(.+?)\*\*(.*)/)
        if (match) return <div key={i} className="flex gap-2 mb-1.5"><span className="text-slate-300">•</span><span><strong className="text-slate-900">{match[1]}</strong><span className="text-slate-600">{match[2]}</span></span></div>
      }
      if (line.startsWith('- ')) return <div key={i} className="flex gap-2 mb-1"><span className="text-slate-300">•</span><span className="text-slate-600">{line.slice(2)}</span></div>
      if (line.trim() === '') return <div key={i} className="h-1.5" />
      const parts = line.split(/(\*\*[^*]+\*\*)/)
      const rendered = parts.map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="text-slate-900">{part.slice(2, -2)}</strong>
        return <span key={j}>{part}</span>
      })
      return <p key={i} className="text-slate-600 leading-relaxed mb-2">{rendered}</p>
    })
  }

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendChatMessage(chatInput)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-blue-50/30">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 sticky top-0 z-50 shadow-lg">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <span className="text-xl font-bold text-white tracking-tight">TribuAnalyzer</span>
              <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-full uppercase tracking-wider">Pro</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {accounts.length > 0 && (
              <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-600 rounded-lg bg-slate-800 text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {accounts.map((acc) => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
              </select>
            )}
            <span className="text-sm text-slate-400">{user.email}</span>
            <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-white transition-colors">Salir</button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Alert - Connect Meta */}
        {needsConnection && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-amber-900">Conecta tu cuenta de Meta Ads</h3>
                <p className="text-sm text-amber-700 mt-1">Para ver tus campañas reales, conecta tu cuenta de Meta Business.</p>
                <button onClick={handleConnectMeta} className="mt-3 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm">
                  Conectar Meta Ads
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Shopify Connection Alert */}
        {needsShopifyConnection && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-green-700" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.337 2.456c-.083-.459-.502-.787-.967-.787-.005 0-.009 0-.014 0-.459.013-.851.353-.913.809l-.355 2.637c-.517.18-1.008.415-1.466.697l-2.367-1.054c-.42-.186-.912-.066-1.197.292l-.01.012c-.285.358-.285.864.002 1.221l1.633 2.02c-.253.508-.45 1.049-.577 1.617l-2.604.598c-.458.105-.782.513-.782.981 0 .468.324.876.782.981l2.604.598c.127.568.324 1.11.577 1.617l-1.633 2.02c-.287.357-.287.863-.002 1.221l.01.012c.285.358.777.478 1.197.292l2.367-1.054c.458.282.949.517 1.466.697l.355 2.637c.062.456.454.796.913.809.005 0 .009 0 .014 0 .465 0 .884-.328.967-.787l.39-2.65c.509-.186.992-.425 1.441-.711l2.415 1.074c.42.186.912.066 1.197-.292l.01-.012c.285-.358.285-.864-.002-1.221l-1.662-2.057c.248-.506.441-1.043.567-1.607l2.656-.61c.458-.105.782-.513.782-.981 0-.468-.324-.876-.782-.981l-2.656-.61c-.126-.564-.319-1.101-.567-1.607l1.662-2.057c.287-.357.287-.863.002-1.221l-.01-.012c-.285-.358-.777-.478-1.197-.292l-2.415 1.074c-.449-.286-.932-.525-1.441-.711l-.39-2.65zm-1.337 9.544a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-green-900">Conecta tu tienda Shopify</h3>
                <p className="text-sm text-green-700 mt-1">Ver órdenes reales de <strong>corvega.myshopify.com</strong> y comparar con el revenue reportado por Meta.</p>
                <button onClick={handleConnectShopify}
                  className="mt-3 px-5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-semibold rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all shadow-sm">
                  Conectar Shopify
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200/80 p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Estado</span>
              <div className="flex gap-1">
                {(['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as StatusFilter[]).map((status) => (
                  <button key={status} onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${statusFilter === status ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                    {status === 'ALL' ? 'Todas' : status === 'ACTIVE' ? 'Activas' : status === 'PAUSED' ? 'Pausadas' : 'Archivadas'}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-px h-6 bg-slate-200"></div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Período</span>
              <div className="flex gap-1">
                {(['last_7d', 'last_14d', 'last_30d'] as DatePreset[]).map((preset) => (
                  <button key={preset} onClick={() => setDatePreset(preset)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${datePreset === preset ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                    {preset === 'last_7d' ? '7 días' : preset === 'last_14d' ? '14 días' : '30 días'}
                  </button>
                ))}
              </div>
            </div>
            {!needsConnection && (
              <>
                <div className="w-px h-6 bg-slate-200"></div>
                <button onClick={loadCampaigns} disabled={loading}
                  className="px-3 py-1.5 text-sm font-medium text-slate-500 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-all flex items-center gap-1.5">
                  <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {loading ? 'Cargando...' : 'Actualizar'}
                </button>
              </>
            )}
            {filteredCampaigns.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                {healthCounts.green > 0 && <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">🟢 {healthCounts.green}</span>}
                {healthCounts.yellow > 0 && <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">🟡 {healthCounts.yellow}</span>}
                {healthCounts.red > 0 && <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full">🔴 {healthCounts.red}</span>}
              </div>
            )}
          </div>
        </div>

        {/* === THREE SECTIONS: Meta | Shopify | Blended === */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

          {/* META ADS */}
          <div className="bg-white rounded-xl border border-blue-200/80 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-700" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z"/></svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Meta Ads</h3>
            </div>
            <div className="space-y-3">
              <div className="bg-blue-50/50 rounded-lg p-3">
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">Gasto</p>
                <p className="text-xl font-bold text-slate-900">{currencySymbol}{totals.spend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
              </div>
              <div className="bg-blue-50/50 rounded-lg p-3">
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">Revenue (Meta)</p>
                <p className="text-xl font-bold text-blue-700">{currencySymbol}{totals.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">ROAS Meta</p>
                  <p className={`text-xl font-bold ${getRoasColor(roasGeneral)}`}>{roasGeneral.toFixed(2)}x</p>
                </div>
                <div className="bg-blue-50/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">Compras</p>
                  <p className="text-xl font-bold text-slate-900">{totals.purchases}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">CPA</p>
                  <p className="text-xl font-bold text-slate-900">{currencySymbol}{cpaGeneral.toFixed(2)}</p>
                </div>
                <div className="bg-blue-50/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">CTR</p>
                  <p className={`text-xl font-bold ${getCtrColor(ctrPromedio)}`}>{ctrPromedio.toFixed(2)}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* SHOPIFY */}
          <div className="bg-white rounded-xl border border-green-200/80 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-green-700" fill="currentColor" viewBox="0 0 24 24"><path d="M15.34 2.46c-.08-.46-.5-.79-.97-.79h-.01c-.46.01-.85.35-.91.81l-.36 2.64c-.52.18-1.01.41-1.47.7l-2.37-1.05c-.42-.19-.91-.07-1.2.29l-.01.01c-.28.36-.28.86 0 1.22l1.63 2.02c-.25.51-.45 1.05-.58 1.62l-2.6.6c-.46.1-.78.51-.78.98s.32.88.78.98l2.6.6c.13.57.32 1.11.58 1.62l-1.63 2.02c-.29.36-.29.86 0 1.22l.01.01c.28.36.78.48 1.2.29l2.37-1.05c.46.28.95.52 1.47.7l.36 2.64c.06.46.45.8.91.81h.01c.47 0 .88-.33.97-.79l.39-2.65c.51-.19.99-.43 1.44-.71l2.42 1.07c.42.19.91.07 1.2-.29l.01-.01c.28-.36.28-.86 0-1.22l-1.66-2.06c.25-.51.44-1.04.57-1.61l2.66-.61c.46-.1.78-.51.78-.98s-.32-.88-.78-.98l-2.66-.61c-.13-.56-.32-1.1-.57-1.61l1.66-2.06c.29-.36.29-.86 0-1.22l-.01-.01c-.28-.36-.78-.48-1.2-.29l-2.42 1.07c-.45-.29-.93-.53-1.44-.71l-.39-2.65zM14 12a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Shopify{shopifyData ? ` · ${shopifyData.shopDomain}` : ''}</h3>
            </div>
            {shopifyData && !shopifyLoading ? (
              <div className="space-y-3">
                <div className="bg-green-50/50 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wider mb-0.5">Revenue Real</p>
                  <p className="text-xl font-bold text-green-800">{currencySymbol}{shopifyData.summary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wider mb-0.5">Órdenes</p>
                    <p className="text-xl font-bold text-green-900">{shopifyData.summary.totalOrders}</p>
                  </div>
                  <div className="bg-green-50/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wider mb-0.5">Ticket Promedio</p>
                    <p className="text-xl font-bold text-green-900">{currencySymbol}{shopifyData.summary.avgOrderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>
              </div>
            ) : shopifyLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-green-200 border-t-green-600 rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400 mb-3">Conecta Shopify para ver datos reales</p>
                <button onClick={handleConnectShopify} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-all">
                  Conectar Shopify
                </button>
              </div>
            )}
          </div>

          {/* BLENDED */}
          <div className="bg-white rounded-xl border border-purple-200/80 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Blended</h3>
            </div>
            {shopifyData && totals.spend > 0 ? (() => {
              const realRevenue = shopifyData.summary.totalRevenue
              const adSpend = totals.spend
              const roasBlended = adSpend > 0 ? realRevenue / adSpend : 0
              const profit = realRevenue - adSpend
              const realOrders = shopifyData.summary.totalOrders
              const cpaReal = realOrders > 0 ? adSpend / realOrders : 0
              const attrPct = totals.revenue > 0 ? (realRevenue / totals.revenue) * 100 : 0
              return (
                <div className="space-y-3">
                  <div className="bg-purple-50/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wider mb-0.5">ROAS Blended</p>
                    <p className={`text-2xl font-bold ${getRoasColor(roasBlended)}`}>{roasBlended.toFixed(2)}x</p>
                  </div>
                  <div className="bg-purple-50/50 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wider mb-0.5">Profit</p>
                    <p className={`text-xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{currencySymbol}{profit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-purple-50/50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wider mb-0.5">CPA Real</p>
                      <p className="text-xl font-bold text-slate-900">{currencySymbol}{cpaReal.toFixed(2)}</p>
                    </div>
                    <div className="bg-purple-50/50 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wider mb-0.5">Atribución</p>
                      <p className={`text-xl font-bold ${attrPct > 120 ? 'text-emerald-600' : attrPct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{attrPct.toFixed(0)}%</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-purple-100">
                    <p className="text-[10px] text-slate-400">Meta dice {currencySymbol}{totals.revenue.toLocaleString('en-US', { minimumFractionDigits: 0 })} · Shopify real {currencySymbol}{realRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
                  </div>
                </div>
              )
            })() : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">{!shopifyData ? 'Conecta Shopify para ver el blended' : 'Sin datos de Meta Ads'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Campaigns Table */}
        <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Campañas</h2>
            <p className="text-xs text-slate-400 mt-0.5">{filteredCampaigns.length} campañas · {datePreset === 'last_7d' ? 'Últimos 7 días' : datePreset === 'last_14d' ? 'Últimos 14 días' : 'Últimos 30 días'}</p>
          </div>
          {loading ? (
            <div className="p-16 text-center">
              <div className="w-10 h-10 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
              <p className="text-slate-400 mt-4 text-sm">Cargando campañas...</p>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              {needsConnection ? 'Conecta tu cuenta de Meta para ver campañas' : 'No hay campañas para mostrar'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/80">
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Salud</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Campaña</th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Estado</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Budget</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Gasto</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Impr.</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Clicks</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">CTR</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">CPC</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">CPM</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Freq.</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">ATC</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">IC</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Compras</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">CPA</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Revenue</th>
                    <th className="px-3 py-3 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredCampaigns.map((campaign, idx) => {
                    const health = getCampaignHealth(campaign)
                    const hc = healthConfig[health]
                    return (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-3 py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${hc.bg} ${hc.text} border ${hc.border}`}>
                            {hc.emoji} {hc.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5"><span className="font-medium text-slate-900 text-sm">{campaign.name}</span></td>
                        <td className="px-3 py-3.5">
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full ${campaign.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700'
                            : campaign.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                            {campaign.status === 'ACTIVE' ? 'Activa' : campaign.status === 'PAUSED' ? 'Pausada' : 'Archivada'}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-400 tabular-nums">{campaign.budget > 0 ? `${currencySymbol}${campaign.budget.toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-700 font-medium tabular-nums">{currencySymbol}{campaign.spend.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.impressions.toLocaleString()}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.clicks.toLocaleString()}</td>
                        <td className={`px-3 py-3.5 text-right text-sm font-medium tabular-nums ${getCtrColor(campaign.ctr)}`}>{campaign.ctr.toFixed(2)}%</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.cpc > 0 ? `${currencySymbol}${campaign.cpc.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.cpm > 0 ? `${currencySymbol}${campaign.cpm.toFixed(2)}` : '—'}</td>
                        <td className={`px-3 py-3.5 text-right text-sm font-medium tabular-nums ${campaign.frequency > 3 ? 'text-red-600' : 'text-slate-500'}`}>{campaign.frequency.toFixed(1)}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.addToCart}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-500 tabular-nums">{campaign.initiateCheckout}</td>
                        <td className="px-3 py-3.5 text-right text-sm font-semibold text-slate-900 tabular-nums">{campaign.purchases}</td>
                        <td className={`px-3 py-3.5 text-right text-sm font-medium tabular-nums ${campaign.cpa > 0 ? (campaign.roas >= 2 ? 'text-emerald-600' : campaign.roas >= 1 ? 'text-amber-600' : 'text-red-600') : 'text-slate-400'}`}>{campaign.cpa > 0 ? `${currencySymbol}${campaign.cpa.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-3.5 text-right text-sm font-medium text-emerald-600 tabular-nums">{currencySymbol}{campaign.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className={`px-3 py-3.5 text-right text-sm font-bold tabular-nums ${getRoasColor(campaign.roas)}`}>{campaign.roas.toFixed(2)}x</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* AI Chat Section */}
        <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
          {/* Chat Header */}
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Chat IA — Media Buyer</h2>
                  <p className="text-xs text-slate-400">Pregúntale sobre tus campañas · Powered by Gemini 3.1 Pro</p>
                </div>
              </div>
              {chatMessages.length > 0 && (
                <button onClick={() => setChatMessages([])} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100">
                  Limpiar chat
                </button>
              )}
            </div>
          </div>

          {/* Quick Questions */}
          {chatMessages.length === 0 && (
            <div className="px-6 py-5 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Preguntas rápidas</p>
              <div className="flex flex-wrap gap-2">
                {quickQuestions.map((q, idx) => (
                  <button key={idx} onClick={() => sendChatMessage(q.prompt)}
                    disabled={needsConnection || filteredCampaigns.length === 0 || isAnalyzing}
                    className="px-3 py-2 text-sm font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-all hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed">
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="max-h-[600px] overflow-y-auto">
            {chatMessages.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-slate-400 text-sm max-w-md mx-auto">
                  {needsConnection
                    ? 'Conecta tu cuenta de Meta para chatear con tu Media Buyer IA'
                    : filteredCampaigns.length === 0
                      ? 'No hay campañas para analizar'
                      : 'Usa las preguntas rápidas arriba o escribe tu propia pregunta'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {chatMessages.map((message) => (
                  <div key={message.id} className={`px-6 py-5 ${message.role === 'user' ? 'bg-slate-50/50' : 'bg-white'}`}>
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${message.role === 'user' ? 'bg-slate-200' : 'bg-gradient-to-br from-blue-500 to-purple-600'}`}>
                        {message.role === 'user' ? (
                          <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-400 mb-1.5">
                          {message.role === 'user' ? 'Tú' : 'Media Buyer IA'}
                        </p>
                        {message.role === 'user' ? (
                          <p className="text-sm text-slate-700">{message.content}</p>
                        ) : message.content === '' && isAnalyzing ? (
                          <div className="flex items-center gap-2 text-slate-400">
                            <div className="flex gap-1">
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                            <span className="text-sm">Analizando {filteredCampaigns.length} campañas...</span>
                          </div>
                        ) : (
                          <div className="text-sm">
                            {renderMarkdown(message.content)}
                            {isAnalyzing && message.id === chatMessages[chatMessages.length - 1]?.id && (
                              <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 rounded-sm"></span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <form onSubmit={handleChatSubmit} className="flex gap-3">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={needsConnection ? 'Conecta Meta primero...' : 'Pregunta sobre tus campañas... (ej: ¿Por qué bajó el ROAS?)'}
                disabled={needsConnection || filteredCampaigns.length === 0 || isAnalyzing}
                className="flex-1 px-4 py-3 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-slate-400"
              />
              <button type="submit"
                disabled={!chatInput.trim() || isAnalyzing || needsConnection || filteredCampaigns.length === 0}
                className="px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Enviar
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
