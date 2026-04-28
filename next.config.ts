import type { NextConfig } from "next";
import path from "path";
import { existsSync } from "fs";

// In a git worktree, node_modules lives in the main repo, not the worktree.
// Walk up from __dirname to find the nearest ancestor that has node_modules/next,
// so Turbopack's filesystem root covers both the source and its dependencies.
function findTurbopackRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(path.join(dir, "node_modules", "next"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const nextConfig: NextConfig = {
  turbopack: {
    root: findTurbopackRoot(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
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
