# Admin Online Users Integration Guide

This guide explains how to integrate online users tracking into your admin application. The chat widget provides utilities for tracking which users are currently online in real-time.

## Overview

The online users tracking system provides:
- **Real-time updates** via WebSocket when users come online/go offline
- **HTTP API endpoint** for fetching current online users list
- **React hook** (`useOnlineUsers`) for easy integration
- **TypeScript types** for type-safe integration

## Architecture

The system follows a **Gateway → Backend Services** architecture:

```
Widget/Admin UI → Gateway (Authentication) → Backend Services
                              ├─→ Backend WebSocket Server (presence tracking via Redis)
                              └─→ Backend API Server (HTTP endpoint)
```

**Key Points:**
- ✅ All connections (HTTP and WebSocket) **must** go through Gateway
- ✅ Gateway handles **all JWT authentication**
- ✅ Gateway issues anonymous tokens via `POST /api/chat/anonymous-token`
- ✅ Backend services trust Gateway (no JWT verification needed)
- ✅ Widget **never** connects directly to backend services

### Data Flow

1. **Anonymous user connects:**
   - Widget requests token: `POST /api/chat/anonymous-token` → Gateway
   - Gateway generates JWT token → Returns to widget
   - Widget connects WebSocket: `Gateway` → Gateway verifies JWT → Proxies to WebSocket Server
   - WebSocket Server tracks connection in Redis

2. **Admin user connects:**
   - Admin has JWT token from login
   - Admin connects WebSocket: `Gateway` → Gateway verifies JWT → Proxies to WebSocket Server
   - WebSocket Server tracks connection in Redis

3. **User comes online:**
   - WebSocket Server stores in Redis: `online_users:{tenantId}`
   - WebSocket Server emits `user_online` event → Broadcasts to admin rooms
   - Admin UI receives event via WebSocket → Updates UI in real-time

4. **Admin requests list:**
   - Admin UI → Gateway: `GET /api/chat/online-users` (with JWT token)
   - Gateway verifies admin JWT → Routes to Backend API Server
   - Backend API Server queries Redis → Returns list
   - Gateway → Admin UI: Returns response

## Backend Requirements

### Gateway (Required - Authentication & Routing Layer)

**IMPORTANT:** All connections (HTTP and WebSocket) must go through the Gateway. The widget always connects to the Gateway, never directly to backend services.

**Responsibilities:**
- **JWT Authentication**: Verify JWT tokens for all connections (HTTP and WebSocket)
- **Issue Anonymous Tokens**: Generate JWT tokens for anonymous chat users
- **Route HTTP requests**: `GET /api/chat/online-users` → Backend API Server
- **Proxy WebSocket connections**: All WebSocket connections → Backend WebSocket Server
- **Admin authorization**: Verify admin role for protected endpoints
- **Rate limiting**: Optional protection against abuse
- **Load balancing**: Optional distribution across backend instances

**Required Endpoints:**

1. **`POST /api/chat/anonymous-token`** - Issue JWT token for anonymous users
   - **Request:**
     ```json
     {
       "tenantId": "tenant-123"
     }
     ```
   - **Response:**
     ```json
     {
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
       "expiresIn": 3600
     }
     ```
   - **Implementation:**
     ```javascript
     // Gateway generates JWT for anonymous user
     const token = jwt.sign({
       userId: `anonymous-${generateId()}`,
       tenantId: req.body.tenantId,
       role: 'user',
       anonymous: true
     }, JWT_SECRET, { expiresIn: '1h' });
     ```

2. **WebSocket Proxy** - Proxy all WebSocket connections
   - Gateway receives WebSocket connection with JWT token
   - Gateway verifies JWT token using `JWT_SECRET`
   - Gateway proxies connection to Backend WebSocket Server
   - Gateway can either:
     - Forward the connection to backend WebSocket server
     - Handle the connection itself and communicate with backend

**Gateway WebSocket Authentication Middleware:**

