/**
 * Cloudflare Worker entry point.
 */

import { createApp } from "./app";
import { handleEmail } from "./email-handler";
import type { Env } from "./types";

const app = createApp();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    await handleEmail(message, env);
  },
};
