# Backend & WebSocket API Documentation

## Overview

This document describes the backend API endpoints and WebSocket events required to support the presence layer and enhanced chat flow. The implementation includes:

1. **Presence Layer** - Track user online/offline status on page load
2. **Chat Bubble Click** - Handle welcome message and name collection
3. **Conversation Lifecycle** - Initialize, track, and manage conversations
4. **Inactivity Handling** - Auto-close conversations after 15 minutes, allow reopening

## Base URL

All API requests go through the Gateway:
```
https://api-gateway-dfcflow.fly.dev
```

Configure via environment variable:
```env
NEXT_PUBLIC_GATEWAY_URL=https://your-gateway-url.com
```

## Authentication

### Gateway Authentication

All requests require API key authentication:
```http
Authorization: Bearer <api-key>
```

### Domain Resolution

Gateway extracts domain from headers in priority order:
1. `X-Website-Origin` header (preferred)
2. `Origin` header (fallback)
3. `Referer` header (fallback)

Gateway then:
- Queries `webchat_integration` table for domain → gets `tenant_id`
- Sets `X-Tenant-ID` header before forwarding to backend

## HTTP API Endpoints

### 1. POST /webchat/session

**Purpose:** Initialize presence layer on page load. Tracks user online/offline status, enables idle timers, retargeting, and AI greeting triggers.

**When Called:** On page load (when browser loads the widget)

**Request Headers:**
```http
Authorization: Bearer <api-key>
Content-Type: application/json
X-Website-Origin: https://example.com
X-Website-Domain: example.com
```

**Request Body:**
```json
{
  "domain": "example.com",
  "origin": "https://example.com",
  "url": "https://example.com/page",
  "referrer": "https://google.com",
  "siteId": "site-123",
  "sessionId": "session-789-abc123",
  "fingerprint": "a1b2c3d4e5f6g7h8",
  "tenantId": "tenant-123",
  "userId": "user-456",
  "userName": "John Doe",
  "email": "john@example.com",
  "userInfo": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890"
  }
}
```

**Field Descriptions:**
- `domain`, `origin`, `url`, `referrer`, `siteId` - Website context (always sent)
- `sessionId` - Client-generated session ID (always sent)
- `fingerprint` - Browser fingerprint for user identification (always sent)
- `tenantId` - Optional, Gateway resolves from domain if not provided
- `userId` - Optional, for logged-in users
- `userName`, `email` - Optional, extracted from `userInfo` if available
- `userInfo` - Optional, full user information object

**Response:**
```json
{
  "tenant_id": "tenant-123",
  "site_id": "site-123",
  "session_id": "session-789-abc123",
  "ws_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "websocket_url": "wss://ws-server.example.com"
}
```

**Backend Actions:**
1. Create or update presence record in Redis:
   ```redis
   SET presence_online:{session_id} {
     "tenant_id": "tenant-123",
     "site_id": "site-123",
     "session_id": "session-789-abc123",
     "status": "initial",
     "created_at": "2024-01-15T10:30:00.000Z",
     "last_activity": "2024-01-15T10:30:00.000Z",
     "user_id": "user-456",
     "domain": "example.com"
   }
   EXPIRE presence_online:{session_id} 3600
   ```

2. Generate JWT token (`ws_token`) with:
   - `session_id`
   - `tenant_id`
   - `site_id`
   - `user_id` (if logged in)
   - Expiration: 1 hour

3. Return WebSocket connection details

**WebSocket Broadcast:**
- Broadcast to room `session:{session_id}`:
  ```json
  {
    "event": "session:update",
    "session_id": "session-789-abc123",
    "status": "initial",
    "tenant_id": "tenant-123",
    "site_id": "site-123"
  }
  ```

### 2. POST /webchat/open

**Purpose:** Handle chat bubble click. Updates presence status and triggers welcome message flow.

**When Called:** When user clicks the chat bubble

**Request Headers:**
```http
Authorization: Bearer <api-key>
Content-Type: application/json
X-Website-Origin: https://example.com
X-Website-Domain: example.com
```

**Request Body:**
```json
{
  "sessionId": "session-789-abc123",
  "domain": "example.com",
  "origin": "https://example.com",
  "url": "https://example.com/page",
  "referrer": "https://google.com",
  "siteId": "site-123",
  "tenantId": "tenant-123"
}
```

**Response:**
```json
{
  "success": true,
  "session_id": "session-789-abc123"
}
```

**Backend Actions:**
1. Update presence record in Redis:
   ```redis
   SET presence_online:{session_id} {
     "tenant_id": "tenant-123",
     "site_id": "site-123",
     "session_id": "session-789-abc123",
     "status": "bubble_click",
     "created_at": "2024-01-15T10:30:00.000Z",
     "last_activity": "2024-01-15T10:35:00.000Z"
   }
   ```