```javascript
// Gateway WebSocket authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const tenantId = socket.handshake.query.tenantId;
  
  if (!token) {
    // For anonymous users, token should be obtained from /api/chat/anonymous-token first
    return next(new Error('JWT token required'));
  }
  
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach user info to socket
    socket.userId = decoded.userId || decoded.user_id || decoded.sub;
    socket.tenantId = decoded.tenantId || tenantId;
    socket.isAdmin = decoded.role === 'admin';
    socket.isAnonymous = decoded.anonymous === true;
    
    // Validate tenantId matches token (if provided in token)
    if (decoded.tenantId && tenantId && decoded.tenantId !== tenantId) {
      return next(new Error('Tenant ID mismatch'));
    }
    
    next();
  } catch (error) {
    return next(new Error('Invalid JWT token'));
  }
});

// After authentication, proxy to backend or handle connection
io.on('connection', (socket) => {
  // Connection is authenticated, now proxy to backend WebSocket server
  // OR handle the connection directly if gateway manages WebSocket
});
```

**Gateway HTTP Authentication Middleware:**

```javascript
// Gateway HTTP authentication middleware
app.use('/api/chat', async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'JWT token required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: decoded.userId || decoded.user_id || decoded.sub,
      tenantId: decoded.tenantId || req.headers['x-tenant-id'],
      role: decoded.role,
      isAdmin: decoded.role === 'admin'
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid JWT token' });
  }
});

// Admin-only endpoint
app.get('/api/chat/online-users', async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Route to backend API server
  const response = await fetch(`${BACKEND_API_URL}/api/chat/online-users?tenantId=${req.user.tenantId}`, {
    headers: {
      'X-Tenant-ID': req.user.tenantId,
      'X-Admin-User-Id': req.user.userId
    }
  });
  
  const data = await response.json();
  res.json(data);
});
```

**Environment Variables Required:**

```env
JWT_SECRET=your-secret-key-here  # Used to sign/verify JWT tokens
BACKEND_API_URL=http://backend-api:3000  # Backend API server URL
BACKEND_WS_URL=http://backend-ws:3001  # Backend WebSocket server URL (if proxying)
```

**Configuration needed:**
- Set `JWT_SECRET` environment variable
- Implement `POST /api/chat/anonymous-token` endpoint
- Implement WebSocket authentication middleware
- Route HTTP requests to backend API server
- Proxy WebSocket connections to backend WebSocket server (or handle directly)
- Admin authentication middleware/verification

### Backend WebSocket Server

**Responsibilities:**
- Track user connections/disconnections in real-time
- Store online users state in Redis Hash (HSET) with key pattern `online_users:{tenantId}`
- Handle incoming messages and push to Redis Streams for worker processing
- Emit WebSocket events:
  - `user_online` - when user connects (broadcast to admin rooms)
  - `user_offline` - when user disconnects (broadcast to admin rooms)
  - `meta_message_created` - when message is created (broadcast to conversation rooms)
  - `online_users_list` - response to `get_online_users` request
- Join clients to appropriate rooms (tenant, conversation, admin)
- Handle `get_online_users` event from admin clients

**Implementation details:**
- Track connections with: `userId`, `sessionId`, `tenantId`, `connectedAt`, `domain`, `origin`, `url`
- Generate `sessionId` once per socket connection (use `socket.id` or generate UUID and store)
- Remove users from online list on disconnect
- Broadcast presence changes to all admin clients in tenant's admin room
- Handle incoming messages: push to Redis Streams, then broadcast to conversation rooms

**Redis Structure:**
- Use Redis Hash (HSET) to store online users: `online_users:{tenantId}`
- Key pattern: `online_users:{tenantId}`
- Field: `userId` (string)
- Value: JSON string containing `{ sessionId, connectedAt, domain, origin, url }`
- Operations:
  - Add/Update: `HSET online_users:{tenantId} {userId} {JSON.stringify(userData)}`
  - Remove: `HDEL online_users:{tenantId} {userId}`
  - Get all: `HGETALL online_users:{tenantId}` (returns object of userId -> JSON string)
  - Get specific user: `HGET online_users:{tenantId} {userId}`

