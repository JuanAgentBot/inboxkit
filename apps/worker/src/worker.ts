/**
 * Cloudflare Worker entry point.
 */

import { createApp } from "./app";
import type { Env } from "./types";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createApp(env).fetch(req, env, ctx);
  },
};
