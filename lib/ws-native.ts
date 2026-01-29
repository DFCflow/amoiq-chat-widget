/**
 * Socket.IO client for real-time chat
 * Connects directly to Socket.IO server using ws_server_url from /webchat/init response
 */

import { io, Socket } from 'socket.io-client';
import { getSessionInfo, refreshSession, getConversationId, setConversationId, getVisitorId, isConversationExpired, clearConversation, getSenderName } from './session';

export interface OnlineUser {
  userId: string;
  sessionId?: string;
  connectedAt: string;
  domain?: string;
  origin?: string;
  url?: string;
}

export interface WebSocketCallbacks {
  onMessage?: (message: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onUserOnline?: (user: OnlineUser) => void;
  onUserOffline?: (userId: string) => void;
  onOnlineUsersList?: (users: OnlineUser[]) => void;
  onConversationClosed?: () => void;
  onConversationCreated?: (conversationId: string) => void;
  onSessionUpdate?: (data: any) => void;
}

export interface WebsiteInfo {
  domain?: string;
  origin?: string;
  url?: string;
  referrer?: string;
  siteId?: string;
}

export interface UserInfo {
  name?: string;
  email?: string;
  phone?: string;
  [key: string]: any;
}

export interface ConversationInitResponse {
  session_id: string;
  visitor_id: string;
  ws_token: string;
  ws_server_url: string;
  tenant_id: string;
  integration_id?: string;
  site_id?: string;
  expires_in: number;
  closed_at?: string | null; // If present, conversation is closed
}

export class ChatWebSocketNative {
  private tenantId: string | null;
  private integrationId?: string;
  private siteId?: string;
  private socket: Socket | null = null;
  private callbacks: WebSocketCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private shouldReconnect = true;
  private websiteInfo: WebsiteInfo;
  private isAdmin: boolean;
  private userId?: string;
  private userInfo?: UserInfo;
  private conversationId?: string;
  private visitorId?: string;
  private wsToken?: string;
  private wsServerUrl?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private tokenExpiresAt?: number; // Timestamp when token expires
  private tokenRefreshTimer?: ReturnType<typeof setTimeout>; // Timer for proactive refresh
  private gatewayUrl: string;
  private presenceSessionId?: string; // Session ID from presence layer
  private currentRoom?: string; // Current WebSocket room (session:{session_id} or conversation:{conversation_id})
  private processedMessageKeys = new Map<string, number>(); // messageKey -> timestamp for deduplication
  private readonly MESSAGE_CACHE_TTL = 60000; // 60 seconds - covers backend processing delays

  constructor(
    tenantId: string | null,
    callbacks: WebSocketCallbacks = {},
    websiteInfo?: WebsiteInfo,
    isAdmin: boolean = false,
    userId?: string,
    userInfo?: UserInfo
  ) {
    this.tenantId = tenantId || null;
    this.callbacks = callbacks;
    this.isAdmin = isAdmin;
    this.userId = userId;
    this.userInfo = userInfo;
    
    // Initialize website info
    // Use provided websiteInfo if it has domain/origin, otherwise try to get from URL params
    // Don't use fallback getWebsiteInfo() if we're on webchat domain (would return wrong domain)
    if (websiteInfo && (websiteInfo.domain || websiteInfo.origin)) {
      this.websiteInfo = websiteInfo;
    } else {
      // Try to get from URL params (widget loader should pass these)
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const domain = params?.get('domain');
      const origin = params?.get('origin');
      
      if (domain || origin) {
        this.websiteInfo = {
          domain: domain || undefined,
          origin: origin || undefined,
          url: params?.get('url') || undefined,
          referrer: params?.get('referrer') || undefined,
          siteId: params?.get('siteId') || undefined,
        };
      } else {
        // Last resort: use provided websiteInfo even if empty, or getWebsiteInfo() if not on webchat domain
        const fallback = this.getWebsiteInfo();
        if (fallback.domain && !fallback.domain.includes('webchat')) {
          this.websiteInfo = fallback;
        } else {
          // On webchat domain without URL params - this shouldn't happen in production
          this.websiteInfo = websiteInfo || {};
          console.warn('[Socket.IO] ⚠️ No domain info available. Widget loader should pass domain via URL params.');
        }
      }
    }
    
    this.isAdmin = isAdmin;
    this.userId = userId;
    this.userInfo = userInfo;
    
    // Get Gateway URL for /webchat/init endpoint
    this.gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api-gateway-dfcflow.fly.dev';
  }

  /**
   * Update callbacks after construction
   * Useful when WebSocket is created in presence mode and later needs message callbacks
   */
  updateCallbacks(newCallbacks: WebSocketCallbacks): void {
    this.callbacks = { ...this.callbacks, ...newCallbacks };
  }

