import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function askYesNo(prompt: string, defaultNo = true): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultNo ? " (y/N): " : " (Y/n): ";
    const raw = (await rl.question(`${prompt}${suffix}`)).trim().toLowerCase();
    if (!raw) return !defaultNo;
    return raw === "y" || raw === "yes";
  } finally {
    rl.close();
  }
}

