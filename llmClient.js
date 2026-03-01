const { loadState, saveState } = require('./stateStore');
const { callGemini } = require('./geminiClient');

let glmClient = null;
let kimiClient = null;

function ensureGlmClient() {
  if (!glmClient) {
    // Lazy require supaya project tetap jalan walau GLM belum dikonfigurasi.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    glmClient = require('./glmClient');
  }
  return glmClient;
}

function ensureKimiClient() {
  if (!kimiClient) {
    // Lazy require supaya project tetap jalan walau Kimi belum dikonfigurasi.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    kimiClient = require('./kimiClient');
  }
  return kimiClient;
}

function getConfiguredProviders() {
  const rawList = process.env.LLM_PROVIDERS;
  if (rawList && rawList.trim().length > 0) {
    const items = rawList
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (items.includes('auto')) {
      return ['auto'];
    }

    const known = ['gemini', 'glm', 'kimi'];
    const filtered = items.filter((p) => {
      const ok = known.includes(p);
      if (!ok) {
        console.warn(`[LLM] Ignoring unknown provider in LLM_PROVIDERS: ${p}`);
      }
      return ok;
    });

    return filtered.length > 0 ? filtered : ['gemini'];
  }

  // Backward compatibility: PRIMARY_LLM_PROVIDER.
  const legacy = process.env.PRIMARY_LLM_PROVIDER || 'gemini';
  const norm = String(legacy).trim().toLowerCase();
  if (norm === 'glm') return ['glm'];
  if (norm === 'kimi') return ['kimi'];
  return ['gemini'];
}

function detectAutoProviders() {
  const providers = [];

  const hasGemini = Object.keys(process.env).some(
    (k) => k.startsWith('GOOGLE_API_KEY') && process.env[k] && process.env[k].trim().length > 0,
  );
  const hasGlm = Object.keys(process.env).some(
    (k) => k.startsWith('GLM_API_KEY') && process.env[k] && process.env[k].trim().length > 0,
  );
  const hasKimi = Object.keys(process.env).some(
    (k) => k.startsWith('KIMI_API_KEY') && process.env[k] && process.env[k].trim().length > 0,
  );

  if (hasGemini) providers.push('gemini');
  if (hasGlm) providers.push('glm');
  if (hasKimi) providers.push('kimi');

  return providers.length > 0 ? providers : ['gemini'];
}

function getProviderOrder() {
  const configured = getConfiguredProviders();
  if (configured.length === 1 && configured[0] === 'auto') {
    return detectAutoProviders();
  }
  return configured;
}

function getPrimaryProvider() {
  const providers = getProviderOrder();
  return providers[0];
}

async function callProvider(provider, { prompt, model, maxAttempts }) {
  if (provider === 'glm') {
    const { callGLM } = ensureGlmClient();
    return callGLM({ prompt, model, maxAttempts });
  }
  if (provider === 'kimi') {
    const { callKimi } = ensureKimiClient();
    return callKimi({ prompt, model, maxAttempts });
  }
  // Default: Gemini.
  return callGemini({ prompt, model, maxAttempts });
}

async function callLLM({ prompt, model, maxAttempts } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('callLLM membutuhkan parameter "prompt" berupa string.');
  }

  const providers = getProviderOrder();
  const state = loadState();
  const lastProvider = state.lastUsedProvider || null;

  let startIndex = 0;
  if (lastProvider) {
    const idx = providers.indexOf(lastProvider);
    if (idx >= 0) {
      startIndex = (idx + 1) % providers.length;
    }
  }

  let lastError = null;

  for (let offset = 0; offset < providers.length; offset += 1) {
    const providerIndex = (startIndex + offset) % providers.length;
    const provider = providers[providerIndex];

    try {
      console.log(
        `[LLM] Trying provider "${provider}" (order index=${providerIndex}) with prompt length=${prompt.length}`,
      );
      const result = await callProvider(provider, { prompt, model, maxAttempts });
      // Provider spesifik sudah meng-update lastUsedProvider di state.
      return result;
    } catch (err) {
      lastError = err;
      console.warn(
        `[LLM] Provider "${provider}" failed with error: ${err.message}. Trying next provider (if any).`,
      );
    }
  }

  throw lastError || new Error('Gagal memanggil LLM di semua provider yang dikonfigurasi.');
}

module.exports = {
  getPrimaryProvider,
  callLLM,
};


