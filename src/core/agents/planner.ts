import { generateText, stepCountIs, tool, zodSchema } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { ModelStepTrace } from "@/core/observability.ts";
import { serializeModelStep } from "@/core/observability.ts";
import type { AgentRegistry } from "@/core/registry/load-agents.ts";
import type { SkillRegistry } from "@/core/registry/load-skills.ts";
import { createWorkspaceTools } from "@/core/tools/workspace.ts";
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
  /** Workspace root used by planner read/list/search tools. */
  workspaceRoot?: string;
  /** Max planner steps for tool loops. */
  maxPlannerSteps?: number;
  /** After each model step (structured output path may still emit reasoning). */
  onPlannerStepTrace?: (trace: ModelStepTrace) => void;
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

  const devNote = agent.includeDeveloperWriteTools
    ? "\n  - **Plus** developer write tools: ensure_dir, write_file (under workspace; no shell)."
    : "";

  const researchNote = agent.includeResearcherTools
    ? "\n  - **Plus** researcher tools: duckduckgo_search (SerpAPI, needs SERPAPI_API_KEY), fetch_web_page (raw HTTP)."
    : "";

  return `- **${id}** — ${meta.name}\n  - ${meta.description}\n  - Custom tools: ${toolsLine}.${skillNote}${defaultsNote}${devNote}${researchNote}`;
}

const PLANNER_SYSTEM = `You are the planning phase of **picoagents**, a harness where an orchestrator later spawns **registered subagents** (by agent key) and uses **skills** (.mdc files) via readSkill.

You receive a detailed **harness context** before the user goal: registered agents, skills, and how execution works. Use it — plans that ignore available agents/skills are wasteful.

You are an agentic planner with tools:
- Use workspace tools (list_dir, glob_search, grep, read_file) to inspect files and infer intent before drafting.
- Maintain draft state with read_plan, set_plan_title, upsert_plan_task, and remove_plan_task.
- Always call finalize_plan when done; that is the source of truth.

Planning quality bar:
- Capture the user's original intent and constraints verbatim where useful.
- Include concrete file paths and implementation checks when requested.
- Do not collapse nuanced requests into one vague task.
- Use clear task ids (kebab-case). Use dependsOn only when sequencing is required.

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
  const onPlannerStepTrace = options?.onPlannerStepTrace;
  const workspaceRoot = options?.workspaceRoot;
  const maxPlannerSteps = options?.maxPlannerSteps ?? 24;
  const prompt =
    briefing && briefing.length > 0
      ? `${briefing}\n\n---\n\n## User goal / request\n\n${goal}`
      : `Goal / request:\n${goal}`;

  const requiredGoalPathHints = [".cursor/plans"].filter((h) =>
    goal.includes(h),
  );

  const draft: Plan = {
    title: "Draft plan",
    phases: [{ name: "Main", tasks: [] }],
  };
  let finalized: Plan | null = null;

  const read_plan = tool({
    description: "Read the current draft plan JSON.",
    inputSchema: z.object({}),
    execute: async () => ({ plan: draft }),
  });

  const set_plan_title = tool({
    description: "Set or replace the plan title.",
    inputSchema: z.object({ title: z.string() }),
    execute: async ({ title }) => {
      draft.title = title.trim() || draft.title;
      return { ok: true, title: draft.title };
    },
  });

  const upsert_plan_task = tool({
    description:
      "Create or update a task in a phase. Creates the phase when missing.",
    inputSchema: z.object({
      phase: z.string(),
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      dependsOn: z.array(z.string()).optional(),
    }),
    execute: async ({ phase, id, title, description, dependsOn }) => {
      const phaseName = phase.trim() || "Main";
      let target = draft.phases.find((p) => p.name === phaseName);
      if (!target) {
        target = { name: phaseName, tasks: [] };
        draft.phases.push(target);
      }
      const i = target.tasks.findIndex((t) => t.id === id);
      const prev = i >= 0 ? target.tasks[i] : undefined;
      const next = {
        id,
        title: title ?? prev?.title ?? id,
        description: description ?? prev?.description,
        dependsOn: dependsOn ?? prev?.dependsOn,
      };
      if (i >= 0) target.tasks[i] = next;
      else target.tasks.push(next);
      return { ok: true, phase: phaseName, task: next };
    },
  });

  const remove_plan_task = tool({
    description: "Remove a task from all phases by id.",
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      let removed = 0;
      for (const p of draft.phases) {
        const before = p.tasks.length;
        p.tasks = p.tasks.filter((t) => t.id !== id);
        removed += before - p.tasks.length;
      }
      return { ok: true, removed };
    },
  });

  const finalize_plan = tool({
    description:
      "Finalize and return the current plan. Must be called exactly once at the end.",
    inputSchema: z.object({}),
    execute: async () => {
      const normalized: Plan = {
        title: draft.title,
        phases: draft.phases.filter((p) => p.tasks.length > 0),
      };
      const parsed = planSchema.safeParse(normalized);
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join("; "),
        };
      }
      if (parsed.data.title.trim().toLowerCase() === "draft plan") {
        return {
          ok: false,
          error: "Plan title is still default ('Draft plan'). Set a meaningful title.",
        };
      }
      if (!parsed.data.phases.some((p) => p.tasks.length > 0)) {
        return { ok: false, error: "Plan must include at least one task." };
      }
      if (requiredGoalPathHints.length > 0) {
        const body = JSON.stringify(parsed.data).toLowerCase();
        const missing = requiredGoalPathHints.filter(
          (h) => !body.includes(h.toLowerCase()),
        );
        if (missing.length > 0) {
          return {
            ok: false,
            error: `Plan misses required goal context/path hints: ${missing.join(", ")}`,
          };
        }
      }
      finalized = parsed.data;
      return { ok: true, plan: parsed.data };
    },
  });

  const tools = {
    ...(workspaceRoot ? createWorkspaceTools(workspaceRoot) : {}),
    read_plan,
    set_plan_title,
    upsert_plan_task,
    remove_plan_task,
    finalize_plan,
  };

  const plannerPassPrompts = [
    prompt,
    `${prompt}

You stopped before finalization in a prior attempt. Continue from the current draft plan:
${JSON.stringify(draft, null, 2)}

Next actions:
1) read_plan
2) upsert_plan_task/remove_plan_task as needed
3) finalize_plan`,
    `${prompt}

Final planner pass. You must finish now.
Current draft plan:
${JSON.stringify(draft, null, 2)}

If the draft is already good, call finalize_plan immediately.
If not, make minimal fixes with upsert_plan_task/remove_plan_task and then call finalize_plan.`,
  ];

  for (const passPrompt of plannerPassPrompts) {
    if (finalized) break;
    await generateText({
      model,
      system: PLANNER_SYSTEM,
      prompt: passPrompt,
      tools,
      stopWhen: stepCountIs(maxPlannerSteps),
      onStepFinish: (event) => {
        onPlannerStepTrace?.(serializeModelStep(event));
      },
    });
  }
  if (!finalized) {
    throw new Error(
      `Planner did not finalize a valid plan. Draft state:\n${JSON.stringify(draft, null, 2)}`,
    );
  }
  return finalized;
}