**Room Management:**
- All users join: `tenant:{tenantId}` (for tenant-wide broadcasts)
- Users join: `conversation:{sessionId}` (for message delivery to specific conversations)
- Admins join: `admin:{tenantId}` (for presence updates)

**Message Handling:**
- Listen for `message` event from clients
- When message received:
  1. Generate `messageId` (UUID)
  2. Get `sessionId` from socket (generated once per connection, stored in Redis)
  3. Get `userId` from socket auth
  4. Push to Redis Stream `meta:webhook_jobs` using XADD:
     ```
     XADD meta:webhook_jobs '*' \
       job_type "webchat_webhook" \
       source "webhook" \
       webhook_type "message" \
       payload '{"messageId":"<uuid>","sessionId":"<from-socket>","userId":"<from-auth>","tenantId":<number>,"siteId":<number>,"domain":"<string>","text":"<string>","senderType":"user","timestamp":"<ISO8601>"}' \
       headers '{"content-type":"application/json","x-webhook-source":"webchat-service"}' \
       timestamp "<ISO8601>"
     ```
  5. Broadcast to conversation room: `io.to('conversation:{sessionId}').emit('meta_message_created', { message: {...} })`

**Example WebSocket server logic (pseudo-code):**
```javascript
// When user connects
socket.on('connect', () => {
  const userId = socket.userId; // from auth
  const tenantId = socket.tenantId;
  const isAdmin = socket.auth.role === 'admin';
  
  // Store user connection in Redis Hash
  const userData = {
    sessionId: socket.id,
    connectedAt: new Date().toISOString(),
    domain: socket.handshake.query.domain,
    origin: socket.handshake.query.origin,
    url: socket.handshake.query.url,
  };
  await redis.hset(
    `online_users:${tenantId}`,
    userId,
    JSON.stringify(userData)
  );
  
  // Join tenant room (for tenant-wide broadcasts)
  socket.join(`tenant:${tenantId}`);
  
  // Join conversation room (for message delivery)
  socket.join(`conversation:${socket.id}`);
  
  // If admin, also join admin room
  if (isAdmin) {
    socket.join(`admin:${tenantId}`);
  }
  
  // Notify admins
  io.to(`admin:${tenantId}`).emit('user_online', {
    userId,
    sessionId: socket.id,
    connectedAt: new Date().toISOString(),
    domain: socket.handshake.query.domain,
    origin: socket.handshake.query.origin,
    url: socket.handshake.query.url,
  });
});

// When user disconnects
socket.on('disconnect', () => {
  const userId = socket.userId;
  const tenantId = socket.tenantId;
  
  // Remove user from Redis Hash
  await redis.hdel(`online_users:${tenantId}`, userId);
  
  // Notify admins
  io.to(`admin:${tenantId}`).emit('user_offline', { userId });
});

// Handle admin request for online users
socket.on('get_online_users', ({ tenantId }) => {
  if (socket.auth.role !== 'admin') return;
  
  // Get all online users from Redis Hash
  const allUsers = await redis.hgetall(`online_users:${tenantId}`);
  const onlineUsers = Object.entries(allUsers).map(([userId, data]) => ({
    userId,
    ...JSON.parse(data),
  }));
  socket.emit('online_users_list', { users: onlineUsers });
});

// Handle incoming messages
socket.on('message', async (data) => {
  const userId = socket.userId;
  const tenantId = socket.tenantId;
  const sessionId = socket.id; // Use socket.id as sessionId (generated once per connection)
  
  // Generate messageId
  const messageId = generateUUID();
  
  // Prepare payload for Redis Stream
  const payload = {
    messageId,
    sessionId,
    userId,
    tenantId: parseInt(tenantId),
    siteId: data.siteId ? parseInt(data.siteId) : null,
    domain: data.domain || '',
    text: data.text,
    senderType: 'user',
    timestamp: new Date().toISOString(),
  };
  
  // Push to Redis Stream for worker processing
  await redis.xadd(
    'meta:webhook_jobs',
    '*',
    'job_type', 'webchat_webhook',
    'source', 'webhook',
    'webhook_type', 'message',
    'payload', JSON.stringify(payload),
    'headers', JSON.stringify({
      'content-type': 'application/json',
      'x-webhook-source': 'webchat-service'
    }),
    'timestamp', new Date().toISOString()
  );
  
  // Broadcast to conversation room (only participants in this conversation)
  io.to(`conversation:${sessionId}`).emit('meta_message_created', {
    message: {
      id: messageId,
      text: data.text,
      sender: 'user',
      timestamp: payload.timestamp,
      sessionId,
      userId,
      tenantId,
    }
  });
});
```

