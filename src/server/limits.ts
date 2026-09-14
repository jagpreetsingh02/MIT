// Public-endpoint abuse limits. Per-client limits use @fastify/rate-limit (keyed by client IP);
// these service-wide ceilings bound total cost even if a client rotates IPs.

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const LIMITS = {
  apiPerClientPerMinute: () => envNumber("API_RATE_LIMIT_PER_MINUTE", 300),
  scansPerClientPerMinute: () => envNumber("SCAN_RATE_LIMIT_PER_MINUTE", 10),
  analysesPerClientPerMinute: () => envNumber("ANALYZE_RATE_LIMIT_PER_MINUTE", 20),
  simulationsPerClientPerMinute: () => envNumber("SIMULATE_RATE_LIMIT_PER_MINUTE", 120),
  sbomPerClientPerMinute: () => envNumber("SBOM_RATE_LIMIT_PER_MINUTE", 30),
  otterPerClientPerMinute: () => envNumber("OTTER_RATE_LIMIT_PER_MINUTE", 30),
  transcriptionsPerClientPerMinute: () => envNumber("TRANSCRIBE_RATE_LIMIT_PER_MINUTE", 12),
  githubScansPerHour: () => envNumber("GITHUB_SCANS_PER_HOUR", 120),
  otterRequestsPerHour: () => envNumber("OTTER_REQUESTS_PER_HOUR", 600),
  transcriptionsPerHour: () => envNumber("TRANSCRIPTIONS_PER_HOUR", 200),
};

export class WindowLimiter {
  private hits: number[] = [];
  constructor(
    private max: () => number,
    private windowMs: number,
  ) {}

  /** Records a hit; returns false when the service-wide ceiling for the window is reached. */
  take(now = Date.now()) {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max()) return false;
    this.hits.push(now);
    return true;
  }
}

export function busy(what: string) {
  return Object.assign(
    new Error(`RootLine is handling a lot of ${what} right now. Please try again in a few minutes.`),
    { statusCode: 429 },
  );
}

/** Fastify trustProxy: a hop count (e.g. "1" behind one reverse proxy), "true", or unset. */
export function trustProxySetting(): boolean | ((address: string, hop: number) => boolean) {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  const hops = Number(raw);
  // Trust only the nearest `hops` proxies so a client cannot spoof its IP via X-Forwarded-For.
  return Number.isInteger(hops) && hops > 0 ? (_address, hop) => hop < hops : false;
}
