import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/embed.js", import.meta.url), "utf8");

function createHarness() {
  const listeners = new Map();
  const children = [];
  const storage = new Map();
  const assigned = [];
  const dataLayer = [];

  const windowRef = {
    CHATBOT_EMBED_URL: "https://aquarius-chatbot-nine.vercel.app/",
    location: {
      href: "https://www.aquariuscriminaldefence.com.au/lp/criminal-law",
      origin: "https://www.aquariuscriminaldefence.com.au",
      assign(value) { assigned.push(value); },
    },
    dataLayer,
    parent: null,
    matchMedia(query) {
      return { matches: query === "(min-width: 768px)" };
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    sessionStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
    fetch() { return Promise.resolve(); },
    setTimeout() { return 1; },
  };
  windowRef.parent = windowRef;

  const documentRef = {
    body: {
      appendChild(child) { children.push(child); },
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        setAttribute() {},
        appendChild() {},
        addEventListener() {},
        contentWindow: tag === "iframe" ? {} : undefined,
      };
    },
  };

  vm.runInNewContext(source, {
    window: windowRef,
    document: documentRef,
    URL,
    sessionStorage: windowRef.sessionStorage,
    setTimeout: windowRef.setTimeout,
    fetch: windowRef.fetch,
  });

  return {
    frame: children.find((child) => child.tagName === "IFRAME"),
    message: listeners.get("message"),
    dataLayer,
    assigned,
    storage,
    window: windowRef,
  };
}

test("the public launcher accepts only its iframe's trusted completion messages", () => {
  const harness = createHarness();

  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "payment_confirmed" },
  });
  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "payment_confirmed" },
  });
  harness.message({
    origin: "https://evil.example",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "appointment_booked" },
  });
  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: {},
    data: { source: "aq-chat", type: "appointment_booked" },
  });
  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "appointment_booked", redirectUrl: "https://evil.example" },
  });

  assert.deepEqual(
    harness.dataLayer.map((entry) => ({ ...entry })),
    [{ event: "aq_payment_confirmed" }],
  );
  assert.deepEqual(harness.assigned, []);
});

test("a valid appointment emits one GTM event and uses the fixed thank-you path", () => {
  const harness = createHarness();

  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "appointment_booked" },
  });
  harness.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: harness.frame.contentWindow,
    data: { source: "aq-chat", type: "appointment_booked" },
  });

  assert.deepEqual(
    harness.dataLayer.map((entry) => ({ ...entry })),
    [{ event: "aq_appointment_booked" }],
  );
  assert.deepEqual(harness.assigned, ["https://www.aquariuscriminaldefence.com.au/lp/criminal-law/thank-you/"]);
});

test("conversion guards survive a launcher reload in the same tab", () => {
  const first = createHarness();
  first.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: first.frame.contentWindow,
    data: { source: "aq-chat", type: "payment_confirmed" },
  });

  // The production launcher stores the guard in sessionStorage. Replaying the
  // same script with that storage must not create another conversion.
  const second = createHarness();
  second.storage.set("aq_conversion_payment_confirmed", "1");
  second.message({
    origin: "https://aquarius-chatbot-nine.vercel.app",
    source: second.frame.contentWindow,
    data: { source: "aq-chat", type: "payment_confirmed" },
  });
  assert.deepEqual(Array.from(second.dataLayer), []);
});
