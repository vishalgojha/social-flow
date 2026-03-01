import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TuiTestCase } from "../parser/intent-parser.test.js";
import { loadHatchMemory, saveHatchMemory } from "./tui-session-actions.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function withIsolatedCliHome(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "social-flow-hatch-test-"));
  const prev = process.env.SOCIAL_CLI_HOME;
  process.env.SOCIAL_CLI_HOME = root;
  try {
    await fn(root);
  } finally {
    if (typeof prev === "string") process.env.SOCIAL_CLI_HOME = prev;
    else delete process.env.SOCIAL_CLI_HOME;
    await rm(root, { recursive: true, force: true });
  }
}

export const sessionActionTests: TuiTestCase[] = [
  {
    name: "hatch memory saves and loads scoped session/profile files",
    fn: async () => {
      await withIsolatedCliHome(async (root) => {
        await saveHatchMemory({
          sessionId: "hatch_session_one",
          profileName: "Vishal",
          lastIntents: [{ at: "2026-03-01T00:00:00.000Z", text: "status", action: "status" }],
          unresolved: [{ at: "2026-03-01T00:00:01.000Z", text: "doctor failed", reason: "execution_failed" }],
          turns: [{ id: "t1", at: "2026-03-01T00:00:00.000Z", role: "user", text: "hello" }]
        }, { profileId: "default" });

        const hatchRoot = path.join(root, ".social-cli", "hatch");
        assert.equal(await exists(path.join(hatchRoot, "sessions", "hatch_session_one.json")), true);
        assert.equal(await exists(path.join(hatchRoot, "profiles", "default.json")), true);
        assert.equal(await exists(path.join(hatchRoot, "index.json")), true);

        const loaded = await loadHatchMemory({ profileId: "default" });
        assert.ok(loaded);
        assert.equal(loaded?.sessionId, "hatch_session_one");
        assert.equal(loaded?.profileName, "Vishal");
        assert.equal(loaded?.lastIntents[0]?.action, "status");
        assert.equal(loaded?.turns[0]?.text, "hello");
      });
    }
  },
  {
    name: "hatch memory remains isolated per profile",
    fn: async () => {
      await withIsolatedCliHome(async () => {
        await saveHatchMemory({
          sessionId: "profile_a_s1",
          profileName: "Alice",
          lastIntents: [{ at: "2026-03-01T00:00:00.000Z", text: "status", action: "status" }],
          unresolved: [],
          turns: [{ id: "ta1", at: "2026-03-01T00:00:00.000Z", role: "user", text: "hi" }]
        }, { profileId: "team_a" });
        await saveHatchMemory({
          sessionId: "profile_b_s1",
          profileName: "Bob",
          lastIntents: [{ at: "2026-03-01T00:00:00.000Z", text: "doctor", action: "doctor" }],
          unresolved: [],
          turns: [{ id: "tb1", at: "2026-03-01T00:00:00.000Z", role: "user", text: "hello" }]
        }, { profileId: "team_b" });

        const teamA = await loadHatchMemory({ profileId: "team_a" });
        const teamB = await loadHatchMemory({ profileId: "team_b" });
        assert.equal(teamA?.profileName, "Alice");
        assert.equal(teamA?.sessionId, "profile_a_s1");
        assert.equal(teamB?.profileName, "Bob");
        assert.equal(teamB?.sessionId, "profile_b_s1");
      });
    }
  },
  {
    name: "legacy hatch memory file is migrated to scoped storage",
    fn: async () => {
      await withIsolatedCliHome(async (root) => {
        const hatchRoot = path.join(root, ".social-cli", "hatch");
        await mkdir(hatchRoot, { recursive: true });
        await writeFile(path.join(hatchRoot, "memory.json"), JSON.stringify({
          sessionId: "legacy_session",
          updatedAt: "2026-03-01T00:00:00.000Z",
          profileName: "Legacy User",
          lastIntents: [{ at: "2026-03-01T00:00:00.000Z", text: "status", action: "status" }],
          unresolved: [{ at: "2026-03-01T00:00:00.000Z", text: "needs setup", reason: "intent_unresolved" }],
          turns: [{ id: "legacy_t1", at: "2026-03-01T00:00:00.000Z", role: "assistant", text: "welcome back" }]
        }, null, 2), "utf8");

        const loaded = await loadHatchMemory({ profileId: "legacy" });
        assert.ok(loaded);
        assert.equal(loaded?.sessionId, "legacy_session");
        assert.equal(loaded?.profileName, "Legacy User");
        assert.equal(loaded?.turns[0]?.text, "welcome back");

        assert.equal(await exists(path.join(hatchRoot, "sessions", "legacy_session.json")), true);
        assert.equal(await exists(path.join(hatchRoot, "profiles", "legacy.json")), true);
        assert.equal(await exists(path.join(hatchRoot, "index.json")), true);
        assert.equal(await exists(path.join(hatchRoot, "memory.legacy.json")), true);
      });
    }
  }
];

