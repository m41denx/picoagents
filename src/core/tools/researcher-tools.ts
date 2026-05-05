import axios from "axios";
import { tool, type Tool } from "ai";
import { z } from "zod";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const MAX_PAGE_BYTES = 512 * 1024;

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
      const res = await axios.get<Record<string, unknown>>(SERPAPI_BASE, {
        params: {
          engine: "duckduckgo",
          q: query,
          kl: kl ?? "us-en",
          api_key: apiKey.trim(),
        },
        timeout: 30_000,
        validateStatus: () => true,
      });
      const data = res.data;
      if (res.status < 200 || res.status >= 300) {
        const err =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : `HTTP ${res.status}`;
        return { ok: false, error: err };
      }
      if (typeof data !== "object" || data === null) {
        return { ok: false, error: "Empty or invalid JSON response" };
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
      const res = await axios.get<string>(url, {
        responseType: "text",
        timeout: 25_000,
        maxContentLength: MAX_PAGE_BYTES,
        maxBodyLength: MAX_PAGE_BYTES,
        headers: {
          "User-Agent":
            "picoagents-researcher/1.0 (compatible; +https://github.com/m41denx/picoagents)",
          Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        },
        validateStatus: () => true,
      });
      const text =
        typeof res.data === "string" ? res.data : String(res.data ?? "");
      const truncated = text.length > 80_000;
      return {
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        url,
        content: truncated ? `${text.slice(0, 80_000)}…` : text,
        truncated,
      };
    },
  });

  return { duckduckgo_search, fetch_web_page };
}
