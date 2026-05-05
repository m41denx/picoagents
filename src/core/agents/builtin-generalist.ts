import { SubAgent } from "../../subagent.ts";

export function createGeneralistAgent(): SubAgent {
  return new SubAgent({
    id: "generalist",
    name: "Generalist",
    description:
      "Reads and searches the workspace, summarizes findings, and updates shared notes via orchestrator tools when spawned from orchestrator only.",
  }).withSystemPrompt(
    `You are a careful engineering subagent working inside a single workspace.
Use tools to inspect files and directories; cite paths when reporting conclusions.
When unsure, say what you checked and what remains unknown.`,
  );
}
