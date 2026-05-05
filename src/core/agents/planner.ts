import { generateText, Output, zodSchema } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";

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

export async function runPlanner(model: LanguageModel, goal: string): Promise<Plan> {
  const result = await generateText({
    model,
    system: `You are a planning agent. Produce a concise, actionable plan as structured output.
Use clear task ids (kebab-case). Respect dependencies via dependsOn when tasks must be ordered.
Keep phases small; prefer parallelizable tasks when safe.`,
    prompt: `Goal / request:\n${goal}`,
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
