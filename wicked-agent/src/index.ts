/**
 * wicked-agent — public entry point.
 *
 * Consumers import only what they need:
 *   import { wickedAgent } from "wicked-agent";
 *   import type { WickedConfig, DomainName } from "wicked-agent";
 */

export { wickedAgent } from "./extension.js";
export type { WickedConfig, DomainName } from "./types.js";
