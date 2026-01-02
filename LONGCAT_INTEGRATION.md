# LongCat AI Integration Guide

## Overview
This guide explains how to integrate LongCat AI with the AI Chat Assistant feature in the playground.

## Backend API Endpoint
The endpoint is already created at: `/app/api/playground/chat/route.ts`

## Environment Variables Required

Add these to your `.env.local` file:

```env
# LongCat API Key (use either CHAT_KEY or LONGCAT_AI_API_KEY)
CHAT_KEY=your_longcat_api_key_here

# Alternative option:
# LONGCAT_AI_API_KEY=your_longcat_api_key_here
```

**Important Notes:**
- The API uses `https://api.longcat.chat` (not `api.longcat.ai`)
- The model is set to `LongCat-Flash-Chat`
- The endpoint is `/openai/v1/chat/completions`

## LongCat AI API Integration

### Current Implementation
The endpoint is set up to call LongCat AI with the following structure:

```typescript
POST https://api.longcat.chat/openai/v1/chat/completions
Headers:
  Content-Type: application/json
  Authorization: Bearer {CHAT_KEY}
Body:
{
  "model": "LongCat-Flash-Chat",
  "messages": [
    {
      "role": "user",
      "content": "user message here"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### Response Format
LongCat AI returns responses in OpenAI-compatible format:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "LongCat-Flash-Chat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "AI response text here"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 15,
    "total_tokens": 35
  }
}
```

The API route handles multiple response formats and normalizes them to a consistent structure.

## Setup Instructions

### Step 1: Get LongCat AI API Credentials
1. Sign up for LongCat AI service
2. Obtain your API key from the dashboard
3. The API endpoint is `https://api.longcat.chat`

### Step 2: Configure Environment Variables
Create a `.env.local` file in the root directory:

```env
CHAT_KEY=your_actual_api_key_here
```

**Note:** Replace `your_actual_api_key_here` with your actual LongCat AI API key.

### Step 3: Install Dependencies (if using Next.js)

If you're using the Next.js API route, install Next.js dependencies:

```bash
npm install next react react-dom
npm install -D typescript @types/node @types/react @types/react-dom
```

### Step 4: Start the Server

**For Next.js:**
```bash
npm run next:dev
```

**For Express.js (standalone):**
```bash
npm run dev
```

### Step 5: Test the Integration
1. Start your development server
2. Navigate to your chat interface
3. Send a test message to verify the response comes from LongCat AI

## API Endpoint Usage

### Endpoint
```
POST /api/playground/chat
```

### Request Body
```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful AI assistant for Bushra Tech. Be professional, friendly, and concise."
    },
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "max_tokens": 1000,
  "temperature": 0.7
}
```

### Parameters
- `messages` (required): Array of message objects with `role` and `content`
  - `role`: Must be one of `"system"`, `"user"`, or `"assistant"`
  - `content`: The message text
- `max_tokens` (optional): Maximum tokens to generate (default: 1000, max: 8192)
- `temperature` (optional): Sampling temperature between 0 and 1 (default: 0.7)
- `stream` (optional): Whether to stream the response (default: false)
- `top_p` (optional): Nucleus sampling parameter
- `enable_thinking` (optional): Enable thinking mode (default: false)
- `thinking_budget` (optional): Maximum length of thinking content (min: 1024)

### Response
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking. How can I help you today?"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 15,
    "total_tokens": 35
  },
  "model": "LongCat-Flash-Chat"
}
```

## Customization Options

### Adjusting AI Behavior
You can modify the AI's behavior by changing these parameters:

- **temperature** (0.0 - 1.0): Controls randomness. Lower = more focused, Higher = more creative
- **max_tokens**: Maximum length of the response (max: 8192)
- **model**: Currently set to `LongCat-Flash-Chat`

### Adding System Prompts
To add a system prompt for context, include it in the messages array:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful AI assistant for Bushra Tech. Be professional, friendly, and concise."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ]
}
```

## Error Handling

The endpoint includes comprehensive error handling for:

- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Invalid or missing API key
- **403 Forbidden**: Insufficient quota or permissions
- **429 Too Many Requests**: Rate limit exceeded (with automatic retry)
- **500 Internal Server Error**: Server-side errors
- **502 Bad Gateway**: LongCat API errors

### Rate Limiting

When rate limiting is detected (429 status), the backend automatically implements exponential backoff retry mechanism:
- Base delay: 1 second
- Maximum retries: 5 attempts
- Respects `retry_after` value from API response

## Rate Limiting Rules

LongCat API has the following rate limits:
- **Maximum output**: 8K tokens per request
- **Rate limit response**: HTTP 429 with `retry_after` field
- **Automatic retry**: The backend automatically retries with exponential backoff

### Example Rate Limit Response
```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Request rate limit exceeded, please try again later",
    "type": "rate_limit_error",
    "retry_after": 60
  }
}
```

## Security Considerations

1. **Never expose API keys** in client-side code
2. **Validate user input** before sending to AI
3. **Sanitize AI responses** before displaying to users
4. **Implement request timeouts** to prevent hanging requests
5. **Add CORS protection** if needed (already configured)
6. **Use environment variables** for sensitive data (already implemented)

## Monitoring

The endpoint logs:
- API call frequency
- Error rates
- Rate limit retries
- Response times

Check your server console for detailed logs.

## Testing Checklist

- [ ] Environment variables are set correctly in `.env.local`
- [ ] API key is valid and has sufficient credits
- [ ] Server is running (Next.js or Express)
- [ ] API endpoint is accessible
- [ ] User messages are sent to backend
- [ ] AI responses are received and displayed
- [ ] Error handling works for invalid requests
- [ ] Rate limiting retry mechanism works
- [ ] Message validation works correctly

## Example Usage

### Using Fetch API (JavaScript)

```javascript
const response = await fetch('/api/playground/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Hello!' }
    ],
    max_tokens: 1000,
    temperature: 0.7
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Using cURL

```bash
curl -X POST http://localhost:3000/api/playground/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 1000
  }'
```

## Support

If you encounter issues:

1. **Check the browser console** for frontend errors
2. **Check the server logs** for backend errors
3. **Verify API credentials** are correct in `.env.local`
4. **Test the LongCat AI API directly** using curl or Postman:
   ```bash
   curl -X POST https://api.longcat.chat/openai/v1/chat/completions \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "LongCat-Flash-Chat",
       "messages": [{"role": "user", "content": "Hello!"}],
       "max_tokens": 1000
     }'
   ```
5. **Review LongCat AI documentation** for API changes
6. **Check rate limits** - you may have exceeded your daily quota

## Notes

- Keep your `CHAT_KEY` secure and never commit it to version control
- The `.env.local` file is already in `.gitignore`
- Unused daily quota does not carry over to the next day
- Maximum tokens per request is 8192
- The API uses OpenAI-compatible format for easy integration

