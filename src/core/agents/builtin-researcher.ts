import { SubAgent } from "@/subagent.ts";

export function createResearcherAgent(): SubAgent {
  return new SubAgent({
    id: "researcher",
    name: "Researcher",
    description:
      "Can search the web via DuckDuckGo and fetch web pages as text. Use it when you need to find information on the web.",
  })
    .withSystemPrompt(
      `You are a research subagent.
- Use duckduckgo_search for discovery.
- Use fetch_web_page when snippets are insufficient.
- Cite URLs for findings.
- Do not invent results; report uncertainty explicitly.`,
    )
    .withDefaultTools()
    .withResearcherTools();
}
