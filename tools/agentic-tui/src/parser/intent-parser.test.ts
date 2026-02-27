import assert from "node:assert/strict";

import { parseNaturalLanguage } from "./intent-parser.js";

export type TuiTestCase = {
  name: string;
  fn: () => Promise<void> | void;
};

export const parserIntentTests: TuiTestCase[] = [
  {
    name: "casual greeting maps to status instead of unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("hello");
      assert.equal(parsed.intent.action, "status");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "capability question maps to help intent",
    fn: () => {
      const parsed = parseNaturalLanguage("what can you do");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "non-casual unmatched text still returns unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("maybe do something strange with numbers");
      assert.equal(parsed.intent.action, "unknown");
    }
  },
  {
    name: "chat input containing social hatch command maps to help",
    fn: () => {
      const parsed = parseNaturalLanguage("social hatch --verbose");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "short conversational input maps to help instead of unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("who");
      assert.equal(parsed.intent.action, "help");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "waba setup request maps to guide intent",
    fn: () => {
      const parsed = parseNaturalLanguage("waba setup");
      assert.equal(parsed.intent.action, "guide");
      assert.equal(parsed.intent.params.topic, "waba");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "auth-style request maps to setup/auth guide",
    fn: () => {
      const parsed = parseNaturalLanguage("help me configure app id and token");
      assert.equal(parsed.intent.action, "guide");
      assert.equal(parsed.intent.params.topic, "setup-auth");
      assert.equal(parsed.valid, true);
    }
  },
  {
    name: "domain command-like instagram phrasing maps to guide instead of unknown",
    fn: () => {
      const parsed = parseNaturalLanguage("social insta list accounts");
      assert.equal(parsed.intent.action, "guide");
      assert.equal(parsed.intent.params.topic, "instagram");
      assert.equal(parsed.valid, true);
    }
  }
];
