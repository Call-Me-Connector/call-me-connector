import { config } from "./config.js";

/**
 * Outbound transactional email via Resend (https://resend.com). Uses the REST
 * API directly (global fetch) so there's no extra dependency. Everything here is
 * a no-op-with-error unless RESEND_API_KEY is set, so the app runs email-free
 * until you finish Resend setup.
 */

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Override the default From ("Call Me <support@getcallme.app>"). */
  from?: string;
  /** Where replies go, if different from From. */
  replyTo?: string;
}

/** Send one email. Throws if RESEND_API_KEY is missing or the API rejects it. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!config.email.resendApiKey) {
    throw new Error("RESEND_API_KEY is not set — outbound email is disabled.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: msg.from ?? config.email.from,
      to: Array.isArray(msg.to) ? msg.to : [msg.to],
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

/** Minimal, on-brand HTML wrapper for transactional emails. */
export function emailLayout(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f8;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6ea">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:20px;font-weight:700">📞 Call Me</div>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.55;color:#222">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #eee;font-size:12px;color:#999">
          Call Me · <a href="https://getcallme.app" style="color:#6b6b7b">getcallme.app</a><br>
          Questions? Just reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
