/**
 * WebSocket client for real-time chat
 * Handles connection, message sending, and event callbacks
 */

export interface WebSocketCallbacks {
  onMessage?: (message: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export class ChatWebSocket {
  private tenantId: string;
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private wsUrl: string;

  constructor(tenantId: string, callbacks: WebSocketCallbacks = {}) {
    this.tenantId = tenantId;
    this.callbacks = callbacks;
    
    // Determine WebSocket URL
    const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || process.env.NEXT_PUBLIC_WS_URL;
    
    if (wsUrl) {
      // If URL already includes path, use as-is, otherwise append /ws/chat
      const baseUrl = wsUrl.replace(/^https?:/, wsProtocol);
      if (baseUrl.includes('/')) {
        // URL already has a path
        this.wsUrl = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}?tenantId=${encodeURIComponent(tenantId)}`;
      } else {
        // No path, append default
        this.wsUrl = `${baseUrl}/ws/chat?tenantId=${encodeURIComponent(tenantId)}`;
      }
    } else {
      // Default fallback
      this.wsUrl = `${wsProtocol}//api.amoiq.com/ws/chat?tenantId=${encodeURIComponent(tenantId)}`;
    }
    
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle different message types
          if (data.type === 'message') {
            this.callbacks.onMessage?.(data.message);
          } else if (data.type === 'error') {
            this.callbacks.onError?.(new Error(data.error || 'WebSocket error'));
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.callbacks.onError?.(new Error('WebSocket connection error'));
      };

      this.ws.onclose = () => {
        this.callbacks.onDisconnect?.();
        
        // Attempt to reconnect if needed
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          setTimeout(() => this.connect(), delay);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      this.callbacks.onError?.(error as Error);
    }
  }

  /**
   * Send a message through WebSocket
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const message = {
      type: 'message',
      text,
      tenantId: this.tenantId,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

