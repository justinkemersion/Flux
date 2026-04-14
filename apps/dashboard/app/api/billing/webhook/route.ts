import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { users } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getStripe } from "@/src/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unwrapId(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if ("deleted" in value && value.deleted) return null;
  return value.id;
}

function unwrapSubscriptionId(
  value: string | Stripe.Subscription | null,
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value.id;
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("STRIPE_WEBHOOK_SECRET is not configured", {
      status: 500,
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Webhook signature verification failed: ${message}`, {
      status: 400,
    });
  }

  if (event.type === "checkout.session.completed") {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const userId = checkoutSession.metadata?.userId;
    if (!userId) {
      return Response.json({ received: true });
    }

    const stripeCustomerId = unwrapId(checkoutSession.customer);
    const stripeSubscriptionId = unwrapSubscriptionId(
      checkoutSession.subscription,
    );

    await initSystemDb();
    const db = getDb();
    await db
      .update(users)
      .set({
        plan: "pro",
        stripeCustomerId,
        stripeSubscriptionId,
      })
      .where(eq(users.id, userId));
  }

  return Response.json({ received: true });
}
