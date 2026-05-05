#!/usr/bin/env bun
import { runPicoagentSession } from "@/core/session.ts";
import { parseArgs, printHelp } from "@/cli/args.ts";
import { runIterationLoop } from "@/cli/iteration-loop.ts";
import { resolveVerbose } from "@/core/observability.ts";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
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

  const verbose = resolveVerbose(args.verbose);

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

  await runIterationLoop({
    infinite: args.infinite,
    goal,
    onLog: (l) => console.error(`[session] ${l}`),
    runIteration: async (iterationGoal) => {
      if (useInk) {
        const { runTuiSession } = await import("./tui/session-app.tsx");
        const summary = await runTuiSession(
          iterationGoal,
          projectRoot,
          workspaceRoot,
          {
            oneshot: args.oneshot,
            verbose,
          },
        );
        if (summary === null) return null;
        console.log("\n--- Final summary ---\n");
        console.log(summary);
        return summary;
      }
      const result = await runPicoagentSession({
        projectRoot,
        workspaceRoot,
        goal: iterationGoal,
        skipPlanner: args.oneshot,
        autoApprovePlan: args.yes || args.oneshot,
        verbose,
        callbacks: {
          onSessionLog: (l) => console.error(`[session] ${l}`),
          onOrchestratorLog: (l) => console.error(`[orch] ${l}`),
          onOrchestratorStart: () => console.error("[orch] starting…"),
          onSubagentStarted: (id, key, task) =>
            console.error(
              `[sub ${id}] ${key}: ${verbose ? task : `${task.slice(0, 80)}…`}`,
            ),
          onSubagentFinished: (id, key, ok, text) =>
            console.error(
              `[sub ${id}] ${key} ${ok ? "ok" : "fail"}: ${verbose ? text : `${text.slice(0, 120)}…`}`,
            ),
        },
      });
      console.log("\n--- Plan ---\n");
      console.log(JSON.stringify(result.plan, null, 2));
      console.log("\n--- Orchestrator ---\n");
      console.log(result.orchestratorSummary);
      return result.orchestratorSummary;
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
