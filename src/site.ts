import { Router } from "express";
import { config } from "./config.js";

/**
 * Public marketing site: landing page, pricing, privacy policy, terms.
 * Served at the connector's root domain (the store listings link here).
 */

const BRAND = config.brandName;
const URL = config.publicUrl || "https://call-me-connector.onrender.com";
const MCP = `${URL}/mcp`;
const SUPPORT = config.supportEmail;

const HEAD = (title: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${BRAND} phones you when your AI assistant finishes a task or gets stuck — hear the update, say what's next, keep moving. Built for people on the go.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
 :root{
   --indigo:#4f46e5; --indigo2:#7c3aed; --ink:#0f1222; --body:#2b2f45; --muted:#6b7192;
   --bg:#ffffff; --soft:#f6f6fb; --line:#e7e7f0; --card:#ffffff;
 }
 @media (prefers-color-scheme: dark){
   :root{ --ink:#f3f4ff; --body:#c9cce4; --muted:#9096b8; --bg:#0c0e1a; --soft:#12152640; --line:#252a44; --card:#141830; }
 }
 *{box-sizing:border-box} html{scroll-behavior:smooth}
 body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;background:var(--bg);color:var(--body);line-height:1.6;-webkit-font-smoothing:antialiased}
 a{color:inherit;text-decoration:none}
 .wrap{max-width:1080px;margin:0 auto;padding:0 1.25rem}
 h1,h2,h3{color:var(--ink);line-height:1.15;letter-spacing:-.02em;margin:.2em 0}
 h1{font-size:clamp(2.2rem,5vw,3.6rem);font-weight:800}
 h2{font-size:clamp(1.6rem,3.5vw,2.4rem);font-weight:800}
 p{margin:.6em 0}
 .btn{display:inline-block;padding:.85rem 1.4rem;border-radius:.7rem;font-weight:650;cursor:pointer;border:0;font-size:1rem}
 .btn-primary{background:linear-gradient(135deg,var(--indigo),var(--indigo2));color:#fff;box-shadow:0 10px 30px -10px rgba(99,73,229,.6)}
 .btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
 .btn:hover{transform:translateY(-1px)}
 /* nav */
 nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(180%) blur(12px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
 nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
 .logo{display:flex;align-items:center;gap:.55rem;font-weight:800;color:var(--ink);font-size:1.15rem}
 .logo .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--indigo),var(--indigo2));display:grid;place-items:center;color:#fff;font-size:1rem}
 .navlinks{display:flex;gap:1.5rem;align-items:center}
 .navlinks a.muted{color:var(--muted);font-weight:550}
 @media(max-width:720px){ .navlinks a.hide-m{display:none} }
 /* hero */
 .hero{position:relative;overflow:hidden;padding:5rem 0 3rem}
 .hero:before{content:"";position:absolute;inset:-40% 30% auto -10%;height:520px;background:radial-gradient(600px 300px at 30% 20%,rgba(124,58,237,.20),transparent 70%);pointer-events:none}
 .hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:2.5rem;align-items:center;position:relative}
 @media(max-width:860px){ .hero-grid{grid-template-columns:1fr;gap:2rem} }
 .eyebrow{display:inline-block;font-size:.82rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--indigo);background:color-mix(in srgb,var(--indigo) 12%,transparent);padding:.35rem .7rem;border-radius:2rem}
 .lead{font-size:1.2rem;color:var(--body);max-width:34rem}
 .cta-row{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.4rem}
 .trust{margin-top:1.2rem;color:var(--muted);font-size:.9rem}
 /* phone mockup */
 .phone{justify-self:center;width:290px;max-width:80vw;background:linear-gradient(160deg,#1b1e36,#0c0e1a);border-radius:34px;padding:14px;box-shadow:0 40px 80px -30px rgba(20,10,60,.7);border:1px solid #2a2e4d}
 .screen{background:linear-gradient(180deg,#141833,#0e1024);border-radius:24px;padding:26px 20px;min-height:430px;display:flex;flex-direction:column;color:#eef}
 .screen .caller{ text-align:center;margin-top:1rem }
 .screen .av{width:76px;height:76px;border-radius:50%;margin:0 auto 1rem;background:linear-gradient(135deg,var(--indigo),var(--indigo2));display:grid;place-items:center;font-size:2rem}
 .screen .who{font-weight:700;font-size:1.3rem} .screen .sub{color:#9aa0c9;font-size:.9rem}
 .bubble{background:#20244a;border-radius:16px;padding:.8rem .9rem;margin:1.4rem 0 auto;font-size:.95rem;color:#dfe3ff}
 .answer{display:flex;justify-content:space-around;margin-top:auto;padding-top:1.4rem}
 .rbtn{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;font-size:1.4rem}
 .decline{background:#e5484d} .accept{background:#30a46c;box-shadow:0 0 0 6px rgba(48,164,108,.2)}
 /* sections */
 section{padding:4.5rem 0}
 .soft{background:var(--soft)}
 .center{text-align:center;max-width:40rem;margin:0 auto}
 .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem;margin-top:2.5rem}
 @media(max-width:820px){ .grid3{grid-template-columns:1fr} }
 .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:1.5rem}
 .card .ic{font-size:1.6rem} .card h3{font-size:1.15rem;margin-top:.4rem}
 .card p{color:var(--muted);font-size:.98rem}
 .steps{counter-reset:s;display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem;margin-top:2.5rem}
 @media(max-width:820px){ .steps{grid-template-columns:1fr} }
 .step{position:relative;padding-left:.2rem}
 .step .n{width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--indigo) 14%,transparent);color:var(--indigo);font-weight:800;display:grid;place-items:center;margin-bottom:.6rem}
 .who-for{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center;margin-top:1.6rem}
 .chip{border:1px solid var(--line);background:var(--card);border-radius:2rem;padding:.5rem 1rem;font-weight:600;color:var(--ink);font-size:.95rem}
 /* pricing */
 .plans{display:grid;grid-template-columns:1fr 1fr;gap:1.3rem;max-width:640px;margin:2.5rem auto 0}
 @media(max-width:640px){ .plans{grid-template-columns:1fr} }
 .plan{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:1.8rem;position:relative}
 .plan.pro{border-color:var(--indigo);box-shadow:0 20px 50px -24px rgba(99,73,229,.5)}
 .plan .tag{position:absolute;top:-12px;right:18px;background:linear-gradient(135deg,var(--indigo),var(--indigo2));color:#fff;font-size:.75rem;font-weight:700;padding:.25rem .7rem;border-radius:2rem}
 .price{font-size:2.6rem;font-weight:800;color:var(--ink)} .price span{font-size:1rem;color:var(--muted);font-weight:600}
 .plan ul{list-style:none;padding:0;margin:1rem 0}
 .plan li{padding:.35rem 0;color:var(--body)} .plan li:before{content:"✓";color:#30a46c;font-weight:800;margin-right:.5rem}
 .cta-band{background:linear-gradient(135deg,var(--indigo),var(--indigo2));color:#fff;border-radius:24px;padding:3rem 2rem;text-align:center;margin:1rem 0}
 .cta-band h2{color:#fff} .cta-band .btn-primary{background:#fff;color:var(--indigo);box-shadow:none}
 code.url{background:var(--soft);border:1px solid var(--line);border-radius:.5rem;padding:.35rem .6rem;font-size:.92rem;color:var(--ink);word-break:break-all}
 /* install */
 .installhead{max-width:44rem;margin:0 auto 0}
 .copybox{display:flex;gap:.6rem;align-items:stretch;max-width:600px;margin:1.6rem auto 0;flex-wrap:wrap}
 .copybox code{flex:1;min-width:240px;display:flex;align-items:center;background:var(--card);border:2px solid var(--indigo);border-radius:.8rem;padding:.8rem 1rem;font-size:1.05rem;color:var(--ink);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
 .copybtn{white-space:nowrap;min-width:120px}
 .install-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-top:1.8rem}
 @media(max-width:820px){ .install-grid{grid-template-columns:1fr} }
 .install-card{padding:1.6rem 1.5rem}
 .install-card ol{margin:.7rem 0 0;padding-left:1.2rem} .install-card li{padding:.3rem 0;color:var(--body)}
 .install-card .note{color:var(--muted);font-size:.86rem;margin-top:.8rem}
 .badge{display:inline-block;background:linear-gradient(135deg,var(--indigo),var(--indigo2));color:#fff;font-weight:800;font-size:.78rem;padding:.22rem .6rem;border-radius:.5rem;margin-right:.5rem;vertical-align:middle;letter-spacing:.02em}
 .afterinstall{text-align:center;max-width:40rem;margin:2rem auto 0;color:var(--body)}
 .kbd{background:var(--soft);border:1px solid var(--line);border-radius:.4rem;padding:.1rem .45rem;font-size:.92rem;color:var(--ink);font-weight:600}
 footer{border-top:1px solid var(--line);padding:2.5rem 0;color:var(--muted);font-size:.92rem}
 footer .wrap{display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:center}
 footer a{color:var(--muted)} footer a:hover{color:var(--ink)}
 .legal{max-width:760px;margin:0 auto;padding:3rem 0}
 .legal h1{font-size:2rem} .legal h2{font-size:1.25rem;margin-top:2rem} .legal p,.legal li{color:var(--body)}
</style></head><body>`;

const NAV = `<nav><div class="wrap">
  <a class="logo" href="/"><span class="dot">📞</span> ${BRAND}</a>
  <div class="navlinks">
    <a class="muted hide-m" href="/#how">How it works</a>
    <a class="muted hide-m" href="/#pricing">Pricing</a>
    <a class="muted" href="/account">Sign in</a>
    <a class="btn btn-primary" href="/#get-started">Add it free</a>
  </div>
</div></nav>`;

const FOOTER = `<footer><div class="wrap">
  <div><a class="logo" href="/" style="font-size:1rem"><span class="dot" style="width:24px;height:24px;font-size:.8rem">📞</span> ${BRAND}</a></div>
  <div style="display:flex;gap:1.4rem;flex-wrap:wrap">
    <a href="/#pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
    <a href="mailto:${SUPPORT}">Support</a>
  </div>
  <div>© ${BRAND}</div>
</div></footer></body></html>`;

// Shared install block (copy-URL + Claude/ChatGPT cards) used by both the
// landing page and the focused /connect page, so they never drift apart.
const INSTALL_BODY = `
      <div class="copybox">
        <code id="mcpurl">${MCP}</code>
        <button class="btn btn-primary copybtn" onclick="copyMcp(this)">Copy URL</button>
      </div>
      <p class="center" style="color:var(--muted);font-size:.9rem;margin-top:.6rem">Step 1 — copy this. Then paste it into Claude or ChatGPT below.</p>

      <div class="install-grid">
        <div class="card install-card">
          <h3><span class="badge">CLAUDE</span> Paste it in</h3>
          <ol>
            <li>Open <strong>Settings → Connectors</strong></li>
            <li>Click <strong>Add custom connector</strong></li>
            <li><strong>Paste the URL</strong> above and click <strong>Add</strong></li>
          </ol>
          <p class="note">Available on Claude Pro, Max, Team &amp; Enterprise.</p>
        </div>
        <div class="card install-card">
          <h3><span class="badge">CHATGPT</span> Paste it in</h3>
          <ol>
            <li>Open <strong>Settings → Connectors</strong> (turn on <strong>Developer mode</strong> if asked)</li>
            <li>Click <strong>Add</strong> / <strong>New connector</strong></li>
            <li><strong>Paste the URL</strong> above and connect</li>
          </ol>
          <p class="note">Available on ChatGPT Plus, Pro &amp; Business.</p>
        </div>
      </div>

      <div class="afterinstall">
        <p><strong>That's it.</strong> When it connects, create your account, verify your number, and pick a plan. Then just tell your assistant: <span class="kbd">“Call me when this is done.”</span></p>
        <div class="cta-row" style="justify-content:center;margin-top:1.2rem">
          <a class="btn btn-primary" href="/#pricing">See plans</a>
          <a class="btn btn-ghost" href="/account">Sign in &amp; subscribe</a>
        </div>
      </div>`;

const COPY_SCRIPT = `<script>
      function copyMcp(btn){
        var u=document.getElementById('mcpurl').textContent.trim();
        function done(){var t=btn.getAttribute('data-label')||btn.textContent;btn.setAttribute('data-label',t);btn.textContent='Copied ✓';setTimeout(function(){btn.textContent=t;},1600);}
        if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,done);}
        else{var r=document.createRange();r.selectNode(document.getElementById('mcpurl'));var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');}catch(e){}s.removeAllRanges();done();}
      }
    </script>`;

function landing(): string {
  return (
    HEAD(`${BRAND} — your AI assistant calls you when the work's done`) +
    NAV +
    `<header class="hero"><div class="wrap"><div class="hero-grid">
      <div>
        <span class="eyebrow">Built for people on the move</span>
        <h1>Get more done — without touching your desk.</h1>
        <p class="lead">${BRAND} lets your AI assistant <strong>phone you</strong> the moment a task is finished or it hits a wall. Hear the update, say what's next out loud, and keep moving. Your work follows you.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="#get-started">Add it in 60 seconds →</a>
          <a class="btn btn-ghost" href="#how">See how it works</a>
        </div>
        <p class="trust">Works with Claude &amp; ChatGPT · Free to add · Calls your own verified number · Cancel anytime</p>
      </div>
      <div class="phone"><div class="screen">
        <div class="caller">
          <div class="av">📞</div>
          <div class="who">${BRAND}</div>
          <div class="sub">incoming call · mobile</div>
        </div>
        <div class="bubble">“The Q3 report is drafted and the email's ready to go. Want me to send it, or change anything first?”</div>
        <div class="answer">
          <div class="rbtn decline">✕</div>
          <div class="rbtn accept">📞</div>
        </div>
      </div></div>
    </div></div></header>

    <section id="who"><div class="wrap center">
      <h2>When you're always moving, your work shouldn't wait.</h2>
      <p class="lead" style="margin:1rem auto 0">You're in the car, between meetings, walking to the next thing. Your assistant is grinding through tasks back at the keyboard. ${BRAND} closes the gap — it calls, tells you exactly where things stand, and takes your spoken orders to keep the momentum going.</p>
      <div class="who-for">
        <span class="chip">Founders</span><span class="chip">Executives</span><span class="chip">Consultants</span>
        <span class="chip">Sales pros</span><span class="chip">Realtors</span><span class="chip">Anyone on the go</span>
      </div>
    </div></section>

    <section id="how" class="soft"><div class="wrap">
      <div class="center"><h2>How it works</h2><p class="lead" style="margin:.5rem auto 0">Three steps, then your phone does the rest.</p></div>
      <div class="steps">
        <div class="step"><div class="n">1</div><h3>Connect it</h3><p>Add ${BRAND} to Claude or ChatGPT as a connector, create your account, and verify your phone number.</p></div>
        <div class="step"><div class="n">2</div><h3>Hand off a task &amp; go</h3><p>Tell your assistant what you need — “finish the deck, then call me.” Then walk out the door.</p></div>
        <div class="step"><div class="n">3</div><h3>Pick up &amp; direct</h3><p>Your phone rings. It reads what it did (or where it's stuck), you say what's next, and it gets right back to work.</p></div>
      </div>
    </div></section>

    <section id="features"><div class="wrap">
      <div class="center"><h2>Your assistant, on the line</h2></div>
      <div class="grid3">
        <div class="card"><div class="ic">🔊</div><h3>Hands-free updates</h3><p>It reads results and questions aloud — perfect for driving, walking, or between meetings. No screen required.</p></div>
        <div class="card"><div class="ic">🎙️</div><h3>Just talk back</h3><p>Answer out loud and it turns your voice into instructions your assistant acts on immediately.</p></div>
        <div class="card"><div class="ic">⚡</div><h3>Never lose momentum</h3><p>Get unblocked the second something's done or stuck — instead of finding out hours later at your desk.</p></div>
        <div class="card"><div class="ic">💬</div><h3>Full conversations <em style="color:var(--indigo);font-style:normal;font-size:.8rem;font-weight:700">PRO</em></h3><p>Go back and forth naturally until you've said everything — it keeps listening until you're done.</p></div>
        <div class="card"><div class="ic">🔒</div><h3>Only your number</h3><p>It only ever calls the number you verified. Your line, your control — no robo-dialing anyone else.</p></div>
        <div class="card"><div class="ic">🤝</div><h3>Works where you work</h3><p>Plugs into Claude and ChatGPT, the assistants you already use. Nothing new to learn.</p></div>
      </div>
    </div></section>

    <section id="pricing" class="soft"><div class="wrap">
      <div class="center"><h2>Simple pricing</h2><p class="lead" style="margin:.5rem auto 0">Pay for what moves your work forward. Cancel anytime.</p></div>
      <div class="plans">
        <div class="plan">
          <h3>Basic</h3><div class="price">$6<span>/mo</span></div>
          <ul><li>Calls you with updates &amp; questions</li><li>Reads results aloud</li><li>Captures your spoken reply</li><li>Up to 100 calls / month</li></ul>
          <a class="btn btn-ghost" href="#get-started" style="width:100%;text-align:center">Get Basic</a>
        </div>
        <div class="plan pro">
          <span class="tag">Most popular</span>
          <h3>Pro</h3><div class="price">$9<span>/mo</span></div>
          <ul><li>Everything in Basic</li><li><strong>Full back-and-forth conversations</strong></li><li>Higher usage — up to 500 calls / month</li><li>Priority for power users</li></ul>
          <a class="btn btn-primary" href="#get-started" style="width:100%;text-align:center">Get Pro</a>
        </div>
      </div>
    </div></section>

    <section id="get-started"><div class="wrap">
      <div class="center installhead">
        <h2>Add ${BRAND} in about a minute</h2>
        <p class="lead" style="margin:.5rem auto 0">One connector URL. It drops right into the assistant you already use.</p>
      </div>
      ${INSTALL_BODY}
    </div></section>
    ${COPY_SCRIPT}` +
    FOOTER
  );
}

// Focused, shareable install page — one clean link for tweets, DMs, Reddit, etc.
function connect(): string {
  return (
    HEAD(`Add ${BRAND} to Claude or ChatGPT`) + NAV +
    `<section><div class="wrap">
      <div class="center installhead" style="padding-top:1.5rem">
        <span class="eyebrow">60-second setup</span>
        <h1 style="font-size:clamp(1.9rem,4vw,2.8rem)">Add ${BRAND} to your AI assistant</h1>
        <p class="lead" style="margin:.7rem auto 0">Paste one URL into Claude or ChatGPT, verify your number, and your assistant can call your phone with updates. Here's exactly how.</p>
      </div>
      ${INSTALL_BODY}
      <p class="center" style="margin-top:2.2rem"><a class="muted" href="/" style="color:var(--muted)">← What is ${BRAND}?</a></p>
    </div></section>
    ${COPY_SCRIPT}` +
    FOOTER
  );
}

function privacy(): string {
  return (
    HEAD(`Privacy Policy — ${BRAND}`) + NAV +
    `<div class="wrap"><div class="legal">
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated: 2026. This policy explains what ${BRAND} collects and why.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account info</strong> — your email address and a password (stored hashed).</li>
        <li><strong>Your phone number</strong> — the number you ask us to call, which you verify by code.</li>
        <li><strong>Call content</strong> — the summaries and questions your assistant sends, and a transcription of your spoken reply, so we can relay it back to your assistant.</li>
        <li><strong>Billing info</strong> — handled by our payment processor; we store only your subscription status and a customer reference, never your card number.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to provide the service: to place the calls you request to your verified number, speak your assistant's updates, transcribe your reply, verify your number, and manage your subscription. We do <strong>not</strong> sell your data or use it for advertising.</p>

      <h2>Service providers</h2>
      <p>We share the minimum necessary with providers that power ${BRAND}:</p>
      <ul>
        <li><strong>Twilio</strong> — placing calls, text-to-speech, speech-to-text, and phone verification (<a href="https://www.twilio.com/legal/privacy">Twilio Privacy</a>).</li>
        <li><strong>Stripe</strong> — payment processing (<a href="https://stripe.com/privacy">Stripe Privacy</a>).</li>
        <li><strong>Render</strong> — hosting and database (<a href="https://render.com/privacy">Render Privacy</a>).</li>
      </ul>

      <h2>Retention</h2>
      <p>Call transcripts are short-lived and are not kept after your assistant has retrieved them. Account and subscription data are kept while your account is active. Email us to delete your account and associated data.</p>

      <h2>Calls &amp; consent</h2>
      <p>${BRAND} calls only the number you provide and verify. By adding a number you confirm it is yours (or that you're authorized to receive calls on it) and consent to receive calls from ${BRAND}. You can stop calls at any time by cancelling or removing your number.</p>

      <h2>Your choices</h2>
      <p>You can update your number, manage or cancel your subscription, or request deletion at any time. For any privacy request, contact <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</p>

      <h2>Contact</h2>
      <p><a href="mailto:${SUPPORT}">${SUPPORT}</a></p>
    </div></div>` + FOOTER
  );
}

function terms(): string {
  return (
    HEAD(`Terms of Service — ${BRAND}`) + NAV +
    `<div class="wrap"><div class="legal">
      <h1>Terms of Service</h1>
      <p class="muted">Last updated: 2026. By using ${BRAND} you agree to these terms.</p>

      <h2>The service</h2>
      <p>${BRAND} is a connector for AI assistants (such as Claude and ChatGPT) that places phone calls to your verified number to deliver updates and collect your spoken instructions.</p>

      <h2>Your number &amp; consent</h2>
      <p>You may only register a phone number you own or are authorized to use, and you consent to receive automated calls from ${BRAND} at that number as part of the service. Don't use ${BRAND} to call numbers that aren't yours or for any unlawful, harassing, or deceptive purpose.</p>

      <h2>Subscriptions &amp; billing</h2>
      <p>Plans are billed monthly (Basic $6/mo, Pro $9/mo) through our payment processor. You can cancel anytime from your account; access continues through the current billing period. Plans include a monthly fair-use call allowance (100 for Basic, 500 for Pro); we may pause additional calls once the allowance is reached.</p>

      <h2>Acceptable use</h2>
      <p>Don't abuse, reverse-engineer, overload, or resell the service, and don't use it to violate any law or third-party rights.</p>

      <h2>Availability &amp; disclaimer</h2>
      <p>The service is provided “as is.” Call delivery depends on carriers and third-party providers and may not always be immediate or successful. To the fullest extent permitted by law, ${BRAND} is not liable for indirect or consequential damages.</p>

      <h2>Changes</h2>
      <p>We may update these terms; continued use means you accept the changes.</p>

      <h2>Contact</h2>
      <p><a href="mailto:${SUPPORT}">${SUPPORT}</a></p>
    </div></div>` + FOOTER
  );
}

export function buildSiteRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => res.type("text/html").send(landing()));
  router.get("/connect", (_req, res) => res.type("text/html").send(connect()));
  router.get("/privacy", (_req, res) => res.type("text/html").send(privacy()));
  router.get("/terms", (_req, res) => res.type("text/html").send(terms()));
  // Machine-readable health check (was previously served at "/").
  router.get("/healthz", (_req, res) =>
    res.json({ name: "call-me-connector", status: "ok", mcp_endpoint: "/mcp", mode: config.multiTenant ? "multi-tenant" : "single-user" })
  );

  // Favicon: the same phone emoji the site uses, as an inline SVG.
  router.get("/favicon.svg", (_req, res) => {
    res.type("image/svg+xml").send(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="32" y="44" font-size="34" text-anchor="middle">📞</text></svg>`
    );
  });

  // Official MCP Registry domain ownership proof (HTTP auth). The public key is
  // meant to be public; the matching private key is used only locally to publish.
  router.get("/.well-known/mcp-registry-auth", (_req, res) =>
    res.type("text/plain").send("v=MCPv1; k=ed25519; p=X3I1qT3xb8TwyF3DMoRzobGOiDxgQFgs3ObtW+83hgM=\n")
  );

  // ChatGPT/OpenAI domain-verification token, served as plain text at the path
  // OpenAI specifies (set OPENAI_VERIFICATION_PATH + OPENAI_VERIFICATION_TOKEN).
  if (config.openaiVerificationPath && config.openaiVerificationToken) {
    router.get(config.openaiVerificationPath, (_req, res) =>
      res.type("text/plain").send(config.openaiVerificationToken)
    );
  }

  return router;
}
