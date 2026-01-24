/**
 * React hook for tracking online users in admin interface
 * Provides real-time updates via WebSocket and fallback to API polling
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { ChatWebSocketNative, OnlineUser } from '@/lib/ws-native';
import { ChatAPI } from '@/lib/api';

export interface UseOnlineUsersOptions {
  /**
   * Enable WebSocket for real-time updates (default: true)
   * If false, will only use API polling
   */
  enableWebSocket?: boolean;
  /**
   * Polling interval in milliseconds when WebSocket is disabled (default: 5000)
   */
  pollingInterval?: number;
  /**
   * Auto-refresh on mount (default: true)
   */
  autoRefresh?: boolean;
}

export interface UseOnlineUsersReturn {
  /**
   * Current list of online users
   */
  onlineUsers: OnlineUser[];
  /**
   * Loading state (initial fetch or refresh)
   */
  isLoading: boolean;
  /**
   * Error state if any
   */
  error: Error | null;
  /**
   * Manual refresh function
   */
  refresh: () => void;
  /**
   * WebSocket connection status
   */
  isConnected: boolean;
}

/**
 * Hook to track online users for a tenant
 * 
 * @param tenantId - Tenant ID to track users for
 * @param options - Configuration options
 * @returns Online users state and controls
 * 
 * @example
 * ```tsx
 * const { onlineUsers, isLoading, error } = useOnlineUsers('tenant-123');
 * 
 * return (
 *   <div>
 *     {isLoading ? 'Loading...' : `${onlineUsers.length} users online`}
 *     {onlineUsers.map(user => (
 *       <div key={user.userId}>{user.userId}</div>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useOnlineUsers(
  tenantId: string | null,
  options: UseOnlineUsersOptions = {}
): UseOnlineUsersReturn {
  const {
    enableWebSocket = true,
    pollingInterval = 5000,
    autoRefresh = true,
  } = options;

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<ChatWebSocketNative | null>(null);
  const apiRef = useRef<ChatAPI | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Fetch online users from API
   */
  const fetchOnlineUsers = useCallback(async () => {
    if (!apiRef.current) return;

    try {
      setIsLoading(true);
      setError(null);
      const users = await apiRef.current.getOnlineUsers();
      setOnlineUsers(users);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch online users');
      setError(error);
      console.error('[useOnlineUsers] Error fetching online users:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Setup WebSocket connection for real-time updates
   */
  useEffect(() => {
    if (!tenantId || !enableWebSocket) {
      return;
    }

    // Initialize API client
    apiRef.current = new ChatAPI(tenantId);

    // Initialize WebSocket connection as admin (Gateway plan)
    const initializeWebSocket = async () => {
      try {
        wsRef.current = new ChatWebSocketNative(tenantId, {
          onConnect: () => {
            console.log('[useOnlineUsers] WebSocket connected');
            setIsConnected(true);
            // Request initial list on connect
            wsRef.current?.requestOnlineUsers();
          },
          onDisconnect: () => {
            console.log('[useOnlineUsers] WebSocket disconnected');
            setIsConnected(false);
          },
          onError: (err) => {
            console.error('[useOnlineUsers] WebSocket error:', err);
            setError(err);
            setIsConnected(false);
            // Fallback to polling if WebSocket fails
            if (!pollingIntervalRef.current) {
              pollingIntervalRef.current = setInterval(fetchOnlineUsers, pollingInterval);
            }
          },
          onUserOnline: (user) => {
            console.log('[useOnlineUsers] User came online:', user);
            setOnlineUsers((prev) => {
              // Check if user already exists
              const exists = prev.find((u) => u.userId === user.userId);
              if (exists) {
                // Update existing user
                return prev.map((u) => (u.userId === user.userId ? user : u));
              }
              // Add new user
              return [...prev, user];
            });
          },
          onUserOffline: (userId) => {
            console.log('[useOnlineUsers] User went offline:', userId);
            setOnlineUsers((prev) => prev.filter((u) => u.userId !== userId));
          },
          onOnlineUsersList: (users) => {
            console.log('[useOnlineUsers] Received online users list:', users);
            setOnlineUsers(users);
            setIsLoading(false);
          },
        }, undefined, true); // true = isAdmin

        // Initialize conversation and get JWT token
        const initResult = await wsRef.current.initialize();
        if (!initResult) {
          throw new Error('Failed to initialize conversation');
        }

        // Connect WebSocket
        wsRef.current.connect();
      } catch (err) {
        console.error('[useOnlineUsers] Failed to initialize WebSocket:', err);
        setError(err instanceof Error ? err : new Error('WebSocket initialization failed'));
        setIsConnected(false);
        // Fallback to polling
        if (!pollingIntervalRef.current) {
          pollingIntervalRef.current = setInterval(fetchOnlineUsers, pollingInterval);
        }
      }
    };

    initializeWebSocket();

    // Initial fetch
    if (autoRefresh) {
      fetchOnlineUsers();
    }

    // Cleanup
    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [tenantId, enableWebSocket, autoRefresh, fetchOnlineUsers, pollingInterval]);

  /**
   * Setup polling fallback when WebSocket is disabled
   */
  useEffect(() => {
    if (!tenantId || enableWebSocket) {
      return;
    }

    // Initialize API client
    apiRef.current = new ChatAPI(tenantId);

    // Initial fetch
    if (autoRefresh) {
      fetchOnlineUsers();
    }

    // Setup polling
    pollingIntervalRef.current = setInterval(fetchOnlineUsers, pollingInterval);

    // Cleanup
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [tenantId, enableWebSocket, autoRefresh, fetchOnlineUsers, pollingInterval]);

  /**
   * Manual refresh function
   */
  const refresh = useCallback(() => {
    if (enableWebSocket && wsRef.current?.isConnected()) {
      // Request via WebSocket if connected
      wsRef.current.requestOnlineUsers();
    } else {
      // Fallback to API
      fetchOnlineUsers();
    }
  }, [enableWebSocket, fetchOnlineUsers]);

  return {
    onlineUsers,
    isLoading,
    error,
    refresh,
    isConnected,
  };
}

