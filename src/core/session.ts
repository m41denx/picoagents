import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
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
import type { ModelStepTrace } from "@/core/observability.ts";
import { emitTraceLine, resolveVerbose } from "@/core/observability.ts";

export type PicoagentSessionCallbacks = OrchestratorCallbacks & {
  onPlanReady?: (plan: Plan) => Promise<boolean>;
  onSessionLog?: (line: string) => void;
  onPlannerStepTrace?: (trace: ModelStepTrace) => void;
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
  /** Rich traces on stderr + structured step callbacks (also env `PICOAGENT_VERBOSE=1`). */
  verbose?: boolean;
  callbacks?: PicoagentSessionCallbacks;
};

export type RunPicoagentSessionResult = {
  sessionId: string;
  plan: Plan;
  orchestratorSummary: string;
};

async function writeSessionArtifact(
  sessionDir: string,
  name: string,
  payload: unknown,
): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, name), JSON.stringify(payload, null, 2), "utf8");
}

const pexecFile = promisify(execFile);

async function ensurePicoagentBootstrap(
  projectRoot: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const dir = join(projectRoot, ".picoagent");
  await mkdir(dir, { recursive: true });

  const gitignorePath = join(dir, ".gitignore");
  const requiredIgnore = ["sessions", "node_modules", "bun.lock"];
  let gitignoreContent = "";
  try {
    gitignoreContent = await readFile(gitignorePath, "utf8");
  } catch {
    // create below
  }
  const existing = new Set(
    gitignoreContent
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const missing = requiredIgnore.filter((line) => !existing.has(line));
  if (missing.length > 0) {
    const next =
      (gitignoreContent.trimEnd() ? `${gitignoreContent.trimEnd()}\n` : "") +
      missing.join("\n") +
      "\n";
    await writeFile(gitignorePath, next, "utf8");
  }

  const pkgPath = join(dir, "package.json");
  try {
    await readFile(pkgPath, "utf8");
  } catch {
    const pkg = {
      name: "picoagent-local-agents",
      private: true,
      type: "module",
      dependencies: {
        picoagents: "latest",
      },
    };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }

  onLog?.("Bootstrapping .picoagent deps (bun install) …");
  await pexecFile("bun", ["install"], {
    cwd: dir,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function mergeSessionCallbacks(
  verbose: boolean,
  user?: PicoagentSessionCallbacks,
): PicoagentSessionCallbacks | undefined {
  const needOrchTrace =
    verbose || Boolean(user?.onOrchestratorStepTrace);
  const needSubTrace = verbose || Boolean(user?.onSubagentStepTrace);
  const needPlannerTrace =
    verbose || Boolean(user?.onPlannerStepTrace);

  if (!user && !verbose) return undefined;

  const base = user ?? {};
  const out: PicoagentSessionCallbacks = { ...base };

  if (needPlannerTrace) {
    out.onPlannerStepTrace = (t) => {
      base.onPlannerStepTrace?.(t);
      if (verbose) emitTraceLine("planner-step", t);
    };
  }
  if (needOrchTrace) {
    out.onOrchestratorStepTrace = (t) => {
      base.onOrchestratorStepTrace?.(t);
      if (verbose) emitTraceLine("orchestrator-step", t);
    };
  }
  if (needSubTrace) {
    out.onSubagentStepTrace = (rid, key, t) => {
      base.onSubagentStepTrace?.(rid, key, t);
      if (verbose) emitTraceLine(`subagent-step:${rid}:${key}`, t);
    };
  }

  return out;
}

export async function runPicoagentSession(
  opts: RunPicoagentSessionOptions,
): Promise<RunPicoagentSessionResult> {
  const projectRoot = opts.projectRoot;
  const workspaceRoot = opts.workspaceRoot ?? projectRoot;
  const verbose = resolveVerbose(opts.verbose);
  const sessionId = randomUUID();
  const sessionDir = join(projectRoot, ".picoagent", "sessions", sessionId);
  opts.callbacks?.onSessionLog?.(`Session: ${sessionId}`);
  await ensurePicoagentBootstrap(projectRoot, opts.callbacks?.onSessionLog);

  const skillRegistry = await loadSkills(projectRoot);
  const customAgents = await loadCustomAgents(projectRoot);
  const generalist = createGeneralistAgent();
  const agentRegistry = mergeRegistry(generalist, customAgents);

  const golden = await GoldenStore.load(projectRoot);

  const orchestratorModel = getLanguageModel(getModelId("orchestrator"));
  const subagentModel = getLanguageModel(getModelId("subagent"));

  const sessionCallbacks =
    mergeSessionCallbacks(verbose, opts.callbacks) ?? opts.callbacks;

  let plan: Plan;
  if (opts.skipPlanner) {
    sessionCallbacks?.onSessionLog?.("Skipping planner (--oneshot).");
    plan = createOneshotPlan(opts.goal);
  } else {
    const plannerModel = getLanguageModel(getModelId("planner"));
    sessionCallbacks?.onSessionLog?.("Generating plan…");
    const plannerBriefing = buildPlannerBriefing(
      agentRegistry,
      skillRegistry,
      workspaceRoot,
    );
    plan = await runPlanner(plannerModel, opts.goal, {
      briefing: plannerBriefing,
      workspaceRoot,
      onPlannerStepTrace: sessionCallbacks?.onPlannerStepTrace,
    });
  }

  let approved = Boolean(opts.autoApprovePlan) || Boolean(opts.skipPlanner);
  if (!approved && opts.callbacks?.onPlanReady) {
    approved = await opts.callbacks.onPlanReady(plan);
  }
  if (!approved) {
    await writeSessionArtifact(sessionDir, "plan.json", plan);
    await writeSessionArtifact(sessionDir, "golden.json", golden.get());
    throw new PlanRejectedError();
  }

  await writeSessionArtifact(sessionDir, "plan.json", plan);
  sessionCallbacks?.onSessionLog?.("Running orchestrator…");

  let orchestratorSummary = "";
  try {
    orchestratorSummary = await runOrchestrator({
      orchestratorModel,
      subagentModel,
      plan,
      goal: opts.goal,
      projectRoot,
      workspaceRoot,
      agentRegistry,
      skillRegistry,
      golden,
      callbacks: sessionCallbacks,
      skipPlanner: opts.skipPlanner,
    });
  } finally {
    await writeSessionArtifact(sessionDir, "golden.json", golden.get());
  }

  if (verbose) {
    emitTraceLine("orchestrator-final", { text: orchestratorSummary });
  }

  await golden.save();

  return { sessionId, plan, orchestratorSummary };
}

export type { Plan } from "@/core/agents/planner.ts";
