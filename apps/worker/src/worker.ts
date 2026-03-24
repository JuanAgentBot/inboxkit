/**
 * Cloudflare Worker entry point.
 */

import { createApp } from "./app";
import type { Env } from "./types";

const app = createApp();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx);
  },
};
