import {
  type Facts,
  ecosystemLabel,
  entryLabel,
  severityOf,
  versionLabel,
} from "../../shared/facts.js";
import { simulate } from "../graph.js";
import {
  OTTER_SECTIONS,
  type Advisory,
  type OtterAction,
  type OtterScope,
  type OtterSection,
  type PackageNode,
  type Scan,
} from "../../shared/types.js";

const SECTION_LABELS: Record<OtterSection, string> = {
  overview: "Overview",
  risks: "Risks",
  applications: "Applications",
  dependencies: "Dependencies",
  vulnerabilities: "Vulnerabilities",
  graph: "Ripple Graph",
  coverage: "Coverage",
  evidence: "Evidence",
};

const SECTION_PURPOSE: Record<OtterSection, string> = {
  overview: "Charts and summary numbers for the whole scan, plus the top priority to start with.",
  risks: "Dependencies with known findings, ranked by deterministic Ripple Priority.",
  applications: "Each analyzed application, its dependency counts and vulnerable packages reaching it.",
  dependencies:
    "Searchable inventory of every package version and unresolved declaration, with filters for known findings, direct, hidden and unresolved dependencies.",
  vulnerabilities:
    "One row per known advisory and installed package, each with a Vulnerability Brief.",
  graph:
    "Dependency graph for one selected package, its paths into applications, and Trace Ripple impact.",
  coverage:
    "What RootLine could and could not verify: checked vs unchecked packages, unresolved versions, source status and per-project resolution.",
  evidence:
    "Source provenance for every finding and the scoring methodology.",
};

const METHODOLOGY =
  "Ripple Priority (0-100) = CVSS x 6 (max 60) + 15 if a source reports known exploitation + exposure (10 / shortest known depth, halved for development-only use) + application reach (up to 12 for share of mapped projects affected, up to 3 for affected ancestors). It is computed per package version from all of that version's advisories. Deterministic ranking, not an exploitation probability. Missing evidence can lower a score.";

const ADVISORY_ID =
  /\b(?:CVE-\d{4}-\d{4,7}|GHSA(?:-[0-9a-z]{4}){3}|DEMO-\d{3,}|PYSEC-\d{4}-\d+|GO-\d{4}-\d+|RUSTSEC-\d{4}-\d{4}|OSV-\d{4}-\d+)\b/gi;

export function advisoryIds(text: string) {
  return new Set([...text.matchAll(ADVISORY_ID)].map((m) => m[0].toUpperCase()));
}

type Target =
  | { type: "application"; applicationId: string; name: string }
  | { type: "package"; nodeId: string; name: string }
  | { type: "vulnerability"; advisoryId: string; nodeId: string; name: string };

class Handles {
  private byHandle = new Map<string, Target>();
  private byKey = new Map<string, string>();
  private counts = { A: 0, P: 0, V: 0 };

  private add(prefix: "A" | "P" | "V", key: string, target: Target) {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const handle = `${prefix}${++this.counts[prefix]}`;
    this.byKey.set(key, handle);
    this.byHandle.set(handle, target);
    return handle;
  }
  app(node: PackageNode) {
    return this.add("A", "A:" + node.id, {
      type: "application",
      applicationId: node.id,
      name: node.name,
    });
  }
  pkg(node: PackageNode) {
    return this.add("P", "P:" + node.id, {
      type: "package",
      nodeId: node.id,
      name: `${node.name}@${node.versionStatus === "unresolved" ? node.declaredSpecifier || "unresolved" : node.version}`,
    });
  }
  vuln(advisory: Advisory, node: PackageNode) {
    return this.add("V", `V:${advisory.id}:${node.id}`, {
      type: "vulnerability",
      advisoryId: advisory.id,
      nodeId: node.id,
      name: `${advisory.id} in ${node.name}@${node.version}`,
    });
  }
  get(handle: string) {
    return this.byHandle.get(handle.trim().toUpperCase());
  }
  catalog() {
    return Object.fromEntries([...this.byHandle].map(([h, t]) => [h, `${t.name} (${t.type})`]));
  }
}

