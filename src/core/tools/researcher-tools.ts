import { tool, type Tool } from "ai";
import { z } from "zod";

const SERPAPI_BASE = "https://serpapi.com/search.json";

export type ResearcherToolOptions = {
  /** Override default process.env.SERPAPI_API_KEY */
  serpApiKey?: string;
};

/**
 * Web research via SerpAPI DuckDuckGo engine + raw HTTP fetch for pages (no third-party reader API).
 */
export function createResearcherTools(opts?: ResearcherToolOptions): Record<string, Tool> {
  const duckduckgo_search = tool({
    description:
      "Search the web via SerpAPI DuckDuckGo JSON API. Returns organic results and search_assist when present. Requires SERPAPI_API_KEY.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      kl: z
        .string()
        .optional()
        .describe("Region/language kl param, e.g. us-en"),
    }),
    execute: async ({ query, kl }) => {
      const apiKey = opts?.serpApiKey ?? process.env["SERPAPI_API_KEY"];
      if (!apiKey?.trim()) {
        throw new Error(
          "Missing SERPAPI_API_KEY — set env or pass serpApiKey when creating tools.",
        );
      }
      const params = new URLSearchParams({
        engine: "duckduckgo",
        q: query,
        kl: kl ?? "us-en",
        api_key: apiKey.trim(),
      });
      let res: Response;
      try {
        res = await fetch(`${SERPAPI_BASE}?${params}`, {
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        return { ok: false, error: String(e) };
      }
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Empty or invalid JSON response" };
      }
      if (!res.ok) {
        const err =
          data && "error" in data
            ? String(data["error"])
            : `HTTP ${res.status}`;
        return { ok: false, error: err };
      }
      const organic = Array.isArray(data["organic_results"])
        ? (data["organic_results"] as unknown[])
        : [];
      const normalized = organic.slice(0, 15).map((row) => {
        if (!row || typeof row !== "object") return row;
        const o = row as Record<string, unknown>;
        return {
          title: o["title"],
          link: o["link"],
          snippet: o["snippet"],
        };
      });
      const searchAssist = data["search_assist"];
      return {
        ok: true,
        query,
        organic_results: normalized,
        search_assist: searchAssist ?? null,
        raw_keys: Object.keys(data),
      };
    },
  });

  const fetch_web_page = tool({
    description:
      "Fetch a public URL over HTTPS/HTTP and return response body as text (truncated). No API key; may fail on bot-protected sites.",
    inputSchema: z.object({
      url: z.string().url().describe("http(s) URL to GET"),
    }),
    execute: async ({ url }) => {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("Only http/https URLs are allowed");
      }
      let res: Response;
      try {
        res = await fetch(url, {
          signal: AbortSignal.timeout(25_000),
          headers: {
            "User-Agent":
              "picoagents-researcher/1.0 (compatible; +https://github.com/m41denx/picoagents)",
            Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
          },
        });
      } catch (e) {
        return { ok: false, status: 0, url, content: String(e), truncated: false };
      }
      const text = await res.text();
      const truncated = text.length > 80_000;
      return {
        ok: res.ok,
        status: res.status,
        url,
        content: truncated ? `${text.slice(0, 80_000)}…` : text,
        truncated,
      };
    },
  });

  return { duckduckgo_search, fetch_web_page };
}
