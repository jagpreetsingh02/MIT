import { parse as toml } from "smol-toml";
import { XMLParser } from "fast-xml-parser";
import semver from "semver";
import type { DependencyDeclaration, Project } from "../shared/types.js";
import type { SourceFile } from "./discovery.js";

/** Static declarations only. Never resolve a range against the latest registry release. */
export function declarations(project: Project, files: SourceFile[]) {
  const found: DependencyDeclaration[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const base = file.filename.split("/").pop()!;
    const add = (
      name: string,
      specifier: unknown,
      scope: DependencyDeclaration["scope"] = "runtime",
      exactVersion?: string,
    ) => {
      if (!name || typeof name !== "string") return;
      found.push({
        name,
        specifier: String(specifier ?? ""),
        file: file.filename,
        scope,
        exactVersion,
      });
    };
    const requirement = (raw: unknown, scope: DependencyDeclaration["scope"] = "runtime") => {
      const value = String(raw).trim();
      if (!value || value.startsWith("#")) return;
      const match = value.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[^\]]+\])?\s*(.*)$/);
      if (!match || value.startsWith("-")) {
        warnings.push(
          `${file.filename}: unsupported requirement directive ${value.slice(0, 120)}; not executed.`,
        );
        return;
      }
      const specifier = match[2].replace(/\s+#.*$/, "").trim();
      const pin = specifier.match(/^==([0-9][\w.!+-]*)(?:\s*(?:;.*|--hash=.*|\\))?$/);
      add(match[1], specifier, scope, pin?.[1]);
    };
    try {
      if (base === "package.json") {
        const data = JSON.parse(file.content);
        for (const group of [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ])
          for (const [name, spec] of Object.entries(data[group] || {}))
            add(
              name,
              spec,
              group === "devDependencies" ? "development" : "runtime",
              typeof spec === "string" && semver.valid(spec) ? spec : undefined,
            );
      } else if (/^requirements.*\.txt$/.test(base)) {
        for (const line of file.content.split("\n"))
          requirement(line, /dev|test/.test(base) ? "development" : "unknown");
      } else if (base === "pyproject.toml") {
        const data = toml(file.content) as any;
        for (const value of data.project?.dependencies || []) requirement(value);
        for (const [group, values] of Object.entries(data.project?.["optional-dependencies"] || {}))
          for (const value of values as any[])
            requirement(value, /^(dev|test|tests)$/.test(group) ? "development" : "unknown");
        for (const [group, values] of Object.entries(data["dependency-groups"] || {}))
          for (const value of values as any[])
            if (typeof value === "string")
              requirement(value, /dev|test/.test(group) ? "development" : "unknown");
        const poetry = data.tool?.poetry;
        const groups = [
          { values: poetry?.dependencies, scope: "runtime" as const },
          { values: poetry?.["dev-dependencies"], scope: "development" as const },
          ...Object.values(poetry?.group || {}).map((g: any) => ({
            values: g.dependencies,
            scope: "unknown" as const,
          })),
        ];
        for (const { values, scope } of groups)
          for (const [name, value] of Object.entries(values || {})) {
            if (name === "python") continue;
            const spec =
              typeof value === "string" ? value : (value as any)?.version || JSON.stringify(value);
            add(name, spec, scope, /^[0-9][\w.!+-]*$/.test(spec) ? spec : undefined);
          }
        for (const value of data["build-system"]?.requires || []) requirement(value, "development");
      } else if (base === "Pipfile" || base === "Pipfile.lock") {
        const data = base.endsWith(".lock") ? JSON.parse(file.content) : toml(file.content);
        for (const group of base.endsWith(".lock")
          ? ["default", "develop"]
          : ["packages", "dev-packages"])
          for (const [name, value] of Object.entries((data as any)[group] || {})) {
            const spec =
              typeof value === "string" ? value : (value as any).version || JSON.stringify(value);
            const pin = spec.match(/^==([0-9][\w.!+-]*)$/);
            add(name, spec, group.includes("dev") ? "development" : "unknown", pin?.[1]);
          }
      } else if (base === "pom.xml") {
        if (/<!DOCTYPE|<!ENTITY/i.test(file.content))
          throw new Error("XML entities are not accepted");
        const doc = new XMLParser({
          processEntities: false,
          parseTagValue: false,
          removeNSPrefix: true,
        }).parse(file.content).project;
        const raw = doc?.dependencies?.dependency;
        for (const d of raw ? (Array.isArray(raw) ? raw : [raw]) : []) {
          if (!d.groupId || !d.artifactId) continue;
          const spec = String(d.version || "managed by parent/BOM");
          const version = spec.replace(
            /\$\{([^}]+)\}/g,
            (original, key) => doc.properties?.[key] || original,
          );
          add(
            d.groupId + ":" + d.artifactId,
            spec,
            d.scope === "test" ? "development" : "runtime",
            /^[0-9][\w.!+-]*$/.test(version) ? version : undefined,
          );
        }
      } else if (/^setup\.(py|cfg)$/.test(base))
        warnings.push(
          `${file.filename}: static dependency extraction is not supported; setup code was not executed.`,
        );
    } catch (error) {
      warnings.push(`${file.filename}: declaration parsing failed: ${(error as Error).message}`);
    }
  }
  return {
    declarations: [
      ...new Map(found.map((d) => [`${d.name}:${d.specifier}:${d.scope}`, d])).values(),
    ],
    warnings,
  };
}