export interface OtterContext {
  json: string;
  allowedAdvisoryIds: Set<string>;
  resolveAction: (type: unknown, target: unknown) => OtterAction | undefined;
  focus?: { advisoryId: string; aliases: string[]; label: string };
}

function coverageLabel(n: PackageNode) {
  return n.coverage === "checked"
    ? "checked against vulnerability sources"
    : n.coverage === "fixture"
      ? "checked against synthetic demo fixture data"
      : n.coverage === "partial"
        ? "only partially checked"
        : n.versionStatus === "unresolved"
          ? "not checked: exact installed version unresolved"
          : "not checked";
}

function advisoryFacts(a: Advisory) {
  return {
    id: a.id,
    aliases: a.aliases,
    summary: a.summary,
    severity: severityOf(a),
    severitySource:
      a.cvss !== undefined
        ? "derived from the CVSS base score"
        : a.severity
          ? "rating supplied by the source"
          : "not scored by any source",
    cvss: a.cvss ?? "not available",
    cvssVector: a.cvssVector ?? "not supplied",
    knownExploitation: a.exploited
      ? "a source reports known exploitation"
      : "no exploitation evidence in this snapshot (this is not proof it is unexploited)",
    fixedVersion: a.fixed ?? "no verified fixed version recorded",
    affectedVersionEvidence: (a.affected ?? []).slice(0, 3).map((t) => t.slice(0, 300)),
    sources: a.provenance.map((p) => ({
      source: p.source,
      url: p.url || "none",
      retrievedAt: p.retrievedAt,
      syntheticFixture: Boolean(p.fixture),
    })),
  };
}

