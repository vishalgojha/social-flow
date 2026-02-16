import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Intent } from "./types.js";

const STORE_FILE = path.join(os.homedir(), ".social-cli", "idempotency.json");

type IdempotencyStore = Record<string, string>;

function buildPayload(intent: Intent): string {
  return JSON.stringify({
    action: intent.action,
    target: intent.target,
    params: intent.params
  });
}

async function readStore(): Promise<IdempotencyStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw) as IdempotencyStore;
  } catch {
    return {};
  }
}

async function writeStore(store: IdempotencyStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function buildIdempotencyKey(intent: Intent): string {
  return createHash("sha256").update(buildPayload(intent)).digest("hex");
}

export async function reserveIdempotency(intent: Intent, allowReplay: boolean): Promise<string> {
  const key = buildIdempotencyKey(intent);
  if (allowReplay) return key;
  const store = await readStore();
  if (store[key]) {
    throw new Error(`Idempotency violation: duplicate action key ${key}`);
  }
  store[key] = new Date().toISOString();
  await writeStore(store);
  return key;
}

