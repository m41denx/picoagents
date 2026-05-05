import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { SubAgent } from "@/subagent.ts";
import type { SkillRegistry } from "@/core/registry/load-skills.ts";
import { createWorkspaceTools } from "@/core/tools/workspace.ts";
import { createReadSkillTool } from "@/core/tools/read-skill-tool.ts";
import type { ModelStepTrace } from "@/core/observability.ts";
import { serializeModelStep } from "@/core/observability.ts";

export type RunSubagentParams = {
  model: LanguageModel;
  agent: SubAgent;
  task: string;
  perspective?: string;
  goldenExcerpt: string;
  skillRegistry: SkillRegistry;
  workspaceRoot: string;
  maxSteps?: number;
  /** Emitted after each model step (tools + text). */
  onStepTrace?: (trace: ModelStepTrace) => void;
};

export async function runSubagent({
  model,
  agent,
  task,
  perspective,
  goldenExcerpt,
  skillRegistry,
  workspaceRoot,
  maxSteps = 14,
  onStepTrace,
}: RunSubagentParams): Promise<string> {
  const menu = skillRegistry.menuBlock(agent);
  const allowed = skillRegistry.visibleSkillNames(agent);
  const readSkill = createReadSkillTool(skillRegistry, allowed);

  const useWorkspace =
    agent.meta.id === "generalist" || agent.includeDefaultWorkspaceTools;
  const ws = useWorkspace ? createWorkspaceTools(workspaceRoot) : {};

  const mergedTools: Record<string, unknown> = {
    ...ws,
    ...(agent.tools as Record<string, unknown>),
    readSkill,
  };

  const sysParts = [
    agent.systemPrompt,
    "",
    menu,
    "",
    "Use the read_skill tool when you need full instructions from a skill.",
  ];

  const userParts = [
    `Golden context (short):\n${goldenExcerpt || "(none)"}`,
    perspective ? `Perspective / angle:\n${perspective}` : "",
    `Task:\n${task}`,
  ].filter(Boolean);

  const system = sysParts.join("\n");
  const prompt = userParts.join("\n\n");

  const result = await generateText({
    model,
    system,
    prompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: mergedTools as any,
    stopWhen: stepCountIs(maxSteps),
    onStepFinish: (event) => {
      onStepTrace?.(serializeModelStep(event));
    },
  });

  return result.text || "(no text)";
}
