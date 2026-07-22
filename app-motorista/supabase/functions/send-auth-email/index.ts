import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Brevo SMTP via HTTP API ───────────────────────────────────────

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const FROM_EMAIL    = 'noreply@paldrivy.com';
const FROM_NAME     = 'PalDrivy';

// ─── Templates ─────────────────────────────────────────

type EmailType = 'signup' | 'recovery' | 'magiclink' | 'email_change';
type Lang      = 'pt' | 'en' | 'es';

const SUBJECTS: Record<EmailType, Record<Lang, string>> = {
  signup: {
    pt: 'Confirme seu e-mail — PalDrivy',
    en: 'Confirm your email — PalDrivy',
    es: 'Confirma tu correo — PalDrivy',
  },
  recovery: {
    pt: 'Redefinição de senha — PalDrivy',
    en: 'Reset your password — PalDrivy',
    es: 'Restablece tu contraseña — PalDrivy',
  },
  magiclink: {
    pt: 'Seu link de acesso — PalDrivy',
    en: 'Your sign-in link — PalDrivy',
    es: 'Tu enlace de acceso — PalDrivy',
  },
  email_change: {
    pt: 'Confirme seu novo e-mail — PalDrivy',
    en: 'Confirm your new email — PalDrivy',
    es: 'Confirma tu nuevo correo — PalDrivy',
  },
};

const COPY: Record<EmailType, Record<Lang, { heading: string; body: string; cta: string; footer: string }>> = {
  signup: {
    pt: {
      heading: 'Confirme seu e-mail',
      body:    'Bem-vindo ao PalDrivy! Clique no botão abaixo para confirmar seu endereço de e-mail e ativar sua conta.',
      cta:     'Confirmar e-mail',
      footer:  'Se não criou uma conta no PalDrivy, ignore este e-mail.',
    },
    en: {
      heading: 'Confirm your email',
      body:    'Welcome to PalDrivy! Click the button below to confirm your email address and activate your account.',
      cta:     'Confirm email',
      footer:  "If you didn't create a PalDrivy account, you can ignore this email.",
    },
    es: {
      heading: 'Confirma tu correo',
      body:    '¡Bienvenido a PalDrivy! Haz clic en el botón a continuación para confirmar tu correo electrónico y activar tu cuenta.',
      cta:     'Confirmar correo',
      footer:  'Si no creaste una cuenta en PalDrivy, ignora este correo.',
    },
  },
  recovery: {
    pt: {
      heading: 'Redefinição de senha',
      body:    'Recebemos uma solicitação para redefinir a senha da sua conta PalDrivy. O link expira em <strong style="color:#f1f5f9">1 hora</strong>.',
      cta:     'Redefinir senha',
      footer:  'Se não solicitou a redefinição, ignore este e-mail — sua conta continua segura.',
    },
    en: {
      heading: 'Reset your password',
      body:    'We received a request to reset your PalDrivy account password. The link expires in <strong style="color:#f1f5f9">1 hour</strong>.',
      cta:     'Reset password',
      footer:  "If you didn't request a password reset, ignore this email — your account is safe.",
    },
    es: {
      heading: 'Restablece tu contraseña',
      body:    'Recibimos una solicitud para restablecer la contraseña de tu cuenta PalDrivy. El enlace vence en <strong style="color:#f1f5f9">1 hora</strong>.',
      cta:     'Restablecer contraseña',
      footer:  'Si no solicitaste el restablecimiento, ignora este correo — tu cuenta está segura.',
    },
  },
  magiclink: {
    pt: {
      heading: 'Seu link de acesso',
      body:    'Clique no botão abaixo para entrar na sua conta PalDrivy. O link expira em <strong style="color:#f1f5f9">1 hora</strong>.',
      cta:     'Entrar no PalDrivy',
      footer:  'Se não solicitou este link, ignore este e-mail.',
    },
    en: {
      heading: 'Your sign-in link',
      body:    'Click the button below to sign in to your PalDrivy account. The link expires in <strong style="color:#f1f5f9">1 hour</strong>.',
      cta:     'Sign in to PalDrivy',
      footer:  "If you didn't request this link, you can ignore this email.",
    },
    es: {
      heading: 'Tu enlace de acceso',
      body:    'Haz clic en el botón a continuación para ingresar a tu cuenta PalDrivy. El enlace vence en <strong style="color:#f1f5f9">1 hora</strong>.',
      cta:     'Entrar a PalDrivy',
      footer:  'Si no solicitaste este enlace, ignora este correo.',
    },
  },
  email_change: {
    pt: {
      heading: 'Confirme seu novo e-mail',
      body:    'Você solicitou a alteração do e-mail da sua conta PalDrivy. Clique abaixo para confirmar o novo endereço.',
      cta:     'Confirmar novo e-mail',
      footer:  'Se não solicitou esta alteração, entre em contato conosco imediatamente.',
    },
    en: {
      heading: 'Confirm your new email',
      body:    'You requested an email address change for your PalDrivy account. Click below to confirm your new address.',
      cta:     'Confirm new email',
      footer:  "If you didn't request this change, please contact us immediately.",
    },
    es: {
      heading: 'Confirma tu nuevo correo',
      body:    'Solicitaste un cambio de correo electrónico en tu cuenta PalDrivy. Haz clic abajo para confirmar tu nuevo correo.',
      cta:     'Confirmar nuevo correo',
      footer:  'Si no solicitaste este cambio, contáctanos de inmediato.',
    },
  },
};

