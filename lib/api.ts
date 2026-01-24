/**
 * Backend API client
 * Handles HTTP requests to the chat API
 * Production-ready with session management and user identification
 */

import { getSessionInfo, refreshSession } from './session';

const API_BASE_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || 'https://api-gateway-dfcflow.fly.dev';

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot' | 'agent';
  timestamp: string;
  deliveryStatus?: 'pending' | 'delivered' | 'failed';
}

export interface SendMessageResponse {
  success: boolean;
  message?: Message;
  error?: string;
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
  [key: string]: any; // Allow additional user properties
}

export interface SendMessageOptions {
  userId?: string; // For logged-in users
  userInfo?: UserInfo; // User information for logged-in users
}

export interface OnlineUser {
  userId: string;
  sessionId?: string;
  connectedAt: string;
  domain?: string;
  origin?: string;
  url?: string;
}

export class ChatAPI {
  private tenantId: string;
  private baseUrl: string;
  private websiteInfo: WebsiteInfo;
  private userId?: string; // For logged-in users
  private userInfo?: UserInfo; // User information

  constructor(tenantId: string, websiteInfo?: WebsiteInfo, userId?: string, userInfo?: UserInfo) {
    this.tenantId = tenantId;
    this.baseUrl = API_BASE_URL;
    this.websiteInfo = websiteInfo || this.getWebsiteInfo();
    this.userId = userId;
    this.userInfo = userInfo;
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

  /**
   * Auto-detect website information from browser
   */
  private getWebsiteInfo(): WebsiteInfo {
    if (typeof window !== 'undefined') {
      return {
        domain: window.location.hostname,
        origin: window.location.origin,
        url: window.location.href,
        referrer: document.referrer || '',
      };
    }
    return {};
  }

  /**
   * Get API headers with tenant authentication
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Add tenant ID to headers
    headers['X-Tenant-ID'] = this.tenantId;

    // Add API key if available (from env or config)
    // This is the API key for Gateway authentication, NOT a JWT token
    // Gateway verifies API key, then routes to Backend
    // Backend generates JWT tokens internally (has JWT_SECRET)
    const apiKey = process.env.NEXT_PUBLIC_GATEWAY_API_KEY || process.env.NEXT_PUBLIC_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  /**
   * Fetch messages for the current conversation
   * Loads conversation history based on sessionId or userId
   */
  async getMessages(): Promise<Message[]> {
    try {
      const sessionInfo = getSessionInfo();
      
      // Build query params with session info
      const params = new URLSearchParams({
        tenantId: this.tenantId,
        sessionId: sessionInfo.sessionId,
      });

      // Add userId if logged in
      if (this.userId) {
        params.append('userId', this.userId);
      }

      const response = await fetch(`${this.baseUrl}/api/chat/messages?${params.toString()}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.statusText}`);
      }

      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      console.error('[ChatAPI] Error fetching messages:', error);
      return [];
    }
  }

  /**
   * Send a message
   * Supports both anonymous and logged-in users
   * Backend determines user type based on payload (userId presence)
   */
  async sendMessage(text: string, options?: SendMessageOptions): Promise<SendMessageResponse> {
    try {
      // Get session info (sessionId + fingerprint)
      const sessionInfo = getSessionInfo();
      
      // Refresh session to extend expiration
      refreshSession();

      // Prepare message payload
      const payload: any = {
        text,
        tenantId: this.tenantId,
        sessionId: sessionInfo.sessionId,
        fingerprint: sessionInfo.fingerprint,
        ...this.websiteInfo, // Include domain, origin, url, referrer, siteId
      };

      // Add user identification if logged in
      const userId = options?.userId || this.userId;
      const userInfo = options?.userInfo || this.userInfo;

      if (userId) {
        // Logged-in user
        payload.userId = userId;
        if (userInfo) {
          payload.userInfo = userInfo;
        }
      }
      // If no userId, backend treats as anonymous user (uses sessionId + fingerprint)

      // Retry logic for production
      let lastError: Error | null = null;
      const maxRetries = 3;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch(`${this.baseUrl}/webchat/message`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            
            // Don't retry on client errors (4xx)
            if (response.status >= 400 && response.status < 500) {
              throw new Error(`Failed to send message: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            // Retry on server errors (5xx)
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          
          // Update sessionId if backend returns a new one
          if (data.sessionId && data.sessionId !== sessionInfo.sessionId) {
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('chat_session_id', data.sessionId);
              } catch (e) {
                console.warn('[ChatAPI] Failed to update sessionId:', e);
              }
            }
          }

          return {
            success: true,
            message: data.message,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error');
          
          // Don't retry on last attempt
          if (attempt < maxRetries - 1) {
            // Exponential backoff
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }

      // All retries failed
      throw lastError || new Error('Failed to send message after retries');
    } catch (error) {
      console.error('[ChatAPI] Error sending message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Include more details for network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          error: `Network error: ${errorMessage}. Check if the API endpoint is accessible.`,
        };
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Initialize a new conversation session
   */
  async initializeSession(): Promise<{ sessionId: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat/session`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          tenantId: this.tenantId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to initialize session: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error initializing session:', error);
      return null;
    }
  }

  /**
   * Initialize conversation and get JWT token for WebSocket connection
   * This is the new flow per Gateway plan: POST /webchat/init
   */
  async initializeConversation(visitorId?: string): Promise<{
    conversation_id: string;
    visitor_id: string;
    ws_token: string;
    expires_in: number;
  } | null> {
    try {
      const sessionInfo = getSessionInfo();
      
      // Prepare payload according to Gateway plan
      const payload: any = {
        tenantId: this.tenantId,
        ...this.websiteInfo, // domain, origin, url, siteId
      };

      // Add visitorId if provided (for returning users)
      if (visitorId) {
        payload.visitorId = visitorId;
      }

      // Add user identification if logged in
      if (this.userId) {
        payload.userId = this.userId;
        if (this.userInfo) {
          payload.userInfo = this.userInfo;
        }
      }

      const response = await fetch(`${this.baseUrl}/webchat/init`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to initialize conversation: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[ChatAPI] Error initializing conversation:', error);
      return null;
    }
  }

  /**
   * Get list of online users for the tenant
   * Requires admin authentication
   * Gateway endpoint: GET /api/webchat/online-users → Forwards to Backend GET /v1/webchat/online-users
   */
  async getOnlineUsers(): Promise<OnlineUser[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/webchat/online-users?tenantId=${this.tenantId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch online users: ${response.statusText}`);
      }

      const data = await response.json();
      return data.users || [];
    } catch (error) {
      console.error('Error fetching online users:', error);
      return [];
    }
  }
}