export function buildContext(scan: Scan, facts: Facts, scope: OtterScope): OtterContext {
  const graph = scan.graph ?? { nodes: [], edges: [], warnings: [] };
  const h = new Handles();
  const demo = scan.mode === "demo";
  const name = (id: string) => facts.nodeById.get(id)?.name ?? id;
  const appNodes = (ids: string[]) =>
    ids
      .map((id) => facts.nodeById.get(id))
      .filter((n): n is PackageNode => Boolean(n))
      .map((n) => ({ handle: h.app(n), name: n.name }));

  const scanInfo = {
    repository: scan.name,
    ref: scan.ref,
    commit: scan.commit ?? "not recorded",
    analyzedAt: scan.completedAt ?? scan.createdAt,
    dataOrigin: demo
      ? "SYNTHETIC OFFLINE DEMO. Every advisory (DEMO-*) and score is an illustrative fixture, not a real vulnerability."
      : "Source-backed snapshot of the repository at the commit above.",
  };

  function packageFacts(node: PackageNode, withFindings: boolean) {
    const risk = facts.riskFor(node);
    const unresolved = node.versionStatus === "unresolved";
    return {
      handle: h.pkg(node),
      name: node.name,
      installedVersion: versionLabel(node),
      ecosystem: ecosystemLabel(node.ecosystem),
      purl: node.purl,
      howItEnters: entryLabel(node),
      dependencyDepth: node.depth ?? "unknown",
      usage:
        node.scope === "runtime"
          ? "runtime"
          : node.scope === "development"
            ? "development only"
            : "not determined",
      relationship: node.relationship === "listed" ? "listed in lockfile; ancestry unconfirmed" : "recorded",
      vulnerabilityCoverage: coverageLabel(node),
      ...(withFindings
        ? {
            knownFindings: node.advisories.map((a) => ({
              handle: h.vuln(a, node),
              id: a.id,
              severity: severityOf(a),
            })),
          }
        : {}),
      ripplePriority:
        risk && !unresolved
          ? { score: risk.score, level: risk.level, factors: risk.factors, reasons: risk.reasons }
          : "not scored",
      applicationsAffected: appNodes(risk?.services ?? []),
    };
  }

  function pathFacts(nodeId: string, limit: number) {
    try {
      const sim = simulate(graph, nodeId);
      return {
        applicationsReached: appNodes(sim.services),
        totalApplications: sim.totalServices,
        pathCount: sim.pathsTruncated ? `at least ${sim.pathCount}` : sim.pathCount,
        dependentNodes: sim.affected.length,
        whatIfOnly: sim.hypothetical
          ? "No advisory on this package; any ripple is a hypothetical what-if."
          : undefined,
        relationshipUncertain: sim.relationshipUncertain
          ? "Some root links mean 'listed in lockfile', not confirmed direct dependency."
          : undefined,
        paths: sim.paths.slice(0, limit).map((p) => p.map(name).join(" -> ")),
      };
    } catch {
      return "No dependency paths recorded for this node.";
    }
  }

  const risks = scan.risks ?? [];
  const priorities = risks.filter((r) => r.advisories > 0);
  const priorityRow = (r: (typeof risks)[number], detail: boolean) => {
    const n = facts.nodeById.get(r.nodeId)!;
    return {
      handle: h.pkg(n),
      package: `${n.name}@${n.version}`,
      ripplePriority: r.score,
      level: r.level,
      advisories: n.advisories.map((a) => ({ handle: h.vuln(a, n), id: a.id, severity: severityOf(a) })),
      howItEnters: entryLabel(n),
      applicationsAffected: `${r.services.length} of ${facts.services.length}`,
      ...(detail ? { reasons: r.reasons, factors: r.factors } : {}),
    };
  };

  let content: Record<string, unknown>;
  let focus: OtterContext["focus"];

  if (scope.kind === "vulnerability") {
    const node = facts.nodeById.get(scope.nodeId)!;
    const advisory = node.advisories.find((a) => a.id === scope.advisoryId)!;
    const instances = graph.nodes.filter((n) => n.purl === node.purl && n.kind === "package");
    const risk = facts.riskFor(node);
    h.vuln(advisory, node);
    focus = {
      advisoryId: advisory.id,
      aliases: advisory.aliases,
      label: `${advisory.id} in ${node.name}@${node.version}`,
    };
    content = {
      scan: scanInfo,
      focusedInvestigation: {
        scopeRule: `This conversation covers exactly one finding: ${focus.label}. Nothing else in the repository is provided.`,
        finding: { handle: "V1", ...advisoryFacts(advisory) },
        package: packageFacts(node, false),
        otherAdvisoriesOnSamePackageVersion:
          new Set(instances.flatMap((n) => n.advisories.map((a) => a.id))).size - 1,
        priorityNote:
          risk && risk.advisories > 1
            ? "Ripple Priority is computed for the package version across all of its advisories, not only this one."
            : undefined,
        installedInstances: instances.slice(0, 10).map((n) => ({
          project: n.projectId ? facts.nodeById.get(n.projectId)?.name : undefined,
          depth: n.depth ?? "unknown",
          howItEnters: entryLabel(n),
          usage: n.scope,
        })),
        dependencyPaths: pathFacts(node.id, 10),
      },
    };
  } else {
    const view: OtterSection = OTTER_SECTIONS.includes(scope.view) ? scope.view : "overview";
    const notChecked = facts.packages.filter(
      (n) => !["checked", "fixture"].includes(n.coverage) && n.versionStatus !== "unresolved",
    );
    const unresolved = facts.packages.filter((n) => n.versionStatus === "unresolved");
    const summary = {
      applications: facts.services.length,
      dependencies: facts.packages.length,
      exactVersions: facts.exact,
      checkedVersions: facts.checked,
      notFullyChecked: notChecked.length,
      unresolvedVersions: unresolved.length,
      knownAdvisories: facts.findings.length,
      vulnerablePackages: facts.vulnerablePackages.length,
      highPriorityDependencies: priorities.filter((r) => r.score >= 60).length,
      severityCounts: Object.fromEntries(
        ["critical", "high", "medium", "low", "unscored"].map((s) => [
          s,
          facts.findings.filter((f) => f.severity === s).length,
        ]),
      ),
    };
    const pageFocus: Record<string, unknown> = {};
    const node = scope.nodeId ? facts.nodeById.get(scope.nodeId) : undefined;
    const app = scope.applicationId
      ? facts.applications.find((a) => a.node.id === scope.applicationId)
      : undefined;
    const row =
      scope.advisoryId && node
        ? facts.findingRows.find((r) => r.advisory.id === scope.advisoryId && r.pkg.id === node.id)
        : undefined;
    const evidenceFinding = scope.advisoryId
      ? facts.findings.find((f) => f.advisory.id === scope.advisoryId)
      : undefined;

    if (view === "overview") {
      pageFocus.vulnerablePackageEntry = {
        direct: facts.vulnerablePackages.filter((n) => n.depth !== null && n.depth <= 1).length,
        hiddenDeeper: facts.vulnerablePackages.filter((n) => n.depth !== null && n.depth > 1).length,
        unknown: facts.vulnerablePackages.filter((n) => n.depth === null).length,
      };
    } else if (view === "risks") {
      pageFocus.rankedRisks = priorities.slice(0, 12).map((r) => priorityRow(r, true));
    } else if (view === "applications") {
      if (app)
        pageFocus.selectedApplication = {
          handle: h.app(app.node),
          name: app.node.name,
          path: app.project?.path ?? "not recorded",
          resolution: app.project?.ingestionStatus ?? app.project?.resolution ?? "not recorded",
          notes: app.project?.notes.slice(0, 4) ?? [],
          dependencies: app.dependencies.length,
          declaredDirectly: app.direct,
          vulnerablePackagesReachingIt: app.vulnerable.map((n) => packageFacts(n, true)).slice(0, 10),
        };
      else
        pageFocus.applicationDetails = facts.applications.slice(0, 20).map((a) => ({
          handle: h.app(a.node),
          name: a.node.name,
          vulnerablePackages: a.vulnerable.map((n) => `${n.name}@${n.version}`).slice(0, 8),
        }));
    } else if (view === "dependencies") {
      if (node?.kind === "package") pageFocus.selectedPackage = packageFacts(node, true);
      pageFocus.unresolvedDeclarations = unresolved
        .slice(0, 20)
        .map((n) => `${n.name} ${n.declaredSpecifier || "(no version declared)"}`);
    } else if (view === "vulnerabilities") {
      pageFocus.findings = facts.findingRows.slice(0, 25).map((r) => ({
        handle: h.vuln(r.advisory, r.pkg),
        id: r.advisory.id,
        severity: r.severity,
        cvss: r.advisory.cvss ?? "not available",
        package: `${r.pkg.name}@${r.pkg.version}`,
        applicationsAffected: r.risk?.services.length ?? 0,
      }));
      if (row)
        pageFocus.openBrief = {
          handle: h.vuln(row.advisory, row.pkg),
          ...advisoryFacts(row.advisory),
          package: packageFacts(row.pkg, false),
        };
    } else if (view === "graph") {
      if (node) {
        pageFocus.selectedNode =
          node.kind === "service" ? { application: node.name } : packageFacts(node, true);
        pageFocus.traceRippleActive = Boolean(scope.ripple);
        pageFocus.paths = pathFacts(node.id, 8);
      }
    } else if (view === "coverage") {
      pageFocus.sources = scan.connectors.map((c) => `${c.name}: ${c.status} - ${c.message}`);
      pageFocus.projects = (scan.repositoryMap?.projects ?? [])
        .filter((p) => p.selected)
        .slice(0, 20)
        .map((p) => ({
          name: p.name,
          path: p.path,
          resolution: p.ingestionStatus ?? p.resolution,
          dependencies: p.packageCount ?? "not recorded",
          exact: p.exactCount ?? "not recorded",
          unresolved: p.unresolvedCount ?? 0,
          relationships: p.relationships ?? "not reported",
          notes: p.notes.slice(0, 3).map((t) => t.slice(0, 240)),
        }));
      pageFocus.warnings = graph.warnings.slice(0, 10).map((w) => w.slice(0, 300));
      pageFocus.notFullyCheckedPackages = notChecked.slice(0, 20).map((n) => `${n.name}@${n.version}`);
      pageFocus.unresolvedDeclarations = unresolved.slice(0, 20).map((n) => n.name);
    } else if (view === "evidence") {
      if (evidenceFinding)
        pageFocus.inspectedEvidence = {
          handle: h.vuln(evidenceFinding.advisory, evidenceFinding.packages[0]),
          ...advisoryFacts(evidenceFinding.advisory),
          matchedPackages: evidenceFinding.packages.map((p) => ({
            purl: p.purl,
            sources: p.provenance.map((s) => s.source),
          })),
        };
      else
        pageFocus.findingSources = facts.findings.slice(0, 20).map((f) => ({
          handle: h.vuln(f.advisory, f.packages[0]),
          id: f.advisory.id,
          sources: f.advisory.provenance.map((p) => p.source),
        }));
    }

    content = {
      scan: scanInfo,
      currentPage: { section: SECTION_LABELS[view], shows: SECTION_PURPOSE[view] },
      summary,
      topPriorities: priorities.slice(0, 5).map((r) => priorityRow(r, false)),
      applications: facts.applications.slice(0, 15).map((a) => ({
        handle: h.app(a.node),
        name: a.node.name,
        dependencies: a.dependencies.length,
        vulnerablePackages: a.vulnerable.length,
        knownAdvisories: a.findings,
      })),
      pageFocus,
      sections: Object.fromEntries(
        OTTER_SECTIONS.map((s) => [s, `${SECTION_LABELS[s]}: ${SECTION_PURPOSE[s]}`]),
      ),
    };
  }

  content.methodology = METHODOLOGY;
  content.actionTargets = {
    sections: [...OTTER_SECTIONS],
    handles: h.catalog(),
  };
  const json = JSON.stringify(content);

  const resolveAction = (type: unknown, target: unknown): OtterAction | undefined => {
    if (typeof type !== "string" || typeof target !== "string") return;
    if (type === "section") {
      const view = target.trim().toLowerCase() as OtterSection;
      return OTTER_SECTIONS.includes(view)
        ? { type: "section", view, label: `Open ${SECTION_LABELS[view]}` }
        : undefined;
    }
    const t = h.get(target);
    if (!t) return;
    if (type === "application" && t.type === "application")
      return { type, applicationId: t.applicationId, label: `Open application ${t.name}` };
    if ((type === "package" || type === "trace") && t.type === "package")
      return type === "package"
        ? { type, nodeId: t.nodeId, label: `Open ${t.name} in Ripple Graph` }
        : { type, nodeId: t.nodeId, label: `Trace Ripple from ${t.name}` };
    if ((type === "trace" || type === "package") && t.type === "vulnerability")
      return {
        type: type as "trace",
        nodeId: t.nodeId,
        label: type === "trace" ? `Trace Ripple for ${t.advisoryId}` : `Open ${t.advisoryId} in Ripple Graph`,
      };
    if (type === "vulnerability" && t.type === "vulnerability")
      return {
        type,
        advisoryId: t.advisoryId,
        nodeId: t.nodeId,
        label: `Open brief for ${t.name}`,
      };
    if (type === "evidence" && t.type === "vulnerability")
      return { type, advisoryId: t.advisoryId, label: `Open evidence for ${t.advisoryId}` };
  };

  return { json, allowedAdvisoryIds: advisoryIds(json), resolveAction, focus };
}
