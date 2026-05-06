import { generateText, stepCountIs, tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentRegistry } from "@/core/registry/load-agents.ts";
import type { SkillRegistry } from "@/core/registry/load-skills.ts";
import type { GoldenStore } from "@/core/context/golden.ts";
import { appendAgentMdSection } from "@/core/context/agent-md.ts";
import { getMaxParallel } from "@/core/config.ts";
import { parallelMapSettled } from "@/core/parallel.ts";
import { runSubagent } from "@/core/agents/run-subagent.ts";
import type { Plan } from "@/core/agents/planner.ts";
import type { ModelStepTrace } from "@/core/observability.ts";
import { serializeModelStep } from "@/core/observability.ts";

export type TaskRow = {
  id: string;
  title: string;
  phase?: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  agentKey?: string;
  notes?: string;
  lastResult?: string;
};

export type OrchestratorCallbacks = {
  onOrchestratorStart?: () => void;
  /** Fires after each orchestrator model step (multi-step tool loops). */
  onOrchestratorStepFinish?: (info: {
    stepNumber: number;
    finishReason: string;
    hadToolCalls: boolean;
  }) => void;
  onOrchestratorLog?: (line: string) => void;
  onSubagentStarted?: (runId: string, agentKey: string, task: string) => void;
  onSubagentFinished?: (
    runId: string,
    agentKey: string,
    ok: boolean,
    summary: string,
  ) => void;
  /** Full step payload (text + tool calls/results) for observability */
  onOrchestratorStepTrace?: (trace: ModelStepTrace) => void;
  onSubagentStepTrace?: (
    runId: string,
    agentKey: string,
    trace: ModelStepTrace,
  ) => void;
  onBatchCompleted?: (payload: unknown) => void;
};

function seedTasksFromPlan(plan: Plan, tasks: Map<string, TaskRow>) {
  for (const ph of plan.phases) {
    for (const t of ph.tasks) {
      tasks.set(t.id, {
        id: t.id,
        title: t.title,
        phase: ph.name,
        status: "pending",
        notes: t.description,
      });
    }
  }
}

