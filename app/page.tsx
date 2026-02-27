import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <nav className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded"></div>
            <span className="text-xl font-semibold text-slate-900">TribuAnalyzer</span>
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">Pro</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              Ingresar
            </Link>
            <Link href="/register" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800">
              Comenzar gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero section */}
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-sm mb-6">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            Production Ready
          </div>
          
          <h1 className="text-6xl font-bold text-slate-900 mb-6 tracking-tight">
            Meta Ads Analytics
            <br />
            <span className="text-slate-400">Built for Scale</span>
          </h1>
          
          <p className="text-xl text-slate-600 mb-10 leading-relaxed">
            Enterprise-grade dashboard for Meta advertising performance.
            Real-time insights, automated reporting, and advanced attribution.
          </p>

          <div className="flex items-center gap-4">
            <Link href="/register" className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors">
              Comenzar gratis
            </Link>
            <Link href="/login" className="px-6 py-3 border border-slate-300 hover:border-slate-400 text-slate-700 font-medium rounded-lg transition-colors">
              Ver Demo
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 mt-16 pt-16 border-t border-gray-200">
            <div>
              <div className="text-3xl font-bold text-slate-900 mb-1">$2.4M+</div>
              <div className="text-sm text-slate-500">Ad Spend Tracked</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900 mb-1">50+</div>
              <div className="text-sm text-slate-500">Active Accounts</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900 mb-1">99.9%</div>
              <div className="text-sm text-slate-500">Uptime SLA</div>
            </div>
          </div>
        </div>
      </div>

      {/* Features preview */}
      <div className="max-w-7xl mx-auto px-6 pb-24">
        <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
          <div className="grid grid-cols-2 gap-px bg-slate-200">
            <div className="bg-white p-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Real-time Sync</h3>
              <p className="text-slate-600 text-sm">Live data from Meta Ads API with sub-second latency</p>
            </div>
            <div className="bg-white p-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Advanced Attribution</h3>
              <p className="text-slate-600 text-sm">Multi-touch attribution with Shopify integration</p>
            </div>
            <div className="bg-white p-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Automated Alerts</h3>
              <p className="text-slate-600 text-sm">Intelligent notifications when metrics deviate</p>
            </div>
            <div className="bg-white p-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">API Access</h3>
              <p className="text-slate-600 text-sm">Full REST API for custom integrations</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}