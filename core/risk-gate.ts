import type { Intent } from "./types.js";
import { askYesNo } from "../utils/confirm.js";

export async function riskGate(intent: Intent): Promise<void> {
  if (intent.risk === "LOW") return;

  if (intent.risk === "MEDIUM") {
    const ok = await askYesNo("MEDIUM risk action detected. Continue?", true);
    if (!ok) throw new Error("Action rejected at risk gate.");
    return;
  }

  const first = await askYesNo("HIGH risk action detected. Continue to manual approval?", true);
  if (!first) throw new Error("Action rejected at risk gate.");
  const second = await askYesNo("Manual approval required. Confirm execution?", true);
  if (!second) throw new Error("Action rejected at manual approval.");
}

