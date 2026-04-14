import { auth } from "@/src/lib/auth";
import { getStripe } from "@/src/lib/stripe";

export const runtime = "nodejs";

function getAppBaseUrl(req: Request): string {
  const fromEnv = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return Response.json(
      { error: "Billing is not configured (STRIPE_PRO_PRICE_ID)." },
      { status: 500 },
    );
  }

  try {
    const baseUrl = getAppBaseUrl(req);
    const stripe = getStripe();

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/projects?checkout=success`,
      cancel_url: `${baseUrl}/projects?checkout=canceled`,
      metadata: { userId: session.user.id },
      ...(session.user.email
        ? { customer_email: session.user.email }
        : {}),
    });

    if (!checkoutSession.url) {
      return Response.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 500 },
      );
    }

    return Response.json({ url: checkoutSession.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