### Backend API Server

**Responsibilities:**
- Implement HTTP endpoint: `GET /api/chat/online-users`
- Query online users from storage (Redis, in-memory store, or database)
- Return formatted list of online users
- Support tenant-scoped queries via `X-Tenant-ID` header or query params

**Endpoint specification:**
- **URL**: `GET /api/chat/online-users?tenantId=xxx`
- **Headers**: 
  - `X-Tenant-ID: <tenantId>` (required)
  - `Authorization: Bearer <token>` (required for admin)
- **Response**: 
  ```json
  {
    "users": [
      {
        "userId": "user-123",
        "sessionId": "session-456",
        "connectedAt": "2024-01-15T10:30:00.000Z",
        "domain": "example.com",
        "origin": "https://example.com",
        "url": "https://example.com/page"
      }
    ]
  }
  ```

## Installation

### Option 1: Copy Utilities to Your Admin App

Copy these files to your admin application:
- `lib/ws.ts` - WebSocket client with presence support
- `lib/api.ts` - API client with `getOnlineUsers()` method
- `lib/hooks/useOnlineUsers.ts` - React hook

### Option 2: Install as Package (if published)

```bash
npm install @amoiq/chat-widget
```

## API Reference

### TypeScript Interfaces

#### `OnlineUser`
```typescript
interface OnlineUser {
  userId: string;
  sessionId?: string;
  connectedAt: string;
  domain?: string;
  origin?: string;
  url?: string;
}
```

#### `WebSocketCallbacks`
```typescript
interface WebSocketCallbacks {
  onMessage?: (message: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onUserOnline?: (user: OnlineUser) => void;
  onUserOffline?: (userId: string) => void;
  onOnlineUsersList?: (users: OnlineUser[]) => void;
}
```

### WebSocket Events

#### Client → Server Events

**`get_online_users`**
- **Description**: Request list of online users (admin only)
- **Payload**: 
  ```typescript
  {
    tenantId: string;
  }
  ```

#### Server → Client Events

**`user_online`**
- **Description**: Emitted when a user comes online
- **Payload**: `OnlineUser` object

**`user_offline`**
- **Description**: Emitted when a user goes offline
- **Payload**: 
  ```typescript
  {
    userId: string;
  }
  ```
  Or just the `userId` string

**`online_users_list`**
- **Description**: Response to `get_online_users` request
- **Payload**: 
  ```typescript
  {
    users: OnlineUser[];
  }
  ```

### HTTP API Endpoints

#### `GET /api/chat/online-users`

**Description**: Get list of online users for a tenant

**Query Parameters:**
- `tenantId` (required): Tenant ID to query

**Headers:**
- `X-Tenant-ID`: Tenant ID (alternative to query param)
- `Authorization`: Bearer token (required for admin)

**Response:**
```json
{
  "users": [
    {
      "userId": "user-123",
      "sessionId": "session-456",
      "connectedAt": "2024-01-15T10:30:00.000Z",
      "domain": "example.com",
      "origin": "https://example.com",
      "url": "https://example.com/page"
    }
  ]
}
```

**Error Responses:**
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Not authorized as admin
- `404 Not Found`: Tenant not found
- `500 Internal Server Error`: Server error

## Usage Examples

### 1. Using the React Hook (Recommended)

The easiest way to integrate online users tracking is using the `useOnlineUsers` hook:

