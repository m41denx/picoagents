#!/usr/bin/env bun
import { runPicoagentSession } from "@/core/session.ts";
import { resolve } from "node:path";

function parseArgs(argv: string[]) {
  const out: {
    projectRoot: string;
    workspaceRoot?: string;
    goal?: string;
    yes: boolean;
    oneshot: boolean;
    headless: boolean;
    smoke: boolean;
    help: boolean;
  } = {
    projectRoot: process.cwd(),
    yes: false,
    oneshot: false,
    headless: false,
    smoke: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--oneshot") out.oneshot = true;
    else if (a === "--headless") out.headless = true;
    else if (a === "--smoke") out.smoke = true;
    else if (a === "--project-root" && argv[i + 1]) {
      out.projectRoot = resolve(argv[++i]!);
    } else if (a === "--workspace" && argv[i + 1]) {
      out.workspaceRoot = resolve(argv[++i]!);
    } else if (a === "--goal" && argv[i + 1]) {
      out.goal = argv[++i];
    } else if (!a.startsWith("-") && !out.goal) {
      out.goal = a;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`picoagents — Bun + AI SDK subagent harness

Usage:
  picoagents [--project-root <dir>] [--workspace <dir>] [--goal <text>] [--yes] [--oneshot] [--headless]
  picoagents --smoke

Flags:
  --oneshot   Skip planner; single-task plan and go straight to orchestrator

Environment:
  OPENAI_BASE_URL             OpenAI-compatible API base (default LM Studio)
  OPENAI_API_KEY              API key (dummy ok for local)
  PICOAGENT_MODEL             Default model id for all roles
  PICOAGENT_MODEL_PLANNER     Planner model id (optional override)
  PICOAGENT_MODEL_ORCHESTRATOR
  PICOAGENT_MODEL_SUBAGENT
  PICOAGENT_MAX_PARALLEL      Subagent concurrency (default 3)
  PICOAGENT_ALLOW_SHELL=1     Enable run_command for the built-in generalist
  PICOAGENT_SKILL_BODY_MAX_CHARS  Max skill body size from readSkill
`);
    process.exit(0);
  }

  if (args.smoke) {
    await import("./smoke.ts");
    return;
  }

  const goal = args.goal?.trim();
  if (!goal) {
    console.error("Missing --goal <text> or positional goal.");
    process.exit(1);
  }

  const tty = process.stdout.isTTY && process.stdin.isTTY;
  const useInk = tty && !args.headless;

  if (!useInk && !args.yes && !args.oneshot) {
    console.error(
      "Non-interactive mode: pass --yes to auto-approve the plan, or --oneshot to skip planning.",
    );
    process.exit(1);
  }

  const projectRoot = args.projectRoot;
  const workspaceRoot = args.workspaceRoot ?? projectRoot;

  if (useInk) {
    const { runTuiSession } = await import("./tui/session-app.tsx");
    const summary = await runTuiSession(goal, projectRoot, workspaceRoot, {
      oneshot: args.oneshot,
    });
    console.log("\n--- Final summary ---\n");
    console.log(summary);
    return;
  }

  const result = await runPicoagentSession({
    projectRoot,
    workspaceRoot,
    goal,
    skipPlanner: args.oneshot,
    autoApprovePlan: args.yes || args.oneshot,
    callbacks: {
      onSessionLog: (l) => console.error(`[session] ${l}`),
      onOrchestratorLog: (l) => console.error(`[orch] ${l}`),
      onOrchestratorStart: () => console.error("[orch] starting…"),
      onSubagentStarted: (id, key, task) =>
        console.error(`[sub ${id}] ${key}: ${task.slice(0, 80)}…`),
      onSubagentFinished: (id, key, ok, text) =>
        console.error(`[sub ${id}] ${key} ${ok ? "ok" : "fail"}: ${text.slice(0, 120)}…`),
    },
  });

  console.log("\n--- Plan ---\n");
  console.log(JSON.stringify(result.plan, null, 2));
  console.log("\n--- Orchestrator ---\n");
  console.log(result.orchestratorSummary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
