import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// LongCat API configuration
const LONGCAT_API_BASE = 'https://api.longcat.chat';
const LONGCAT_MODEL = 'LongCat-Flash-Chat';
const MAX_TOKENS = 8192; // Maximum allowed by LongCat

/**
 * Exponential backoff retry mechanism
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 5, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
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
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors or if max retries reached, throw the error
      throw error;
    }
  }
}

/**
 * Make request to LongCat API
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Additional options (max_tokens, temperature, stream)
 * @returns {Promise} - API response
 */
async function callLongCatAPI(messages, options = {}) {
  const apiKey = process.env.CHAT_KEY;
  
  if (!apiKey) {
    throw new Error('CHAT_KEY environment variable is not set');
  }

  const {
    max_tokens = 1000,
    temperature = 0.7,
    stream = false,
    top_p,
    enable_thinking = false,
    thinking_budget
  } = options;

  // Validate max_tokens
  if (max_tokens > MAX_TOKENS) {
    throw new Error(`max_tokens cannot exceed ${MAX_TOKENS}`);
  }

  const requestBody = {
    model: LONGCAT_MODEL,
    messages,
    max_tokens,
    temperature,
    stream
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

  const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
  console.log('LongCat API URL:', apiUrl);
  console.log('LongCat API Request Body:', JSON.stringify(requestBody, null, 2));

  const response = await axios.post(
    apiUrl,
    requestBody,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 minutes timeout
    }
  );

  console.log('LongCat API Response Status:', response.status);
  return response.data;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Chat completion endpoint
app.post('/api/chat', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const requestBody = req.body;
  
  // Debug: Log request details
  console.log('\n=== Chat API Request ===');
  console.log('URL:', url);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const { message, isInitial, conversationHistory } = requestBody;

    // Handle initial message
    if (isInitial === true) {
      console.log('Initial message request detected');
      
      // Default greeting message for initial request from Asta
      const greetingMessage = "Hello! I'm Asta, your AI chat assistant powered by Bushra Technologies and Services. I'm here to help you with your questions and conversations. How can I assist you today?";
      
      const response = { response: greetingMessage };
      console.log('Response Status: 200');
      console.log('Response Data:', JSON.stringify(response, null, 2));
      console.log('=== End Request ===\n');
      
      return res.json(response);
    }

    // Validate message for user messages
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('Error: Message is required and must not be empty');
      return res.status(400).json({
        error: {
          message: 'Message is required and must not be empty',
          type: 'invalid_request_error',
          code: 'invalid_parameter'
        }
      });
    }

    // Build messages array from conversation history and current message
    const messages = [];
    
    // LoRA-style system prompt for Asta - ensures responses only to chat assistant related questions
    const astaSystemPrompt = `You are Asta, an AI chat assistant powered by Bushra Technologies and Services.

IMPORTANT INSTRUCTIONS (LoRA-style filtering):
- You are a chat assistant designed to help users with conversations, questions, and general assistance
- ONLY respond to questions and requests that are appropriate for a chat assistant
- If a question is NOT related to chat assistance, general knowledge, or conversational help, politely decline and redirect
- Your purpose is to provide helpful, friendly, and professional chat assistance
- Stay in character as Asta, representing Bushra Technologies and Services
- Be concise, clear, and helpful in your responses
- Maintain a professional yet friendly tone

Your name is: Asta
Powered by: Bushra Technologies and Services
Role: AI Chat Assistant`;

    // Add system message with LoRA prompt
    messages.push({
      role: 'system',
      content: astaSystemPrompt
    });

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      // Reverse the history to maintain chronological order (oldest first)
      const reversedHistory = [...conversationHistory].reverse();
      
      for (const msg of reversedHistory) {
        if (msg.role && msg.content) {
          // Validate role
          if (['user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role,
              content: String(msg.content)
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message.trim()
    });

    console.log('Messages array prepared:', JSON.stringify(messages, null, 2));

    // Call LongCat API with retry mechanism
    const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
    console.log('Calling LongCat API:', apiUrl);
    
    const apiResponse = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens: 1000,
        temperature: 0.7,
        stream: false
      })
    );

    console.log('LongCat API Response Status: 200');
    console.log('LongCat API Response Data:', JSON.stringify(apiResponse, null, 2));

    // Extract AI response from different possible formats
    let aiResponse = '';
    
    // Format 1: OpenAI format (choices[0].message.content)
    if (apiResponse.choices && apiResponse.choices[0]?.message?.content) {
      aiResponse = apiResponse.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (apiResponse.response) {
      aiResponse = apiResponse.response;
    }
    // Format 3: Anthropic format (content array)
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      aiResponse = apiResponse.content[0]?.text || '';
    }
    // Format 4: Other possible formats
    else if (apiResponse.text) {
      aiResponse = apiResponse.text;
    }
    else if (apiResponse.message) {
      aiResponse = apiResponse.message;
    }
    else if (apiResponse.content) {
      aiResponse = apiResponse.content;
    }
    else {
      // Fallback: try to extract any text field
      console.warn('Unexpected response format, attempting to extract text');
      aiResponse = JSON.stringify(apiResponse);
    }

    // Return response in frontend-compatible format
    // Frontend accepts: { response }, { message }, { text }, { content }, or OpenAI format
    const response = { response: aiResponse };
    
    console.log('Final Response Status: 200');
    console.log('Final Response Data:', JSON.stringify(response, null, 2));
    console.log('=== End Request ===\n');
    
    res.json(response);
  } catch (error) {
    console.error('\n=== Chat API Error ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('=== End Error ===\n');

    // Handle different error types
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        const errorResponse = {
          error: {
            message: 'Invalid API Key. Please check your CHAT_KEY environment variable.',
            type: 'authentication_error',
            code: 'invalid_api_key'
          }
        };
        console.log('Response Status: 401');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(401).json(errorResponse);
      }

      if (status === 403) {
        const errorResponse = {
          error: {
            message: 'API Key has insufficient quota or permissions',
            type: 'permission_error',
            code: 'insufficient_quota'
          }
        };
        console.log('Response Status: 403');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(403).json(errorResponse);
      }

      if (status === 429) {
        const errorResponse = {
          error: {
            message: 'Rate limit exceeded. Please try again later.',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            retry_after: errorData?.error?.retry_after || 60
          }
        };
        console.log('Response Status: 429');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(429).json(errorResponse);
      }

      if (status >= 500) {
        const errorResponse = {
          error: {
            message: 'LongCat API server error. Please try again later.',
            type: 'server_error',
            code: 'upstream_error'
          }
        };
        console.log('Response Status: 502');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(502).json(errorResponse);
      }

      // Return the error from the API
      const errorResponse = errorData || {
        error: {
          message: error.message || 'An error occurred',
          type: 'api_error',
          code: 'unknown_error'
        }
      };
      console.log(`Response Status: ${status}`);
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(status).json(errorResponse);
    }

    if (error.code === 'ECONNABORTED') {
      const errorResponse = {
        error: {
          message: 'Request timeout. The API took too long to respond.',
          type: 'timeout_error',
          code: 'request_timeout'
        }
      };
      console.log('Response Status: 504');
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(504).json(errorResponse);
    }

    // Generic error
    const errorResponse = {
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    };
    console.log('Response Status: 500');
    console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Code Generation endpoint
