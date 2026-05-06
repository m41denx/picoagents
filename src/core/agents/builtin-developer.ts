import { SubAgent } from "@/subagent.ts";

export function createDeveloperAgent(): SubAgent {
  return new SubAgent({
    id: "developer",
    name: "Developer",
    description: "Creates and edits files under the workspace via write_file / ensure_dir (no shell).",
  })
    .withSystemPrompt(
      `You are a developer subagent.
- Implement requested code/file changes directly.
- Prefer small, reviewable edits and keep scope tight.
- Use read/search tools before overwriting when uncertain.
- Summarize changed paths in the final response.`,
    )
    .withDefaultTools()
    .withDeveloperWriteTools();
}
