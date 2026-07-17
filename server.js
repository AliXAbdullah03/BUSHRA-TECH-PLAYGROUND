import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// NVIDIA NIM (OpenAI-compatible)
const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'poolside/laguna-xs-2.1';
const MAX_TOKENS = 8192;

const FEATURES = {
  chat: {
    path: '/api/chat',
    greeting:
      "Hello! I'm Asta, your AI chat assistant powered by Bushra Technologies and Services. I'm here to help with questions, writing, research, coding help, math, translation, and casual conversation. How can I assist you today?",
    successShape: 'chat',
    max_tokens: 2000,
    temperature: 0.7,
    top_p: 0.95,
    system: `You are Asta, an AI chat assistant powered by Bushra Technologies and Services.

You help with:
- Answering questions and explaining complex topics
- Writing and editing (emails, essays, reports, outlines)
- Programming and tech help
- Math and logic
- Creative ideas
- Language and translation
- General conversation, advice, fun and games

Be helpful, clear, professional, and friendly. Stay in character as Asta.`,
  },
  'code-generation': {
    path: '/api/code-generation',
    greeting:
      "Hello! I'm your Code Generation Assistant, powered by Bushra Technologies and Services. I can help you generate code, debug issues, explain algorithms, write SQL, and integrate APIs. What would you like to code today?",
    successShape: 'feature',
    max_tokens: 4096,
    temperature: 0.4,
    top_p: 0.95,
    system: `You are an expert Code Generation Assistant powered by Bushra Technologies and Services.

Focus only on programming, debugging, algorithms, SQL, APIs, and software development.
Generate clean, well-documented code with language-tagged markdown fences.
Include brief explanations and best practices.
If the request is unrelated to coding, politely redirect.`,
  },
  'text-analysis': {
    path: '/api/text-analysis',
    greeting:
      "Hello! I'm your Text Analysis Assistant, powered by Bushra Technologies and Services. I can summarize, extract insights, analyze sentiment, and review writing style. What text would you like me to analyze?",
    successShape: 'feature',
    max_tokens: 3000,
    temperature: 0.4,
    top_p: 0.9,
    system: `You are an expert Text Analysis Assistant powered by Bushra Technologies and Services.

Analyze text for metrics, summary, key insights, sentiment, language/style, and recommendations.
Use clear markdown sections. Stay focused on text analysis tasks.`,
  },
  'translation-nlp': {
    path: '/api/translation-nlp',
    greeting:
      "Hello! I'm your Translation & NLP Assistant, powered by Bushra Technologies and Services. I can translate between languages, help with grammar/vocabulary, and run NLP-style analysis. What would you like to translate or analyze?",
    successShape: 'feature',
    max_tokens: 3000,
    temperature: 0.3,
    top_p: 0.9,
    system: `You are an expert Translation & NLP Assistant powered by Bushra Technologies and Services.

Provide accurate translations, language detection notes, alternatives when useful, and NLP insights (entities, sentiment, topics) when asked.
Preserve meaning and tone. Use clear markdown sections.`,
  },
  'data-analytics': {
    path: '/api/data-analytics',
    greeting:
      "Hello! I'm your Data Analytics Assistant, powered by Bushra Technologies and Services. Paste data, describe a dataset, or ask for SQL/metrics/insights and I'll help analyze it. What should we look at?",
    successShape: 'feature',
    max_tokens: 4096,
    temperature: 0.3,
    top_p: 0.9,
    system: `You are a Data Analytics Assistant powered by Bushra Technologies and Services.

Help with:
- Interpreting tables/CSV samples
- Metrics, trends, anomalies
- SQL / pandas-style analysis plans
- Clear charts recommendations and business insights

Use structured markdown. Be precise with numbers. If data is missing, say what you need.`,
  },
};

function getApiKey() {
  return process.env.NVIDIA_API_KEY || process.env.CHAT_KEY || process.env.NVAPI_KEY;
}