app.post('/api/code-generation', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const requestBody = req.body;
  
  // Debug: Log request details
  console.log('\n=== Code Generation API Request ===');
  console.log('URL:', url);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const { message, isInitial, conversationHistory, feature } = requestBody;

    // Handle initial message
    if (isInitial === true) {
      console.log('Initial code generation message request detected');
      
      // Default greeting message for code generation assistant
      const greetingMessage = "Hello! I'm your Code Generation Assistant, powered by Bushra Technologies and Services. I can help you generate code snippets, debug issues, and provide programming solutions. What would you like to code today?";
      
      const response = {
        success: true,
        response: greetingMessage
      };
      console.log('Response Status: 200');
      console.log('Response Data:', JSON.stringify(response, null, 2));
      console.log('=== End Request ===\n');
      
      return res.json(response);
    }

    // Validate message for code generation requests
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('Error: Message is required and must not be empty');
      return res.status(400).json({
        success: false,
        error: 'Message is required and must not be empty'
      });
    }

    // Build messages array from conversation history and current message
    const messages = [];
    
    // LoRA-style system prompt for Code Generation Assistant
    const codeGenSystemPrompt = `You are an expert Code Generation Assistant powered by Bushra Technologies and Services.

IMPORTANT INSTRUCTIONS (LoRA-style filtering):
- You are a professional code generation assistant specialized in generating clean, well-documented code
- ONLY respond to code generation, programming, debugging, and software development related questions
- If a question is NOT related to code generation, programming, or software development, politely decline and redirect to appropriate topics
- Your purpose is to generate production-ready code with proper documentation, comments, and best practices
- Always format code blocks with triple backticks and language identifier (e.g., \`\`\`python, \`\`\`javascript, \`\`\`typescript, etc.)
- Include explanations, comments, and usage examples when appropriate
- Follow language-specific best practices and conventions
- Suggest error handling and edge cases when relevant
- Be concise but thorough in your code explanations
- Maintain a professional yet helpful tone

Code Generation Guidelines:
- Generate clean, readable, and maintainable code
- Include proper documentation (docstrings, comments)
- Provide usage examples when helpful
- Suggest best practices and optimizations
- Handle edge cases and errors appropriately
- Support multiple programming languages when requested
- Format code with proper indentation and syntax

Your name: Code Generation Assistant
Powered by: Bushra Technologies and Services
Role: Expert Code Generation and Programming Assistant`;

    // Add system message with LoRA prompt
    messages.push({
      role: 'system',
      content: codeGenSystemPrompt
    });

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      // Reverse the history to maintain chronological order (oldest first)
      const reversedHistory = [...conversationHistory].reverse();
      
      for (const msg of reversedHistory) {
        if (msg.role && msg.content) {
          // Validate role
          if (['user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role,
              content: String(msg.content)
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message.trim()
    });

    console.log('Messages array prepared:', JSON.stringify(messages, null, 2));

    // Call LongCat API with retry mechanism
    const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
    console.log('Calling LongCat API:', apiUrl);
    
    const apiResponse = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens: 2000, // Higher token limit for code generation
        temperature: 0.7,
        stream: false
      })
    );

    console.log('LongCat API Response Status: 200');
    console.log('LongCat API Response Data:', JSON.stringify(apiResponse, null, 2));

    // Extract AI response from different possible formats
    let aiResponse = '';
    
    // Format 1: OpenAI format (choices[0].message.content)
    if (apiResponse.choices && apiResponse.choices[0]?.message?.content) {
      aiResponse = apiResponse.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (apiResponse.response) {
      aiResponse = apiResponse.response;
    }
    // Format 3: Anthropic format (content array)
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      aiResponse = apiResponse.content[0]?.text || '';
    }
    // Format 4: Other possible formats
    else if (apiResponse.text) {
      aiResponse = apiResponse.text;
    }
    else if (apiResponse.message) {
      aiResponse = apiResponse.message;
    }
    else if (apiResponse.content) {
      aiResponse = apiResponse.content;
    }
    else {
      // Fallback: try to extract any text field
      console.warn('Unexpected response format, attempting to extract text');
      aiResponse = JSON.stringify(apiResponse);
    }

    // Try to extract code separately if it exists in a code field
    // This is optional - frontend can also parse code from markdown
    let code = null;
    if (apiResponse.code) {
      code = apiResponse.code;
    }

    // Return response in frontend-compatible format
    const response = {
      success: true,
      response: aiResponse
    };

    // Add code field if available
    if (code) {
      response.code = code;
    }
    
    console.log('Final Response Status: 200');
    console.log('Final Response Data:', JSON.stringify(response, null, 2));
    console.log('=== End Request ===\n');
    
    res.json(response);
  } catch (error) {
    console.error('\n=== Code Generation API Error ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('=== End Error ===\n');

    // Handle different error types
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        const errorResponse = {
          success: false,
          error: 'Invalid API Key. Please check your CHAT_KEY environment variable.'
        };
        console.log('Response Status: 401');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(401).json(errorResponse);
      }

      if (status === 403) {
        const errorResponse = {
          success: false,
          error: 'API Key has insufficient quota or permissions'
        };
        console.log('Response Status: 403');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(403).json(errorResponse);
      }

      if (status === 429) {
        const errorResponse = {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retry_after: errorData?.error?.retry_after || 60
        };
        console.log('Response Status: 429');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(429).json(errorResponse);
      }

      if (status >= 500) {
        const errorResponse = {
          success: false,
          error: 'LongCat API server error. Please try again later.'
        };
        console.log('Response Status: 502');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(502).json(errorResponse);
      }

      const errorResponse = {
        success: false,
        error: errorData?.error?.message || error.message || 'An error occurred'
      };
      console.log(`Response Status: ${status}`);
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(status).json(errorResponse);
    }

    if (error.code === 'ECONNABORTED') {
      const errorResponse = {
        success: false,
        error: 'Request timeout. The API took too long to respond.'
      };
      console.log('Response Status: 504');
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(504).json(errorResponse);
    }

    // Generic error
    const errorResponse = {
      success: false,
      error: error.message || 'Internal server error'
    };
    console.log('Response Status: 500');
    console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Code Generation endpoint
