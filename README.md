# Amoiq Chat Widget

Public-facing chat widget for customer websites.

## Installation

Customers install with one script:

```html
<script>
  window.ChatWidgetConfig = {
    tenantId: "xxx",
    position: "bottom-right"
  };
</script>
<script src="https://webchat.amoiq.com/widget.v1.0.0.js" async></script>
```

## Development

```bash
npm install
npm run dev
```

The widget will be available at `http://localhost:3000`. Test the embed page at `http://localhost:3000/embed?tenantId=test`.

## Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=https://api.amoiq.com
NEXT_PUBLIC_WS_URL=wss://api.amoiq.com
NEXT_PUBLIC_API_KEY=your-api-key-optional
```

## Deployment

Deployed to Vercel at `webchat.amoiq.com`.

### Vercel Configuration

- Project name: `amoiq-chat-widget`
- Domain: `webchat.amoiq.com`
- Framework: Next.js
- Build command: `npm run build`
- Output directory: `.next`

The `vercel.json` file configures caching headers automatically.

## Architecture

- **widget.v1.0.0.js**: Static loader script (CDN cached forever)
  - Injects iframe pointing to `/embed`
  - Handles floating bubble UI
  - Reads `window.ChatWidgetConfig`
  - No React, pure vanilla JS

- **/embed**: React chat UI (no cache, runs in iframe)
  - Full chat interface
  - Connects to backend API + WebSocket
  - Tenant-scoped via URL params
  - `force-dynamic` rendering

## Project Structure

```
amoiq-chat-widget/
├── app/
│   ├── embed/
│   │   ├── page.tsx          # Chat UI component
│   │   └── styles.module.css # Chat styles
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Home page
│   └── globals.css            # Global styles
├── lib/
│   ├── api.ts                 # Backend API client
│   ├── ws.ts                  # WebSocket client
│   └── tenant.ts              # Tenant resolution
├── public/
│   └── widget.v1.0.0.js       # Widget loader script
├── next.config.js             # Next.js config with caching
└── vercel.json                # Vercel deployment config
```

## Security

- No staff authentication
- No CRM access
- Tenant-scoped API keys or short-lived tokens
- Domain allowlist (optional, configure in backend)

