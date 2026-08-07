/**
 * One-off early-member win-back campaign sender.
 *
 * Sends the "$4.99 first month" email to every signup who never subscribed,
 * from support@getcallme.app via Resend. Run inside the Render shell where
 * RESEND_API_KEY + DATABASE_URL are set.
 *
 *   node scripts/send-campaign.js                 # dry run: print the recipient count only
 *   node scripts/send-campaign.js --test a@b.com  # send ONE test email to a@b.com
 *   node scripts/send-campaign.js --send          # send to ALL non-subscribers
 *
 * Guarded: does nothing destructive without an explicit --test or --send flag.
 */
import { Client } from "pg";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "Call Me <support@getcallme.app>";
const DATABASE_URL = process.env.DATABASE_URL;
const START_URL = "https://getcallme.app/start";
const UNSUB = "mailto:support@getcallme.app?subject=unsubscribe";

const SUBJECT = "Your first month of Call Me is $4.99";

function html() {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f8;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6ea">
        <tr><td style="padding:28px 32px 6px"><div style="font-size:20px;font-weight:700">📞 Call Me</div></td></tr>
        <tr><td style="padding:6px 32px 24px;font-size:15px;line-height:1.6;color:#222">
          <p style="margin:0 0 14px">Hey there,</p>
          <p style="margin:0 0 14px">You set up Call Me a while back and verified your number — but never picked a plan, so it's just been sitting there. That's on me for not making it worth your while yet.</p>
          <p style="margin:0 0 14px">So here's the deal: because you were one of the first people to try it, <strong>your first month is $4.99</strong> instead of $6. Tap below and it's applied automatically — no code to enter. After that it's $6/mo, cancel anytime.</p>
          <p style="margin:22px 0"><a href="${START_URL}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:600">Start my $4.99 first month →</a></p>
          <p style="margin:0 0 14px;font-size:13px;color:#666">Use the same email you signed up with at checkout so it activates the account you already set up.</p>
          <p style="margin:0 0 6px">Quick reminder of what it does:</p>
          <p style="margin:0 0 14px;padding:12px 16px;background:#f4f4f8;border-radius:8px;font-size:14px">You're running a long task in Claude or ChatGPT and you walk away. When it finishes — or gets stuck and needs a decision — <strong>your phone rings.</strong> A real voice reads you the update, you talk back to say what to do next, and it keeps going. No babysitting the screen.</p>
          <p style="margin:0 0 14px">Questions, or something didn't work the first time? Just hit reply — it comes straight to me.</p>
          <p style="margin:0">Thanks for being early,<br>George · Call Me</p>
        </td></tr>
        <tr><td style="padding:16px 32px 26px;border-top:1px solid #eee;font-size:12px;color:#999">
          Call Me · <a href="https://getcallme.app" style="color:#6b6b7b">getcallme.app</a><br>
          Not interested in these? Reply "unsubscribe" and I'll take you off the list.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function text() {
  return [
    "Hey there,",
    "",
    "You set up Call Me a while back and verified your number, but never picked a plan.",
    "Because you were one of the first to try it, your first month is $4.99 instead of $6 —",
    "applied automatically, no code. After that it's $6/mo, cancel anytime.",
    "",
    "Start your $4.99 first month: " + START_URL,
    "(Use the same email you signed up with so it activates your existing account.)",
    "",
    "What it does: you're running a long task in Claude or ChatGPT and walk away. When it",
    "finishes or gets stuck, your phone rings, a real voice reads you the update, and you talk",
    "back to say what to do next.",
    "",
    "Questions? Just reply — it comes straight to me.",
    "",
    "Thanks for being early,",
    "George · Call Me · getcallme.app",
    "",
    'Not interested? Reply "unsubscribe" and I\'ll take you off the list.',
  ].join("\n");
}

async function recipients() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `select email from users
       where subscription_status <> $1 and subscription_status <> $2
         and email is not null and email not like $3
       order by created_at, email`,
    ["active", "trialing", "%@getcallme.app"]
  );
  await c.end();
  return r.rows.map((x) => x.email);
}

async function sendOne(to) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: SUBJECT,
      html: html(),
      text: text(),
      headers: { "List-Unsubscribe": `<${UNSUB}>` },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body}`);
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const args = process.argv.slice(2);
  const testIdx = args.indexOf("--test");

  if (testIdx !== -1) {
    const to = args[testIdx + 1];
    if (!to) throw new Error("--test needs an email, e.g. --test you@example.com");
    console.log(`Sending ONE test to ${to} ...`);
    await sendOne(to);
    console.log("Test sent. Check the inbox.");
    return;
  }

  const list = await recipients();
  if (!args.includes("--send")) {
    console.log(`[dry run] ${list.length} recipients. Re-run with --send to actually send.`);
    return;
  }

  console.log(`Sending to ${list.length} recipients ...`);
  let ok = 0;
  const failed = [];
  for (const to of list) {
    try {
      await sendOne(to);
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${list.length} sent`);
    } catch (e) {
      failed.push(`${to}: ${e.message}`);
    }
    await sleep(600); // stay under Resend's rate limit
  }
  console.log(`Done. Sent ${ok}/${list.length}.`);
  if (failed.length) console.log("Failures:\n" + failed.join("\n"));
}

main().catch((e) => {
  console.error("Campaign error:", e.message);
  process.exit(1);
});