export function createOrchestratorTools(opts: {
  projectRoot: string;
  workspaceRoot: string;
  agentRegistry: AgentRegistry;
  skillRegistry: SkillRegistry;
  golden: GoldenStore;
  subagentModel: LanguageModel;
  tasks: Map<string, TaskRow>;
  callbacks?: OrchestratorCallbacks;
}) {
  const {
    projectRoot,
    workspaceRoot,
    agentRegistry,
    skillRegistry,
    golden,
    subagentModel,
    tasks,
    callbacks,
  } = opts;

  const list_agents = tool({
    description: "List registered subagent ids that can be spawned.",
    inputSchema: z.object({}),
    execute: async () => ({
      agents: [...agentRegistry.byId.keys()].sort(),
    }),
  });

  const list_tasks = tool({
    description: "List workflow tasks loaded from the approved plan.",
    inputSchema: z.object({}),
    execute: async () => ({
      tasks: [...tasks.values()].map((t) => ({ ...t })),
    }),
  });

  const upsert_task = tool({
    description: "Create or update a task row.",
    inputSchema: z.object({
      id: z.string(),
      title: z.string().optional(),
      status: z
        .enum(["pending", "in_progress", "done", "blocked"])
        .optional(),
      notes: z.string().optional(),
      agentKey: z.string().optional(),
      lastResult: z.string().optional(),
    }),
    execute: async (u) => {
      const cur = tasks.get(u.id) ?? {
        id: u.id,
        title: u.title ?? u.id,
        status: "pending" as const,
      };
      const next: TaskRow = {
        ...cur,
        title: u.title ?? cur.title,
        status: u.status ?? cur.status,
        notes: u.notes ?? cur.notes,
        agentKey: u.agentKey ?? cur.agentKey,
        lastResult: u.lastResult ?? cur.lastResult,
      };
      tasks.set(u.id, next);
      return { ok: true, task: next };
    },
  });

  const spawn_subagents = tool({
    description:
      "Run multiple subagents in parallel (respects PICOAGENT_MAX_PARALLEL). Waits for all to finish.",
    inputSchema: z.object({
      runs: z.array(
        z.object({
          agentKey: z.string(),
          task: z.string(),
          perspective: z.string().optional(),
        }),
      ),
    }),
    execute: async ({ runs }) => {
      const settled = await parallelMapSettled(
        runs,
        getMaxParallel(),
        async (r, i) => {
          const agent = agentRegistry.byId.get(r.agentKey);
          if (!agent) {
            throw new Error(
              `Unknown agentKey "${r.agentKey}". Available: ${[...agentRegistry.byId.keys()].join(", ")}`,
            );
          }
          const runId = `run-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
          callbacks?.onSubagentStarted?.(runId, r.agentKey, r.task);
          callbacks?.onOrchestratorLog?.(
            `[spawn] ${r.agentKey} run ${runId}`,
          );
          try {
            const text = await runSubagent({
              model: subagentModel,
              agent,
              task: r.task,
              perspective: r.perspective,
              // Keep subagent context focused; large global context can cause role drift.
              goldenExcerpt: golden.excerptForPrompt(1200),
              skillRegistry,
              workspaceRoot,
              onStepTrace: (trace) =>
                callbacks?.onSubagentStepTrace?.(runId, r.agentKey, trace),
            });
            callbacks?.onSubagentFinished?.(runId, r.agentKey, true, text);
            return {
              agentKey: r.agentKey,
              perspective: r.perspective,
              output: text,
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            callbacks?.onSubagentFinished?.(runId, r.agentKey, false, msg);
            throw e;
          }
        },
      );

      const summary = settled.map((s, i) => {
        if (s.status === "fulfilled") {
          return { ok: true as const, index: i, value: s.value };
        }
        const reason =
          s.reason instanceof Error ? s.reason.message : String(s.reason);
        return { ok: false as const, index: i, error: reason };
      });

      callbacks?.onBatchCompleted?.(summary);
      return { results: summary };
    },
  });

  const append_agent_md_section = tool({
    description:
      "Append a markdown section to .picoagent/AGENT.md for durable session memory.",
    inputSchema: z.object({
      section: z.string(),
      body: z.string(),
    }),
    execute: async ({ section, body }) => {
      await appendAgentMdSection(projectRoot, section, body);
      return { ok: true };
    },
  });

  const record_decision = tool({
    description: "Record a short decision into golden context.",
    inputSchema: z.object({
      text: z.string(),
    }),
    execute: async ({ text }) => {
      const g = golden.get();
      golden.patch({ decisions: [...g.decisions, text] });
      await golden.save();
      return { ok: true };
    },
  });

  return {
    list_agents,
    list_tasks,
    upsert_task,
    spawn_subagents,
    append_agent_md_section,
    record_decision,
  };
}

export async function runOrchestrator(opts: {
  orchestratorModel: LanguageModel;
  subagentModel: LanguageModel;
  plan: Plan;
  goal: string;
  projectRoot: string;
  workspaceRoot: string;
  agentRegistry: AgentRegistry;
  skillRegistry: SkillRegistry;
  golden: GoldenStore;
  callbacks?: OrchestratorCallbacks;
  maxOrchestratorSteps?: number;
  /** Planner was skipped (--oneshot); steer orchestrator toward direct delegation */
  skipPlanner?: boolean;
}): Promise<string> {
  const tasks = new Map<string, TaskRow>();
  seedTasksFromPlan(opts.plan, tasks);

  opts.golden.patch({
    goal: opts.goal,
    summary: opts.plan.title,
  });
  await opts.golden.save();

  opts.callbacks?.onOrchestratorStart?.();

  const agentKeys = [...opts.agentRegistry.byId.keys()].sort().join(", ");

  const tools = createOrchestratorTools({
    projectRoot: opts.projectRoot,
    workspaceRoot: opts.workspaceRoot,
    agentRegistry: opts.agentRegistry,
    skillRegistry: opts.skillRegistry,
    golden: opts.golden,
    subagentModel: opts.subagentModel,
    tasks,
    callbacks: opts.callbacks,
  });

  const system = `You are the picoagent orchestrator. You coordinate specialist subagents using tools only.
Workspace root: ${opts.workspaceRoot}
Registered subagents: ${agentKeys}

Golden context (short):\n${opts.golden.excerptForPrompt()}

Rules:
- Prefer spawn_subagents for independent research or perspectives; it runs agents concurrently (batched by PICOAGENT_MAX_PARALLEL) and waits for all results.
- Think carefully about the tasks you are delegating to the subagents and how agents depend on each other. (Example: without API research you cannot make developer agent write code for API it doesn't know about)
- If agent relies on another agent result, don't run them in parallel.
- Track tasks with upsert_task / list_tasks.
- Persist important conclusions with append_agent_md_section or record_decision.
- When delegating to spawn_subagents, each runs[].task must be a self-contained mini-brief with:
  1) What to do (exact deliverable)
  2) Why it matters (goal/risk/user intent)
  3) Context/where to look (paths, symbols, assumptions)
  4) Done criteria (how to know the task is complete)
  5) Constraints (e.g. read-only, no scope creep, output format)
- Do not send vague tasks like "investigate this" without context. Subagents should not need hidden orchestrator state to succeed.
- Prefer explicit file paths and expected outputs over generic prompts.
- When finished, respond with a concise status summary for the user.${
    opts.skipPlanner
      ? "\n\nNote: The user ran --oneshot (no planner). There is only a single high-level task — delegate aggressively with spawn_subagents and tools."
      : ""
  }`;

  const prompt = `Approved plan JSON:\n${JSON.stringify(opts.plan, null, 2)}\n\nUser goal:\n${opts.goal}\n\nExecute the plan. Use tools.`;

  const result = await generateText({
    model: opts.orchestratorModel,
    system,
    prompt,
    tools,
    stopWhen: stepCountIs(opts.maxOrchestratorSteps ?? 30),
    onStepFinish: (event) => {
      const hadToolCalls =
        (event.staticToolCalls?.length ?? 0) > 0 ||
        (event.toolCalls?.length ?? 0) > 0;
      opts.callbacks?.onOrchestratorStepFinish?.({
        stepNumber: event.stepNumber,
        finishReason: event.finishReason,
        hadToolCalls,
      });
      opts.callbacks?.onOrchestratorStepTrace?.(serializeModelStep(event));
    },
  });

  opts.callbacks?.onOrchestratorLog?.(
    `[done] finishReason=${result.finishReason}`,
  );

  return result.text;
}