```tsx
import { useOnlineUsers } from '@/lib/hooks/useOnlineUsers';

function AdminDashboard({ tenantId }: { tenantId: string }) {
  const { onlineUsers, isLoading, error, refresh, isConnected } = useOnlineUsers(tenantId);

  return (
    <div>
      <h2>Online Users</h2>
      <div>
        Status: {isConnected ? 'Real-time' : 'Polling'}
        <button onClick={refresh}>Refresh</button>
      </div>
      
      {error && <div>Error: {error.message}</div>}
      
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p>{onlineUsers.length} users online</p>
          <ul>
            {onlineUsers.map(user => (
              <li key={user.userId}>
                {user.userId} - {user.domain}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

**Hook Options:**
```typescript
interface UseOnlineUsersOptions {
  enableWebSocket?: boolean;  // Default: true
  pollingInterval?: number;   // Default: 5000ms (when WebSocket disabled)
  autoRefresh?: boolean;      // Default: true
}
```

**Example with options:**
```tsx
const { onlineUsers } = useOnlineUsers(tenantId, {
  enableWebSocket: true,      // Use WebSocket for real-time updates
  pollingInterval: 10000,     // Fallback polling interval
  autoRefresh: true,          // Auto-fetch on mount
});
```

### 2. Direct WebSocket Integration

For more control, you can use the `ChatWebSocket` class directly:

```tsx
import { useEffect, useState } from 'react';
import { ChatWebSocket, OnlineUser } from '@/lib/ws';

function CustomOnlineUsers({ tenantId }: { tenantId: string }) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [ws, setWs] = useState<ChatWebSocket | null>(null);

  useEffect(() => {
    const websocket = new ChatWebSocket(
      tenantId,
      {
        onConnect: () => {
          console.log('Connected as admin');
          websocket.requestOnlineUsers();
        },
        onUserOnline: (user) => {
          setOnlineUsers(prev => {
            const exists = prev.find(u => u.userId === user.userId);
            if (exists) {
              return prev.map(u => u.userId === user.userId ? user : u);
            }
            return [...prev, user];
          });
        },
        onUserOffline: (userId) => {
          setOnlineUsers(prev => prev.filter(u => u.userId !== userId));
        },
        onOnlineUsersList: (users) => {
          setOnlineUsers(users);
        },
      },
      undefined,
      true // isAdmin = true
    );

    setWs(websocket);

    return () => {
      websocket.disconnect();
    };
  }, [tenantId]);

  return (
    <div>
      <h2>Online Users ({onlineUsers.length})</h2>
      <ul>
        {onlineUsers.map(user => (
          <li key={user.userId}>{user.userId}</li>
        ))}
      </ul>
    </div>
  );
}
```

### 3. API-Only Integration (Polling)

If you prefer to use only HTTP API without WebSocket:

```tsx
import { useEffect, useState } from 'react';
import { ChatAPI, OnlineUser } from '@/lib/api';

