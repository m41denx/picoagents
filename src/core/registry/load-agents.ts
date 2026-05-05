import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { SubAgent } from "../../subagent.ts";

export type AgentRegistry = {
  /** Includes built-in `generalist` */
  byId: Map<string, SubAgent>;
};

async function collectAgentFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let ents;
    try {
      ents = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) out.push(p);
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function stemFromPath(file: string): string {
  const base = basename(file, extname(file));
  return base.toLowerCase().replace(/_/g, "-");
}

export async function loadCustomAgents(projectRoot: string): Promise<Map<string, SubAgent>> {
  const agentsDir = join(projectRoot, ".picoagent", "agents");
  const files = await collectAgentFiles(agentsDir);
  const byId = new Map<string, SubAgent>();

  for (const file of files) {
    const stem = stemFromPath(file);
    if (stem === "generalist") {
      throw new Error(
        `Reserved agent id "generalist": rename ${file} or remove — built-in generalist is always registered.`,
      );
    }
    const href = pathToFileURL(file).href;
    const mod = (await import(href)) as {
      default?: unknown;
      subagent?: unknown;
    };
    const candidate = mod.default ?? mod.subagent;
    if (!(candidate instanceof SubAgent)) {
      throw new Error(`Expected default export SubAgent in ${file}`);
    }
    const agent = candidate as SubAgent;
    const id = agent.meta.id || stem;
    if (byId.has(id)) {
      throw new Error(`Duplicate subagent id "${id}"`);
    }
    byId.set(id, agent);
  }

  return byId;
}

export function mergeRegistry(builtin: SubAgent, custom: Map<string, SubAgent>): AgentRegistry {
  const byId = new Map<string, SubAgent>();
  const bid = builtin.meta.id ?? "generalist";
  byId.set(bid, builtin);
  for (const [id, a] of custom) {
    if (id === "generalist") continue;
    byId.set(id, a);
  }
  return { byId };
}
