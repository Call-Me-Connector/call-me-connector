import { Router, type Request, type Response } from "express";
import express from "express";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
import { authenticate, findById, isSubscribed, type User } from "./users.js";
import { createCheckoutUrl, createPortalUrl, type Plan } from "./billing.js";

/**
 * Customer self-serve account page: sign in, subscribe (Stripe Checkout), and
 * manage/cancel (Stripe Billing Portal). Uses a signed session cookie.
 */

const enc = new TextEncoder();
const key = () => enc.encode(config.oauth.signingSecret);
const COOKIE = "cm_session";
const SESSION_TTL = "7d";

async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(config.publicUrl)
    .setAudience("account-session")
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(key());
}

async function readSession(req: Request): Promise<string | null> {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE.length + 1));
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: config.publicUrl, audience: "account-session" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.publicUrl.startsWith("https"),
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Call Me</title>
<style>
 :root{color-scheme:light dark}
 body{font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5}
 h1{font-size:1.4rem} .sub{opacity:.75}
 form{display:grid;gap:.7rem;margin:1rem 0}
 input{padding:.6rem;font-size:1rem;border-radius:.5rem;border:1px solid #8888;width:100%;box-sizing:border-box}
 button{padding:.7rem 1rem;font-size:1rem;border:0;border-radius:.5rem;background:#4f46e5;color:#fff;cursor:pointer}
 button.sec{background:transparent;color:#4f46e5;border:1px solid #4f46e5}
 .card{border:1px solid #8883;border-radius:.75rem;padding:1rem 1.25rem;margin:1rem 0}
 .plans{display:grid;gap:.75rem;grid-template-columns:1fr 1fr}
 .plan{border:1px solid #8884;border-radius:.75rem;padding:1rem;text-align:center}
 .price{font-size:1.6rem;font-weight:700} .err{color:#dc2626}
 .badge{display:inline-block;padding:.1rem .5rem;border-radius:1rem;background:#16a34a22;color:#16a34a;font-size:.8rem}
</style></head><body>${inner}</body></html>`;
}

function loginPage(error?: string): string {
  return page(
    "Sign in",
    `<h1>Call Me — account</h1>
     <p class="sub">Sign in to manage your subscription.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form method="POST" action="/account/login">
       <label>Email<input type="email" name="email" autocomplete="email" required></label>
       <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
       <button type="submit">Sign in</button>
     </form>
     <p class="sub" style="font-size:.85rem">Use the same email and password you created when connecting Call Me.</p>`
  );
}

function planLabel(user: User): string {
  if (!isSubscribed(user)) return `<span class="badge" style="background:#eab30822;color:#a16207">No active plan</span>`;
  const name = user.tier === "pro" ? "Pro ($9/mo)" : "Basic ($6/mo)";
  return `<span class="badge">${esc(name)} · ${esc(user.subscription_status)}</span>`;
}

function dashboardPage(user: User, notice?: string): string {
  const subscribed = isSubscribed(user);
  return page(
    "Account",
    `<h1>Your Call Me account</h1>
     ${notice ? `<div class="card" style="border-color:#16a34a">${esc(notice)}</div>` : ""}
     <div class="card">
       <div><strong>${esc(user.email)}</strong></div>
       <div class="sub">Phone: ${user.phone_e164 ? esc(user.phone_e164) + (user.phone_verified ? " ✓" : " (unverified)") : "not set"}</div>
       <div style="margin-top:.5rem">Plan: ${planLabel(user)}</div>
     </div>
     ${
       subscribed
         ? `<div class="card">
              <p>Manage payment method, switch plans, or cancel anytime.</p>
              <form method="POST" action="/account/portal"><button type="submit">Manage billing</button></form>
            </div>`
         : `<h2 style="font-size:1.1rem">Choose a plan</h2>
            <div class="plans">
              <div class="plan">
                <div>Basic</div><div class="price">$6<span style="font-size:.9rem">/mo</span></div>
                <p class="sub" style="font-size:.85rem">Calls you with updates &amp; captures your reply</p>
                <form method="POST" action="/account/subscribe"><input type="hidden" name="plan" value="basic"><button type="submit">Choose Basic</button></form>
              </div>
              <div class="plan">
                <div>Pro</div><div class="price">$9<span style="font-size:.9rem">/mo</span></div>
                <p class="sub" style="font-size:.85rem">Everything in Basic + full back-and-forth conversation</p>
                <form method="POST" action="/account/subscribe"><input type="hidden" name="plan" value="pro"><button type="submit">Choose Pro</button></form>
              </div>
            </div>`
     }
     <form method="POST" action="/account/logout" style="margin-top:1.5rem"><button type="submit" class="sec">Sign out</button></form>`
  );
}

export function buildAccountRouter(): Router {
  const router = Router();
  const form = express.urlencoded({ extended: false });

  router.get("/account", async (req, res) => {
    const userId = await readSession(req);
    if (!userId) return res.type("text/html").send(loginPage());
    const user = await findById(userId);
    if (!user) return res.type("text/html").send(loginPage());
    const notice = req.query.subscribed === "1" ? "🎉 Subscription active — your assistant can call you now." : undefined;
    res.type("text/html").send(dashboardPage(user, notice));
  });

  router.post("/account/login", form, async (req, res) => {
    const b = req.body as Record<string, string>;
    const user = await authenticate(b.email ?? "", b.password ?? "");
    if (!user) return res.status(401).type("text/html").send(loginPage("Incorrect email or password."));
    setSessionCookie(res, await signSession(user.id));
    res.redirect(302, "/account");
  });

  router.post("/account/logout", form, (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.redirect(302, "/account");
  });

  router.post("/account/subscribe", form, async (req, res) => {
    const userId = await readSession(req);
    if (!userId) return res.redirect(302, "/account");
    const user = await findById(userId);
    if (!user) return res.redirect(302, "/account");
    if (!config.billingEnabled) {
      return res.status(503).type("text/html").send(dashboardPage(user, "Billing isn't configured yet."));
    }
    const plan: Plan = (req.body?.plan === "pro" ? "pro" : "basic") as Plan;
    try {
      const url = await createCheckoutUrl(
        user,
        plan,
        `${config.publicUrl}/account?subscribed=1`,
        `${config.publicUrl}/account`
      );
      res.redirect(303, url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout.";
      res.status(500).type("text/html").send(dashboardPage(user, msg));
    }
  });

  router.post("/account/portal", form, async (req, res) => {
    const userId = await readSession(req);
    if (!userId) return res.redirect(302, "/account");
    const user = await findById(userId);
    if (!user) return res.redirect(302, "/account");
    try {
      const url = await createPortalUrl(user, `${config.publicUrl}/account`);
      res.redirect(303, url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open the billing portal.";
      res.status(500).type("text/html").send(dashboardPage(user, msg));
    }
  });

  return router;
}
