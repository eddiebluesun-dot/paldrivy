import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((utcTo - utcFrom) / msPerDay)
}

async function sendPush(token: string, title: string, body: string) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ to: token, title, body, sound: 'default' }]),
    })
  } catch (err) {
    console.error('expo push send failed', err)
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  if (!apiKey) return
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: 'PalDrivy', email: 'no-reply@paldrivy.com' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    })
  } catch (err) {
    console.error('brevo send failed', err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // subscriptions.user_id has no FK to profiles (only to auth.users), so PostgREST
  // can't embed profiles here — fetch separately and merge (same pattern used in
  // admin-paldrivy's getSubscriptions/getCountryStats).
  const { data: subs, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, current_period_end, expiry_warning_sent_at, expiry_followup_sent_at')
    .in('status', ['active', 'trial', 'complimentary'])
    .not('current_period_end', 'is', null)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userIds = (subs ?? []).map((s: any) => s.user_id)
  const { data: profiles } = userIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, push_token').in('id', userIds)
    : { data: [] as any[] }
  const pushTokenByUserId = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.push_token as string | null]))

  const today = new Date()
  let warned = 0
  let followedUp = 0

  for (const sub of (subs ?? []) as any[]) {
    const end = new Date(sub.current_period_end)
    const diff = daysBetween(today, end) // positive = end is still in the future
    const pushToken: string | null = pushTokenByUserId.get(sub.user_id) ?? null

    if (diff === 7 && !sub.expiry_warning_sent_at) {
      if (pushToken) await sendPush(pushToken, 'Sua assinatura vence em 7 dias', 'Renove para não perder o acesso Premium.')
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sub.user_id)
      if (authUser?.user?.email) {
        await sendEmail(authUser.user.email, 'Sua assinatura PalDrivy vence em 7 dias',
          '<p>Sua assinatura Premium vence em 7 dias. Renove para continuar aproveitando todos os recursos.</p>')
      }
      await supabaseAdmin.from('subscriptions').update({ expiry_warning_sent_at: today.toISOString() }).eq('id', sub.id)
      warned++
    }

    if (diff === -1 && !sub.expiry_followup_sent_at) {
      if (pushToken) await sendPush(pushToken, 'Sua assinatura expirou', 'Renove agora para recuperar o acesso Premium.')
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sub.user_id)
      if (authUser?.user?.email) {
        await sendEmail(authUser.user.email, 'Sua assinatura PalDrivy expirou',
          '<p>Sua assinatura Premium expirou ontem. Renove agora para recuperar o acesso.</p>')
      }
      await supabaseAdmin.from('subscriptions').update({ expiry_followup_sent_at: today.toISOString() }).eq('id', sub.id)
      followedUp++
    }
  }

  return new Response(JSON.stringify({ checked: (subs ?? []).length, warned, followedUp }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
