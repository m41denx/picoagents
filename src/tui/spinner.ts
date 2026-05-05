/** Braille frames for terminal spinners (shared by loading + dashboard). */
export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export function spinnerAt(tick: number): string {
  const i =
    ((tick % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) %
    SPINNER_FRAMES.length;
  return SPINNER_FRAMES[i]!;
}
