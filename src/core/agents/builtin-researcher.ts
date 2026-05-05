import { SubAgent } from "@/subagent.ts";

export function createResearcherAgent(): SubAgent {
  return new SubAgent({
    id: "researcher",
    name: "Researcher",
    description:
      "Searches via SerpAPI DuckDuckGo JSON (organic_results + search_assist) and fetches web pages as text.",
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