function PollingOnlineUsers({ tenantId }: { tenantId: string }) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const api = new ChatAPI(tenantId);

    const fetchUsers = async () => {
      try {
        const users = await api.getOnlineUsers();
        setOnlineUsers(users);
      } catch (error) {
        console.error('Failed to fetch online users:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchUsers();

    // Poll every 5 seconds
    const interval = setInterval(fetchUsers, 5000);

    return () => clearInterval(interval);
  }, [tenantId]);

  return (
    <div>
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p>{onlineUsers.length} users online</p>
          <ul>
            {onlineUsers.map(user => (
              <li key={user.userId}>{user.userId}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Or use the hook with WebSocket disabled:

```tsx
const { onlineUsers } = useOnlineUsers(tenantId, {
  enableWebSocket: false,
  pollingInterval: 5000,
});
```

## Integration Guide

### Step 1: Environment Variables

Set up environment variables in your admin application:

```env
NEXT_PUBLIC_GATEWAY_URL=https://api-gateway-dfcflow.fly.dev
NEXT_PUBLIC_GATEWAY_API_KEY=your-jwt-token-here
```

**Important Notes:**
- **`NEXT_PUBLIC_GATEWAY_URL`** (Required): Gateway URL for all connections (HTTP and WebSocket)
  - Widget always connects to Gateway, never directly to backend services
  - Gateway handles authentication and proxies to backend services
- **`NEXT_PUBLIC_GATEWAY_API_KEY`** (Required for authenticated users): JWT token for admin/authenticated users
  - Should contain a **JWT token** (already signed by gateway), NOT the JWT secret
  - For admin users: obtained from your authentication system (login/auth endpoint)
  - For anonymous users: obtained from gateway endpoint `POST /api/chat/anonymous-token`
- **Deprecated:**
  - `NEXT_PUBLIC_WEBSOCKET_URL` - Deprecated, use `NEXT_PUBLIC_GATEWAY_URL` instead
  - `NEXT_PUBLIC_WS_URL` - Deprecated, use `NEXT_PUBLIC_GATEWAY_URL` instead
- **JWT Secret:**
  - `JWT_SECRET` is only needed on the **Gateway** (server-side) to sign/verify tokens
  - The frontend does NOT need the JWT secret - only the signed token

### Step 2: Install Dependencies

If copying files, ensure you have the required dependencies:

```bash
npm install socket.io-client
```

### Step 3: Copy Utilities

Copy the following files to your admin app:
- `lib/ws.ts`
- `lib/api.ts`
- `lib/hooks/useOnlineUsers.ts` (if using React)

### Step 4: Use in Your Admin UI

Import and use the hook or utilities in your admin components:

```tsx
import { useOnlineUsers } from '@/lib/hooks/useOnlineUsers';

export default function AdminPage() {
  const tenantId = 'your-tenant-id'; // Get from auth/context
  const { onlineUsers, isLoading } = useOnlineUsers(tenantId);

  // Render your admin UI with online users
  return (
    <div>
      {/* Your admin UI */}
    </div>
  );
}
```

## Authentication Requirements

### JWT Authentication

The WebSocket server uses **JWT authentication**. Connections without a valid JWT token are rejected.

#### Frontend Requirements (This Widget)

**What you need:**
- ✅ JWT token (already signed by backend)
- ❌ JWT secret (NOT needed on frontend)

**How to provide the token:**

The token can be provided via environment variable:
```env
NEXT_PUBLIC_GATEWAY_API_KEY=your-jwt-token-here
```

The code automatically sends it in the `auth` object (recommended method):
```typescript
// Automatically done by ChatWebSocket class
io(WEBSOCKET_URL, {
  auth: {
    token: jwtToken, // From NEXT_PUBLIC_GATEWAY_API_KEY
  }
});
```

**JWT Token Requirements:**
- Must be signed with the `JWT_SECRET` from your backend environment
- Must contain at least one of: `userId`, `user_id`, or `sub` (for user identification)
- Optionally include `tenant_id` and `role` (for admin access)

**How to obtain the JWT token:**
1. Authenticate with your backend (login endpoint)
2. Backend signs a JWT token using `JWT_SECRET`
3. Store the token in environment variable or get it dynamically
4. Use the token to connect to WebSocket

#### Backend Requirements

**What you need:**
- ✅ `JWT_SECRET` environment variable (to sign/verify tokens)
- ✅ JWT middleware to verify tokens on WebSocket connections

**Backend Configuration:**
```env
JWT_SECRET=your-secret-key-here
```

The backend should:
1. Sign JWT tokens when users authenticate
2. Verify JWT tokens when WebSocket connections are established
3. Reject connections without valid tokens

### Admin Authentication

The system requires admin-level authentication:

1. **WebSocket**: Pass admin role in connection:
   ```typescript
   new ChatWebSocket(tenantId, callbacks, websiteInfo, true); // isAdmin = true
   ```

2. **HTTP API**: Include admin token in headers:
   ```typescript
   headers: {
     'Authorization': 'Bearer <jwt-token>',
     'X-Tenant-ID': tenantId
   }
   ```

### Token Management

- JWT tokens should be obtained through your authentication system
- Tokens should be scoped to specific tenants
- Gateway should verify admin role before allowing access
- **Frontend**: Only needs the signed JWT token (not the secret)
- **Backend**: Needs `JWT_SECRET` to sign and verify tokens

## Error Handling

### WebSocket Connection Failures

The hook automatically falls back to API polling if WebSocket fails:

```tsx
const { onlineUsers, isConnected } = useOnlineUsers(tenantId);

// isConnected will be false if WebSocket failed
// Hook will automatically use polling as fallback
```

### API Errors

Handle errors gracefully:

```tsx
const { onlineUsers, error } = useOnlineUsers(tenantId);

if (error) {
  return (
    <div>
      <p>Error loading online users: {error.message}</p>
      <button onClick={refresh}>Retry</button>
    </div>
  );
}
```

### Network Issues

The hook handles:
- Connection timeouts
- Network failures
- Automatic reconnection (WebSocket)
- Fallback to polling

## Best Practices

1. **Use the Hook**: Prefer `useOnlineUsers` hook for React applications - it handles all edge cases

2. **Error Boundaries**: Wrap components using the hook in error boundaries

3. **Loading States**: Always show loading states during initial fetch

4. **Real-time Updates**: Use WebSocket for real-time updates (default behavior)

5. **Polling Fallback**: The hook automatically falls back to polling if WebSocket fails

6. **Cleanup**: The hook handles cleanup automatically, but ensure you clean up if using direct WebSocket

7. **Tenant Scoping**: Always pass the correct tenantId - users are scoped per tenant

8. **Performance**: For large numbers of online users, consider pagination or virtualization

## Troubleshooting

### No Online Users Showing

1. Check backend WebSocket server is tracking connections
2. Verify admin authentication is working
3. Check browser console for errors
4. Verify tenantId is correct

### WebSocket Not Connecting

1. Check `NEXT_PUBLIC_GATEWAY_URL` is set correctly (not `NEXT_PUBLIC_WEBSOCKET_URL`)
2. Verify gateway is running and proxying WebSocket connections
3. Check JWT token is valid (for anonymous users, get token from `POST /api/chat/anonymous-token`)
4. Verify gateway WebSocket authentication middleware is working
5. Check browser console for connection errors
6. Hook will fallback to polling automatically if WebSocket fails

### Events Not Received

1. Verify backend is emitting `user_online`/`user_offline` events
2. Check admin client is joined to admin room
3. Verify tenantId matches between client and server
4. Check WebSocket connection status

### API Returns Empty Array

1. Verify gateway is routing requests to backend API server
2. Verify backend API endpoint is implemented
3. Check online users are being stored in Redis (key pattern: `online_users:{tenantId}`)
4. Verify tenantId in request matches stored data
5. Check admin authentication is working (JWT token has admin role)
6. Verify gateway is forwarding requests correctly

## Example Reference

See `lib/components/OnlineUsersExample.tsx` for a complete reference implementation.

## Gateway Implementation Guide

### Complete Gateway Example (Node.js/Express)

Here's a complete example of how to implement the Gateway:

```javascript
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const JWT_SECRET = process.env.JWT_SECRET;
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://backend-api:3000';
const BACKEND_WS_URL = process.env.BACKEND_WS_URL || 'http://backend-ws:3001';

// Middleware
app.use(express.json());

// ============================================
// HTTP Endpoints
// ============================================

// Issue anonymous JWT token
app.post('/api/chat/anonymous-token', async (req, res) => {
  const { tenantId } = req.body;
  
  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId is required' });
  }
  
  // Generate anonymous user ID
  const userId = `anonymous-${uuidv4()}`;
  
  // Create JWT token
  const token = jwt.sign(
    {
      userId,
      tenantId,
      role: 'user',
      anonymous: true
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({
    token,
    expiresIn: 86400, // 24 hours
    userId
  });
});

// Get online users (admin only)
app.get('/api/chat/online-users', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'JWT token required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check admin role
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const tenantId = req.query.tenantId || decoded.tenantId;
    
    // Route to backend API
    const response = await fetch(`${BACKEND_API_URL}/api/chat/online-users?tenantId=${tenantId}`, {
      headers: {
        'X-Tenant-ID': tenantId,
        'X-Admin-User-Id': decoded.userId
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Backend API error' });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(401).json({ error: 'Invalid JWT token' });
  }
});

// Proxy other chat API endpoints
app.use('/api/chat', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'JWT token required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Forward request to backend API
    const backendUrl = `${BACKEND_API_URL}${req.path}${req.url.includes('?') ? '&' : '?'}tenantId=${decoded.tenantId || req.query.tenantId}`;
    
    const response = await fetch(backendUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': decoded.tenantId || req.query.tenantId,
        'X-User-Id': decoded.userId
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(401).json({ error: 'Invalid JWT token' });
  }
});

// ============================================
// WebSocket Authentication
// ============================================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const tenantId = socket.handshake.query.tenantId;
  
  if (!token) {
    return next(new Error('JWT token required'));
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach user info to socket
    socket.userId = decoded.userId || decoded.user_id || decoded.sub;
    socket.tenantId = decoded.tenantId || tenantId;
    socket.isAdmin = decoded.role === 'admin';
    socket.isAnonymous = decoded.anonymous === true;
    
    // Validate tenantId
    if (decoded.tenantId && tenantId && decoded.tenantId !== tenantId) {
      return next(new Error('Tenant ID mismatch'));
    }
    
    if (!socket.tenantId) {
      return next(new Error('Tenant ID required'));
    }
    
    next();
  } catch (error) {
    return next(new Error('Invalid JWT token'));
  }
});

// ============================================
// WebSocket Connection Handling
// ============================================

io.on('connection', (socket) => {
  console.log(`[Gateway] User connected: ${socket.userId}, tenant: ${socket.tenantId}, admin: ${socket.isAdmin}`);
  
  // Here you can either:
  // 1. Proxy to backend WebSocket server
  // 2. Handle the connection directly in gateway
  
  // Option 1: Proxy to backend WebSocket server
  // (Implementation depends on your setup - could use socket.io-redis, etc.)
  
  // Option 2: Handle directly (if gateway manages WebSocket)
  // You would implement the WebSocket server logic here
  // See Backend WebSocket Server section for implementation details
  
  socket.on('disconnect', () => {
    console.log(`[Gateway] User disconnected: ${socket.userId}`);
  });
  
  // Forward events to backend or handle directly
  socket.on('message', (data) => {
    // Forward to backend WebSocket server or handle directly
  });
  
  socket.on('get_online_users', (data) => {
    // Only allow for admin
    if (!socket.isAdmin) {
      return socket.emit('error', { message: 'Admin access required' });
    }
    // Forward to backend or handle directly
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`[Gateway] Server running on port ${PORT}`);
  console.log(`[Gateway] JWT_SECRET configured: ${JWT_SECRET ? 'Yes' : 'No'}`);
});
```

### Gateway Environment Variables

```env
JWT_SECRET=your-secret-key-here
BACKEND_API_URL=http://backend-api:3000
BACKEND_WS_URL=http://backend-ws:3001
PORT=3000
```

### Gateway Checklist

- [ ] Set `JWT_SECRET` environment variable
- [ ] Implement `POST /api/chat/anonymous-token` endpoint
- [ ] Implement WebSocket authentication middleware
- [ ] Implement HTTP authentication middleware
- [ ] Route HTTP requests to backend API server
- [ ] Proxy WebSocket connections to backend WebSocket server (or handle directly)
- [ ] Verify admin role for protected endpoints
- [ ] Test anonymous token generation
- [ ] Test authenticated connections
- [ ] Test admin-only endpoints

## Support

For issues or questions:
1. Check this documentation
2. Review the example component
3. Check backend implementation matches requirements
4. Verify environment variables are set correctly
5. Ensure Gateway is properly configured and running

