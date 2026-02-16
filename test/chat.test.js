const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConversationContext } = require('../lib/chat/context');
const { PersistentMemory } = require('../lib/chat/memory');
const { AutonomousAgent } = require('../lib/chat/agent');

module.exports = [
  {
    name: 'chat context stores facts and pending actions',
    fn: () => {
      const ctx = new ConversationContext();
      ctx.addMessage('user', "Launch product called SuperWidget tomorrow on Facebook and Instagram");
      ctx.setPendingActions([{ tool: 'query_me', params: {} }]);

      const summary = ctx.getSummary();
      assert.equal(summary.pendingActions, 1);
      assert.equal(summary.facts.productName, 'SuperWidget');
      assert.equal(summary.facts.launchDateHint, 'tomorrow');
      assert.equal(summary.facts.channels.includes('facebook'), true);
      assert.equal(summary.facts.channels.includes('instagram'), true);
    }
  },
  {
    name: 'chat memory saves and loads session payload',
    fn: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-chat-test-'));
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = tmp;
      try {
        const mem = new PersistentMemory('test_session');
        mem.save({ context: { messages: [{ role: 'user', content: 'hi' }] } });
        assert.equal(mem.exists(), true);
        const loaded = mem.load();
        assert.equal(loaded.sessionId, 'test_session');
        assert.equal(loaded.context.messages[0].content, 'hi');
      } finally {
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'chat agent creates pending action then executes on yes',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;
      try {
        const ctx = new ConversationContext();
        const agent = new AutonomousAgent({
          context: ctx,
          config: {
            getDefaultApi: () => 'facebook',
            getToken: () => '',
            getDefaultWhatsAppPhoneNumberId: () => '',
            getDefaultFacebookPageId: () => '',
            getDefaultIgUserId: () => ''
          },
          options: {}
        });

        const first = await agent.process('check my rate limit');
        assert.equal(first.actions.length, 1);
        assert.equal(ctx.hasPendingActions(), true);
        assert.equal(first.needsInput, true);

        const second = await agent.process('yes');
        assert.equal(second.actions.length, 1);
        assert.equal(ctx.hasPendingActions(), false);
      } finally {
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'chat agent handles small talk without actions',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const res = await agent.process('hello');
      assert.equal(res.actions.length, 0);
      assert.equal(res.needsInput, true);
    }
  },
  {
    name: 'chat agent supports developer auth status intent',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const res = await agent.process('check auth status for this profile');
      assert.equal(res.actions.length, 1);
      assert.equal(res.actions[0].tool, 'auth.status');
      assert.equal(res.needsInput, true);
      assert.equal(ctx.hasPendingActions(), true);
    }
  },
  {
    name: 'chat agent asks for token when debug token is missing',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const res = await agent.process('debug token');
      assert.equal(res.actions.length, 0);
      assert.equal(res.needsInput, true);
      assert.equal(res.message.toLowerCase().includes('paste the token'), true);
    }
  },
  {
    name: 'chat agent gives proactive scheduling suggestion from context facts',
    fn: () => {
      const ctx = new ConversationContext();
      ctx.addMessage('user', 'Launch product called SuperWidget tomorrow on Facebook and Instagram');
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const suggestions = agent.proactiveSuggestionsFromContext();
      assert.equal(suggestions.some((s) => s.toLowerCase().includes('schedule all launch posts')), true);
    }
  },
  {
    name: 'chat agent gives post-execution suggestions for limits check',
    fn: () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const suggestions = agent.postExecutionSuggestions(
        { tool: 'check_limits' },
        { data: { usage: { call_count: 90, total_time: 10, total_cputime: 10 } } }
      );
      assert.equal(suggestions.some((s) => s.toLowerCase().includes('rate usage looks high')), true);
    }
  },
  {
    name: 'chat agent replaces stale pending actions for new deterministic command',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;
      try {
        const ctx = new ConversationContext();
        ctx.setPendingActions([{ tool: 'query_me', params: {}, description: 'Old pending' }]);
        const agent = new AutonomousAgent({
          context: ctx,
          config: { getDefaultApi: () => 'facebook' },
          options: {}
        });

        const res = await agent.process('social auth status');
        assert.equal(res.actions.length, 1);
        assert.equal(res.actions[0].tool, 'auth.status');
        assert.equal(res.needsInput, false);
        assert.equal(ctx.hasPendingActions(), false);
      } finally {
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'chat agent failure advice maps expired token to re-login guidance',
    fn: () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });

      const advice = agent.failureAdvice(
        { tool: 'query_me', params: { api: 'facebook' } },
        new Error('Meta API error 190 (463): Error validating access token: Session has expired')
      );

      assert.equal(advice.message.toLowerCase().includes('social auth login -a facebook'), true);
      assert.equal(Array.isArray(advice.suggestions), true);
      assert.equal(advice.suggestions.length > 0, true);
    }
  }
];
