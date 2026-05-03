import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/kv";

export const tokenLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  prefix: "upload-rl:token",
  analytics: true,
});

// IP-based limit on /api/late-upload/session. Without this, an attacker who
// holds N stolen / minted magic links can sustain N × 20 uploads/hr aggregate
// (capped only by globalLimiter at 500/hr). With it, a single IP is held to
// 60/hr regardless of how many cookies it presents.
export const ipUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1 h"),
  prefix: "upload-rl:ip",
  analytics: true,
});

export const globalLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(500, "1 h"),
  prefix: "upload-rl:global",
  analytics: true,
});

export const getLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "1 h"),
  prefix: "upload-rl:get",
  analytics: true,
});

export const chatLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
  prefix: "chat-rl:ip",
  analytics: true,
});

export const inChatUploadLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "in-chat-upload-rl:ip",
  analytics: true,
});
