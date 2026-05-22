# Own post-upload booking routing outside the model

After a paid visitor resolves the document upload prompt, the app decides the next booking step from the saved intake instead of relying on model continuation. The prompt keeps the same urgency guardrail as a fallback, but deterministic app code owns the transition to either session booking or urgent contact so the flow cannot silently stall when the model fails to continue.
