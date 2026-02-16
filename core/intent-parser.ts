import type { Intent } from "./types.js";
import { validateIntentSchema } from "./intent-schema.js";

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseNaturalLanguageToIntent(input: string): Intent {
  const raw = String(input || "").trim();
  const text = normalize(raw);

  if (text === "get my profile" || text === "get facebook profile" || text === "get my facebook profile") {
    const intent: Intent = {
      action: "get",
      target: "profile",
      params: { fields: "id,name" },
      risk: "LOW"
    };
    validateIntentSchema(intent);
    return intent;
  }

  const createPost = raw.match(/^create post "(.*)"(?: page ([a-z0-9_]+))?$/i);
  if (createPost) {
    const intent: Intent = {
      action: "create",
      target: "post",
      params: {
        message: createPost[1],
        pageId: createPost[2] || ""
      },
      risk: "MEDIUM"
    };
    validateIntentSchema(intent);
    return intent;
  }

  const adsList = text.match(/^list ads(?: account ([a-z0-9_]+))?$/i);
  if (adsList) {
    const intent: Intent = {
      action: "list",
      target: "ads",
      params: { adAccountId: adsList[1] || "" },
      risk: "LOW"
    };
    validateIntentSchema(intent);
    return intent;
  }

  throw new Error("Unable to parse intent deterministically. Use an explicit supported phrase.");
}
