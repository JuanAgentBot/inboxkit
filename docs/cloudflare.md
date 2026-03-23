# Cloudflare Workers + Durable Objects Reference

Quick reference for the limits, pricing, and patterns that matter during development.

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/).

## Workers limits

| Limit | Free | Paid |
|---|---|---|
| Requests | 100K/day | Unlimited |
| CPU time per request | 10ms | 30s default, up to 5min |
| Memory per isolate | 128MB | 128MB |
| Subrequests per invocation | 50 | 10,000 |
| Worker bundle size (compressed) | 3MB | 10MB |
| Worker startup time | 1s | 1s |

**CPU time** counts only active JS execution. Time spent waiting on `fetch()`, storage calls, and other I/O does not count.

**Duration (wall time)** has no hard limit for HTTP requests while the client stays connected. Alarm handlers have a 15-minute wall time limit.

## Durable Objects limits

| Limit | Value |
|---|---|
| CPU per request/alarm | 30s default, configurable to 5min |
| Storage per DO (SQLite) | 10GB |
| Storage per account (SQLite, paid) | Unlimited |
| Max DO classes per account | 500 (paid) / 100 (free) |
| Soft throughput limit | ~1,000 req/s per DO |
| WebSocket message size | 32 MiB |
| Max columns per SQLite table | 100 |

## Alarms

- One alarm per DO at a time. `setAlarm()` overwrites any existing alarm.
- Guaranteed at-least-once execution.
- Retried on exception with exponential backoff (starting at 2s, up to 6 retries).
- 15-minute wall time limit per alarm invocation.
- Each `setAlarm()` is billed as one row written (SQLite).

**Retry caution:** If an alarm exhausts all 6 retries (e.g., extended API outage), it stops permanently. Catch errors inside `alarm()` and explicitly call `setAlarm()` for retry rather than letting exceptions bubble up and consume retry attempts.

## Hibernation lifecycle

A Durable Object transitions through these states:

1. **Active, in-memory** - Handling requests/events.
2. **Idle, in-memory, hibernateable** - All handlers done, eligible for hibernation.
3. **Idle, in-memory, non-hibernateable** - Handlers done but something prevents hibernation.
4. **Hibernated** - Removed from memory. WebSocket connections stay alive on the Cloudflare edge.
5. **Inactive** - Fully removed from host process. Cold start on next request.

**Hibernation requires ALL of these:**
- No `setTimeout` / `setInterval` callbacks pending.
- No in-progress `fetch()` calls being awaited.
- No WebSocket Standard API usage (must use Hibernation API: `ctx.acceptWebSocket()`).
- No request/event still being processed.

**Timing:**
- Eligible idle DO hibernates after ~10 seconds.
- Non-hibernateable idle DO is evicted after 70-140 seconds.

**Critical:** When a DO hibernates, ALL in-memory state is discarded. The constructor runs again on wake-up. Only persisted storage and WebSocket attachments survive.

## Pricing (Workers Paid plan, $5/month base)

### Compute

| | Included | Overage |
|---|---|---|
| Requests | 1M/month | $0.15 per million |
| Duration | 400,000 GB-s | $12.50 per million GB-s |

**WebSocket billing:**
- Each connection creation = 1 request.
- Incoming messages use a 20:1 ratio (100 messages = 5 billed requests).
- Outgoing messages are free.
- Protocol-level pings are free and don't wake the DO from hibernation.
- `setWebSocketAutoResponse()` messages don't incur wall-clock charges.

**Duration billing:**
- Billed for wall-clock time while active OR idle-but-non-hibernateable.
- NOT billed while hibernation-eligible or while hibernated.
- Duration is billed at 128MB regardless of actual memory usage.

### Storage (SQLite)

| | Included | Overage |
|---|---|---|
| Rows read | 25B/month | $0.001 per million |
| Rows written | 50M/month | $1.00 per million |
| Stored data | 5 GB-month | $0.20 per GB-month |

## Secrets

Set via wrangler CLI (not in code, not in wrangler.jsonc):

```bash
wrangler secret put MY_SECRET
```

For local dev, create `.dev.vars` (gitignored):

```
MY_SECRET=actual-value-here
```

## Shutdown behavior

Durable Objects shut down on:
- Code deployments (disconnects all WebSockets).
- Inactivity (follows lifecycle states above).
- Runtime updates (Cloudflare-initiated, ~30s grace period for in-flight requests).

No shutdown hooks exist. Design for state to be persisted incrementally, not saved on exit.

**WebSocket disconnects on deploy:** Every deploy restarts all DOs, killing WebSocket connections. Clients must handle reconnection with automatic backoff.

## Error handling

Exceptions from DOs propagate to the calling Worker. Key properties:
- `.retryable` = true: Transient error, safe to retry if idempotent.
- `.overloaded` = true: DO is overloaded, do NOT retry (makes it worse).
- `.remote` = true: Exception originated in user code (vs. infrastructure).

After an exception, the `DurableObjectStub` may be broken. Create a new one for subsequent requests.

## Wrangler configuration tips

### Storage backend

The `migrations` section in `wrangler.jsonc` determines the storage backend:
- `new_classes` creates a KV-backed DO (legacy).
- `new_sqlite_classes` creates a SQLite-backed DO (recommended).

Always use `new_sqlite_classes` for new DOs. It has better pricing and is required for the free plan.

### CPU limit

The default 30s CPU time is configurable:

```jsonc
{
  "limits": {
    "cpu_ms": 300000  // 5 minutes max
  }
}
```

### NixOS

The npm-installed `workerd` binary is dynamically linked and won't run on NixOS. The `shell.nix` in this template patches it by symlinking to the nix-packaged workerd. It also builds a CA certificate directory for workerd's BoringSSL. See `shell.nix` for details.

The `SSL_CERT_DIR` env var must reach workerd through turbo. That's why `globalPassThroughEnv` in `turbo.json` includes it.
