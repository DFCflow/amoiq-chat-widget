'use client';

import { useEffect, useState, useRef } from 'react';
import { getTenantId } from '@/lib/tenant';
import { ChatAPI } from '@/lib/api';
import { ChatWebSocket } from '@/lib/ws';
import styles from './styles.module.css';

// Force dynamic rendering - no caching
export const dynamic = 'force-dynamic';

export default function EmbedPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<ChatWebSocket | null>(null);
  const apiRef = useRef<ChatAPI | null>(null);

  useEffect(() => {
    // Get tenant ID from URL params (support both 'tenantId' and 'tenant')
    const params = new URLSearchParams(window.location.search);
    const tid = params.get('tenantId') || params.get('tenant');
    
    if (!tid) {
      console.error('Missing tenantId or tenant parameter');
      setIsLoading(false);
      return;
    }

    setTenantId(tid);
    
    // Initialize API client
    apiRef.current = new ChatAPI(tid);
    
    // Initialize WebSocket
    wsRef.current = new ChatWebSocket(tid, {
      onMessage: (message) => {
        setMessages((prev) => [...prev, message]);
      },
      onConnect: () => {
        setIsConnected(true);
        setIsLoading(false);
        setWsError(null);
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
        setWsError(error.message || 'WebSocket connection failed');
        setIsLoading(false);
        // Allow input even if WebSocket fails - will use HTTP API fallback
        setIsConnected(false);
      },
    });

    // Load initial messages
    apiRef.current.getMessages().then((initialMessages) => {
      setMessages(initialMessages);
    }).catch((error) => {
      console.error('Failed to load messages:', error);
      setIsLoading(false);
    });

    return () => {
      wsRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || !apiRef.current) return;

    const messageText = inputValue.trim();
    setInputValue('');

    // Optimistically add user message
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // Try WebSocket first if connected
      if (wsRef.current && isConnected) {
        await wsRef.current.sendMessage(messageText);
      } else {
        // Fallback to HTTP API if WebSocket not available
        const response = await apiRef.current.sendMessage(messageText);
        if (!response.success) {
          throw new Error(response.error || 'Failed to send message');
        }
        // Replace temp message with real one from API
        if (response.message) {
          setMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== userMessage.id);
            return [...filtered, response.message!];
          });
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    }
  };

  const handleClose = () => {
    // Notify parent window to close widget
    if (window.parent) {
      window.parent.postMessage({ type: 'amoiq-widget-close' }, '*');
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Connecting...</div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Invalid configuration</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Chat Support</h3>
        <button className={styles.closeButton} onClick={handleClose} aria-label="Close">
          ×
        </button>
        <div className={styles.status}>
          {isConnected ? (
            <span className={styles.statusConnected}>● Online</span>
          ) : wsError ? (
            <span className={styles.statusDisconnected} title={wsError}>● Offline (API only)</span>
          ) : (
            <span className={styles.statusDisconnected}>● Offline</span>
          )}
        </div>
      </div>

      <div className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>Start a conversation</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.message} ${
                message.sender === 'user' ? styles.messageUser : styles.messageBot
              }`}
            >
              <div className={styles.messageContent}>{message.text}</div>
              <div className={styles.messageTime}>
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputContainer}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          className={styles.input}
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || isLoading}
          className={styles.sendButton}
          aria-label="Send message"
        >
          →
        </button>
      </div>
    </div>
  );
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot' | 'agent';
  timestamp: string;
}

