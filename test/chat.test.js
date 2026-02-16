const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConversationContext } = require('../lib/chat/context');
const { PersistentMemory } = require('../lib/chat/memory');
const { AutonomousAgent } = require('../lib/chat/agent');
const opsStorage = require('../lib/ops/storage');

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
    name: 'chat agentic mode auto-executes non-high-risk actions',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: { agentic: true }
      });
      const res = await agent.process('check auth status for this profile');
      assert.equal(res.actions.length, 1);
      assert.equal(res.actions[0].tool, 'auth.status');
      assert.equal(res.needsInput, false);
      assert.equal(ctx.hasPendingActions(), false);
    }
  },
  {
    name: 'chat agentic mode still asks confirmation for high-risk actions',
    fn: async () => {
      const ws = `chat_agentic_high_${Date.now()}`;
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook', getActiveProfile: () => ws },
        options: { agentic: true }
      });
      const res = await agent.process(`approve low-risk approvals for workspace ${ws}`);
      assert.equal(res.actions.length, 1);
      assert.equal(res.actions[0].tool, 'ops.approvals.approve_low_risk');
      assert.equal(res.needsInput, true);
      assert.equal(ctx.hasPendingActions(), true);
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
  },
  {
    name: 'chat agent asks clarification for ambiguous unknown input',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;
      try {
        const ctx = new ConversationContext();
        const agent = new AutonomousAgent({
          context: ctx,
          config: { getDefaultApi: () => 'facebook', getAgentConfig: () => ({ provider: 'openai', apiKey: '' }) },
          options: {}
        });
        const res = await agent.process('blabla random text');
        assert.equal(res.actions.length, 0);
        assert.equal(res.needsInput, true);
        assert.equal(res.message.toLowerCase().includes('not fully sure'), true);
      } finally {
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'chat agent suggests ollama setup when no cloud key is available',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.META_AI_KEY;
      try {
        const ctx = new ConversationContext();
        const agent = new AutonomousAgent({
          context: ctx,
          config: { getDefaultApi: () => 'facebook', getAgentConfig: () => ({ provider: 'openai', apiKey: '' }) },
          options: {}
        });
        const res = await agent.process('show my pages');
        const joined = (res.suggestions || []).join('\n').toLowerCase();
        assert.equal(joined.includes('ollama'), true);
        assert.equal(joined.includes('llama3.1:8b'), true);
        assert.equal(joined.includes('social agent setup --provider ollama'), true);
      } finally {
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  },
  {
    name: 'chat agent maps setup ollama intent to local.ollama.setup tool',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const res = await agent.process('setup ollama llama3.1:8b');
      assert.equal(res.actions.length, 1);
      assert.equal(res.actions[0].tool, 'local.ollama.setup');
      assert.equal(res.actions[0].params.model, 'llama3.1:8b');
    }
  },
  {
    name: 'chat agent classifies specialist by tool domain',
    fn: () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      assert.equal(agent.selectSpecialist('anything', [{ tool: 'auth.status' }]), 'developer');
      assert.equal(agent.selectSpecialist('anything', [{ tool: 'query_insights' }]), 'marketing');
      assert.equal(agent.selectSpecialist('anything', [{ tool: 'ops.guard.mode' }]), 'ops');
      assert.equal(agent.selectSpecialist('anything', [{ tool: 'sources.sync' }]), 'connector');
    }
  },
  {
    name: 'chat agent enforces specialist scope guard',
    fn: () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const scoped = agent.enforceSpecialistScope('developer', [
        { tool: 'auth.status', params: {} },
        { tool: 'list_campaigns', params: {} }
      ]);
      assert.equal(scoped.allowed.length, 1);
      assert.equal(scoped.allowed[0].tool, 'auth.status');
      assert.equal(scoped.blocked.length, 1);
      assert.equal(scoped.blocked[0].tool, 'list_campaigns');
    }
  },
  {
    name: 'chat agent writes active specialist into context summary',
    fn: async () => {
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook' },
        options: {}
      });
      const res = await agent.process('check auth status for this profile');
      assert.equal(res.specialist, 'developer');
      const summary = ctx.getSummary();
      assert.equal(summary.activeSpecialist, 'developer');
      assert.equal(summary.specialistsSeen.includes('developer'), true);
    }
  },
  {
    name: 'chat agent routes ops summary requests to ops specialist executor',
    fn: async () => {
      const ws = `chat_ops_${Date.now()}`;
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook', getActiveProfile: () => ws },
        options: {}
      });
      const res = await agent.process(`show ops summary for workspace ${ws}`);
      assert.equal(res.specialist, 'ops');
      assert.equal(res.actions.length, 1);
      assert.equal(res.actions[0].tool, 'ops.summary');
      assert.equal(res.actions[0].params.workspace, ws);
    }
  },
  {
    name: 'chat agent executes ops summary specialist tool',
    fn: async () => {
      const ws = `chat_ops_exec_${Date.now()}`;
      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook', getActiveProfile: () => ws },
        options: {}
      });
      const out = await agent.execute({
        tool: 'ops.summary',
        params: { workspace: ws },
        description: 'Load ops summary'
      });
      assert.equal(out.success, true);
      assert.equal(out.raw?.data?.workspace, ws);
      assert.equal(typeof out.raw?.data?.summary?.alertsOpen, 'number');
    }
  },
  {
    name: 'chat agent executes connector sync specialist tool',
    fn: async () => {
      const ws = `chat_connector_${Date.now()}`;
      opsStorage.upsertSource(ws, {
        name: 'CSV Sync Source',
        connector: 'csv_upload',
        syncMode: 'manual',
        enabled: true
      });

      const ctx = new ConversationContext();
      const agent = new AutonomousAgent({
        context: ctx,
        config: { getDefaultApi: () => 'facebook', getActiveProfile: () => ws },
        options: {}
      });
      const out = await agent.execute({
        tool: 'connector.sources.sync',
        params: { workspace: ws },
        description: 'Sync connector sources'
      });
      assert.equal(out.success, true);
      assert.equal(Array.isArray(out.raw?.data?.result), true);
      assert.equal(out.raw.data.result.length > 0, true);
    }
  }
];
