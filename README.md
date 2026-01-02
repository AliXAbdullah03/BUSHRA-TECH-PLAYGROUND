# Bushra Tech Playground - AI Chat Backend

Backend server for AI Chat Feature using LongCat API.

## Features

- ✅ LongCat API integration
- ✅ Exponential backoff retry mechanism for rate limiting
- ✅ Comprehensive error handling
- ✅ Input validation
- ✅ CORS enabled for frontend integration
- ✅ Environment variable configuration

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your LongCat API key:

```
CHAT_KEY=your_longcat_api_key_here
PORT=3000
```

### 3. Start the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## API Endpoints

### Health Check

```
GET /health
```

Returns server status.

**Response:**
```json
{
  "status": "ok",
  "message": "Server is running"
}
```

### Chat Completion

```
POST /api/chat
```

Send a chat message to the LongCat AI model.

**Request Body:**
```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "stream": false
}
```

**Parameters:**
- `messages` (required): Array of message objects with `role` and `content`
  - `role`: Must be one of `"system"`, `"user"`, or `"assistant"`
  - `content`: The message text
- `max_tokens` (optional): Maximum tokens to generate (default: 1000, max: 8192)
- `temperature` (optional): Sampling temperature between 0 and 1 (default: 0.7)
- `stream` (optional): Whether to stream the response (default: false)
- `top_p` (optional): Nucleus sampling parameter
- `enable_thinking` (optional): Enable thinking mode (default: false)
- `thinking_budget` (optional): Maximum length of thinking content (min: 1024)

**Response:**
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
        "content": "Hello! I'm doing well, thank you for asking. How can I help you today?"
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

## Error Handling

The API handles various error scenarios:

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

## Example Usage

### Using cURL

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 1000
  }'
```

### Using JavaScript (Fetch)

```javascript
const response = await fetch('http://localhost:3000/api/chat', {
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

## Rate Limiting

LongCat API has the following rate limits:
- Maximum output: 8K tokens per request
- When rate limit is exceeded, the API returns HTTP 429
- The backend automatically retries with exponential backoff

## Notes

- Keep your `CHAT_KEY` secure and never commit it to version control
- The `.env` file is already in `.gitignore`
- Unused daily quota does not carry over to the next day
- Maximum tokens per request is 8192

## License

ISC