app.post('/api/code-generation', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const requestBody = req.body;
  
  // Debug: Log request details
  console.log('\n=== Code Generation API Request ===');
  console.log('URL:', url);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const { message, isInitial, conversationHistory, feature } = requestBody;

    // Handle initial message
    if (isInitial === true) {
      console.log('Initial code generation message request detected');
      
      // Default greeting message for code generation assistant
      const greetingMessage = "Hello! I'm your Code Generation Assistant, powered by Bushra Technologies and Services. I can help you generate code snippets, debug issues, and provide programming solutions. What would you like to code today?";
      
      const response = {
        success: true,
        response: greetingMessage
      };
      console.log('Response Status: 200');
      console.log('Response Data:', JSON.stringify(response, null, 2));
      console.log('=== End Request ===\n');
      
      return res.json(response);
    }

    // Validate message for code generation requests
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('Error: Message is required and must not be empty');
      return res.status(400).json({
        success: false,
        error: 'Message is required and must not be empty'
      });
    }

    // Build messages array from conversation history and current message
    const messages = [];
    
    // LoRA-style system prompt for Code Generation Assistant
    const codeGenSystemPrompt = `You are an expert Code Generation Assistant powered by Bushra Technologies and Services.

IMPORTANT INSTRUCTIONS (LoRA-style filtering):
- You are a professional code generation assistant specialized in generating clean, well-documented code
- ONLY respond to code generation, programming, debugging, and software development related questions
- If a question is NOT related to code generation, programming, or software development, politely decline and redirect to appropriate topics
- Your purpose is to generate production-ready code with proper documentation, comments, and best practices
- Always format code blocks with triple backticks and language identifier (e.g., \`\`\`python, \`\`\`javascript, \`\`\`typescript, etc.)
- Include explanations, comments, and usage examples when appropriate
- Follow language-specific best practices and conventions
- Suggest error handling and edge cases when relevant
- Be concise but thorough in your code explanations
- Maintain a professional yet helpful tone

Code Generation Guidelines:
- Generate clean, readable, and maintainable code
- Include proper documentation (docstrings, comments)
- Provide usage examples when helpful
- Suggest best practices and optimizations
- Handle edge cases and errors appropriately
- Support multiple programming languages when requested
- Format code with proper indentation and syntax

Your name: Code Generation Assistant
Powered by: Bushra Technologies and Services
Role: Expert Code Generation and Programming Assistant`;

    // Add system message with LoRA prompt
    messages.push({
      role: 'system',
      content: codeGenSystemPrompt
    });

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      // Reverse the history to maintain chronological order (oldest first)
      const reversedHistory = [...conversationHistory].reverse();
      
      for (const msg of reversedHistory) {
        if (msg.role && msg.content) {
          // Validate role
          if (['user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role,
              content: String(msg.content)
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message.trim()
    });

    console.log('Messages array prepared:', JSON.stringify(messages, null, 2));

    // Call LongCat API with retry mechanism
    const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
    console.log('Calling LongCat API:', apiUrl);
    
    const apiResponse = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens: 2000, // Higher token limit for code generation
        temperature: 0.7,
        stream: false
      })
    );

    console.log('LongCat API Response Status: 200');
    console.log('LongCat API Response Data:', JSON.stringify(apiResponse, null, 2));

    // Extract AI response from different possible formats
    let aiResponse = '';
    
    // Format 1: OpenAI format (choices[0].message.content)
    if (apiResponse.choices && apiResponse.choices[0]?.message?.content) {
      aiResponse = apiResponse.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (apiResponse.response) {
      aiResponse = apiResponse.response;
    }
    // Format 3: Anthropic format (content array)
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      aiResponse = apiResponse.content[0]?.text || '';
    }
    // Format 4: Other possible formats
    else if (apiResponse.text) {
      aiResponse = apiResponse.text;
    }
    else if (apiResponse.message) {
      aiResponse = apiResponse.message;
    }
    else if (apiResponse.content) {
      aiResponse = apiResponse.content;
    }
    else {
      // Fallback: try to extract any text field
      console.warn('Unexpected response format, attempting to extract text');
      aiResponse = JSON.stringify(apiResponse);
    }

    // Try to extract code separately if it exists in a code field
    // This is optional - frontend can also parse code from markdown
    let code = null;
    if (apiResponse.code) {
      code = apiResponse.code;
    }

    // Return response in frontend-compatible format
    const response = {
      success: true,
      response: aiResponse
    };

    // Add code field if available
    if (code) {
      response.code = code;
    }
    
    console.log('Final Response Status: 200');
    console.log('Final Response Data:', JSON.stringify(response, null, 2));
    console.log('=== End Request ===\n');
    
    res.json(response);
  } catch (error) {
    console.error('\n=== Code Generation API Error ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('=== End Error ===\n');

    // Handle different error types
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        const errorResponse = {
          success: false,
          error: 'Invalid API Key. Please check your CHAT_KEY environment variable.'
        };
        console.log('Response Status: 401');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(401).json(errorResponse);
      }

      if (status === 403) {
        const errorResponse = {
          success: false,
          error: 'API Key has insufficient quota or permissions'
        };
        console.log('Response Status: 403');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(403).json(errorResponse);
      }

      if (status === 429) {
        const errorResponse = {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retry_after: errorData?.error?.retry_after || 60
        };
        console.log('Response Status: 429');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(429).json(errorResponse);
      }

      if (status >= 500) {
        const errorResponse = {
          success: false,
          error: 'LongCat API server error. Please try again later.'
        };
        console.log('Response Status: 502');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(502).json(errorResponse);
      }

      const errorResponse = {
        success: false,
        error: errorData?.error?.message || error.message || 'An error occurred'
      };
      console.log(`Response Status: ${status}`);
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(status).json(errorResponse);
    }

    if (error.code === 'ECONNABORTED') {
      const errorResponse = {
        success: false,
        error: 'Request timeout. The API took too long to respond.'
      };
      console.log('Response Status: 504');
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(504).json(errorResponse);
    }

    // Generic error
    const errorResponse = {
      success: false,
      error: error.message || 'Internal server error'
    };
    console.log('Response Status: 500');
    console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Text Analysis endpoint
