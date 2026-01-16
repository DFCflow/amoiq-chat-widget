/**
 * Tenant resolution utilities
 * Handles tenant ID extraction and validation
 */

export function getTenantId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // Get from URL params (for iframe)
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get('tenantId');

  if (tenantId) {
    return tenantId;
  }

  // Fallback to config (for direct access)
  const config = (window as any).ChatWidgetConfig;
  if (config?.tenantId) {
    return config.tenantId;
  }

  return null;
}

export function validateTenantId(tenantId: string | null): boolean {
  if (!tenantId) {
    return false;
  }

  // Basic validation - adjust based on your tenant ID format
  return /^[a-zA-Z0-9_-]+$/.test(tenantId) && tenantId.length > 0;
}

