/**
 * HTTP API using Hono.
 */

import { Hono } from "hono";
import type { Env } from "./types";

export const createApp = (_env: Env) => {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "inboxkit", version: "0.1.0" })
  );

  return app;
};