2. Update `last_activity` timestamp

**WebSocket Broadcast:**
- Broadcast to room `session:{session_id}`:
  ```json
  {
    "event": "session:update",
    "session_id": "session-789-abc123",
    "status": "bubble_click",
    "tenant_id": "tenant-123",
    "site_id": "site-123"
  }
  ```

### 3. POST /webchat/init

**Purpose:** Initialize or retrieve conversation. Called after user enters their name.

**When Called:** After user submits their name in the welcome message

**Request Headers:**
```http
Authorization: Bearer <api-key>
Content-Type: application/json
X-Website-Origin: https://example.com
X-Website-Domain: example.com
```

**Request Body:**
```json
{
  "domain": "example.com",
  "origin": "https://example.com",
  "url": "https://example.com/page",
  "referrer": "https://google.com",
  "siteId": "site-123",
  "tenantId": "tenant-123",
  "visitorId": "visitor-uuid-here",
  "userId": "user-456",
  "userInfo": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

**Response:**
```json
{
  "conversation_id": "conv-uuid-here",
  "visitor_id": "visitor-uuid",
  "ws_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "ws_server_url": "wss://ws-server.example.com",
  "tenant_id": "tenant-123",
  "integration_id": "integration-123",
  "site_id": "site-123",
  "expires_in": 900,
  "closed_at": null
}
```

**Backend Actions:**
1. Create or retrieve conversation:
   - If `visitorId` provided and conversation exists → return existing conversation
   - If `visitorId` provided but conversation closed → create new conversation
   - If no `visitorId` → create new conversation

2. Generate JWT token with:
   - `conversation_id`
   - `visitor_id`
   - `tenant_id`
   - `integration_id`
   - `site_id`
   - Expiration: 15 minutes (900 seconds)

3. Store conversation in database with:
   - `conversation_id`
   - `visitor_id`
   - `tenant_id`
   - `status`: "active"
   - `created_at`
   - `last_activity`

**WebSocket Broadcast:**
- Broadcast to room `session:{session_id}`:
  ```json
  {
    "event": "conversation:created",
    "conversation_id": "conv-uuid-here",
    "visitor_id": "visitor-uuid",
    "session_id": "session-789-abc123"
  }
  ```

### 4. POST /webchat/message

**Purpose:** Send a message. Supports reopening closed conversations.

**When Called:** When user sends a message

**Request Headers:**
```http
Authorization: Bearer <api-key>
Content-Type: application/json
X-Website-Origin: https://example.com
X-Website-Domain: example.com
```

**Request Body:**
```json
{
  "text": "Hello",
  "conversation_id": "conv-uuid-here",
  "sessionId": "session-789-abc123",
  "fingerprint": "a1b2c3d4e5f6g7h8",
  "sender_name": "John",
  "tenantId": "tenant-123",
  "domain": "example.com",
  "origin": "https://example.com",
  "url": "https://example.com/page",
  "referrer": "https://google.com",
  "siteId": "site-123",
  "userId": "user-456",
  "userInfo": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

**Response (Active Conversation):**
```json
{
  "success": true,
  "message": {
    "id": "msg-123",
    "text": "Hello",
    "sender": "user",
    "timestamp": "2024-01-15T10:40:00.000Z",
    "conversation_id": "conv-uuid-here"
  }
}
```

**Response (Reopened Conversation):**
```json
{
  "success": true,
  "message": {
    "id": "msg-124",
    "text": "Hello again",
    "sender": "user",
    "timestamp": "2024-01-15T10:50:00.000Z",
    "conversation_id": "conv-uuid-here"
  },
  "conversation_reopened": true
}
```

**Backend Actions:**
1. Check conversation status:
   - If `conversation_id` provided and conversation exists:
     - If status is "closed" → **Reopen conversation**:
       - Update `status` to "active"
       - Clear `closed_at`
       - Update `last_activity`
     - If status is "active" → Continue normally

2. Save message to database:
   - `message_id`
   - `conversation_id`
   - `text`
   - `sender_type`: "user"
   - `sender_name`: From request (if provided)
   - `sender_id`: `userId` or `visitor_id`
   - `created_at`

3. Update conversation `last_activity` timestamp

4. Push message to Redis stream `chat_incoming` for processing

**WebSocket Broadcast:**
- Broadcast to room `conversation:{conversation_id}`:
  ```json
  {
    "event": "meta_message_created",
    "message": {
      "id": "msg-123",
      "text": "Hello",
      "sender_type": "user",
      "sender_name": "John",
      "conversation_id": "conv-uuid-here",
      "created_at": "2024-01-15T10:40:00.000Z"
    }
  }
  ```

- If conversation was reopened, also broadcast:
  ```json
  {
    "event": "conversation:reopened",
    "conversation_id": "conv-uuid-here"
  }
  ```

## WebSocket API

### Connection

**URL:** From `websocket_url` in `/webchat/session` or `/webchat/init` response

**Connection Options:**
```javascript
{
  auth: {
    token: "<ws_token>"
  },
  query: {
    token: "<ws_token>"
  },
  extraHeaders: {
    'Authorization': 'Bearer <ws_token>'
  },
  transports: ['websocket', 'polling'],
  reconnection: true
}
```

### Rooms

#### Session Room: `session:{session_id}`

**Purpose:** Presence tracking, session updates, conversation creation notifications

**Join Event:**
```javascript
socket.emit('join:session', { sessionId: 'session-789-abc123' });
```

**Leave Event:**
```javascript
socket.emit('leave:session', { sessionId: 'session-789-abc123' });
```

**Events Received:**
- `session:update` - Presence status updates
- `conversation:created` - Conversation initialized (contains `conversation_id`)

#### Conversation Room: `conversation:{conversation_id}`

**Purpose:** Real-time message delivery, conversation status updates

**Join Event:**
```javascript
socket.emit('join:conversation', { conversationId: 'conv-uuid-here' });
```

**Events Received:**
- `meta_message_created` - New message (user, agent, or bot)
- `conversation:closed` - Conversation closed due to inactivity
- `conversation:reopened` - Conversation reopened

### WebSocket Events

#### Client → Server

**`join:session`**
```json
{
  "sessionId": "session-789-abc123"
}
```

**`leave:session`**
```json
{
  "sessionId": "session-789-abc123"
}
```

**`join:conversation`**
```json
{
  "conversationId": "conv-uuid-here"
}
```

**`message`**
```json
{
  "type": "message",
  "text": "Hello",
  "conversation_id": "conv-uuid-here",
  "tenant_id": "tenant-123",
  "sender_name": "John",
  "timestamp": "2024-01-15T10:40:00.000Z"
}
```

#### Server → Client

**`session:update`**
```json
{
  "session_id": "session-789-abc123",
  "status": "initial" | "bubble_click",
  "tenant_id": "tenant-123",
  "site_id": "site-123",
  "conversation_id": "conv-uuid-here"
}
```

**`conversation:created`**
```json
{
  "conversation_id": "conv-uuid-here",
  "visitor_id": "visitor-uuid",
  "session_id": "session-789-abc123"
}
```

**`meta_message_created`**
```json
{
  "message": {
    "id": "msg-123",
    "text": "Hello",
    "sender_type": "user" | "agent" | "bot",
    "sender_name": "John",
    "conversation_id": "conv-uuid-here",
    "created_at": "2024-01-15T10:40:00.000Z"
  }
}
```

**`conversation:closed`**
```json
{
  "conversation_id": "conv-uuid-here",
  "reason": "inactivity",
  "closed_at": "2024-01-15T10:55:00.000Z"
}
```

**`conversation:reopened`**
```json
{
  "conversation_id": "conv-uuid-here",
  "reopened_at": "2024-01-15T11:00:00.000Z"
}
```

**`joined`** (Confirmation)
```json
{
  "conversation_id": "conv-uuid-here",
  "room": "conversation:conv-uuid-here"
}
```

## Redis Data Structures

### Presence Tracking

**Key:** `presence_online:{session_id}`

**Value (JSON):**
```json
{
  "tenant_id": "tenant-123",
  "site_id": "site-123",
  "session_id": "session-789-abc123",
  "status": "initial" | "bubble_click",
  "created_at": "2024-01-15T10:30:00.000Z",
  "last_activity": "2024-01-15T10:35:00.000Z",
  "user_id": "user-456",
  "domain": "example.com"
}
```

**TTL:** 3600 seconds (1 hour)

**Operations:**
- `SET presence_online:{session_id} <json>` - Create/update presence
- `GET presence_online:{session_id}` - Get presence status
- `EXPIRE presence_online:{session_id} 3600` - Set expiration

### Conversation Status

**Key:** `conversation:{conversation_id}`

**Value (JSON):**
```json
{
  "conversation_id": "conv-uuid-here",
  "visitor_id": "visitor-uuid",
  "tenant_id": "tenant-123",
  "status": "active" | "closed",
  "created_at": "2024-01-15T10:35:00.000Z",
  "last_activity": "2024-01-15T10:40:00.000Z",
  "closed_at": null
}
```

**TTL:** 86400 seconds (24 hours)

## Inactivity Handling

### 15-Minute Inactivity Timer

**Backend Implementation:**

1. **Timer Setup:**
   - When conversation is created or last message sent, set timer for 15 minutes
   - Timer key: `conversation_timer:{conversation_id}`
   - Timer value: Unix timestamp when conversation should close

2. **Timer Check:**
   - Background job runs every minute
   - Check all active conversations: `last_activity < (now - 15 minutes)`
   - Close conversations that exceed 15 minutes of inactivity

3. **Close Conversation:**
   ```javascript
   // Update conversation status
   UPDATE conversations
   SET status = 'closed',
       closed_at = NOW()
   WHERE conversation_id = ? AND status = 'active';
   
   // Broadcast to WebSocket room
   io.to(`conversation:${conversation_id}`).emit('conversation:closed', {
     conversation_id: conversation_id,
     reason: 'inactivity',
     closed_at: new Date().toISOString()
   });
   ```

4. **Auto-Reopen:**
   - When message sent to closed conversation:
     ```javascript
     // Check if conversation is closed
     if (conversation.status === 'closed') {
       // Reopen conversation
       UPDATE conversations
       SET status = 'active',
           closed_at = NULL,
           last_activity = NOW()
       WHERE conversation_id = ?;
       
       // Broadcast reopen event
       io.to(`conversation:${conversation_id}`).emit('conversation:reopened', {
         conversation_id: conversation_id,
         reopened_at: new Date().toISOString()
       });
     }
     ```

## Database Schema

### conversations Table

```sql
CREATE TABLE conversations (
  conversation_id UUID PRIMARY KEY,
  visitor_id UUID NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  integration_id VARCHAR(255),
  site_id VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active' | 'closed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP NULL,
  INDEX idx_tenant_id (tenant_id),
  INDEX idx_visitor_id (visitor_id),
  INDEX idx_status (status),
  INDEX idx_last_activity (last_activity)
);
```

### messages Table

```sql
CREATE TABLE messages (
  message_id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  text TEXT NOT NULL,
  sender_type VARCHAR(50) NOT NULL, -- 'user' | 'agent' | 'bot'
  sender_name VARCHAR(255),
  sender_id VARCHAR(255), -- userId or visitorId
  tenant_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id),
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_created_at (created_at)
);
```

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Error Codes

- `INVALID_API_KEY` - Invalid API key
- `INVALID_SESSION` - Session not found or expired
- `INVALID_CONVERSATION` - Conversation not found
- `CONVERSATION_CLOSED` - Conversation is closed (can be reopened)
- `MISSING_TENANT_ID` - Tenant ID is required
- `RATE_LIMIT_EXCEEDED` - Rate limit exceeded

## Rate Limiting

- **HTTP API**: 100 requests per minute per IP
- **WebSocket**: 10 messages per second per connection
- **Rate limit headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Testing Checklist

- [ ] POST /webchat/session creates presence record in Redis
- [ ] POST /webchat/session returns valid ws_token and websocket_url
- [ ] POST /webchat/open updates presence status to "bubble_click"
- [ ] WebSocket connects with ws_token
- [ ] Client joins session room on presence connection
- [ ] POST /webchat/init creates conversation
- [ ] WebSocket broadcasts conversation:created to session room
- [ ] Client switches from session room to conversation room
- [ ] POST /webchat/message sends message successfully
- [ ] Conversation closes after 15 minutes of inactivity
- [ ] WebSocket broadcasts conversation:closed event
- [ ] POST /webchat/message to closed conversation reopens it
- [ ] WebSocket broadcasts conversation:reopened event

## Implementation Notes

1. **Presence vs Conversation:**
   - Presence layer (session room) tracks online/offline status
   - Conversation layer (conversation room) handles message delivery
   - Frontend switches from session room to conversation room when conversation_id is available

2. **Room Switching:**
   - Frontend starts in `session:{session_id}` room
   - When `conversation:created` event received, frontend switches to `conversation:{conversation_id}` room
   - Frontend can receive `conversation_id` via:
     - `conversation:created` event in session room
     - `session:update` event with `conversation_id` field
     - `/webchat/init` response

3. **Backend-Initiated Conversations:**
   - If backend creates conversation before frontend calls `/webchat/init`, backend broadcasts `conversation:created` to session room
   - Frontend receives event and switches to conversation room automatically

4. **Inactivity Timer:**
   - Timer resets on every message sent/received
   - Timer only applies to active conversations
   - Closed conversations can be reopened by sending a message

5. **Sender Name:**
   - Collected from welcome message (frontend stores in localStorage)
   - Included in message payload as `sender_name`
   - Used for display in admin panel and message history

