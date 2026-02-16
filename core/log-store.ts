import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ActionLog } from "./types.js";

const LOG_DIR = path.join(process.cwd(), "logs");

async function ensureDir(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

export async function writeLog(entry: Omit<ActionLog, "id">): Promise<ActionLog> {
  await ensureDir();
  const record: ActionLog = { id: randomUUID(), ...entry };
  const file = path.join(LOG_DIR, `${record.id}.json`);
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export async function listLogs(): Promise<ActionLog[]> {
  await ensureDir();
  const files = await fs.readdir(LOG_DIR);
  const logs: ActionLog[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(LOG_DIR, f), "utf8");
      logs.push(JSON.parse(raw) as ActionLog);
    } catch {}
  }
  logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return logs;
}

export async function readLogById(id: string): Promise<ActionLog> {
  await ensureDir();
  const raw = await fs.readFile(path.join(LOG_DIR, `${id}.json`), "utf8");
  return JSON.parse(raw) as ActionLog;
}

