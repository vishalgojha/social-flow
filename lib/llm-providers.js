const axios = require('axios');

function normalizeProvider(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'openai') return 'openai';
  if (v === 'anthropic' || v === 'claude') return 'anthropic';
  if (v === 'openrouter') return 'openrouter';
  if (v === 'xai' || v === 'grok') return 'xai';
  if (v === 'ollama' || v === 'local') return 'ollama';
  if (v === 'gemini' || v === 'google') return 'gemini';
  return 'openai';
}

function defaultModelForProvider(provider) {
  const p = normalizeProvider(provider);
  if (p === 'openai') return 'gpt-4o-mini';
  if (p === 'anthropic') return 'claude-3-5-sonnet-latest';
  if (p === 'openrouter') return 'openai/gpt-4o-mini';
  if (p === 'xai') return 'grok-2-latest';
  if (p === 'ollama') return 'llama3.1:8b';
  if (p === 'gemini') return 'gemini-1.5-pro';
  return 'gpt-4o-mini';
}

function resolveApiKeyForProvider(provider, configuredKey) {
  const p = normalizeProvider(provider);
  if (configuredKey) return String(configuredKey);

  if (p === 'openai') {
    return process.env.OPENAI_API_KEY || '';
  }
  if (p === 'anthropic') {
    return process.env.SOCIAL_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  }
  if (p === 'openrouter') {
    return process.env.SOCIAL_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
  }
  if (p === 'xai') {
    return process.env.SOCIAL_XAI_API_KEY || process.env.XAI_API_KEY || '';
  }
  if (p === 'gemini') {
    return process.env.SOCIAL_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  }
  // Ollama does not require an API key by default.
  return '';
}

function hasProviderCredential(provider, configuredKey) {
  const p = normalizeProvider(provider);
  if (p === 'ollama') return true;
  return Boolean(resolveApiKeyForProvider(p, configuredKey));
}

function sanitizeBase(base, fallback) {
  return String(base || fallback || '').trim().replace(/\/+$/, '');
}

function extractTextFromOpenAICompat(payload) {
  return payload?.choices?.[0]?.message?.content || '';
}

function extractTextFromAnthropic(payload) {
  const parts = payload?.content;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => String(p.text || ''))
    .join('\n')
    .trim();
}

function extractTextFromGemini(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => String(p.text || '')).join('\n').trim();
}

async function chatComplete({
  provider,
  model,
  apiKey,
  system,
  user,
  temperature = 0.2,
  timeoutMs = 60000
}) {
  const p = normalizeProvider(provider);
  const finalModel = model || defaultModelForProvider(p);
  const finalKey = resolveApiKeyForProvider(p, apiKey);

  if (!hasProviderCredential(p, finalKey)) {
    throw new Error(`Missing API key for provider: ${p}`);
  }

  if (p === 'openai') {
    const base = sanitizeBase(process.env.OPENAI_BASE_URL, 'https://api.openai.com/v1');
    const res = await axios.post(`${base}/chat/completions`, {
      model: finalModel,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${finalKey}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    return extractTextFromOpenAICompat(res?.data);
  }

  if (p === 'openrouter') {
    const base = sanitizeBase(
      process.env.SOCIAL_OPENROUTER_BASE_URL || process.env.OPENROUTER_BASE_URL,
      'https://openrouter.ai/api/v1'
    );
    const headers = {
      Authorization: `Bearer ${finalKey}`,
      'Content-Type': 'application/json'
    };
    const referer = process.env.SOCIAL_OPENROUTER_SITE_URL || process.env.OPENROUTER_SITE_URL || '';
    const title = process.env.SOCIAL_OPENROUTER_APP_NAME || process.env.OPENROUTER_APP_NAME || 'social-cli';
    if (referer) headers['HTTP-Referer'] = referer;
    if (title) headers['X-Title'] = title;

    const res = await axios.post(`${base}/chat/completions`, {
      model: finalModel,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }, {
      headers,
      timeout: timeoutMs
    });
    return extractTextFromOpenAICompat(res?.data);
  }

  if (p === 'xai') {
    const base = sanitizeBase(process.env.SOCIAL_XAI_BASE_URL || process.env.XAI_BASE_URL, 'https://api.x.ai/v1');
    const res = await axios.post(`${base}/chat/completions`, {
      model: finalModel,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${finalKey}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    return extractTextFromOpenAICompat(res?.data);
  }

  if (p === 'anthropic') {
    const base = sanitizeBase(process.env.SOCIAL_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL, 'https://api.anthropic.com/v1');
    const res = await axios.post(`${base}/messages`, {
      model: finalModel,
      system,
      temperature,
      max_tokens: 1400,
      messages: [{ role: 'user', content: user }]
    }, {
      headers: {
        'x-api-key': finalKey,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    return extractTextFromAnthropic(res?.data);
  }

  if (p === 'gemini') {
    const base = sanitizeBase(
      process.env.SOCIAL_GEMINI_BASE_URL || process.env.GEMINI_BASE_URL,
      'https://generativelanguage.googleapis.com/v1beta'
    );
    const endpoint = `${base}/models/${encodeURIComponent(finalModel)}:generateContent?key=${encodeURIComponent(finalKey)}`;
    const res = await axios.post(endpoint, {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${system}\n\n${user}` }]
        }
      ],
      generationConfig: {
        temperature
      }
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs
    });
    return extractTextFromGemini(res?.data);
  }

  if (p === 'ollama') {
    const base = sanitizeBase(process.env.SOCIAL_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
    const res = await axios.post(`${base}/api/chat`, {
      model: finalModel,
      stream: false,
      options: { temperature },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs
    });
    return res?.data?.message?.content || '';
  }

  throw new Error(`Unsupported provider: ${p}`);
}

module.exports = {
  normalizeProvider,
  defaultModelForProvider,
  resolveApiKeyForProvider,
  hasProviderCredential,
  chatComplete
};
