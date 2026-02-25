/**
 * rde-coding-agent — public entry point.
 *
 * Consumers import only what they need:
 *   import { rdeCodingAgent } from "rde-coding-agent";
 *   import type { RdeConfig, DomainName } from "rde-coding-agent";
 */

export { rdeCodingAgent } from "./extension.js";
export type { RdeConfig, DomainName } from "./types.js";
