import type { ActionType } from "../types.js";

export type DomainSkillId =
  | "setup-auth"
  | "facebook"
  | "instagram"
  | "waba"
  | "marketing"
  | "general";

export type DomainSkillProfile = {
  id: DomainSkillId;
  name: string;
  purpose: string;
  suggestions: string[];
};

const DOMAIN_SKILLS: Record<DomainSkillId, DomainSkillProfile> = {
  "setup-auth": {
    id: "setup-auth",
    name: "Setup/Auth",
    purpose: "I can guide token, app credentials, and onboarding checks step by step.",
    suggestions: [
      "social setup",
      "social auth login -a facebook",
      "social doctor"
    ]
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    purpose: "I can help with Page profile checks, posting, and Facebook Graph actions.",
    suggestions: [
      "get my facebook profile",
      "create post \"hello\" page 12345",
      "social facebook pages --table"
    ]
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    purpose: "I can guide Instagram account/media publish and insights flows.",
    suggestions: [
      "social insta accounts list",
      "social instagram media --help",
      "/ai list instagram media"
    ]
  },
  waba: {
    id: "waba",
    name: "WhatsApp/WABA",
    purpose: "I can guide WhatsApp Cloud API setup, template sends, and webhook checks.",
    suggestions: [
      "social integrations connect waba",
      "social waba send --from PHONE_ID --to +15551234567 --body \"Hello\"",
      "social waba send --help",
      "/ai send whatsapp test to +15551234567"
    ]
  },
  marketing: {
    id: "marketing",
    name: "Marketing API",
    purpose: "I can help with ad accounts, campaign listing, and ads diagnostics.",
    suggestions: [
      "list ads account act_123",
      "social marketing accounts",
      "/ai show active campaigns for act_123"
    ]
  },
  general: {
    id: "general",
    name: "General",
    purpose: "I can route your request to the right domain skill automatically.",
    suggestions: [
      "status",
      "doctor",
      "what can you do"
    ]
  }
};

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function detectDomainSkill(input: string, action: ActionType): DomainSkillProfile {
  const text = String(input || "").trim().toLowerCase();
  const hasPhoneNumber = /\+?\d[\d -]{7,}\d/.test(text);
  const hasMessageVerb = hasAny(text, ["send", "msg", "message", "text", "ping"]);
  const hasWabaLanguage = hasAny(text, ["whatsapp", " waba", "waba ", "template", "phone number id", "webhook"]);

  // Explicit WhatsApp cues should override any action misclassification from parser/AI.
  if (hasWabaLanguage || (hasPhoneNumber && hasMessageVerb)) {
    return DOMAIN_SKILLS.waba;
  }

  if (hasAny(text, ["instagram", " insta", "insta ", " ig ", "reel", "story"])) {
    return DOMAIN_SKILLS.instagram;
  }

  if (hasAny(text, ["marketing", "campaign", "adset", "ad set", "creative", "spend", " act_"])) {
    return DOMAIN_SKILLS.marketing;
  }

  if (hasAny(text, ["facebook", "fb ", " page", "graph api"])) {
    return DOMAIN_SKILLS.facebook;
  }

  if (hasAny(text, ["setup", "onboard", "auth", "token", "app id", "app secret", "credential", "login"])) {
    return DOMAIN_SKILLS["setup-auth"];
  }

  if (action === "onboard") return DOMAIN_SKILLS["setup-auth"];
  if (action === "create_post" || action === "get_profile") return DOMAIN_SKILLS.facebook;
  if (action === "list_ads") return DOMAIN_SKILLS.marketing;

  return DOMAIN_SKILLS.general;
}
