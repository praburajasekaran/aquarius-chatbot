import { NextResponse } from "next/server";
import { getStripe, PRICING } from "@/lib/stripe";

export async function POST(req: Request) {
  const { sessionId, urgency } = (await req.json()) as {
    sessionId: string;
    urgency: "urgent" | "non-urgent";
  };

  const pricing = PRICING[urgency];
  if (!pricing) {
    return NextResponse.json({ error: "Invalid urgency" }, { status: 400 });
  }

  const checkoutSession = await getStripe().checkout.sessions.create({
    mode: "payment",
    currency: "aud",
    line_items: [
      {
        price_data: {
          currency: "aud",
          unit_amount: pricing.amount,
          product_data: { name: pricing.label },
        },
        quantity: 1,
      },
    ],
    ui_mode: "embedded_page",
    return_url: `${process.env.NEXT_PUBLIC_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { sessionId, urgency },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
  });

  return NextResponse.json({ clientSecret: checkoutSession.client_secret });
}
