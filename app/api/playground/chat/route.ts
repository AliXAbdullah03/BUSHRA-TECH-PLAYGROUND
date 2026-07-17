import { NextRequest, NextResponse } from 'next/server';

const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'poolside/laguna-xs-2.1';
const MAX_TOKENS = 8192;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.response?.status === 429 && attempt < maxRetries) {
        const retryAfter = error.response?.data?.error?.retry_after || 60;
        const delay = Math.min(baseDelay * Math.pow(2, attempt), retryAfter * 1000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

async function callNvidiaAPI(
  messages: Array<{ role: string; content: string }>,
  options: {
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    top_p?: number;
  } = {}
) {
  const apiKey =
    process.env.NVIDIA_API_KEY || process.env.CHAT_KEY || process.env.NVAPI_KEY;

  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY environment variable is not set');
  }

  const {
    max_tokens = 2000,
    temperature = 0.7,
    stream = false,
    top_p = 0.95,
  } = options;

  if (max_tokens > MAX_TOKENS) {
    throw new Error(`max_tokens cannot exceed ${MAX_TOKENS}`);
  }

  const response = await fetch(`${NVIDIA_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages,
      temperature,
      top_p,
      max_tokens,
      stream,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error: any = new Error(
      errorData.error?.message || `API error: ${response.statusText}`
    );
    error.response = { status: response.status, data: errorData };
    throw error;
  }

  return await response.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, max_tokens, temperature, stream, top_p } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        {
          error: {
            message: 'Messages array is required and must not be empty',
            type: 'invalid_request_error',
            code: 'invalid_parameter',
          },
        },
        { status: 400 }
      );
    }

    for (const message of messages) {
      if (!message.role || !message.content) {
        return NextResponse.json(
          {
            error: {
              message: 'Each message must have "role" and "content" fields',
              type: 'invalid_request_error',
              code: 'invalid_parameter',
            },
          },
          { status: 400 }
        );
      }
      if (!['system', 'user', 'assistant'].includes(message.role)) {
        return NextResponse.json(
          {
            error: {
              message: 'Message role must be one of: system, user, assistant',
              type: 'invalid_request_error',
              code: 'invalid_parameter',
            },
          },
          { status: 400 }
        );
      }
    }

    const response = await retryWithBackoff(() =>
      callNvidiaAPI(messages, {
        max_tokens,
        temperature,
        stream: stream || false,
        top_p,
      })
    );

    let aiMessage: string;
    if (response.choices?.[0]?.message?.content) {
      aiMessage = response.choices[0].message.content;
    } else if (response.response) {
      aiMessage = response.response;
    } else if (Array.isArray(response.content)) {
      aiMessage = response.content[0]?.text || '';
    } else {
      aiMessage = response.text || response.output || response.message || JSON.stringify(response);
    }

    return NextResponse.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: aiMessage,
          },
        },
      ],
      usage: response.usage || {},
      model: response.model || NVIDIA_MODEL,
    });
  } catch (error: any) {
    console.error('Chat API Error:', error);

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid API Key. Check NVIDIA_API_KEY.',
              type: 'authentication_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 }
        );
      }
      if (status === 403) {
        return NextResponse.json(
          {
            error: {
              message: 'API Key has insufficient quota or permissions',
              type: 'permission_error',
              code: 'insufficient_quota',
            },
          },
          { status: 403 }
        );
      }
      if (status === 429) {
        return NextResponse.json(
          {
            error: {
              message: 'Rate limit exceeded. Please try again later.',
              type: 'rate_limit_error',
              code: 'rate_limit_exceeded',
              retry_after: errorData?.error?.retry_after || 60,
            },
          },
          { status: 429 }
        );
      }
      if (status >= 500) {
        return NextResponse.json(
          {
            error: {
              message: 'NVIDIA API server error. Please try again later.',
              type: 'server_error',
              code: 'upstream_error',
            },
          },
          { status: 502 }
        );
      }

      return NextResponse.json(
        errorData || {
          error: {
            message: error.message || 'An error occurred',
            type: 'api_error',
            code: 'unknown_error',
          },
        },
        { status }
      );
    }

    return NextResponse.json(
      {
        error: {
          message: error.message || 'Internal server error',
          type: 'server_error',
          code: 'internal_error',
        },
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Chat API endpoint is running',
    provider: 'nvidia',
    model: NVIDIA_MODEL,
  });
}
