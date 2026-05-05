import { getLanguageModel } from "@/core/model/provider.ts";
import { getModelId } from "@/core/config.ts";
import { loadSkills } from "@/core/registry/load-skills.ts";
import { loadCustomAgents, mergeRegistry } from "@/core/registry/load-agents.ts";
import { createGeneralistAgent } from "@/core/agents/builtin-generalist.ts";
import { GoldenStore } from "@/core/context/golden.ts";
import {
  buildPlannerBriefing,
  createOneshotPlan,
  runPlanner,
  type Plan,
} from "@/core/agents/planner.ts";
import { runOrchestrator, type OrchestratorCallbacks } from "@/core/agents/orchestrator.ts";

export type PicoagentSessionCallbacks = OrchestratorCallbacks & {
  onPlanReady?: (plan: Plan) => Promise<boolean>;
  onSessionLog?: (line: string) => void;
};

export type { OrchestratorCallbacks };

/** Thrown when the user declines the plan (e.g. TUI plan review). Not a fatal harness error. */
export class PlanRejectedError extends Error {
  override readonly name = "PlanRejectedError";
  constructor(message = "Plan was not approved.") {
    super(message);
  }
}

export type RunPicoagentSessionOptions = {
  projectRoot: string;
  /** Workspace files root — defaults to projectRoot */
  workspaceRoot?: string;
  goal: string;
  /** If true, approve plan without prompting */
  autoApprovePlan?: boolean;
  /** Skip planner LLM; use a single-task plan and go straight to orchestrator */
  skipPlanner?: boolean;
  callbacks?: PicoagentSessionCallbacks;
};

export type RunPicoagentSessionResult = {
  plan: Plan;
  orchestratorSummary: string;
};

export async function runPicoagentSession(
  opts: RunPicoagentSessionOptions,
): Promise<RunPicoagentSessionResult> {
  const projectRoot = opts.projectRoot;
  const workspaceRoot = opts.workspaceRoot ?? projectRoot;

  const skillRegistry = await loadSkills(projectRoot);
  const customAgents = await loadCustomAgents(projectRoot);
  const generalist = createGeneralistAgent();
  const agentRegistry = mergeRegistry(generalist, customAgents);

  const golden = await GoldenStore.load(projectRoot);

  const orchestratorModel = getLanguageModel(getModelId("orchestrator"));
  const subagentModel = getLanguageModel(getModelId("subagent"));

  let plan: Plan;
  if (opts.skipPlanner) {
    opts.callbacks?.onSessionLog?.("Skipping planner (--oneshot).");
    plan = createOneshotPlan(opts.goal);
  } else {
    const plannerModel = getLanguageModel(getModelId("planner"));
    opts.callbacks?.onSessionLog?.("Generating plan…");
    const plannerBriefing = buildPlannerBriefing(
      agentRegistry,
      skillRegistry,
      workspaceRoot,
    );
    plan = await runPlanner(plannerModel, opts.goal, {
      briefing: plannerBriefing,
    });
  }

  let approved = Boolean(opts.autoApprovePlan) || Boolean(opts.skipPlanner);
  if (!approved && opts.callbacks?.onPlanReady) {
    approved = await opts.callbacks.onPlanReady(plan);
  }
  if (!approved) {
    throw new PlanRejectedError();
  }

  opts.callbacks?.onSessionLog?.("Running orchestrator…");

  const orchestratorSummary = await runOrchestrator({
    orchestratorModel,
    subagentModel,
    plan,
    goal: opts.goal,
    projectRoot,
    workspaceRoot,
    agentRegistry,
    skillRegistry,
    golden,
    callbacks: opts.callbacks,
    skipPlanner: opts.skipPlanner,
  });

  await golden.save();

  return { plan, orchestratorSummary };
}

export type { Plan } from "@/core/agents/planner.ts";
