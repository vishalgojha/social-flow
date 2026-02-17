const assert = require('node:assert/strict');
const { resolveIntentDecision } = require('../lib/chat/intent-engine');

module.exports = [
  {
    name: 'intent engine returns structured clarification for unknown intent',
    fn: async () => {
      const res = await resolveIntentDecision({
        userInput: 'random unmatched words',
        parseIntent: async () => ({ action: 'unknown_input', confidence: 0.1 }),
        isSupportedTool: () => false,
        validateIntent: async () => ({ valid: false, suggestions: [] }),
        onValidIntent: () => ({ actions: [] })
      });
      assert.equal(res.needsInput, true);
      assert.equal(Array.isArray(res.clarificationChoices), true);
      assert.equal(res.clarificationChoices.length > 0, true);
    }
  },
  {
    name: 'intent engine returns validation question when required fields are missing',
    fn: async () => {
      const res = await resolveIntentDecision({
        userInput: 'create campaign',
        parseIntent: async () => ({ action: 'create_campaign', confidence: 0.9 }),
        isSupportedTool: () => true,
        validateIntent: async () => ({
          valid: false,
          suggestions: ['Need budget', 'Need objective']
        }),
        onValidIntent: () => ({ actions: [] })
      });
      assert.equal(res.needsInput, true);
      assert.equal(res.message, 'Need budget');
    }
  }
];
