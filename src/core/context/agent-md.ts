import { mkdir } from "fs/promises";
import { join } from "path";

const DEFAULT = `# AGENT.md — picoagent session memory

## Goal

## Decisions

## Facts / assumptions

## Open questions

## Paths touched
`;

export async function readAgentMd(projectRoot: string): Promise<string> {
  const p = join(projectRoot, ".picoagent", "AGENT.md");
  const f = Bun.file(p);
  if (await f.exists()) return f.text();
  return DEFAULT;
}

export async function appendAgentMdSection(
  projectRoot: string,
  section: string,
  body: string,
): Promise<void> {
  const dir = join(projectRoot, ".picoagent");
  await mkdir(dir, { recursive: true });
  const p = join(dir, "AGENT.md");
  let cur = DEFAULT;
  const f = Bun.file(p);
  if (await f.exists()) cur = await f.text();
  const stamp = new Date().toISOString();
  const block = `\n\n### ${section} (${stamp})\n\n${body}\n`;
  await Bun.write(p, cur + block);
}
