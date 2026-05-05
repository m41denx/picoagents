import { tool } from "ai";
import { z } from "zod";
import type { SkillRegistry } from "../registry/load-skills.ts";
import { maxSkillBodyChars } from "../config.ts";

export function createReadSkillTool(registry: SkillRegistry, allowedNames: readonly string[]) {
  const allow = new Set(allowedNames);
  return tool({
    description:
      "Load the full body text for a skill listed under Available skills (lazy context).",
    inputSchema: z.object({
      skillName: z.string().describe("Skill id (filename stem without .mdc)"),
    }),
    execute: async ({ skillName }) => {
      if (!allow.has(skillName)) {
        return {
          error: "forbidden",
          message: `Skill "${skillName}" is not available for this agent variant.`,
        };
      }
      const body = registry.getBody(skillName);
      if (body === undefined) {
        return { error: "not_found", message: `Unknown skill "${skillName}".` };
      }
      const max = maxSkillBodyChars();
      const clipped = body.length > max ? body.slice(0, max) + "\n…[truncated]" : body;
      return { skillName, body: clipped };
    },
  });
}
