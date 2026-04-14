import Stripe from "stripe";

let stripe: Stripe | null = null;

/**
 * Lazily constructs a Stripe client using {@link process.env.STRIPE_SECRET_KEY}.
 * Server-only — do not import from client components.
 */
export function getStripe(): Stripe {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  stripe = new Stripe(key);
  return stripe;
}
