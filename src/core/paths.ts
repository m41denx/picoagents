import { relative, resolve } from "path";

export function safeResolveUnder(root: string, userPath: string): string {
  const absRoot = resolve(root);
  const target = resolve(absRoot, userPath);
  const rel = relative(absRoot, target);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return target;
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
