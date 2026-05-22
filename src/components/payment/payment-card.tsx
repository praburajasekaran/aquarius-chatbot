"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { AlertCircle, CheckCircle2, CreditCard, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

export type PaymentFailureReason = "declined" | "invalid" | "system" | "expired";

interface PaymentCardProps {
  sessionId: string;
  onComplete: () => void;
  onFail?: () => void;
}

interface Pricing {
  urgency: "urgent" | "non-urgent";
  displayPrice: string;
  tier: string;
  lineItem: string;
}

type PaymentState = "loading" | "ready" | "succeeded" | "failed";

export function PaymentCard({ sessionId, onComplete, onFail }: PaymentCardProps) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [authKey, setAuthKey] = useState<string | null>(null);
  const [state, setState] = useState<PaymentState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [processing, setProcessing] = useState(false);
  const onCompleteRef = useRef(onComplete);
  const onFailRef = useRef(onFail);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onFailRef.current = onFail;
  }, [onComplete, onFail]);

  useEffect(() => {
    let cancelled = false;

    async function preparePayment() {
      setState("loading");
      setError(null);
      setAuthKey(null);
      try {
        const pricingRes = await fetch(
          `/api/intake/${encodeURIComponent(sessionId)}/pricing`
        );
        if (!pricingRes.ok) {
          if (pricingRes.status === 404) {
            throw new Error("payment_not_ready");
          }
          throw new Error(`pricing lookup failed (${pricingRes.status})`);
        }
        const pricingData = (await pricingRes.json()) as Pricing;

        const checkoutRes = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, forceNew: retryAttempt > 0 }),
        });
        const checkoutData = (await checkoutRes.json().catch(() => ({}))) as {
          authKey?: string;
          error?: string;
        };
        if (!checkoutRes.ok) {
          if (checkoutData.error === "bpoint_redirect_url_invalid") {
            throw new Error("bpoint_redirect_url_invalid");
          }
          throw new Error(`checkout create failed (${checkoutRes.status})`);
        }
        if (!checkoutData.authKey) {
          throw new Error("checkout create returned no AuthKey");
        }

        if (cancelled) return;
        setPricing(pricingData);
        setAuthKey(checkoutData.authKey);
        setState("ready");
      } catch (err) {
        console.error("[PaymentCard] BPoint checkout setup failed", err);
        if (cancelled) return;
        setState("failed");
        setError(
          err instanceof Error && err.message === "payment_not_ready"
            ? "Payment is not ready yet. Please complete your contact details and choose an urgency option first."
            : err instanceof Error && err.message === "bpoint_redirect_url_invalid"
              ? "BPoint needs an HTTPS return URL before it can load the secure payment form."
              : "We couldn't start the payment form. Please refresh and try again."
        );
      }
    }

    void preparePayment();

    return () => {
      cancelled = true;
    };
  }, [sessionId, retryAttempt]);

  const iframeSrc = useMemo(() => {
    if (!authKey) return null;
    return `https://www.bpoint.com.au/webapi/v2/txns/iframe/${encodeURIComponent(
      authKey
    )}`;
  }, [authKey]);

  function handleBpointFrameLoad(event: SyntheticEvent<HTMLIFrameElement>) {
    try {
      const href = event.currentTarget.contentWindow?.location.href;
      if (!href) return;
      const url = new URL(href);
      const payment = url.searchParams.get("payment");
      if (payment === "success") {
        setState("succeeded");
        onCompleteRef.current();
      } else if (payment === "failed") {
        setState("failed");
        setError("Payment was not approved. Please check the details and try again.");
        onFailRef.current?.();
      }
    } catch {
      // BPoint pages are cross-origin until they redirect back to our app.
    }
  }

  async function processPayment() {
    if (!authKey) return;
    setProcessing(true);
    setError(null);
    try {
      const processRes = await fetch("/api/checkout/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, authKey }),
      });
      const processData = (await processRes.json().catch(() => ({}))) as {
        redirectionUrl?: string;
        error?: string;
        responseText?: string;
      };
      if (!processRes.ok) {
        throw new Error(
          processData.responseText ??
            processData.error ??
            "BPoint could not process the payment."
        );
      }
      if (!processData.redirectionUrl) {
        throw new Error("BPoint did not return a confirmation URL.");
      }
      window.location.assign(processData.redirectionUrl);
    } catch (err) {
      console.error("[PaymentCard] BPoint processing failed", err);
      setProcessing(false);
      setError(err instanceof Error ? err.message : "Payment could not be processed.");
    }
  }

  return (
    <section
      aria-label="Payment required"
      className="-mx-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.10)]"
    >
      <div className="border-b border-slate-200 bg-[#f7fbfc] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#085a66] text-white shadow-sm">
              <CreditCard className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-heading text-base font-semibold leading-tight text-slate-950">
                Secure payment
              </h2>
              <p className="mt-0.5 text-sm leading-snug text-slate-600">
                BPoint card checkout
              </p>
            </div>
          </div>
          {pricing ? (
            <div className="shrink-0 rounded-full border border-[#085a66]/15 bg-white px-3 py-1.5 text-right shadow-sm">
              <p className="text-xs font-medium leading-none text-slate-500">
                Total due
              </p>
              <p className="mt-1 text-sm font-semibold leading-none text-[#085a66]">
                {pricing.displayPrice}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {pricing ? (
          <>
            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  {pricing.tier}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                  {pricing.lineItem}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fixed-fee disclosure
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">
                  {pricing.urgency === "urgent"
                    ? "In accordance with the Legal Profession Uniform Law, this is a fixed initial deposit to commence work on your urgent matter. Further legal work will be quoted separately."
                    : "In accordance with the Legal Profession Uniform Law, this is a fixed fee for an initial consultation. Further legal work will be quoted separately."}
                </p>
              </div>
            </div>
          </>
        ) : null}

        {state === "loading" && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
          >
            <Loader2 className="h-4 w-4 animate-spin text-[#085a66]" aria-hidden="true" />
            Loading secure BPoint payment form...
          </div>
        )}

        {error && (
          <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-950">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
              <p>{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setRetryAttempt((attempt) => attempt + 1)}
              className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
            >
              Retry payment form
            </button>
          </div>
        )}

        {state === "succeeded" && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-950"
          >
            <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />
            Payment successful.
          </div>
        )}

        {iframeSrc && state !== "succeeded" ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-[#085a66]" aria-hidden="true" />
                  <span>Card details</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#085a66]" aria-hidden="true" />
                  Encrypted
                </div>
              </div>
              <iframe
                title="BPoint secure payment form"
                src={iframeSrc}
                onLoad={handleBpointFrameLoad}
                className="block h-[260px] w-full bg-white sm:h-[280px]"
              />
            </div>
            <button
              type="button"
              onClick={processPayment}
              disabled={processing}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#085a66] px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[#064550] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Processing...
                </>
              ) : (
                "Process payment"
              )}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
