#!/usr/bin/env node
// Entry point shebang wrapper.
// The compiled bin.js is the actual entry after `tsc --build`.
import("../dist/bin.js").catch((err) => {
  console.error("[the-agent] Failed to start:", err.message);
  process.exit(1);
});