function buildHtml(type: EmailType, lang: Lang, confirmationUrl: string, siteUrl: string): string {
  const c = COPY[type][lang];
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1221;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td align="center" style="padding-bottom:32px;">
  <div style="font-size:32px;margin-bottom:8px;">&#128205;</div>
  <div style="color:#F59E0B;font-size:26px;font-weight:800;">PalDrivy</div>
  <div style="color:#334155;font-size:12px;margin-top:4px;">Controle financeiro para motoristas</div>
</td></tr>
<tr><td style="background:#111827;border-radius:14px;padding:36px 32px;border:1px solid rgba(255,255,255,0.07);">
  <h2 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0 0 12px 0;">${c.heading}</h2>
  <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 28px 0;">${c.body}</p>
  <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
    <a href="${confirmationUrl}" style="display:inline-block;background:#F59E0B;color:#0B1221;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;text-decoration:none;">${c.cta}</a>
  </td></tr></table>
  <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:24px 0;">
  <p style="color:#334155;font-size:11px;text-align:center;margin:0;">${c.footer}</p>
</td></tr>
<tr><td align="center" style="padding-top:24px;">
  <p style="color:#1e293b;font-size:11px;margin:0;">&#169; 2026 PalDrivy &middot; <a href="${siteUrl}" style="color:#F59E0B;text-decoration:none;">app.paldrivy.com</a></p>
</td></tr>
</table></td></tr></table>`;
}

// ─── Detect language ───────────────────────────────────────

function detectLang(locale?: string | null): Lang {
  if (!locale) return 'pt';
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('es')) return 'es';
  return 'pt';
}

// ─── Send via Brevo ─────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept':       'application/json',
      'content-type': 'application/json',
      'api-key':      BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender:   { name: FROM_NAME, email: FROM_EMAIL },
      to:       [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo error ${res.status}: ${body}`);
  }
}

// ─── Handler ─────────────────────────────────────────

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const payload = await req.json();

    // Supabase Auth Hook payload: { user, email_data }
    const email: string    = payload?.user?.email ?? payload?.email ?? '';
    const userId: string   = payload?.user?.id    ?? '';
    const locale: string   = payload?.user?.user_metadata?.locale ?? '';
    const emailType: string = payload?.email_data?.email_action_type ?? 'signup';
    // Build the verify link off SUPABASE_URL (guaranteed bare project URL) instead of
    // payload.email_data.site_url, which already includes an /auth/v1 suffix and was
    // producing a doubled /auth/v1/auth/v1/verify path.
    const supabaseUrl: string = Deno.env.get('SUPABASE_URL') ?? '';
    const confirmationUrl: string = payload?.email_data?.token_hash
      ? `${supabaseUrl}/auth/v1/verify?token=${payload.email_data.token_hash}&type=${payload.email_data.email_action_type}&redirect_to=${payload.email_data.redirect_to ?? ''}`
      : (payload?.email_data?.confirmation_url ?? '');
    const siteUrl: string = payload?.email_data?.redirect_to ?? 'https://app.paldrivy.com';

    if (!email || !confirmationUrl) {
      return Response.json({ error: null }); // let Supabase handle it normally
    }

    // Try to get locale from profiles table if not in user_metadata
    let lang = detectLang(locale);
    if (!locale && userId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        const { data } = await supabase.from('profiles').select('locale').eq('id', userId).maybeSingle();
        if (data?.locale) lang = detectLang(data.locale);
      } catch {}
    }

    const type    = (['signup', 'recovery', 'magiclink', 'email_change'].includes(emailType) ? emailType : 'signup') as EmailType;
    const subject = SUBJECTS[type][lang];
    const html    = buildHtml(type, lang, confirmationUrl, siteUrl);

    await sendEmail(email, subject, html);

    return Response.json({ error: null });
  } catch (err) {
    console.error('[send-auth-email]', err);
    // Return null error so Supabase falls back to default template
    return Response.json({ error: null });
  }
});
