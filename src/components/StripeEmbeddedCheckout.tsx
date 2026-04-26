/**
 * Renders Stripe's embedded checkout inline. Hits our /api/billing/create-checkout
 * route with the user's Supabase access token so the server can attach
 * `userId` to the resulting subscription's metadata.
 */
import { useCallback } from "react";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";

type Props = {
  priceId: string;
  returnUrl: string;
};

export function StripeEmbeddedCheckout({ priceId, returnUrl }: Props) {
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Sign in required");

    const res = await fetch("/api/billing/create-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        priceId,
        environment: getStripeEnvironment(),
        returnUrl,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to start checkout");
    }
    const json = (await res.json()) as { clientSecret?: string };
    if (!json.clientSecret) throw new Error("No client secret returned");
    return json.clientSecret;
  }, [priceId, returnUrl]);

  return (
    <div id="checkout" className="min-h-[520px]">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
