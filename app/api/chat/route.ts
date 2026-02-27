import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await (supabase as any).auth.getUser()

        if (!user) {
            return new Response(JSON.stringify({ error: 'No autenticado' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        const body = await request.json()
        const { messages, campaigns, currency = 'USD', datePreset = 'last_7d' } = body

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ error: 'No hay mensajes' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            return new Response('# ⚠️ Error de configuración\n\nLa variable **GOOGLE_GENERATIVE_AI_API_KEY** no está configurada.', {
                status: 200,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
        }

        // Build campaign context for system prompt
        let campaignContext = ''
        if (campaigns && Array.isArray(campaigns) && campaigns.length > 0) {
            const totalSpend = campaigns.reduce((sum: number, c: any) => sum + (c.spend || 0), 0)
            const totalRevenue = campaigns.reduce((sum: number, c: any) => sum + (c.revenue || 0), 0)
            const totalPurchases = campaigns.reduce((sum: number, c: any) => sum + (c.purchases || 0), 0)
            const totalATC = campaigns.reduce((sum: number, c: any) => sum + (c.addToCart || 0), 0)
            const totalIC = campaigns.reduce((sum: number, c: any) => sum + (c.initiateCheckout || 0), 0)
            const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length
            const roasGeneral = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : '0'

            const periodLabel = datePreset === 'last_7d' ? 'Últimos 7 días'
                : datePreset === 'last_14d' ? 'Últimos 14 días' : 'Últimos 30 días'

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
                cpa: c.purchases > 0 ? (c.spend / c.purchases).toFixed(2) : null,
            }))

            campaignContext = `

## Datos de la cuenta de Meta Ads del usuario:
- Moneda: ${currency}
- Período: ${periodLabel}
- Total de campañas: ${campaigns.length} (${activeCampaigns} activas)
- Gasto total: ${totalSpend.toFixed(2)} ${currency}
- Revenue total: ${totalRevenue.toFixed(2)} ${currency}
- ROAS general: ${roasGeneral}x
- Compras totales: ${totalPurchases}
- Añadidos al carrito totales: ${totalATC}
- Pagos iniciados totales: ${totalIC}

**Datos por campaña:**
${JSON.stringify(cleanedData, null, 2)}`
        }

        const systemPrompt = `Eres un Media Buyer Senior con más de 10 años de experiencia gestionando presupuestos de Meta Ads para marcas de e-commerce y lead generation en Latinoamérica.

## Tu rol:
Eres el consultor IA del dashboard TribuAnalyzer Pro. El usuario te puede hacer preguntas sobre sus campañas y tú respondes con análisis basados en los datos reales que tienes.

## Reglas:
- Responde SIEMPRE en español
- Usa Markdown limpio y estructurado con emojis
- Sé directo, accionable y específico — no genérico
- Incluye los números reales de las métricas en tus respuestas
- Si el usuario pide el diagnóstico completo, incluye: Resumen Ejecutivo, Creativos con Fatiga, Campañas para Escalar, Campañas para Optimizar, Recomendaciones de Apagado, y Próximos Pasos
- Si el usuario pregunta algo específico (ej: "¿por qué baja el ROAS de X?"), responde solo eso
- Si no hay datos suficientes, dilo explícitamente
- Analiza el embudo: ATC → IC → Compra y señala dónde hay caídas${campaignContext}`

        // Build conversation messages for Gemini, including history
        const geminiMessages = messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }))

        const models = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'] as const

        for (const modelId of models) {
            try {
                const result = streamText({
                    model: google(modelId),
                    system: systemPrompt,
                    messages: geminiMessages,
                })

                return result.toTextStreamResponse()
            } catch (streamErr: any) {
                console.error(`Model ${modelId} failed:`, streamErr?.message || streamErr)
                if (modelId === models[models.length - 1]) {
                    const errorMsg = `# ⚠️ Error de Gemini\n\n${streamErr?.message || 'Error desconocido'}`
                    return new Response(errorMsg, {
                        status: 200,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                    })
                }
                console.log(`Falling back from ${modelId} to next model...`)
            }
        }

    } catch (err: any) {
        console.error('Error in chat route:', err?.message || err)
        return new Response(JSON.stringify({
            error: 'Error en el chat',
            details: err?.message || 'Unknown error'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
}
