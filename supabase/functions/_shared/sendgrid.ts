/**
 * SendGrid Email API helper (v3 Mail Send).
 * Reusable across Edge Functions (create-user, send-place-out-reminders, etc.).
 *
 * Requires Supabase secret: SENDGRID_API_KEY
 */

interface SendEmailParams {
  to: { email: string; name?: string }
  from: { email: string; name?: string }
  subject: string
  htmlBody: string
}

interface SendEmailResult {
  ok: boolean
  error?: string
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('SENDGRID_API_KEY')

  if (!apiKey) {
    console.warn('SENDGRID_API_KEY not configured — skipping email')
    return { ok: false, error: 'SendGrid API key not configured' }
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: params.to.email, name: params.to.name ?? undefined }],
          },
        ],
        from: {
          email: params.from.email,
          name: params.from.name ?? undefined,
        },
        subject: params.subject,
        content: [
          {
            type: 'text/html',
            value: params.htmlBody,
          },
        ],
      }),
    })

    // SendGrid returns 202 Accepted on success
    if (res.status === 202 || res.ok) {
      return { ok: true }
    }

    const body = await res.text()
    console.error('SendGrid email error:', res.status, body)
    return { ok: false, error: `SendGrid API error: ${res.status} — ${body}` }
  } catch (err) {
    console.error('SendGrid email exception:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
