import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { metrics, trace } from "@opentelemetry/api";
import type { Store } from "./store.js";
import type { ConnectorHealth, Provenance } from "../shared/types.js";
const hosts = new Set([
  "registry.npmjs.org",
  "pypi.org",
  "repo.maven.apache.org",
  "services.nvd.nist.gov",
  "cveawg.mitre.org",
  "ossindex.sonatype.org",
  "api.github.com",
  "api.osv.dev",
  "raw.githubusercontent.com",
]);
const meter = metrics.getMeter("rippleguard");
const latency = meter.createHistogram("connector_latency", { unit: "ms" });
const failures = meter.createCounter("connector_errors");
export interface SourceResponse<T> {
  data: T;
  provenance: Provenance;
}
export interface HttpSource {
  get<T>(
    source: string,
    url: string,
    options?: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      ttl?: number;
      interval?: number;
    },
  ): Promise<SourceResponse<T>>;
}
export class Transport implements HttpSource {
  health = new Map<string, ConnectorHealth>();
  private next = new Map<string, number>();
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  async get<T>(
    source: string,
    url: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      ttl?: number;
      interval?: number;
    } = {},
  ): Promise<SourceResponse<T>> {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !hosts.has(parsed.hostname) ||
      parsed.port ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Connector URL is not allowlisted.");
    const key = createHash("sha256")
      .update(JSON.stringify([source, url, options.method, options.body, options.headers]))
      .digest("hex");
    const cached = this.store.cacheGet(key);
    if (cached) {
      this.health.set(source, {
        name: source,
        status: "ok",
        message: "Cached source response",
        checkedAt: new Date().toISOString(),
      });
      return JSON.parse(cached);
    }
    const started = Date.now();
    const span = trace.getTracer("rippleguard").startSpan("connector." + source);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const slot = Math.max(Date.now(), this.next.get(parsed.hostname) || 0);
        this.next.set(parsed.hostname, slot + (options.interval ?? 250));
        await delay(Math.max(0, slot - Date.now()));
        let response: Response;
        try {
          response = await this.fetcher(url, {
            method: options.method || "GET",
            headers: {
              "User-Agent": "RippleGuard/1.0",
              Accept: "application/json",
              ...(options.body ? { "Content-Type": "application/json" } : {}),
              ...options.headers,
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
          });
        } catch {
          if (attempt < 2) {
            await delay(400 * 2 ** attempt);
            continue;
          }
          throw new Error("Source timed out or could not be reached.");
        }
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          failures.add(1, { source, status: String(response.status) });
          const retry = response.headers.get("retry-after");
          const seconds = Number(retry);
          const wait = retry
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retry) - Date.now()
            : 400 * 2 ** attempt;
          await response.body?.cancel();
          if (wait > 30_000) throw new Error("Source rate limit exceeded; try again later.");
          await delay(Math.max(250, wait || 1000));
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Source returned HTTP ${response.status}.`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty source response.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.length;
          if (size > 8_000_000) {
            await reader.cancel();
            throw new Error("Source response exceeds 8 MB.");
          }
          chunks.push(result.value);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const data = (
          response.headers.get("content-type")?.includes("json") ? JSON.parse(raw) : raw
        ) as T;
        const result = { data, provenance: { source, url, retrievedAt: new Date().toISOString() } };
        if (options.ttl !== 0)
          this.store.cachePut(key, JSON.stringify(result), options.ttl ?? 3_600_000);
        this.health.set(source, {
          name: source,
          status: "ok",
          message: "Source responded",
          checkedAt: result.provenance.retrievedAt,
        });
        return result;
      }
      throw new Error("Source retry budget exhausted.");
    } catch (error) {
      failures.add(1, { source });
      this.health.set(source, {
        name: source,
        status: "degraded",
        message: error instanceof Error ? error.message : "Connector failed",
        checkedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      latency.record(Date.now() - started, { source });
      span.end();
    }
  }
}
