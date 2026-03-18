const RUNTIME_PUBLISHABLE_KEY_STORAGE_KEY = 'amoiq_widget_publishable_key';
const RUNTIME_WIDGET_TOKEN_STORAGE_KEY = 'amoiq_widget_token';

/**
 * Resolves the widget bootstrap key in this order:
 * 1) URL query params (publishableKey / siteKey / apiKey)
 * 2) window.ChatWidgetConfig.publishableKey / siteKey / apiKey
 * 3) localStorage cache from previous successful runtime injection
 * 4) build-time public env vars
 */
export function getRuntimePublishableKey(): string | null {
  const envKey = process.env.NEXT_PUBLIC_GATEWAY_API_KEY || process.env.NEXT_PUBLIC_API_KEY;

  if (typeof window === 'undefined') {
    return envKey || null;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryKey =
      params.get('publishableKey') ||
      params.get('publishable_key') ||
      params.get('siteKey') ||
      params.get('site_key') ||
      params.get('apiKey') ||
      params.get('api_key');
    if (queryKey) {
      localStorage.setItem(RUNTIME_PUBLISHABLE_KEY_STORAGE_KEY, queryKey);
      return queryKey;
    }
  } catch (_e) {
    // Ignore URL parsing/localStorage failures and continue fallback chain.
  }

  try {
    const cfg = (window as any).ChatWidgetConfig;
    const cfgKey =
      cfg?.publishableKey ||
      cfg?.publishable_key ||
      cfg?.siteKey ||
      cfg?.site_key ||
      cfg?.apiKey ||
      cfg?.api_key;
    if (cfgKey) {
      localStorage.setItem(RUNTIME_PUBLISHABLE_KEY_STORAGE_KEY, cfgKey);
      return cfgKey;
    }
  } catch (_e) {
    // Ignore cross-origin/config access failures.
  }

  try {
    const cached = localStorage.getItem(RUNTIME_PUBLISHABLE_KEY_STORAGE_KEY);
    if (cached) return cached;
  } catch (_e) {
    // Ignore localStorage access failures.
  }

  return envKey || null;
}

// Backward-compatible alias while callers migrate to publishable-key naming.
export function getRuntimeGatewayApiKey(): string | null {
  return getRuntimePublishableKey();
}

export function getRuntimeCustomerToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('customerToken') || params.get('customer_token');
    if (queryToken) {
      return queryToken;
    }
  } catch (_e) {
    // Ignore URL parsing failures.
  }

  try {
    const cfg = (window as any).ChatWidgetConfig;
    const cfgToken = cfg?.customerToken || cfg?.customer_token;
    if (cfgToken) {
      return cfgToken;
    }
  } catch (_e) {
    // Ignore cross-origin/config access failures.
  }

  return null;
}

export function getRuntimeWidgetToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return localStorage.getItem(RUNTIME_WIDGET_TOKEN_STORAGE_KEY);
  } catch (_e) {
    return null;
  }
}

export function setRuntimeWidgetToken(token: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (token) {
      localStorage.setItem(RUNTIME_WIDGET_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(RUNTIME_WIDGET_TOKEN_STORAGE_KEY);
    }
  } catch (_e) {
    // Ignore localStorage failures.
  }
}