app.post('/api/text-analysis', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const requestBody = req.body;
  
  // Debug: Log request details
  console.log('\n=== Text Analysis API Request ===');
  console.log('URL:', url);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const { message, isInitial, conversationHistory, feature } = requestBody;

    // Handle initial message
    if (isInitial === true) {
      console.log('Initial text analysis message request detected');
      
      // Default greeting message for text analysis assistant
      const greetingMessage = "Hello! I'm your Text Analysis Assistant, powered by Bushra Technologies and Services. I can help you analyze, summarize, extract insights, and understand your text content. What text would you like me to analyze?";
      
      const response = {
        success: true,
        response: greetingMessage
      };
      console.log('Response Status: 200');
      console.log('Response Data:', JSON.stringify(response, null, 2));
      console.log('=== End Request ===\n');
      
      return res.json(response);
    }

    // Validate message for text analysis requests
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('Error: Message is required and must not be empty');
      return res.status(400).json({
        success: false,
        error: 'Message is required and must not be empty'
      });
    }

    // Build messages array from conversation history and current message
    const messages = [];
    
    // LoRA-style system prompt for Text Analysis Assistant
    const textAnalysisSystemPrompt = `You are an expert Text Analysis Assistant powered by Bushra Technologies and Services.

IMPORTANT INSTRUCTIONS (LoRA-style filtering):
- You are a professional text analysis assistant specialized in analyzing, summarizing, and extracting insights from text
- ONLY respond to text analysis, content analysis, summarization, and text understanding related questions
- If a question is NOT related to text analysis, content analysis, or text understanding, politely decline and redirect to appropriate topics
- Your purpose is to provide comprehensive text analysis including metrics, summaries, insights, sentiment, and actionable recommendations
- Always format your analysis with clear sections using markdown (bold headings with **, bullet points, numbered lists)
- Provide structured, organized, and easy-to-read analysis results
- Include quantitative metrics when relevant (word count, character count, etc.)
- Be thorough but concise in your analysis
- Maintain a professional yet helpful tone

Text Analysis Capabilities:
- **Basic Metrics**: Word count, character count, sentence count, paragraph count, average words per sentence
- **Content Analysis**: Summaries, key themes, main ideas, important keywords, named entities
- **Sentiment Analysis**: Overall sentiment (positive/negative/neutral), emotional tone, confidence scores
- **Language Analysis**: Detected language, writing style, readability assessment, grammar insights
- **Advanced Features**: Keyword extraction, named entity recognition, topic modeling, text classification

Analysis Guidelines:
- Provide comprehensive analysis with multiple sections
- Use clear headings and structure (markdown format)
- Include quantitative metrics when applicable
- Extract key insights and themes
- Identify sentiment and emotional tone
- Assess writing style and readability
- Provide actionable recommendations
- Format with **bold headings**, bullet points, and clear sections
- Be specific and data-driven in your analysis

Response Format:
Structure your analysis with:
- **Basic Metrics** section (word count, character count, etc.)
- **Summary** section (brief overview)
- **Key Insights** section (main themes, topics, important points)
- **Sentiment Analysis** section (if applicable)
- **Language & Style** section (writing style, readability)
- **Recommendations** section (actionable suggestions)

Your name: Text Analysis Assistant
Powered by: Bushra Technologies and Services
Role: Expert Text Analysis and Content Understanding Assistant`;

    // Add system message with LoRA prompt
    messages.push({
      role: 'system',
      content: textAnalysisSystemPrompt
    });

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      // Reverse the history to maintain chronological order (oldest first)
      const reversedHistory = [...conversationHistory].reverse();
      
      for (const msg of reversedHistory) {
        if (msg.role && msg.content) {
          // Validate role
          if (['user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role,
              content: String(msg.content)
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message.trim()
    });

    console.log('Messages array prepared:', JSON.stringify(messages, null, 2));

    // Call LongCat API with retry mechanism
    const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
    console.log('Calling LongCat API:', apiUrl);
    
    const apiResponse = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens: 2000, // Higher token limit for comprehensive analysis
        temperature: 0.5, // Lower temperature for more consistent analysis
        stream: false
      })
    );

    console.log('LongCat API Response Status: 200');
    console.log('LongCat API Response Data:', JSON.stringify(apiResponse, null, 2));

    // Extract AI response from different possible formats
    let aiResponse = '';
    
    // Format 1: OpenAI format (choices[0].message.content)
    if (apiResponse.choices && apiResponse.choices[0]?.message?.content) {
      aiResponse = apiResponse.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (apiResponse.response) {
      aiResponse = apiResponse.response;
    }
    // Format 3: Anthropic format (content array)
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      aiResponse = apiResponse.content[0]?.text || '';
    }
    // Format 4: Other possible formats
    else if (apiResponse.text) {
      aiResponse = apiResponse.text;
    }
    else if (apiResponse.message) {
      aiResponse = apiResponse.message;
    }
    else if (apiResponse.content) {
      aiResponse = apiResponse.content;
    }
    else {
      // Fallback: try to extract any text field
      console.warn('Unexpected response format, attempting to extract text');
      aiResponse = JSON.stringify(apiResponse);
    }

    // Return response in frontend-compatible format
    const response = {
      success: true,
      response: aiResponse
    };

    // Optionally add structured data if available
    if (apiResponse.metrics) {
      response.metrics = apiResponse.metrics;
    }
    if (apiResponse.insights) {
      response.insights = apiResponse.insights;
    }
    
    console.log('Final Response Status: 200');
    console.log('Final Response Data:', JSON.stringify(response, null, 2));
    console.log('=== End Request ===\n');
    
    res.json(response);
  } catch (error) {
    console.error('\n=== Text Analysis API Error ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('=== End Error ===\n');

    // Handle different error types
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        const errorResponse = {
          success: false,
          error: 'Invalid API Key. Please check your CHAT_KEY environment variable.'
        };
        console.log('Response Status: 401');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(401).json(errorResponse);
      }

      if (status === 403) {
        const errorResponse = {
          success: false,
          error: 'API Key has insufficient quota or permissions'
        };
        console.log('Response Status: 403');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(403).json(errorResponse);
      }

      if (status === 429) {
        const errorResponse = {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retry_after: errorData?.error?.retry_after || 60
        };
        console.log('Response Status: 429');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(429).json(errorResponse);
      }

      if (status >= 500) {
        const errorResponse = {
          success: false,
          error: 'LongCat API server error. Please try again later.'
        };
        console.log('Response Status: 502');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(502).json(errorResponse);
      }

      const errorResponse = {
        success: false,
        error: errorData?.error?.message || error.message || 'An error occurred'
      };
      console.log(`Response Status: ${status}`);
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(status).json(errorResponse);
    }

    if (error.code === 'ECONNABORTED') {
      const errorResponse = {
        success: false,
        error: 'Request timeout. The API took too long to respond.'
      };
      console.log('Response Status: 504');
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(504).json(errorResponse);
    }

    // Generic error
    const errorResponse = {
      success: false,
      error: error.message || 'Internal server error'
    };
    console.log('Response Status: 500');
    console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Translation & NLP endpoint
