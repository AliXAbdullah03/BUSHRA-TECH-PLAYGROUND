import { NextRequest, NextResponse } from 'next/server';

// LongCat API configuration
const LONGCAT_API_BASE = 'https://api.longcat.chat';
const LONGCAT_MODEL = 'LongCat-Flash-Chat';
const MAX_TOKENS = 8192; // Maximum allowed by LongCat

/**
 * Exponential backoff retry mechanism
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      // If it's a rate limit error (429), retry with backoff
      if (error.response?.status === 429 && attempt < maxRetries) {
        const retryAfter = error.response?.data?.error?.retry_after || 60;
        const delay = Math.min(
          baseDelay * Math.pow(2, attempt),
          retryAfter * 1000
        );

        console.log(
          `Rate limit exceeded. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For other errors or if max retries reached, throw the error
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Make request to LongCat API
 */
async function callLongCatAPI(
  messages: Array<{ role: string; content: string }>,
  options: {
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    top_p?: number;
    enable_thinking?: boolean;
    thinking_budget?: number;
  } = {}
) {
  const apiKey = process.env.CHAT_KEY || process.env.LONGCAT_AI_API_KEY;

  if (!apiKey) {
    throw new Error('CHAT_KEY or LONGCAT_AI_API_KEY environment variable is not set');
  }

  const {
    max_tokens = 1000,
    temperature = 0.7,
    stream = false,
    top_p,
    enable_thinking = false,
    thinking_budget,
  } = options;

  // Validate max_tokens
  if (max_tokens > MAX_TOKENS) {
    throw new Error(`max_tokens cannot exceed ${MAX_TOKENS}`);
  }

  const requestBody: any = {
    model: LONGCAT_MODEL,
    messages,
    max_tokens,
    temperature,
    stream,
  };

  // Add optional parameters
  if (top_p !== undefined) {
    requestBody.top_p = top_p;
  }

  if (enable_thinking) {
    requestBody.enable_thinking = enable_thinking;
    if (thinking_budget !== undefined) {
      requestBody.thinking_budget = thinking_budget;
    }
  }

  const response = await fetch(`${LONGCAT_API_BASE}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error: any = new Error(errorData.error?.message || `API error: ${response.statusText}`);
    error.response = {
      status: response.status,
      data: errorData,
    };
    throw error;
  }

  return await response.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      messages,
      max_tokens,
      temperature,
      stream,
      top_p,
      enable_thinking,
      thinking_budget,
    } = body;

    // Validate messages
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

    // Validate message format
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

    // Validate max_tokens if provided
    if (max_tokens !== undefined) {
      if (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > MAX_TOKENS) {
        return NextResponse.json(
          {
            error: {
              message: `max_tokens must be a number between 1 and ${MAX_TOKENS}`,
              type: 'invalid_request_error',
              code: 'invalid_parameter',
            },
          },
          { status: 400 }
        );
      }
    }

    // Validate temperature if provided
    if (temperature !== undefined) {
      if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
        return NextResponse.json(
          {
            error: {
              message: 'temperature must be a number between 0 and 1',
              type: 'invalid_request_error',
              code: 'invalid_parameter',
            },
          },
          { status: 400 }
        );
      }
    }

    // Call LongCat API with retry mechanism
    const response = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens,
        temperature,
        stream: stream || false,
        top_p,
        enable_thinking,
        thinking_budget,
      })
    );

    // Handle different response formats
    let aiMessage: string;

    // Format 1: OpenAI-compatible format
    if (response.choices && response.choices[0]?.message?.content) {
      aiMessage = response.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (response.response) {
      aiMessage = response.response;
    }
    // Format 3: Anthropic format
    else if (response.content && Array.isArray(response.content)) {
      aiMessage = response.content[0]?.text || '';
    }
    // Fallback: try to extract from any text field
    else {
      aiMessage = response.text || response.output || response.message || JSON.stringify(response);
    }

    // Return response in a consistent format
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
      model: response.model || LONGCAT_MODEL,
    });
  } catch (error: any) {
    console.error('Chat API Error:', error);

    // Handle different error types
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        return NextResponse.json(
          {
            error: {
              message: 'Invalid API Key. Please check your CHAT_KEY or LONGCAT_AI_API_KEY environment variable.',
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
              message: 'LongCat API server error. Please try again later.',
              type: 'server_error',
              code: 'upstream_error',
            },
          },
          { status: 502 }
        );
      }

      // Return the error from the API
      return NextResponse.json(errorData || {
        error: {
          message: error.message || 'An error occurred',
          type: 'api_error',
          code: 'unknown_error',
        },
      }, { status });
    }

    // Generic error
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

// Optional: Add GET method for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Chat API endpoint is running',
    model: LONGCAT_MODEL,
  });
}

