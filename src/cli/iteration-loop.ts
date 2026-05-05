import { generateText, stepCountIs } from "ai";
import { getModelId } from "@/core/config.ts";
import { getLanguageModel } from "@/core/model/provider.ts";

export function buildIterationGoal(baseGoal: string, prior: string[]): string {
  if (prior.length === 0) return baseGoal;
  const lines = prior.slice(-12).map((s, i) => `${i + 1}. ${s}`);
  return `${baseGoal}

Previous iteration outcomes (oldest -> newest):
${lines.join("\n")}

Use these as historical context only. Continue improving toward the original goal.`;
}

export async function summarizeIteration(
  orchestratorSummary: string,
): Promise<string> {
  const model = getLanguageModel(getModelId("orchestrator"));
  const result = await generateText({
    model,
    system:
      "You compress iteration output into one compact handoff line for future runs.",
    prompt: `Summarize this orchestrator output in 1-2 sentences with concrete outcomes and unresolved items:\n\n${orchestratorSummary}`,
    stopWhen: stepCountIs(2),
  });
  const text = result.text.replace(/\s+/g, " ").trim();
  return text || "Iteration completed (no summary text).";
}

export async function runIterationLoop(opts: {
  infinite: boolean;
  goal: string;
  onLog: (line: string) => void;
  runIteration: (goal: string, iteration: number) => Promise<string | null>;
}): Promise<void> {
  let stopRequested = false;
  let forceRequested = false;
  const priorIterationSummaries: string[] = [];
  const onSigint = () => {
    if (!stopRequested) {
      stopRequested = true;
      opts.onLog(
        "Ctrl+C received. Will stop after current iteration finishes (press Ctrl+C again to force quit).",
      );
      return;
    }
    if (!forceRequested) {
      forceRequested = true;
      opts.onLog("Force quitting now.");
      process.exit(130);
    }
  };
  process.on("SIGINT", onSigint);

  try {
    let iteration = 0;
    while (true) {
      if (stopRequested && opts.infinite) break;
      iteration += 1;
      const iterationGoal = opts.infinite
        ? buildIterationGoal(opts.goal, priorIterationSummaries)
        : opts.goal;
      opts.onLog(
        `Iteration ${iteration}${opts.infinite ? " (infinite mode)" : ""}`,
      );
      const summary = await opts.runIteration(iterationGoal, iteration);
      if (summary === null) break;
      if (!opts.infinite) break;
      const short = await summarizeIteration(summary);
      priorIterationSummaries.push(short);
      opts.onLog(`Iteration ${iteration} summary: ${short}`);
      if (stopRequested) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
  }
}
