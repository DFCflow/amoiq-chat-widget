# Backend Requirements for Chat Widget

## What the Widget Needs

The chat widget is a **frontend-only** component. To work properly, it needs these backend services:

### 1. **HTTP API Server** (Required)
**Purpose:** Send/receive messages, manage conversations

**Endpoints needed:**
- `POST /webchat/message` - Send a message (single endpoint for both anonymous and logged-in users)
- `GET /api/chat/messages` - Fetch message history (by sessionId or userId)
- `POST /api/chat/anonymous-token` - Generate JWT token for anonymous users

**What it does:**
- Receives messages from widget with sessionId/fingerprint (anonymous) or userId (logged-in)
- Determines user type based on payload (if userId present = logged-in, else = anonymous)
- Saves messages to database with proper user identification
- Returns message history based on sessionId or userId
- Handles session management and conversation continuity

### 2. **WebSocket Server** (Required for real-time)
**Purpose:** Real-time message delivery

**Connection:** `ws://your-api.com/ws/chat?tenantId=xxx`

**What it does:**
- Receives messages from widget in real-time
- Broadcasts messages to agents/other users
- Handles reconnection automatically

### 3. **API Gateway** (Required)
**Purpose:** Authentication, routing, and security layer

**What it does:**
- **JWT Authentication**: Verifies JWT tokens for all connections
- **Issue Anonymous Tokens**: Generates JWT tokens for anonymous chat users via `POST /api/chat/anonymous-token`
- **Routes HTTP requests** to correct backend services
- **Proxies WebSocket connections** to backend WebSocket server
- Handles load balancing
- Can add rate limiting, authentication layers

**Required Endpoints:**
- `POST /api/chat/anonymous-token` - Generate JWT token for anonymous users
- WebSocket proxy endpoint - All WebSocket connections go through gateway

**Note:** The widget always connects to the Gateway, never directly to backend services. Gateway is the single entry point for all authentication.

## Current Status

✅ **Widget works without backend** - but shows "Invalid configuration" or connection errors
❌ **Widget needs backend** - to actually send/receive messages

## What Happens Without Backend

1. Widget loads ✅
2. User types message ✅
3. Widget tries to send to API ❌ (fails - no backend)
4. Widget tries to connect WebSocket ❌ (fails - no backend)
5. Shows "Offline" or connection errors ❌

## Quick Test (Without Backend)

You can test the widget UI without a backend by:
1. Using URL: `webchat.amoiq.com/embed?tenantId=test` (now fixed to accept `tenant` too)
2. Widget will load but show connection errors
3. This is normal - it's waiting for your backend API

## Next Steps

1. **Build your Gateway** with:
   - JWT authentication middleware
   - `POST /api/chat/anonymous-token` endpoint
   - WebSocket proxy/authentication
   - HTTP request routing
2. **Build your backend API** with the endpoints above
3. **Build your backend WebSocket server** for real-time connections
4. **Set environment variables** in Vercel:
   - `NEXT_PUBLIC_GATEWAY_URL` = Your Gateway URL (required)
   - `NEXT_PUBLIC_API_URL` = Your Gateway URL (same as gateway, deprecated)
   - `NEXT_PUBLIC_WEBSOCKET_URL` = Deprecated, use `NEXT_PUBLIC_GATEWAY_URL` instead
5. **Deploy backend services** separately (not in this repo)
6. **Test** - widget should connect through gateway and work