async function retryWithBackoff(fn, maxRetries = 5, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.response?.status === 429 && attempt < maxRetries) {
        const retryAfter = error.response?.data?.error?.retry_after || 60;
        const delay = Math.min(baseDelay * Math.pow(2, attempt), retryAfter * 1000);
        console.log(`Rate limit. Retrying in ${delay}ms (${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}

async function callNvidiaAPI(messages, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY environment variable is not set');
  }

  const {
    max_tokens = 2000,
    temperature = 0.7,
    top_p = 0.95,
    stream = false,
  } = options;

  if (max_tokens > MAX_TOKENS) {
    throw new Error(`max_tokens cannot exceed ${MAX_TOKENS}`);
  }

  const requestBody = {
    model: NVIDIA_MODEL,
    messages,
    temperature,
    top_p,
    max_tokens,
    stream,
  };

  console.log('NVIDIA request:', JSON.stringify({ ...requestBody, messages: `[${messages.length} msgs]` }));

  const response = await axios.post(`${NVIDIA_API_BASE}/chat/completions`, requestBody, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 180000,
  });

  return response.data;
}

function extractContent(apiResponse) {
  if (apiResponse?.choices?.[0]?.message?.content) {
    return apiResponse.choices[0].message.content;
  }
  if (apiResponse?.response) return apiResponse.response;
  if (Array.isArray(apiResponse?.content)) return apiResponse.content[0]?.text || '';
  if (apiResponse?.text) return apiResponse.text;
  if (apiResponse?.message) return apiResponse.message;
  if (typeof apiResponse?.content === 'string') return apiResponse.content;
  console.warn('Unexpected NVIDIA response shape');
  return JSON.stringify(apiResponse);
}

function buildMessages(systemPrompt, message, conversationHistory) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (Array.isArray(conversationHistory)) {
    const chronological = [...conversationHistory].reverse();
    for (const msg of chronological) {
      if (msg?.role && msg?.content && ['user', 'assistant'].includes(msg.role)) {
        messages.push({ role: msg.role, content: String(msg.content) });
      }
    }
  }

  messages.push({ role: 'user', content: message.trim() });
  return messages;
}

function sendSuccess(res, featureConfig, text) {
  if (featureConfig.successShape === 'chat') {
    return res.json({ response: text });
  }
  return res.json({ success: true, response: text });
}

function sendError(res, featureConfig, status, message, extra = {}) {
  if (featureConfig.successShape === 'chat') {
    return res.status(status).json({
      error: {
        message,
        type: extra.type || 'api_error',
        code: extra.code || 'unknown_error',
        ...extra.fields,
      },
    });
  }
  return res.status(status).json({
    success: false,
    error: message,
    ...extra.fields,
  });
}

function handleUpstreamError(res, featureConfig, error) {
  console.error('API Error:', error.message);
  if (error.response) {
    console.error('Upstream status:', error.response.status);
    console.error('Upstream data:', JSON.stringify(error.response.data, null, 2));
  }

  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    if (status === 401) {
      return sendError(res, featureConfig, 401, 'Invalid API Key. Check NVIDIA_API_KEY.', {
        type: 'authentication_error',
        code: 'invalid_api_key',
      });
    }
    if (status === 403) {
      return sendError(res, featureConfig, 403, 'API key has insufficient quota or permissions', {
        type: 'permission_error',
        code: 'insufficient_quota',
      });
    }
    if (status === 429) {
      return sendError(res, featureConfig, 429, 'Rate limit exceeded. Please try again later.', {
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        fields: { retry_after: data?.error?.retry_after || 60 },
      });
    }
    if (status >= 500) {
      return sendError(res, featureConfig, 502, 'NVIDIA API server error. Please try again later.', {
        type: 'server_error',
        code: 'upstream_error',
      });
    }

    const msg = data?.error?.message || data?.message || error.message || 'An error occurred';
    return sendError(res, featureConfig, status, msg);
  }

  if (error.code === 'ECONNABORTED') {
    return sendError(res, featureConfig, 504, 'Request timeout. The API took too long to respond.', {
      type: 'timeout_error',
      code: 'request_timeout',
    });
  }

  return sendError(res, featureConfig, 500, error.message || 'Internal server error', {
    type: 'server_error',
    code: 'internal_error',
  });
}

function registerFeature(key, featureConfig) {
  app.post(featureConfig.path, async (req, res) => {
    console.log(`\n=== ${key} ===`);
    console.log('Body:', JSON.stringify(req.body, null, 2));

    try {
      const { message, isInitial, conversationHistory } = req.body || {};

      if (isInitial === true) {
        return sendSuccess(res, featureConfig, featureConfig.greeting);
      }

      if (!message || typeof message !== 'string' || !message.trim()) {
        return sendError(res, featureConfig, 400, 'Message is required and must not be empty', {
          type: 'invalid_request_error',
          code: 'invalid_parameter',
        });
      }

      const messages = buildMessages(featureConfig.system, message, conversationHistory);

      const apiResponse = await retryWithBackoff(() =>
        callNvidiaAPI(messages, {
          max_tokens: featureConfig.max_tokens,
          temperature: featureConfig.temperature,
          top_p: featureConfig.top_p,
          stream: false,
        })
      );

      const text = extractContent(apiResponse);
      return sendSuccess(res, featureConfig, text);
    } catch (error) {
      return handleUpstreamError(res, featureConfig, error);
    }
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    provider: 'nvidia',
    model: NVIDIA_MODEL,
    features: Object.keys(FEATURES),
  });
});

app.get('/api/features', (req, res) => {
  res.json({
    provider: 'nvidia',
    model: NVIDIA_MODEL,
    endpoints: Object.entries(FEATURES).map(([id, f]) => ({
      id,
      method: 'POST',
      path: f.path,
    })),
  });
});

for (const [key, config] of Object.entries(FEATURES)) {
  registerFeature(key, config);
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error',
    },
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      type: 'not_found_error',
      code: 'endpoint_not_found',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Provider: NVIDIA NIM | Model: ${NVIDIA_MODEL}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  for (const f of Object.values(FEATURES)) {
    console.log(`  POST http://localhost:${PORT}${f.path}`);
  }
  if (!getApiKey()) {
    console.warn('WARNING: NVIDIA_API_KEY is not set');
  }
});
