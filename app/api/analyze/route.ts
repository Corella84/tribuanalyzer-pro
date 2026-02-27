import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `Eres un Media Buyer Senior con más de 10 años de experiencia gestionando presupuestos de Meta Ads para marcas de e-commerce y lead generation en Latinoamérica.

Tu tarea es analizar un JSON con métricas de campañas de Meta Ads y entregar un diagnóstico accionable.

## Tu análisis DEBE incluir:

### 1. Resumen Ejecutivo
Un párrafo breve con el estado general de la cuenta.

### 2. 🔴 Creativos con Fatiga
Identifica campañas con señales de fatiga:
- CTR por debajo de 1% o en tendencia a la baja
- Frecuencia alta (>3)
- ROAS decreciente
Explica POR QUÉ están fatigadas y qué hacer.

### 3. 🟢 Campañas para Escalar
Identifica campañas con potencial de escalamiento:
- ROAS alto (>2x)
- CPA por debajo del promedio
- CTR saludable (>1.5%)
Recomienda cuánto incrementar el presupuesto y cómo.

### 4. 🟡 Campañas para Optimizar
Campañas con métricas mixtas que necesitan ajustes.

### 5. 🔻 Recomendaciones de Apagado
Campañas que deberían pausarse inmediatamente y por qué.

### 6. 📊 Próximos Pasos
Lista concreta de 3-5 acciones prioritarias ordenadas por impacto.

## Reglas:
- Responde SIEMPRE en español
- Usa Markdown limpio y estructurado
- Sé directo y accionable, no genérico
- Si no hay suficientes datos para una sección, dilo explícitamente
- Incluye los números reales de las métricas en tu análisis
- Usa emojis para mejorar la legibilidad`

export async function POST(request: Request) {
    try {
        // Authenticate user
        const supabase = await createClient()
        const { data: { user } } = await (supabase as any).auth.getUser()

        if (!user) {
            return new Response(JSON.stringify({ error: 'No autenticado' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // Parse request body - useCompletion sends { prompt, ...body }
        const body = await request.json()
        const { campaigns, currency = 'USD', datePreset = 'last_7d' } = body

        if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
            return new Response(JSON.stringify({ error: 'No hay campañas para analizar' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // Clean and extract key metrics
        const cleanedData = campaigns.map((c: any) => ({
            nombre: c.name,
            estado: c.status,
            gasto: c.spend,
            impresiones: c.impressions,
            ctr: c.ctr,
            frecuencia: c.frequency,
            añadidos_carrito: c.addToCart,
            pagos_iniciados: c.initiateCheckout,
            compras: c.purchases,
            revenue: c.revenue,
            roas: c.roas,
            cpa: c.purchases > 0 ? c.spend / c.purchases : null,
            cpc: c.impressions > 0 ? c.spend / (c.impressions * (c.ctr / 100)) : null,
        }))

        // Calculate account-level totals for context
        const totalSpend = campaigns.reduce((sum: number, c: any) => sum + (c.spend || 0), 0)
        const totalRevenue = campaigns.reduce((sum: number, c: any) => sum + (c.revenue || 0), 0)
        const totalPurchases = campaigns.reduce((sum: number, c: any) => sum + (c.purchases || 0), 0)
        const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length

        const roasGeneral = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : '0'

        const periodLabel = datePreset === 'last_7d' ? 'Últimos 7 días'
            : datePreset === 'last_14d' ? 'Últimos 14 días'
                : 'Últimos 30 días'

        const userPrompt = `Analiza estas campañas de Meta Ads.

**Contexto de la cuenta:**
- Moneda: ${currency}
- Período: ${periodLabel}
- Total de campañas: ${campaigns.length} (${activeCampaigns} activas)
- Gasto total: ${totalSpend.toFixed(2)} ${currency}
- Revenue total: ${totalRevenue.toFixed(2)} ${currency}
- ROAS general: ${roasGeneral}x
- Compras totales: ${totalPurchases}

**Datos por campaña:**
${JSON.stringify(cleanedData, null, 2)}`

        // Check API key is present
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            console.error('GOOGLE_GENERATIVE_AI_API_KEY is not set')
            const errorMsg = '# ⚠️ Error de configuración\n\nLa variable **GOOGLE_GENERATIVE_AI_API_KEY** no está configurada en Vercel.'
            return new Response(errorMsg, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }

        // Stream response from Gemini - try 3.1 pro, fallback to 2.0 flash
        const models = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'] as const

        for (const modelId of models) {
            try {
                const result = streamText({
                    model: google(modelId),
                    system: SYSTEM_PROMPT,
                    prompt: userPrompt,
                })

                // Await the text to check for errors before streaming
                const text = await result.text

                return new Response(text, {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                })
            } catch (streamErr: any) {
                console.error(`Model ${modelId} failed:`, streamErr?.message || streamErr)
                // If this is the last model, return error
                if (modelId === models[models.length - 1]) {
                    const errorMsg = `# ⚠️ Error de Gemini\n\n${streamErr?.message || 'Error desconocido'}`
                    return new Response(errorMsg, {
                        status: 200,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                    })
                }
                // Otherwise try next model
                console.log(`Falling back from ${modelId} to next model...`)
            }
        }

    } catch (err: any) {
        console.error('Error in analyze route:', err?.message || err)
        return new Response(JSON.stringify({
            error: 'Error al analizar campañas',
            details: err?.message || 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
