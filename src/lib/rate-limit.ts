import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/kv";

export const tokenLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  prefix: "upload-rl:token",
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
