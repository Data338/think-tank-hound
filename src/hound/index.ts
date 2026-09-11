import { HoundChildClient, type HoundClientLike } from "./client.js";

let houndClient: HoundChildClient | null = null;

export function getHoundClient(): HoundClientLike | null {
  return houndClient;
}

/**
 * Start the owned Hound child. Degrades gracefully: if Hound is missing
 * or fails to handshake, the server still serves think/memory/tasks —
 * research tools are simply not registered. Misconfiguration surfaces
 * in the startup log and in the validation smoke test, not in a hang.
 */
export async function initHound(): Promise<HoundChildClient | null> {
  try {
    const client = new HoundChildClient();
    await client.connect();
    houndClient = client;
    return client;
  } catch (error) {
    console.error(
      `[ERROR] [hound] child unavailable, research tools disabled: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function closeHound(): Promise<void> {
  if (houndClient) {
    await houndClient.close();
    houndClient = null;
    console.error("[INFO] [hound] child closed");
  }
}
