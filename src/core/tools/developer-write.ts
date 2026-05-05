import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { safeResolveUnder, toPosix } from "@/core/paths.ts";

const MAX_WRITE_BYTES = 2 * 1024 * 1024;

/**
 * Safe file creation under workspace (no shell). For the **developer** subagent.
 */
export function createDeveloperWorkspaceTools(workspaceRoot: string): Record<string, Tool> {
  const ensure_dir = tool({
    description:
      "Create a directory under the workspace (including parent segments). Idempotent.",
    inputSchema: z.object({
      path: z.string().describe("Relative path from workspace root"),
    }),
    execute: async ({ path }) => {
      const abs = safeResolveUnder(workspaceRoot, path);
      await mkdir(abs, { recursive: true });
      return { ok: true, path: toPosix(path) };
    },
  });

  const write_file = tool({
    description:
      "Write UTF-8 text to a file under the workspace. Optionally creates parent directories.",
    inputSchema: z.object({
      path: z.string().describe("Relative path from workspace root"),
      content: z.string().describe("Full file contents"),
      create_parent_dirs: z
        .boolean()
        .optional()
        .describe("If true, mkdir -p parent dirs before write (default true)"),
    }),
    execute: async ({ path, content, create_parent_dirs = true }) => {
      const buf = Buffer.from(content, "utf8");
      if (buf.length > MAX_WRITE_BYTES) {
        throw new Error(
          `Content too large (${buf.length} bytes, max ${MAX_WRITE_BYTES})`,
        );
      }
      const abs = safeResolveUnder(workspaceRoot, path);
      if (create_parent_dirs) {
        await mkdir(dirname(abs), { recursive: true });
      }
      await writeFile(abs, content, "utf8");
      return { ok: true, path: toPosix(path), bytesWritten: buf.length };
    },
  });

  return { ensure_dir, write_file };
}
