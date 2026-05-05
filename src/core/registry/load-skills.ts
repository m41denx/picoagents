import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import type { SubAgent } from "@/subagent.ts";
import type { SkillRecord } from "@/core/registry/skill-types.ts";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

type FrontmatterShape = {
  description?: string;
  alwaysApply?: boolean;
};

function parseMdcFile(content: string, filePath: string, skillName: string): SkillRecord {
  const m = content.match(FRONTMATTER);
  if (!m) {
    throw new Error(`Invalid .mdc (missing frontmatter): ${filePath}`);
  }
  const yamlText = m[1] ?? "";
  const body = m[2] ?? "";
  let data: FrontmatterShape;
  try {
    data = parseYaml(yamlText) as FrontmatterShape;
  } catch (e) {
    throw new Error(`YAML parse error in ${filePath}: ${e}`);
  }
  const description = data.description?.trim();
  if (!description) {
    throw new Error(`Missing required "description" in ${filePath}`);
  }
  if (typeof data.alwaysApply !== "boolean") {
    throw new Error(`Missing required boolean "alwaysApply" in ${filePath}`);
  }
  return {
    skillName,
    filePath,
    description,
    alwaysApply: data.alwaysApply,
    body: body.trimEnd(),
  };
}

export class SkillRegistry {
  readonly byName = new Map<string, SkillRecord>();

  constructor(skills: SkillRecord[]) {
    for (const s of skills) {
      if (this.byName.has(s.skillName)) {
        throw new Error(`Duplicate skill id "${s.skillName}"`);
      }
      this.byName.set(s.skillName, s);
    }
  }

  /** Skills visible for menu + readSkill allow-list */
  visibleSkillNames(agent: SubAgent): string[] {
    const names = new Set<string>();
    for (const s of this.byName.values()) {
      if (s.alwaysApply) names.add(s.skillName);
    }
    for (const ref of agent.skillRefs) {
      const stem = ref.replace(/\.mdc$/i, "");
      const rec = this.byName.get(stem);
      if (rec && !rec.alwaysApply) names.add(stem);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  menuBlock(agent: SubAgent): string {
    const visible = this.visibleSkillNames(agent);
    if (visible.length === 0) {
      return "Available skills:\n(none)";
    }
    const lines = visible.map((n) => {
      const rec = this.byName.get(n)!;
      return `- ${n}: ${rec.description}`;
    });
    return `Available skills:\n${lines.join("\n")}`;
  }

  getBody(skillName: string): string | undefined {
    return this.byName.get(skillName)?.body;
  }
}

export async function loadSkills(projectRoot: string): Promise<SkillRegistry> {
  const dir = join(projectRoot, ".picoagent", "skills");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return new SkillRegistry([]);
  }
  const records: SkillRecord[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".mdc")) continue;
    const skillName = name.slice(0, -".mdc".length);
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf8");
    records.push(parseMdcFile(content, filePath, skillName));
  }
  return new SkillRegistry(records);
}
