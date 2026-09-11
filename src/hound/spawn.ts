import { execFileSync } from "node:child_process";

/**
 * Resolve the Hound binary for the owned-child integration.
 *
 * Order: HOUND_BIN env → `hound` on PATH → fail with a clear message.
 * The production install must stay untouched: point HOUND_BIN at the
 * isolated copy (~/tools/hound-integration/.venv/bin/hound).
 */
export function resolveHoundBin(): string {
  const explicit = process.env.HOUND_BIN?.trim();
  if (explicit) return explicit;
  try {
    const found = execFileSync("which", ["hound"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split("\n")[0]?.trim();
    if (found) {
      console.error(`[INFO] [hound] HOUND_BIN unset, using PATH binary: ${found}`);
      return found;
    }
  } catch {
    // fall through to the fatal error below
  }
  throw new Error(
    "Hound binary not found. Set HOUND_BIN to the isolated copy " +
      "(e.g. /home/korolev/tools/hound-integration/.venv/bin/hound). " +
      "The production ~/.local/bin/hound install must stay untouched."
  );
}

/**
 * Smoke test: `hound -v` must exit 0. Fails fast with a clear message
 * instead of hanging the MCP handshake later.
 */
export function smokeTestHound(bin: string, timeoutMs = 15000): string {
  try {
    const out = execFileSync(bin, ["-v"], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = out.split("\n").find((l) => l.includes("v"))?.trim() ?? "unknown";
    console.error(`[INFO] [hound] smoke OK (${bin} ${version})`);
    return version;
  } catch (error) {
    throw new Error(
      `Hound smoke test failed for ${bin}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
