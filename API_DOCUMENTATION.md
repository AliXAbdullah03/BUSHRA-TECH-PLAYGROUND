# Chat API Documentation

## Endpoint
`POST http://localhost:3000/api/chat`

## Request Format

### Initial Message Request
For the initial greeting message when the chat loads:

```json
{
  "message": "",
  "isInitial": true
}
```

**Response:**
```json
{
  "response": "Hello! I'm your AI assistant. How can I help you today?"
}
```

### User Message Request
For subsequent user messages:

```json
{
  "message": "user's message text here",
  "conversationHistory": [
    {
      "role": "assistant",
      "content": "previous AI response"
    },
    {
      "role": "user",
      "content": "previous user message"
    }
  ]
}
```

**Note:** The `conversationHistory` array should be in reverse chronological order (most recent first), but the API will handle it correctly.

## Response Format

The API returns responses in a format compatible with the frontend. The frontend accepts multiple formats:

### Format 1 (Primary):
```json
{
  "response": "AI response text"
}
```

### Alternative Formats (also supported):
```json
{
  "message": "AI response text"
}
```

```json
{
  "text": "AI response text"
}
```

```json
{
  "content": "AI response text"
}
```

### OpenAI Format (also supported):
```json
{
  "choices": [
    {
      "message": {
        "content": "AI response text"
      }
    }
  ]
}
```

## Debugging

The endpoint includes comprehensive console logging for debugging:

### Request Logging
- **URL**: The full URL being called
- **Request Body**: The complete request body sent to the endpoint

### API Call Logging
- **LongCat API URL**: The LongCat API endpoint being called
- **LongCat API Request Body**: The request sent to LongCat API
- **LongCat API Response Status**: HTTP status from LongCat API
- **LongCat API Response Data**: Complete response from LongCat API

### Response Logging
- **Response Status**: HTTP status code returned to frontend
- **Response Data**: The final response data sent to frontend

### Error Logging
- **Error Details**: Complete error information
- **Error Response Status**: HTTP status code for errors
- **Error Response Data**: Error response details

All logs are formatted with clear separators (`===`) for easy reading in the console.

## Example Usage

### Initial Message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "",
    "isInitial": true
  }'
```

### User Message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is JavaScript?",
    "conversationHistory": [
      {
        "role": "assistant",
        "content": "Hello! I'\''m your AI assistant. How can I help you today?"
      },
      {
        "role": "user",
        "content": "Hello"
      }
    ]
  }'
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "error_type",
    "code": "error_code"
  }
}
```

### Common Error Codes

- **400**: Invalid request parameters
- **401**: Invalid API key
- **403**: Insufficient quota or permissions
- **429**: Rate limit exceeded
- **500**: Internal server error
- **502**: LongCat API server error
- **504**: Request timeout

## Implementation Details

### Message Processing
1. System message is automatically added for context
2. Conversation history is processed and added to the message array
3. Current user message is appended
4. Messages are sent to LongCat API in chronological order

### Rate Limiting
- Automatic exponential backoff retry on 429 errors
- Maximum 5 retry attempts
- Respects `retry_after` value from API response

### Response Extraction
The API handles multiple response formats from LongCat:
- OpenAI format (`choices[0].message.content`)
- Direct response format (`response`)
- Anthropic format (`content[0].text`)
- Fallback formats (`text`, `message`, `content`)

## Environment Variables

Required:
- `CHAT_KEY`: Your LongCat API key

Optional:
- `PORT`: Server port (default: 3000)

