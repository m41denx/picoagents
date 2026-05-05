import { generateText, Output, zodSchema } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentRegistry } from "@/core/registry/load-agents.ts";
import type { SkillRegistry } from "@/core/registry/load-skills.ts";
import type { SubAgent } from "@/subagent.ts";

export const planTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const planSchema = z.object({
  title: z.string(),
  phases: z.array(
    z.object({
      name: z.string(),
      tasks: z.array(planTaskSchema),
    }),
  ),
});

export type Plan = z.infer<typeof planSchema>;

export type RunPlannerOptions = {
  /** Rich harness context (subagents, skills, orchestrator behavior). Optional but strongly recommended. */
  briefing?: string;
};

/**
 * Build a large planner-oriented brief: registered subagents, skills, and how the orchestrator uses them.
 * Safe to make verbose — only the planner sees this.
 */
export function buildPlannerBriefing(
  agentRegistry: AgentRegistry,
  skillRegistry: SkillRegistry,
  workspaceRoot: string,
): string {
  const sections: string[] = [];

  sections.push(`### Execution model (what your plan is for)
After approval, an **orchestrator** LLM runs with tools: it tracks tasks, updates shared session notes, and calls **spawn_subagents** to run **parallel batches** of work (concurrency capped by \`PICOAGENT_MAX_PARALLEL\`, default 3). Each spawn selects an **agentKey** from the registry below and passes a **task** string (and optionally a **perspective** for varied angles on the same question).

**Workspace files** for the built-in **generalist** (and for custom agents that call \`.withDefaultTools()\`) are rooted at:
\`${workspaceRoot}\`
(Custom agents otherwise only get their own \`.withTool()\` definitions plus **readSkill**, unless they opt into defaults.)

### Built-in capabilities you should assume exist
- **Orchestrator**: task graph, merging subagent outputs, recording progress (you do not plan orchestrator tool names — describe *work* and *which agent kinds* fit).
- **Every subagent profile**: merged with a universal **readSkill(skillName)** tool so instruction files (skills) can be loaded on demand.
- **generalist** subagent: standard workspace tools at run time — **read_file**, **list_dir**, **glob_search**, **grep**, plus **readSkill**. If \`PICOAGENT_ALLOW_SHELL=1\`, **run_command** may exist (shell in workspace root); do not assume shell unless the user clearly needs it.`);

  const agentIds = [...agentRegistry.byId.keys()].sort((a, b) => a.localeCompare(b));
  const agentBlocks: string[] = [];
  for (const id of agentIds) {
    const agent = agentRegistry.byId.get(id)!;
    agentBlocks.push(formatAgentEntry(id, agent));
  }
  sections.push(
    `### Registered subagent profiles (agentKey → spawn_subagents)\nUse these **exact ids** as \`agentKey\` when you describe who should do work.\n\n${agentBlocks.join("\n\n")}`,
  );

  const skillIds = [...skillRegistry.byName.keys()].sort((a, b) => a.localeCompare(b));
  if (skillIds.length === 0) {
    sections.push(
      `### Skills library (.picoagent/skills/*.mdc)\n*(No skill files loaded — empty directory or missing folder.)*\n\nSkills are reusable markdown instructions. Each subagent sees a **menu** of skills (alwaysApply + per-agent \`.withSkill()\` refs). Bodies are fetched via **readSkill** when needed.`,
    );
  } else {
    const skillLines = skillIds.map((name) => {
      const rec = skillRegistry.byName.get(name)!;
      const scope = rec.alwaysApply
        ? "visible to all subagents (alwaysApply)"
        : "visible only to subagents that reference this skill";
      return `- **${name}** — ${rec.description} (*${scope}*)`;
    });
    sections.push(
      `### Skills library (.picoagent/skills/*.mdc)\nReusable instruction bodies (YAML frontmatter + markdown). Subagents see descriptions in their menu and load full text with **readSkill**.\n\n${skillLines.join("\n")}`,
    );
  }

  sections.push(`### How to plan well here
- Split work into tasks that name **which agentKey** is appropriate (e.g. parallel **generalist** research paths, or a specialist you defined).
- Use **dependsOn** when ordering matters; omit it when tasks can run together.
- In **task.description**, mention files, skills by name, or verification steps so the orchestrator and subagents are not guessing.
- Prefer phases that mirror real parallelism (investigate → consolidate, or N parallel probes → merge).`);

  return sections.join("\n\n");
}

function formatAgentEntry(id: string, agent: SubAgent): string {
  const meta = agent.meta;
  const skillRefs = [...agent.skillRefs];
  const skillNote =
    skillRefs.length > 0
      ? `\n  - Extra skill refs (menu): ${skillRefs.join(", ")}`
      : "";

  if (id === "generalist") {
    return `- **${id}** — ${meta.name}\n  - ${meta.description}\n  - At run time tools include: read_file, list_dir, glob_search, grep, readSkill; optional run_command if shell env enabled.${skillNote}`;
  }

  const toolKeys = Object.keys(agent.tools);
  const toolsLine =
    toolKeys.length > 0
      ? toolKeys.join(", ") + ", readSkill"
      : "readSkill (define tools in .picoagent/agents to add capabilities)";

  const defaultsNote = agent.includeDefaultWorkspaceTools
    ? "\n  - **Plus** default workspace tools (read_file, list_dir, glob_search, grep; optional run_command if shell env enabled), merged with custom tools above."
    : "";

  return `- **${id}** — ${meta.name}\n  - ${meta.description}\n  - Custom tools: ${toolsLine}.${skillNote}${defaultsNote}`;
}

const PLANNER_SYSTEM = `You are the planning phase of **picoagents**, a harness where an orchestrator later spawns **registered subagents** (by agent key) and uses **skills** (.mdc files) via readSkill.

You receive a detailed **harness context** before the user goal: registered agents, skills, and how execution works. Use it — plans that ignore available agents/skills are wasteful.

Produce a concise, actionable **structured plan** (phases with tasks). Use clear task ids (kebab-case). Use dependsOn when ordering matters; omit when tasks can run in parallel.

Important: emit the plan through the normal structured output path the client reads. Some OpenAI-compatible stacks leave assistant content empty if you write only to an internal reasoning stream — put the structured plan where the API returns it.

Task descriptions should reference relevant **agentKey** values from the harness context and, when useful, **skill** names or workspace paths.`;

/** Single-task plan when `--oneshot` skips the planner LLM call. */
export function createOneshotPlan(goal: string): Plan {
  const title =
    goal.length > 80 ? `${goal.slice(0, 77).trim()}…` : goal.trim() || "Oneshot";
  return {
    title: "Oneshot (planner skipped)",
    phases: [
      {
        name: "Execute",
        tasks: [
          {
            id: "oneshot-main",
            title,
            description:
              "Execute the user request using orchestrator tools and spawn_subagents as needed.",
          },
        ],
      },
    ],
  };
}

export async function runPlanner(
  model: LanguageModel,
  goal: string,
  options?: RunPlannerOptions,
): Promise<Plan> {
  const briefing = options?.briefing?.trim();
  const prompt =
    briefing && briefing.length > 0
      ? `${briefing}\n\n---\n\n## User goal / request\n\n${goal}`
      : `Goal / request:\n${goal}`;

  const result = await generateText({
    model,
    system: PLANNER_SYSTEM,
    prompt,
    output: Output.object({
      schema: zodSchema(planSchema),
      name: "Plan",
      description: "Phased plan with tasks",
    }),
  });

  const out = result.output;
  if (!out) {
    throw new Error("Planner produced no structured output");
  }
  return out as Plan;
}
