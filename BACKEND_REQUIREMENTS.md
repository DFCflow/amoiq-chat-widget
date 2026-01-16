# Backend Requirements for Chat Widget

## What the Widget Needs

The chat widget is a **frontend-only** component. To work properly, it needs these backend services:

### 1. **HTTP API Server** (Required)
**Purpose:** Send/receive messages, manage conversations

**Endpoints needed:**
- `GET /api/chat/messages` - Fetch message history
- `POST /api/chat/messages` - Send a new message
- `POST /api/chat/session` - Initialize a chat session

**What it does:**
- Receives messages from widget
- Saves messages to database
- Returns message history
- Handles authentication (tenant-scoped)

### 2. **WebSocket Server** (Required for real-time)
**Purpose:** Real-time message delivery

**Connection:** `ws://your-api.com/ws/chat?tenantId=xxx`

**What it does:**
- Receives messages from widget in real-time
- Broadcasts messages to agents/other users
- Handles reconnection automatically

### 3. **API Gateway** (Optional)
**Purpose:** Route/organize API requests

**What it does:**
- Routes requests to correct services
- Handles load balancing
- Can add rate limiting, authentication layers

**Note:** API Gateway is NOT required if you have a simple API server. It's just a routing layer.

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

1. **Build your backend API** with the endpoints above
2. **Set environment variables** in Vercel:
   - `NEXT_PUBLIC_API_URL` = Your API URL
   - `NEXT_PUBLIC_WS_URL` = Your WebSocket URL
3. **Deploy backend** separately (not in this repo)
4. **Test** - widget should connect and work