  /**
   * Auto-detect website information from browser
   * Note: This should rarely be called since websiteInfo is passed from embed page
   * This is only a fallback if websiteInfo wasn't provided
   */
  private getWebsiteInfo(): WebsiteInfo {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      // Don't use webchat.amoiq.com as domain - this means we're in iframe without proper info
      if (hostname === 'webchat.amoiq.com' || hostname.includes('webchat')) {
        console.warn('[Socket.IO] ⚠️ Widget is on webchat domain but no websiteInfo provided. This should not happen in production.');
        return {};
      }
      return {
        domain: hostname,
        origin: window.location.origin,
        url: window.location.href,
        referrer: document.referrer || '',
      };
    }
    return {};
  }

  /**
   * Connect to presence WebSocket (for presence layer)
   * Called on page load to track online/offline status
   */
  async connectPresence(wsToken: string, wsServerUrl: string, sessionId: string): Promise<void> {
    if (typeof window === 'undefined') {
      console.warn('[Socket.IO] Cannot connect presence: Socket.IO is only available in the browser');
      return;
    }

    this.presenceSessionId = sessionId;
    this.wsToken = wsToken;
    this.wsServerUrl = wsServerUrl;

    // Disconnect existing socket if it exists
    if (this.socket && this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    try {
      this.socket = io(wsServerUrl, {
        auth: {
          token: wsToken,
        },
        query: {
          token: wsToken,
        },
        extraHeaders: {
          'Authorization': `Bearer ${wsToken}`,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      // Set up event listeners
      this.setupPresenceEventListeners();
      
      // Wait for connection and join session room
      this.socket.on('connect', () => {
        this.reconnectAttempts = 0;
        
        // Join session room for presence tracking
        if (this.socket && sessionId) {
          const roomName = `session:${sessionId}`;
          this.socket.emit('join:session', { sessionId });
          this.currentRoom = roomName;
        }
        
        this.callbacks.onConnect?.();
      });

      this.socket.on('connect_error', (error: Error) => {
        console.error('[Socket.IO] ❌ Presence connection error:', error);
        this.reconnectAttempts++;
        this.callbacks.onError?.(error);
      });

      this.socket.on('disconnect', () => {
        this.callbacks.onDisconnect?.();
      });
    } catch (error) {
      console.error('[Socket.IO] Error creating presence connection:', error);
      this.callbacks.onError?.(error as Error);
    }
  }

  /**
   * Set up event listeners for presence WebSocket
   */
  private setupPresenceEventListeners(): void {
    if (!this.socket) return;

    // Listen for session updates
    this.socket.on('session:update', (data: any) => {
      this.callbacks.onSessionUpdate?.(data);
      
      // If conversation_id is provided in update, switch to conversation room
      if (data.conversation_id && !this.conversationId) {
        this.conversationId = data.conversation_id;
        this.switchToConversationRoom(data.conversation_id);
      }
    });

    // Listen for conversation created events
    this.socket.on('conversation:created', (data: { conversation_id: string }) => {
      if (data.conversation_id) {
        this.conversationId = data.conversation_id;
        // Don't call onConversationCreated here - it will be called after joining the room
        this.switchToConversationRoom(data.conversation_id);
      }
    });

    // Listen for conversation:new events (new event name from backend)
    this.socket.on('conversation:new', (data: { id?: string; conversation_id?: string }) => {
      // Handle both 'id' and 'conversation_id' formats
      const conversationId = data.id || data.conversation_id;
      if (conversationId) {
        this.conversationId = conversationId;
        // Don't call onConversationCreated here - it will be called after joining the room
        // Automatically switch from session room to conversation room
        this.switchToConversationRoom(conversationId);
      }
    });

    // Listen for conversation:update events (broadcasted to session room when conversation is updated)
    // According to backend docs: conversation:update uses 'id' field (REQUIRED) and is broadcast to session:{sessionId} room
    this.socket.on('conversation:update', (data: { id?: string; conversation_id?: string; conversationId?: string }) => {
      // Handle multiple possible field names for conversation ID
      // Backend uses 'id' field per WEBSOCKET_PAYLOADS.md, but we support all variants for compatibility
      const conversationId = data.id || data.conversation_id || data.conversationId;
      
      if (conversationId) {
        // If we don't have conversationId yet, or we're not in conversation room yet, switch
        const shouldSwitch = !this.conversationId || !this.currentRoom?.startsWith('conversation:');
        
        if (shouldSwitch) {
          this.conversationId = conversationId;
          // Don't call onConversationCreated here - it will be called after joining the room
          // Automatically switch from session room to conversation room
          this.switchToConversationRoom(conversationId);
        } else if (this.conversationId !== conversationId) {
          // Conversation ID changed, switch to new conversation room
          this.conversationId = conversationId;
          this.switchToConversationRoom(conversationId);
        }
      }
    });

    // Listen for conversation closed events
    this.socket.on('conversation:closed', (data: { conversation_id: string }) => {
      if (data.conversation_id === this.conversationId) {
        this.callbacks.onConversationClosed?.();
      }
    });

    // ALSO listen for message events in session room (to catch messages before room switch)
    // This handles race condition where backend broadcasts to both rooms simultaneously
    this.socket.on('meta_message_created', (data: any) => {
      // If we're already in conversation room, skip - let conversation room listener handle it
      if (this.currentRoom?.startsWith('conversation:')) {
        return;
      }
      
      const rawMessage = data.message || data;
      
      // Check for duplicate BEFORE transforming/handling
      const messageKey = this.getMessageKey(rawMessage);
      if (this.hasProcessedMessage(messageKey)) {
        return;
      }
      
      // Mark as processed BEFORE transforming/handling
      this.markMessageProcessed(messageKey);
      
      // Transform to ensure message_text -> text conversion
      const message = this.transformMessageNewToMessage(rawMessage);
      
      // Extract conversation_id from message
      const messageConversationId = message.conversation_id;
      
      if (messageConversationId) {
        // If we don't have conversationId yet, set it and switch rooms
        if (!this.conversationId) {
          this.conversationId = messageConversationId;
          // Don't call onConversationCreated here - it will be called after joining the room
          this.switchToConversationRoom(messageConversationId);
          // Process the message after switching
          this.handleMessage(message);
        } else {
          // We have conversationId but not in conversation room yet - process it
          if (messageConversationId === this.conversationId) {
            this.handleMessage(message);
          }
        }
      } else {
        // No conversation_id in message, process anyway (might be for our session)
        this.handleMessage(message);
      }
    });

    this.socket.on('message:new', (data: any) => {
      // If we're already in conversation room, skip - let conversation room listener handle it
      if (this.currentRoom?.startsWith('conversation:')) {
        return;
      }
      
      const rawMessage = data.message || data;
      
      // Check for duplicate BEFORE transforming/handling
      const messageKey = this.getMessageKey(rawMessage);
      if (this.hasProcessedMessage(messageKey)) {
        return;
      }
      
      // Mark as processed BEFORE transforming/handling
      this.markMessageProcessed(messageKey);
      
      const message = this.transformMessageNewToMessage(rawMessage);
      
      // Extract conversation_id from transformed message
      const messageConversationId = message.conversation_id;
      
      if (messageConversationId) {
        // If we don't have conversationId yet, set it and switch rooms
        if (!this.conversationId) {
          this.conversationId = messageConversationId;
          // Don't call onConversationCreated here - it will be called after joining the room
          this.switchToConversationRoom(messageConversationId);
          // Process the message after switching
          this.handleMessage(message);
        } else {
          // We have conversationId but not in conversation room yet - process it
          if (messageConversationId === this.conversationId) {
            this.handleMessage(message);
          }
        }
      } else {
        // No conversation_id in message, process anyway (might be for our session)
        this.handleMessage(message);
      }
    });
  }

  /**
   * Switch from session room to conversation room
   */
  switchToConversationRoom(conversationId: string): void {
    if (!this.socket || !this.socket.connected) {
      console.warn('[Socket.IO] Cannot switch room: not connected');
      return;
    }

    // Set up message event listeners BEFORE joining conversation room
    // This ensures we catch messages immediately when we join
    this.setupMessageEventListeners();

    // Join conversation room FIRST (before leaving session room)
    // This ensures we're in the room when messages are broadcast
    const roomName = `conversation:${conversationId}`;
    this.socket.emit('join:conversation', { conversationId });
    this.currentRoom = roomName;

    // Listen for joined confirmation, THEN leave session room
    this.socket.once('joined', () => {
      // NOW it's safe to leave session room - we're confirmed in conversation room
      if (this.presenceSessionId) {
        this.socket?.emit('leave:session', { sessionId: this.presenceSessionId });
      }
      this.callbacks.onConversationCreated?.(conversationId);
    });
  }

  /**
   * Set up message event listeners for conversation room
   */
  private setupMessageEventListeners(): void {
    if (!this.socket) return;

    // Check if conversation room listeners are already set up
    // We use a flag to track if we've set up conversation-specific listeners
    // Session room listeners will continue to work, but we add conversation room listeners
    // that filter by conversation_id
    
    // Remove only conversation room listeners if they exist (not session room listeners)
    // We'll use a different approach: check if we're already in a conversation room
    const isInConversationRoom = this.currentRoom?.startsWith('conversation:');
    
    // Only remove listeners if we're switching from one conversation to another
    // Keep session room listeners active (they handle messages before room switch)
    if (isInConversationRoom) {
      // We're switching conversations, remove old conversation listeners
      // But keep session room listeners
      this.socket.off('meta_message_created');
      this.socket.off('message:new');
      this.socket.off('message');
    }

    // Set up conversation room message listeners
    // These will work in both session and conversation rooms (Socket.IO delivers to all listeners)
    // But we filter by conversation_id to only process relevant messages
    this.socket.on('meta_message_created', (data: any) => {
      // WebSocket payload format: { message: { text: string, ... } } or direct message object
      const rawMessage = data.message || data;
      
      // Check for duplicate BEFORE transforming/handling
      const messageKey = this.getMessageKey(rawMessage);
      if (this.hasProcessedMessage(messageKey)) {
        return;
      }
      
      // Mark as processed BEFORE transforming/handling
      this.markMessageProcessed(messageKey);
      
      // Transform to ensure message_text -> text conversion
      const message = this.transformMessageNewToMessage(rawMessage);
      
      // Filter: only process if message belongs to current conversation (if we have one)
      // Or if we don't have conversationId yet, process it (will be handled by session room listener)
      if (!this.conversationId || !message.conversation_id || message.conversation_id === this.conversationId) {
        this.handleMessage(message);
      }
    });

    this.socket.on('message:new', (data: any) => {
      // WebSocket payload format: { message: { text: string, messageId: string, ... } }
      const rawMessage = data.message || data;
      
      // Check for duplicate BEFORE transforming/handling
      const messageKey = this.getMessageKey(rawMessage);
      if (this.hasProcessedMessage(messageKey)) {
        return;
      }
      
      // Mark as processed BEFORE transforming/handling
      this.markMessageProcessed(messageKey);
      
      const message = this.transformMessageNewToMessage(rawMessage);
      
      // Filter: only process if message belongs to current conversation (if we have one)
      if (!this.conversationId || !message.conversation_id || message.conversation_id === this.conversationId) {
        this.handleMessage(message);
      }
    });

    this.socket.on('message', (data: any) => {
      // Generic: process if no conversation_id or matches current
      if (!this.conversationId || !data.conversation_id || data.conversation_id === this.conversationId) {
        this.handleMessage(data);
      }
    });
  }

  /**
   * Initialize conversation and get JWT token and Socket.IO server URL
   * Must be called before connect()
   */
  async initialize(visitorId?: string, sessionId?: string): Promise<ConversationInitResponse | null> {
    try {
      const sessionInfo = getSessionInfo();
      
      // Check if conversation expired - if so, don't use stored visitorId
      let storedVisitorId: string | undefined = undefined;
      if (!isConversationExpired()) {
        storedVisitorId = visitorId || getVisitorId() || undefined;
      } else {
        // Conversation expired, clear it
        clearConversation();
      }
      
      const payload: any = {
        ...this.websiteInfo,
      };

      // Only add tenantId if available - Gateway will resolve from domain if not provided
      if (this.tenantId) {
        payload.tenantId = this.tenantId;
      }

      // Add sessionId when available (session-first flow)
      // Priority: passed sessionId > presenceSessionId > sessionInfo.sessionId
      const effectiveSessionId = sessionId || this.presenceSessionId || sessionInfo.sessionId;
      if (effectiveSessionId) {
        payload.sessionId = effectiveSessionId;
      }

      if (storedVisitorId) {
        payload.visitorId = storedVisitorId;
      }

      if (this.userId) {
        payload.userId = this.userId;
        if (this.userInfo) {
          payload.userInfo = this.userInfo;
        }
      }

      const apiKey = process.env.NEXT_PUBLIC_GATEWAY_API_KEY || process.env.NEXT_PUBLIC_API_KEY;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Send parent domain in custom headers for Gateway to use
      // Since widget runs in iframe (webchat.amoiq.com), Origin header will be from iframe domain
      // We need to send the actual parent website domain so Gateway can look it up
      if (this.websiteInfo?.origin) {
        headers['X-Website-Origin'] = this.websiteInfo.origin;
      }
      if (this.websiteInfo?.domain) {
        headers['X-Website-Domain'] = this.websiteInfo.domain;
      }

      // DO NOT send X-Tenant-ID header - Gateway will set it based on domain lookup
      // Gateway should check X-Website-Origin first, then fallback to Origin/Referer

      const response = await fetch(`${this.gatewayUrl}/webchat/init`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to initialize conversation: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: ConversationInitResponse = await response.json();
      
      // Check if conversation is closed
      if (data.closed_at) {
        // Clear stored conversation data since it's closed
        clearConversation();
        // But we still need the token and connection info for new conversation
      }
      
      // Session-first flow: init returns session_id, NOT conversation_id
      // conversation_id will come from conversation:created event on session room
      this.presenceSessionId = data.session_id;
      this.visitorId = data.visitor_id;
      this.wsToken = data.ws_token;
      this.wsServerUrl = data.ws_server_url;
      
      // Store expiration timestamp (expires_in is in seconds)
      const expiresInMs = (data.expires_in || 900) * 1000; // Default 15 minutes (900s) if not provided
      this.tokenExpiresAt = Date.now() + expiresInMs;
      
      // Note: Do NOT call setConversationId() here - conversation_id comes later
      // from conversation:created event on session room
      
      // Schedule proactive token refresh (refresh at 80% of expiration time)
      this.scheduleTokenRefresh(expiresInMs * 0.8);
      // Extract additional fields from Gateway response
      if (data.integration_id) {
        this.integrationId = data.integration_id;
      }
      if (data.site_id) {
        this.siteId = data.site_id;
      }
      // Extract tenant_id from response (Gateway should return it)
      const receivedTenantId = data.tenant_id;
      
      // Also try to extract tenant_id, integration_id, site_id from JWT token payload (fallback)
      let tokenTenantId: string | null = null;
      let tokenIntegrationId: string | null = null;
      let tokenSiteId: string | null = null;
      if (this.wsToken) {
        try {
          const base64Url = this.wsToken.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
          const tokenPayload = JSON.parse(jsonPayload);
          // Check for tenant_id in token (could be tenant_id, tenantId, or tenant_id)
          tokenTenantId = tokenPayload.tenant_id || tokenPayload.tenantId || tokenPayload.tenant_id || null;
          // Check for integration_id in token
          tokenIntegrationId = tokenPayload.integration_id || tokenPayload.integrationId || null;
          // Check for site_id in token
          tokenSiteId = tokenPayload.site_id || tokenPayload.siteId || null;
        } catch (_e) {}
      }
      
      // Validate tenant_id - reject placeholder values
      const placeholderValues = ['your-tenant-id', 'tenant-id', 'your_tenant_id', 'tenant_id', ''];
      
      // Priority: 1) Gateway response, 2) JWT token payload, 3) constructor value
      let finalTenantId: string | null = null;
      let finalIntegrationId: string | null = null;
      let finalSiteId: string | null = null;
      
      if (receivedTenantId && !placeholderValues.includes(String(receivedTenantId).toLowerCase())) {
        finalTenantId = receivedTenantId;
      } else if (tokenTenantId && !placeholderValues.includes(String(tokenTenantId).toLowerCase())) {
        finalTenantId = tokenTenantId;
      } else if (this.tenantId && !placeholderValues.includes(String(this.tenantId).toLowerCase())) {
        finalTenantId = this.tenantId;
      }
      
      // Extract integration_id: Gateway response > JWT token
      if (data.integration_id && !placeholderValues.includes(String(data.integration_id).toLowerCase())) {
        finalIntegrationId = data.integration_id;
      } else if (tokenIntegrationId && !placeholderValues.includes(String(tokenIntegrationId).toLowerCase())) {
        finalIntegrationId = tokenIntegrationId;
      }
      
      // Extract site_id: Gateway response > JWT token
      if (data.site_id && !placeholderValues.includes(String(data.site_id).toLowerCase())) {
        finalSiteId = data.site_id;
      } else if (tokenSiteId && !placeholderValues.includes(String(tokenSiteId).toLowerCase())) {
        finalSiteId = tokenSiteId;
      }
      
      if (receivedTenantId && placeholderValues.includes(String(receivedTenantId).toLowerCase())) {
        console.error('[Socket.IO] ERROR - Gateway returned placeholder tenant_id:', receivedTenantId);
        console.error('[Socket.IO] Gateway should return actual tenant_id, not a placeholder');
      } else if (!receivedTenantId) {
        console.warn('[Socket.IO] WARNING - Gateway did not return tenant_id in response body');
      }
      
      this.tenantId = finalTenantId;
      this.integrationId = finalIntegrationId || this.integrationId;
      this.siteId = finalSiteId || this.siteId;
      
      // Decode JWT token to see payload (without verification)
      let tokenPayload: any = null;
      if (this.wsToken) {
        try {
          const base64Url = this.wsToken.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
          tokenPayload = JSON.parse(jsonPayload);
        } catch (_e) {}
      }

      return data;
    } catch (error) {
      console.error('[Socket.IO] Error initializing conversation:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Failed to initialize conversation'));
      return null;
    }
  }

  /**
   * Connect to Socket.IO server with JWT token
   * Must call initialize() first
   */
  connect(): void {
    // Ensure we're in the browser (not SSR)
    if (typeof window === 'undefined') {
      console.warn('[Socket.IO] Cannot connect: Socket.IO is only available in the browser');
      return;
    }

    if (!this.wsToken || !this.wsServerUrl) {
      console.error('[Socket.IO] Cannot connect: no JWT token or server URL. Call initialize() first.');
      this.callbacks.onError?.(new Error('No JWT token or server URL. Call initialize() first.'));
      return;
    }

    if (this.socket && this.socket.connected) {
      return;
    }

    // Disconnect existing socket if it exists but is not connected
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners(); // Remove all listeners to prevent duplicates
      this.socket.disconnect();
      this.socket = null;
    }

    try {
      this.socket = io(this.wsServerUrl, {
        auth: {
          token: this.wsToken,
        },
        query: {
          token: this.wsToken,  // Fallback: socket.handshake.query?.token
        },
        extraHeaders: {
          'Authorization': `Bearer ${this.wsToken}`,  // Fallback: socket.handshake.headers?.authorization
        },
        transports: ['websocket', 'polling'], // Allow fallback to polling if websocket fails
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      // Set up event listeners BEFORE connection is established
      this.socket.on('message', (data: any) => {
        this.handleMessage(data);
      });

      // Handle meta_message_created events (from backend when messages are saved to DB)
      this.socket.on('meta_message_created', (data: any) => {
        const rawMessage = data.message || data;
        const messageKey = this.getMessageKey(rawMessage);
        if (this.hasProcessedMessage(messageKey)) {
          return;
        }
        this.markMessageProcessed(messageKey);
        this.handleMessage(rawMessage);
      });

      // Handle message:new events (alternative event name used by server)
      this.socket.on('message:new', (data: any) => {
        const rawMessage = data.message || data;
        const messageKey = this.getMessageKey(rawMessage);
        if (this.hasProcessedMessage(messageKey)) {
          return;
        }
        this.markMessageProcessed(messageKey);
        const message = this.transformMessageNewToMessage(rawMessage);
        this.handleMessage(message);
      });

      // Handle AI event created events (optional, for AI responses)
      this.socket.on('ai_event_created', (data: any) => {
        // Extract message from data.message or use data directly
        const message = data.message || data;
        this.handleMessage(message);
      });

      // Handle presence events
      this.socket.on('user_online', (data: OnlineUser) => {
        this.callbacks.onUserOnline?.(data);
      });

      this.socket.on('user_offline', (data: { userId: string } | string) => {
        const userId = typeof data === 'string' ? data : data.userId;
        this.callbacks.onUserOffline?.(userId);
      });

      this.socket.on('online_users_list', (data: { users?: OnlineUser[] } | OnlineUser[]) => {
        const users = Array.isArray(data) ? data : (data.users || []);
        this.callbacks.onOnlineUsersList?.(users);
      });

      // Connection established
      this.socket.on('connect', () => {
        this.reconnectAttempts = 0;
        
        // Session-first flow: join session room first, wait for conversation:created
        if (this.conversationId && this.socket) {
          this.switchToConversationRoom(this.conversationId);
        } else if (this.presenceSessionId && this.socket) {
          const roomName = `session:${this.presenceSessionId}`;
          this.socket.emit('join:session', { sessionId: this.presenceSessionId });
          this.currentRoom = roomName;
        } else {
          console.warn('[Socket.IO] WARNING - Cannot join any room:', {
            has_conversation_id: !!this.conversationId,
            has_socket: !!this.socket,
            has_presence_session: !!this.presenceSessionId,
          });
        }
        
        this.callbacks.onConnect?.();
      });

      // Listen for joined event from server (confirmation of room join)
      this.socket.on('joined', () => {});

      // Handle connection errors
      this.socket.on('connect_error', (error: Error) => {
        console.error('[Socket.IO] Connection error:', error);
        this.reconnectAttempts++;
        this.callbacks.onError?.(error);
      });

      // Handle disconnection
      this.socket.on('disconnect', (reason: string) => {
        this.callbacks.onDisconnect?.();

        const isTokenExpired = this.isTokenExpired();
        const isAuthError = reason === 'io server disconnect' || 
                           reason.includes('auth') || 
                           reason.includes('token') ||
                           reason.includes('unauthorized');

        if (this.shouldReconnect && (isAuthError || isTokenExpired)) {
          this.initialize(this.visitorId).then(() => {
            if (this.wsToken && this.wsServerUrl) {
              this.connect();
            }
          });
        }
      });

      // Handle general errors
      this.socket.on('error', (error: Error) => {
        console.error('[Socket.IO] ❌ Socket error:', error);
        this.callbacks.onError?.(error);
      });
    } catch (error) {
      console.error('[Socket.IO] Error creating connection:', error);
      this.callbacks.onError?.(error as Error);
    }
  }

  /**
   * Transform message:new event format to standard message format
   */
  private transformMessageNewToMessage(data: any): any {
    // message:new event has fields like: id, message_text, sender_type, sender_id, etc.
    // IMPORTANT: message:new events have message_id (actual message ID) and id (event ID)
    // We should use message_id as the primary ID for deduplication
    // Preserve all original fields first
    // WebSocket payload format: { message: { text: string, sender: string, messageId: string, ... } }
    
    const transformed = {
      ...data,
      // Override with normalized fields (these take precedence)
      id: data.message_id || data.messageId || data.id,  // Use message_id first (actual message ID), then messageId, then id
      text: data.text || data.message_text || data.message,  // WebSocket uses "text" field directly
      sender: data.sender_type === 'user' ? 'user' : (data.sender_type === 'agent' ? 'agent' : (data.sender_type === 'human' ? 'agent' : 'bot')),
      senderId: data.sender_id || data.sender,  // Handle sender being a UUID
      senderName: data.sender_name,
      timestamp: data.timestamp || data.created_at || data.inserted_at || new Date().toISOString(),  // WebSocket uses "timestamp" directly
      conversation_id: data.conversation_id,
      tenant_id: data.tenant_id || data.tenantId,
      status: data.status,
      attachments: data.attachments,
      metadata: data.metadata,
    };
    
    // If sender is a UUID (user ID), we'll let the normalization in embed/page.tsx handle it
    // But ensure we have the original sender field preserved
    if (data.sender && !transformed.senderId) {
      transformed.senderId = data.sender;
    }
    
    return transformed;
  }

  /**
   * Handle incoming messages from Socket.IO
   */
  private handleMessage(data: any): void {
    const transformedMessage = this.transformMessageNewToMessage(data);
    this.callbacks.onMessage?.(transformedMessage);
  }

  /**
   * Send a message through Socket.IO
   * Message is pushed to Redis stream chat_incoming
   * @param tempId - Optional client-generated temp id for optimistic message replacement (server echoes in meta_message_created)
   */
  async sendMessage(text: string, tempId?: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Socket.IO is only available in the browser');
    }

    if (!this.socket || !this.socket.connected) {
      throw new Error('Socket.IO is not connected');
    }

    const sessionInfo = getSessionInfo();
    refreshSession();

    // tenantId is REQUIRED by the server - throw error if not available or if it's a placeholder
    const placeholderValues = ['your-tenant-id', 'tenant-id', 'your_tenant_id', 'tenant_id', ''];
    const isPlaceholder = this.tenantId && placeholderValues.includes(String(this.tenantId).toLowerCase());
    
    if (!this.tenantId || isPlaceholder) {
      const error = new Error(
        isPlaceholder 
          ? `tenantId is a placeholder value ("${this.tenantId}"). Gateway must return actual tenant_id in /webchat/init response.`
          : 'tenantId is required but not available. Make sure initialize() was called successfully and Gateway returned tenant_id.'
      );
      console.error('[Socket.IO] ERROR - Invalid tenantId:', {
        tenantId: this.tenantId,
        is_placeholder: isPlaceholder,
        conversation_id: this.conversationId,
        visitor_id: this.visitorId,
        has_ws_token: !!this.wsToken,
        has_ws_server_url: !!this.wsServerUrl,
      });
      throw error;
    }

    // integration_id is REQUIRED by the server - throw error if not available
    if (!this.integrationId) {
      const error = new Error(
        'integration_id is required but not available. Gateway must return integration_id in /webchat/init response or include it in JWT token payload.'
      );
      console.error('[Socket.IO] ERROR - Missing integration_id:', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        siteId: this.siteId,
        conversation_id: this.conversationId,
        visitor_id: this.visitorId,
        has_ws_token: !!this.wsToken,
        has_ws_server_url: !!this.wsServerUrl,
      });
      throw error;
    }

    // Prepare message payload according to Gateway plan
    // Server might expect tenant_id (snake_case) or tenantId (camelCase) - send both to be safe
    const message: any = {
      type: 'message',
      text,
      tenantId: this.tenantId,  // camelCase
      tenant_id: this.tenantId,  // snake_case (server might expect this)
      conversation_id: this.conversationId,
      visitor_id: this.visitorId,
      timestamp: new Date().toISOString(),
      sessionId: sessionInfo.sessionId,
      fingerprint: sessionInfo.fingerprint,
      ...this.websiteInfo,
    };

    // Add integration_id and site_id if available (from Gateway response)
    if (this.integrationId) {
      message.integration_id = this.integrationId;
      message.integrationId = this.integrationId;  // Send both formats
    }
    if (this.siteId) {
      message.site_id = this.siteId;
      message.siteId = this.siteId;  // Send both formats
    }

    if (this.userId) {
      message.userId = this.userId;
      if (this.userInfo) {
        message.userInfo = this.userInfo;
      }
    }

    // Add sender_name if available (from welcome message)
    const senderName = getSenderName();
    if (senderName) {
      message.sender_name = senderName;
    }

    // Add temp_id for optimistic message replacement (server echoes in meta_message_created)
    if (tempId) {
      message.temp_id = tempId;
    }

    try {
      this.socket.emit('message', message);
    } catch (error) {
      console.error('[Socket.IO] Error sending message:', error);
      throw error;
    }
  }

  /**
   * Request list of online users (admin only)
   */
  requestOnlineUsers(): void {
    if (typeof window === 'undefined') {
      console.warn('[Socket.IO] Cannot request online users: Socket.IO is only available in the browser');
      return;
    }

    if (!this.socket || !this.socket.connected) {
      console.warn('[Socket.IO] Cannot request online users: not connected');
      return;
    }

    if (!this.isAdmin) {
      console.warn('[Socket.IO] Cannot request online users: not admin');
      return;
    }

    const payload: any = {
      type: 'get_online_users',
    };
    // Only add tenantId if available
    if (this.tenantId) {
      payload.tenantId = this.tenantId;
    }
    this.socket.emit('get_online_users', payload);
  }

  /**
   * Schedule proactive token refresh before expiration
   */
  private scheduleTokenRefresh(refreshInMs: number): void {
    // Clear existing timer
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    // Don't schedule if refresh time is too short (< 1 minute)
    if (refreshInMs < 60000) {
      console.warn('[Socket.IO] Token expires too soon, skipping proactive refresh');
      return;
    }

    this.tokenRefreshTimer = setTimeout(async () => {
      if (this.socket && this.socket.connected) {
        try {
          // Re-initialize to get new token
          const result = await this.initialize(this.visitorId);
          if (result && this.socket) {
            // Disconnect old connection and reconnect with new token
            const wasConnected = this.socket.connected;
            this.socket.disconnect();
            
            if (wasConnected) {
              // Reconnect with new token
              this.connect();
            }
          }
        } catch (error) {
          console.error('[Socket.IO] Failed to refresh token:', error);
          // Token refresh failed - let Socket.IO handle reconnection
        }
      }
    }, refreshInMs);
  }

  /**
   * Generate unique key for message deduplication
   * Uses content-based key since IDs won't match between message:new and meta_message_created
   * message:new broadcasts BEFORE DB write (no message_id), meta_message_created broadcasts AFTER (with message_id)
   */
  private getMessageKey(data: any): string {
    // Use content-based key: conversation_id + sender_type + text
    // This works because IDs will never match between the two events
    const text = data.text || data.message_text;
    const sender = data.sender_type || data.sender;
    const conversationId = data.conversation_id;
    
    // Normalize sender to match backend values: 'human', 'ai', 'user'
    const normalizedSender = sender === 'agent' ? 'human' : (sender === 'bot' ? 'ai' : sender);
    
    return `${conversationId}:${normalizedSender}:${text}`;
  }

  /**
   * Check if message has already been processed
   */
  private hasProcessedMessage(messageKey: string): boolean {
    const timestamp = this.processedMessageKeys.get(messageKey);
    if (!timestamp) return false;
    
    // Check if still within TTL
    return (Date.now() - timestamp) < this.MESSAGE_CACHE_TTL;
  }

  /**
   * Mark message as processed
   */
  private markMessageProcessed(messageKey: string): void {
    this.processedMessageKeys.set(messageKey, Date.now());
    this.cleanMessageCache();
  }

  /**
   * Clean up expired entries from message cache
   */
  private cleanMessageCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.processedMessageKeys.entries()) {
      if (now - timestamp > this.MESSAGE_CACHE_TTL) {
        this.processedMessageKeys.delete(key);
      }
    }
  }

  /**
   * Check if JWT token is expired or about to expire
   */
  isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) {
      return true; // No token = expired
    }
    // Consider expired if less than 1 minute remaining
    return Date.now() >= (this.tokenExpiresAt - 60000);
  }

  /**
   * Disconnect Socket.IO connection
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Clear token refresh timer
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if Socket.IO is connected
   */
  isConnected(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return this.socket?.connected ?? false;
  }

  /**
   * Set user information (for logged-in users)
   */
  setUser(userId: string, userInfo?: UserInfo): void {
    this.userId = userId;
    this.userInfo = userInfo;
  }

  /**
   * Clear user information (logout)
   */
  clearUser(): void {
    this.userId = undefined;
    this.userInfo = undefined;
  }
}
