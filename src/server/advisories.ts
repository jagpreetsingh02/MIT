import { CVSS20, CVSS30, CVSS31, CVSS40 } from "@pandatix/js-cvss";
import { PackageURL } from "packageurl-js";
import semver from "semver";
import type { Advisory, PackageNode, Provenance } from "../shared/types.js";
export function cvssFromVector(vector: string): number | undefined {
  try {
    return vector.startsWith("CVSS:4.0/")
      ? new CVSS40(vector).Score()
      : vector.startsWith("CVSS:3.1/")
        ? new CVSS31(vector).BaseScore()
        : vector.startsWith("CVSS:3.0/")
          ? new CVSS30(vector).BaseScore()
          : vector.startsWith("AV:")
            ? new CVSS20(vector).BaseScore()
            : undefined;
  } catch {
    return undefined;
  }
}
const norm = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
export function osvAdvisory(v: any, n: PackageNode, provenance: Provenance): Advisory | undefined {
  if (v.withdrawn || typeof v.id !== "string") return;
  const ecosystem = { npm: "npm", pypi: "PyPI", maven: "Maven" }[n.ecosystem];
  const matching = (v.affected || []).filter((a: any) => {
    if (a.package?.purl) {
      try {
        const p = PackageURL.fromString(a.package.purl);
        const own = PackageURL.fromString(n.purl);
        return p.type === own.type && p.name === own.name && p.namespace === own.namespace;
      } catch {
        return false;
      }
    }
    return (
      a.package?.ecosystem === ecosystem &&
      (n.ecosystem === "pypi"
        ? norm(a.package.name || "") === norm(n.name)
        : a.package.name === n.name)
    );
  });
  if (!matching.length) return; // Never attach details for a different package returned by a source.
  const scores = [...(v.severity || []), ...matching.flatMap((a: any) => a.severity || [])]
    .filter((s: any) => typeof s.score === "string")
    .map((s: any) => ({ vector: s.score, score: cvssFromVector(s.score) }))
    .filter((s: { score?: number }) => s.score !== undefined)
    .sort((a: { score?: number }, b: { score?: number }) => (b.score || 0) - (a.score || 0));
  const fixed: string[] = [];
  const affected: string[] = [];
  for (const a of matching)
    for (const range of a.ranges || []) {
      // Only list a fixed endpoint from the interval containing the installed version.
      // Semver intervals are evaluated; other ecosystem ranges remain source text.
      let introduced = "0";
      for (const event of range.events || []) {
        if (event.introduced !== undefined) introduced = event.introduced;
        if (event.fixed) {
          const text = `${introduced === "0" ? "Earlier versions" : `From ${introduced}`} to before ${event.fixed}`;
          affected.push(text);
          if (
            range.type === "SEMVER" &&
            semver.valid(n.version) &&
            semver.valid(event.fixed) &&
            (introduced === "0" ||
              (semver.valid(introduced) && semver.gte(n.version, introduced))) &&
            semver.lt(n.version, event.fixed)
          )
            fixed.push(event.fixed);
          else if (
            range.type !== "SEMVER" &&
            matching.length === 1 &&
            (a.versions || []).includes(n.version)
          )
            fixed.push(event.fixed);
        }
      }
    }
  const severity = String(v.database_specific?.severity || "").toLowerCase();
  return {
    id: v.id,
    aliases: (v.aliases || []).filter((s: unknown) => typeof s === "string"),
    summary: v.summary || v.details?.slice(0, 400) || "Known vulnerability reported by the source",
    cvss: scores[0]?.score,
    cvssVector: scores[0]?.vector,
    severity: ["critical", "high", "medium", "low"].includes(severity)
      ? (severity as Advisory["severity"])
      : undefined,
    fixed: [...new Set(fixed)].join(", ") || undefined,
    affected: [...new Set(affected)],
    provenance: [
      { ...provenance, url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}` },
    ],
  };
}
