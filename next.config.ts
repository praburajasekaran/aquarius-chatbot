import type { NextConfig } from "next";
import path from "path";
import { existsSync } from "fs";

// In a git worktree, node_modules lives in the main repo, not the worktree.
// Walk up from __dirname to find the nearest ancestor that has node_modules/next,
// so Turbopack's filesystem root covers both the source and its dependencies.
function findTurbopackRoot(start: string): string {
  if (existsSync(path.join(process.cwd(), "node_modules", "next"))) {
    return process.cwd();
  }
  let dir = start;
  while (true) {
    if (existsSync(path.join(dir, "node_modules", "next"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// Frame-ancestors allowlist for the embedded chat widget. Default ("*")
// preserves the original "embed anywhere" behavior so this rollout is a
// no-op for deployments that haven't set the env var. Operators who know
// the set of approved embedding origins should set
// CHATBOT_FRAME_ANCESTORS to a space-separated list — e.g.
// "https://aquariuslawyers.com.au https://*.aquariuslawyers.com.au" —
// to prevent clickjacking + UI-redress attacks via malicious embeds.
const frameAncestors = (
  process.env.CHATBOT_FRAME_ANCESTORS ?? "*"
).trim();
const csp = [
  `frame-ancestors ${frameAncestors}`,
  "frame-src 'self' https://www.bpoint.com.au https://calendly.com https://*.calendly.com",
].join("; ");
// X-Frame-Options is a binary toggle, not a list — only ALLOWALL or
// SAMEORIGIN/DENY make sense. If the operator has restricted
// frame-ancestors via CSP, drop XFO entirely (CSP supersedes it in
// modern browsers; legacy IE/Edge fall back to no protection but this
// app does not target those).
const xfoValue = frameAncestors === "*" ? "ALLOWALL" : null;

function hostnameFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const allowedDevOrigins = Array.from(
  new Set(
    [
      "auroral-superethically-hans.ngrok-free.dev",
      hostnameFromUrl(process.env.NEXT_PUBLIC_URL),
      hostnameFromUrl(process.env.APP_URL),
      hostnameFromUrl(process.env.BPOINT_REDIRECT_BASE_URL),
    ].filter((origin): origin is string => Boolean(origin)),
  ),
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: findTurbopackRoot(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(xfoValue ? [{ key: "X-Frame-Options", value: xfoValue }] : []),
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        source: "/upload/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, private" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/late-upload/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
