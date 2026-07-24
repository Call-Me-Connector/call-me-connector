import Stripe from "stripe";
import { config } from "./config.js";
import {
  findById,
  findByStripeCustomerId,
  setStripeCustomerId,
  setSubscription,
  type User,
  type SubscriptionStatus,
} from "./users.js";

/**
 * Stripe billing. Everything here is a no-op unless STRIPE_SECRET_KEY is set,
 * so the connector runs paywall-free until you finish Stripe setup.
 */

let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    if (!config.stripe.secretKey) throw new Error("STRIPE_SECRET_KEY is not set.");
    stripe = new Stripe(config.stripe.secretKey);
  }
  return stripe;
}

export type Plan = "basic" | "pro";

export function priceForTier(tier: Plan): string {
  return tier === "pro" ? config.stripe.pricePro : config.stripe.priceBasic;
}

function tierForPrice(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === config.stripe.priceBasic) return "basic";
  if (priceId === config.stripe.pricePro) return "pro";
  return null;
}

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

/** Ensure the user has a Stripe customer; returns the customer id. */
async function ensureCustomer(user: User): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await getStripe().customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });
  await setStripeCustomerId(user.id, customer.id);
  return customer.id;
}

/** Create a Checkout session for a subscription and return its URL. */
export async function createCheckoutUrl(
  user: User,
  tier: Plan,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const price = priceForTier(tier);
  if (!price) throw new Error(`No Stripe price configured for the ${tier} plan.`);
  const customerId = await ensureCustomer(user);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

/** Create a Billing Portal session (manage/cancel) and return its URL. */
export async function createPortalUrl(user: User, returnUrl: string): Promise<string> {
  const customerId = await ensureCustomer(user);
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/** Sync a subscription's state onto the owning user. */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = await findByStripeCustomerId(customerId);
  if (!user) {
    console.warn("[billing] subscription for unknown customer:", customerId);
    return;
  }
  const priceId = sub.items.data[0]?.price?.id;
  const tier = tierForPrice(priceId) ?? user.tier;
  const status = mapStatus(sub.status);
  await setSubscription(user.id, status, tier, sub.id);
  console.log(`[billing] user ${user.id} -> ${status} (${tier})`);
}

/**
 * Verify + handle a Stripe webhook. `rawBody` must be the raw request bytes
 * (not JSON-parsed) so the signature check works.
 */
export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const event = getStripe().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (userId && customerId) {
        const user = await findById(userId);
        if (user && !user.stripe_customer_id) await setStripeCustomerId(userId, customerId);
      }
      if (session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await getStripe().subscriptions.retrieve(subId);
        await syncSubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break; // ignore other events
  }
}