app.post('/api/translation-nlp', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const requestBody = req.body;
  
  // Debug: Log request details
  console.log('\n=== Translation & NLP API Request ===');
  console.log('URL:', url);
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const { message, isInitial, conversationHistory, feature } = requestBody;

    // Handle initial message
    if (isInitial === true) {
      console.log('Initial translation & NLP message request detected');
      
      // Default greeting message for translation & NLP assistant
      const greetingMessage = "Hello! I'm your Translation & NLP Assistant, powered by Bushra Technologies and Services. I can help you translate text between languages, perform natural language processing tasks, and understand linguistic patterns. What would you like to translate or analyze?";
      
      const response = {
        success: true,
        response: greetingMessage
      };
      console.log('Response Status: 200');
      console.log('Response Data:', JSON.stringify(response, null, 2));
      console.log('=== End Request ===\n');
      
      return res.json(response);
    }

    // Validate message for translation/NLP requests
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('Error: Message is required and must not be empty');
      return res.status(400).json({
        success: false,
        error: 'Message is required and must not be empty'
      });
    }

    // Build messages array from conversation history and current message
    const messages = [];
    
    // LoRA-style system prompt for Translation & NLP Assistant
    const translationNLPSystemPrompt = `You are an expert Translation & Natural Language Processing Assistant powered by Bushra Technologies and Services.

IMPORTANT INSTRUCTIONS (LoRA-style filtering):
- You are a professional translation and NLP assistant specialized in translating text between languages and performing natural language processing tasks
- ONLY respond to translation, language processing, linguistic analysis, and multilingual communication related questions
- If a question is NOT related to translation, language processing, or NLP tasks, politely decline and redirect to appropriate topics
- Your purpose is to provide accurate translations, language detection, NLP analysis, and linguistic insights
- Always format your responses with clear sections using markdown (bold headings with **, bullet points, numbered lists)
- Provide context-aware translations that preserve meaning and tone
- Include language details, confidence scores, and cultural notes when relevant
- Offer alternative translations when appropriate
- Be accurate, precise, and culturally sensitive in your translations
- Maintain a professional yet helpful tone

Translation Capabilities:
- **Language Detection**: Automatic source language detection with confidence scores
- **Text Translation**: Accurate translation between 100+ languages
- **Context-Aware Translation**: Preserve meaning, tone, and style
- **Formal/Informal Options**: Provide both formal and informal translations
- **Technical Terminology**: Handle specialized vocabulary correctly
- **Idiomatic Expressions**: Translate idioms and cultural expressions appropriately
- **Multi-language Support**: Support major and regional languages worldwide

NLP Capabilities:
- **Language Processing**: Part-of-speech tagging, named entity recognition, dependency parsing
- **Text Understanding**: Sentiment analysis, topic extraction, keyword extraction, text classification
- **Linguistic Analysis**: Grammar checking, style analysis, readability scoring, language complexity
- **Advanced NLP**: Text summarization, question answering, language modeling

Translation Guidelines:
- Detect source language automatically when not specified
- Provide accurate, context-aware translations
- Preserve formatting (bold, italics, etc.) when possible
- Include source and target language labels clearly
- Provide translation confidence scores when available
- Offer alternative translations for ambiguous phrases
- Include cultural notes for context-sensitive translations
- Handle technical terms and domain-specific vocabulary correctly

NLP Analysis Guidelines:
- Provide comprehensive NLP analysis with multiple sections
- Use clear headings and structure (markdown format)
- Include quantitative metrics when applicable
- Extract key linguistic features
- Identify sentiment, entities, and topics
- Assess language complexity and readability
- Provide actionable linguistic insights

Response Format:
For translations, structure with:
- **Translation** section (source and target text)
- **Language Details** section (source, target, confidence)
- **Alternative Translations** section (when relevant)
- **Cultural Notes** section (when applicable)

For NLP analysis, structure with:
- **Language Detection** section
- **Sentiment Analysis** section
- **Named Entities** section
- **Key Topics** section
- **Linguistic Features** section

Your name: Translation & NLP Assistant
Powered by: Bushra Technologies and Services
Role: Expert Translation and Natural Language Processing Assistant`;

    // Add system message with LoRA prompt
    messages.push({
      role: 'system',
      content: translationNLPSystemPrompt
    });

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      // Reverse the history to maintain chronological order (oldest first)
      const reversedHistory = [...conversationHistory].reverse();
      
      for (const msg of reversedHistory) {
        if (msg.role && msg.content) {
          // Validate role
          if (['user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role,
              content: String(msg.content)
            });
          }
        }
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message.trim()
    });

    console.log('Messages array prepared:', JSON.stringify(messages, null, 2));

    // Call LongCat API with retry mechanism
    const apiUrl = `${LONGCAT_API_BASE}/openai/v1/chat/completions`;
    console.log('Calling LongCat API:', apiUrl);
    
    const apiResponse = await retryWithBackoff(() =>
      callLongCatAPI(messages, {
        max_tokens: 2000, // Higher token limit for comprehensive translations/NLP
        temperature: 0.3, // Lower temperature for more accurate translations
        stream: false
      })
    );

    console.log('LongCat API Response Status: 200');
    console.log('LongCat API Response Data:', JSON.stringify(apiResponse, null, 2));

    // Extract AI response from different possible formats
    let aiResponse = '';
    
    // Format 1: OpenAI format (choices[0].message.content)
    if (apiResponse.choices && apiResponse.choices[0]?.message?.content) {
      aiResponse = apiResponse.choices[0].message.content;
    }
    // Format 2: Direct response format
    else if (apiResponse.response) {
      aiResponse = apiResponse.response;
    }
    // Format 3: Anthropic format (content array)
    else if (apiResponse.content && Array.isArray(apiResponse.content)) {
      aiResponse = apiResponse.content[0]?.text || '';
    }
    // Format 4: Other possible formats
    else if (apiResponse.text) {
      aiResponse = apiResponse.text;
    }
    else if (apiResponse.message) {
      aiResponse = apiResponse.message;
    }
    else if (apiResponse.content) {
      aiResponse = apiResponse.content;
    }
    else {
      // Fallback: try to extract any text field
      console.warn('Unexpected response format, attempting to extract text');
      aiResponse = JSON.stringify(apiResponse);
    }

    // Return response in frontend-compatible format
    const response = {
      success: true,
      response: aiResponse
    };

    // Optionally add structured data if available
    if (apiResponse.sourceLanguage) {
      response.sourceLanguage = apiResponse.sourceLanguage;
    }
    if (apiResponse.targetLanguage) {
      response.targetLanguage = apiResponse.targetLanguage;
    }
    if (apiResponse.confidence) {
      response.confidence = apiResponse.confidence;
    }
    
    console.log('Final Response Status: 200');
    console.log('Final Response Data:', JSON.stringify(response, null, 2));
    console.log('=== End Request ===\n');
    
    res.json(response);
  } catch (error) {
    console.error('\n=== Translation & NLP API Error ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('=== End Error ===\n');

    // Handle different error types
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      if (status === 401) {
        const errorResponse = {
          success: false,
          error: 'Invalid API Key. Please check your CHAT_KEY environment variable.'
        };
        console.log('Response Status: 401');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(401).json(errorResponse);
      }

      if (status === 403) {
        const errorResponse = {
          success: false,
          error: 'API Key has insufficient quota or permissions'
        };
        console.log('Response Status: 403');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(403).json(errorResponse);
      }

      if (status === 429) {
        const errorResponse = {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          retry_after: errorData?.error?.retry_after || 60
        };
        console.log('Response Status: 429');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(429).json(errorResponse);
      }

      if (status >= 500) {
        const errorResponse = {
          success: false,
          error: 'LongCat API server error. Please try again later.'
        };
        console.log('Response Status: 502');
        console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
        return res.status(502).json(errorResponse);
      }

      const errorResponse = {
        success: false,
        error: errorData?.error?.message || error.message || 'An error occurred'
      };
      console.log(`Response Status: ${status}`);
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(status).json(errorResponse);
    }

    if (error.code === 'ECONNABORTED') {
      const errorResponse = {
        success: false,
        error: 'Request timeout. The API took too long to respond.'
      };
      console.log('Response Status: 504');
      console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
      return res.status(504).json(errorResponse);
    }

    // Generic error
    const errorResponse = {
      success: false,
      error: error.message || 'Internal server error'
    };
    console.log('Response Status: 500');
    console.log('Response Data:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      type: 'not_found_error',
      code: 'endpoint_not_found'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`💻 Code Generation endpoint: http://localhost:${PORT}/api/code-generation`);
  console.log(`📊 Text Analysis endpoint: http://localhost:${PORT}/api/text-analysis`);
  console.log(`🌐 Translation & NLP endpoint: http://localhost:${PORT}/api/translation-nlp`);
  
  if (!process.env.CHAT_KEY) {
    console.warn('⚠️  WARNING: CHAT_KEY environment variable is not set!');
  }
});

