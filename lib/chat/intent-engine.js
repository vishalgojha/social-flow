const INTENT_CUE_RE = /\b(me|profile|who am i|pages?|post|publish|instagram|facebook|whatsapp|campaigns?|ads?|insights?|analytics|rate\s*limit|token|auth|webhook|launch|schedule|send|message)\b/i;

const DEFAULT_CLARIFICATION_CHOICES = [
  { label: 'Show my Facebook pages', prompt: 'show my facebook pages' },
  { label: 'Check auth status', prompt: 'check auth status for this profile' },
  { label: 'Check rate limits', prompt: 'check my rate limit' },
  { label: 'Debug a token', prompt: 'debug token' },
  { label: 'List webhook subscriptions', prompt: 'list webhook subscriptions' },
  { label: 'Send a WhatsApp message', prompt: 'send whatsapp message "+14155550123" "hello"' }
];

function uniq(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach((x) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function shouldAskClarification(text, intent) {
  const raw = String(text || '').trim();
  if (!raw || !intent || intent.action !== 'query_me') return false;

  const confidence = Number(intent.confidence || 0);
  const hasCue = INTENT_CUE_RE.test(raw);
  const wordCount = raw.split(/\s+/).filter(Boolean).length;

  if (!hasCue && confidence < 0.7) return true;
  if (!hasCue && wordCount <= 2) return true;
  return false;
}

function scoreClarificationChoice(text, choice) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return 0;
  const label = String(choice?.label || '').toLowerCase();
  const prompt = String(choice?.prompt || '').toLowerCase();
  const tokens = raw.split(/[^a-z0-9+]+/).filter((x) => x.length > 2);
  let score = 0;
  tokens.forEach((t) => {
    if (label.includes(t)) score += 2;
    if (prompt.includes(t)) score += 3;
  });
  return score;
}

function buildClarificationDecision(userInput, reason = 'unknown', choices = DEFAULT_CLARIFICATION_CHOICES) {
  const ranked = choices
    .map((choice) => ({ choice, score: scoreClarificationChoice(userInput, choice) }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.choice);
  const fallback = choices.filter((x) => !ranked.some((r) => r.prompt === x.prompt));
  const selected = [...ranked, ...fallback].slice(0, 3);
  const suggestions = selected.map((c, i) => `${i + 1}. ${c.label}`);
  suggestions.push('Reply with 1, 2, or 3. You can also type your request in plain English.');

  const reasonText = reason === 'ambiguous'
    ? 'That was ambiguous, so I paused before executing anything.'
    : 'I could not map that confidently, so I paused before executing anything.';

  return {
    message: `${reasonText} Did you mean one of these?`,
    actions: [],
    needsInput: true,
    suggestions,
    clarificationChoices: selected
  };
}

async function resolveIntentDecision({
  userInput,
  parseIntent,
  isSupportedTool,
  validateIntent,
  onValidIntent,
  clarificationChoices = DEFAULT_CLARIFICATION_CHOICES,
  unknownSuggestions = [],
  ambiguousSuggestions = []
}) {
  const intent = await parseIntent(userInput);
  if (!intent || !intent.action || intent.action === 'unknown_input' || !isSupportedTool(intent.action)) {
    const clarification = buildClarificationDecision(userInput, 'unknown', clarificationChoices);
    return {
      ...clarification,
      suggestions: uniq([...(clarification.suggestions || []), ...(unknownSuggestions || [])])
    };
  }
  if (shouldAskClarification(userInput, intent)) {
    const clarification = buildClarificationDecision(userInput, 'ambiguous', clarificationChoices);
    return {
      ...clarification,
      suggestions: uniq([...(clarification.suggestions || []), ...(ambiguousSuggestions || [])])
    };
  }

  const validation = await validateIntent(intent);
  if (!validation.valid) {
    const question = validation.suggestions[0] || 'I need a bit more detail before I can execute that.';
    return {
      message: question,
      actions: [],
      needsInput: true,
      suggestions: validation.suggestions.slice(1, 3)
    };
  }
  return onValidIntent(intent);
}

module.exports = {
  DEFAULT_CLARIFICATION_CHOICES,
  buildClarificationDecision,
  resolveIntentDecision
};
