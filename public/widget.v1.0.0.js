/**
 * Amoiq Chat Widget Loader
 * Version: 1.0.0
 * 
 * This script injects the chat widget iframe into the page.
 * It reads window.ChatWidgetConfig for configuration.
 */

(function() {
  'use strict';

  // Wait for config to be available
  function initWidget() {
    const config = window.ChatWidgetConfig || {};
    const tenantId = config.tenantId;
    const position = config.position || 'bottom-right';
    
    // tenantId is optional - Gateway will resolve it from domain if not provided

    // Prevent multiple initializations
    if (document.getElementById('amoiq-widget-container')) {
      return;
    }

    // Create container
    const container = document.createElement('div');
    container.id = 'amoiq-widget-container';
    container.style.cssText = `
      position: fixed;
      z-index: 999999;
      ${getPositionStyles(position)};
    `;
    document.body.appendChild(container);

    const bubbleTheme = resolveBubbleTheme(config);
    const bubbleGradient = bubbleTheme.background;
    const bubbleShadowRest = bubbleTheme.shadowRest;
    const bubbleShadowPulse = bubbleTheme.shadowPulse;
    const bubbleShadowHover = bubbleTheme.shadowHover;
    const iconColor = bubbleTheme.iconColor;

    const bubble = document.createElement('div');
    bubble.id = 'amoiq-widget-bubble';
    bubble.style.cssText = `
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${bubbleGradient};
      cursor: pointer;
      box-shadow: ${bubbleShadowRest};
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      position: relative;
    `;
    
    // Four-pointed spark from the Amo IQ mark; ink on the logo gradient (favicon treatment)
    bubble.innerHTML = `
      <span id="amoiq-widget-badge" style="
        position: absolute;
        top: 4px;
        right: 4px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #EF4444;
        border: 2px solid white;
        display: none;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      " aria-label="New message"></span>
      <svg id="amoiq-widget-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transition: transform 0.3s ease; filter: drop-shadow(0 1px 1px rgba(13, 13, 13, 0.12));">
        <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="${iconColor}" stroke="${iconColor}" stroke-width="0.5"/>
        <path d="M12 2L12 6M12 14L12 18M2 10L6 10M18 10L22 10" stroke="${iconColor}" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>
      </svg>
    `;
    
    bubble.addEventListener('mouseenter', function() {
      this.style.transform = 'scale(1.1)';
      this.style.boxShadow = bubbleShadowHover;
      const icon = this.querySelector('#amoiq-widget-icon');
      if (icon) {
        icon.style.transform = 'rotate(15deg) scale(1.1)';
      }
    });
    
    bubble.addEventListener('mouseleave', function() {
      this.style.transform = 'scale(1)';
      this.style.boxShadow = bubbleShadowRest;
      const icon = this.querySelector('#amoiq-widget-icon');
      if (icon) {
        icon.style.transform = 'rotate(0deg) scale(1)';
      }
    });
    
    let glowInterval = setInterval(function() {
      if (bubble.style.boxShadow === bubbleShadowRest) {
        bubble.style.boxShadow = bubbleShadowPulse;
      } else if (bubble.style.boxShadow === bubbleShadowPulse) {
        bubble.style.boxShadow = bubbleShadowRest;
      }
    }, 2000);
    
    container.appendChild(bubble);

    // Detect mobile
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

    // Create iframe (hidden initially)
    const iframe = document.createElement('iframe');
    iframe.id = 'amoiq-widget-iframe';
    iframe.setAttribute('allow', 'microphone; camera');
    const baseUrl = config.baseUrl || getBaseUrl();
    
    // Build URL with tenantId (if provided) and website info
    const urlParams = new URLSearchParams();
    // Only add tenantId if provided - Gateway will resolve from domain if not provided
    if (tenantId) {
      urlParams.set('tenantId', tenantId);
    }
    
    // Add website info from current page (allow overrides from config)
    if (typeof window !== 'undefined') {
      const resolvedDomain = normalizeDomain(config.domain || window.location.hostname);
      const resolvedOrigin = config.origin || window.location.origin;
      urlParams.set('domain', resolvedDomain);
      urlParams.set('origin', resolvedOrigin);
      urlParams.set('url', window.location.href);
      if (document.referrer) {
        urlParams.set('referrer', document.referrer);
      }
    }
    
    // Add optional siteId from config if provided
    if (config.siteId) {
      urlParams.set('siteId', config.siteId);
    }

    // Runtime bootstrap key support:
    // Useful when the same widget bundle is reused across environments
    // and the publishable key should be injected at embed-time.
    const publishableKey =
      config.publishableKey ||
      config.publishable_key ||
      config.siteKey ||
      config.site_key ||
      config.apiKey ||
      config.api_key;
    if (publishableKey) {
      urlParams.set('publishableKey', publishableKey);
      // Keep the legacy parameter during migration.
      urlParams.set('apiKey', publishableKey);
    }

    // Forward signed customer identity and display hints into the iframe so
    // cross-origin embeds do not need same-origin access to the parent page.
    if (config.customerToken || config.customer_token) {
      urlParams.set('customerToken', config.customerToken || config.customer_token);
    }
    if (config.userId) {
      urlParams.set('userId', config.userId);
    }
    if (config.userName || (config.userInfo && config.userInfo.name)) {
      urlParams.set('userName', config.userName || config.userInfo.name);
    }
    if (config.userEmail || (config.userInfo && config.userInfo.email)) {
      urlParams.set('userEmail', config.userEmail || config.userInfo.email);
    }
    if (config.userPhone || (config.userInfo && config.userInfo.phone)) {
      urlParams.set('userPhone', config.userPhone || config.userInfo.phone);
    }
    
    iframe.src = `${baseUrl}/embed?${urlParams.toString()}`;

    if (isMobile) {
      // Fullscreen on mobile — app-like experience
      iframe.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: none;
        border-radius: 0;
        box-shadow: none;
        display: none;
        background: white;
        z-index: 999999;
      `;
    } else {
      // Desktop: normal popup widget
      iframe.style.cssText = `
        width: 380px;
        height: 600px;
        border: none;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        display: none;
        background: white;
      `;
    }
    container.appendChild(iframe);

    let isOpen = false;

    function showNewMessageBadge() {
      var badge = document.getElementById('amoiq-widget-badge');
      if (badge && !isOpen) {
        badge.style.display = 'block';
      }
    }

    function hideNewMessageBadge() {
      var badge = document.getElementById('amoiq-widget-badge');
      if (badge) {
        badge.style.display = 'none';
      }
    }

    // Toggle chat
    function toggleChat() {
      isOpen = !isOpen;
      if (isOpen) {
        iframe.style.display = 'block';
        bubble.style.display = 'none';
        hideNewMessageBadge();
        iframe.focus();
        // On mobile: prevent body scroll when chat is open
        if (isMobile) {
          document.body.style.overflow = 'hidden';
          document.body.style.position = 'fixed';
          document.body.style.width = '100%';
          document.body.style.height = '100%';
        }
        // Notify iframe that chat is now open (for WebSocket initialization)
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'amoiq-widget-open' }, '*');
        }
      } else {
        iframe.style.display = 'none';
        bubble.style.display = 'flex';
        // Restore body scroll on mobile
        if (isMobile) {
          document.body.style.overflow = '';
          document.body.style.position = '';
          document.body.style.width = '';
          document.body.style.height = '';
        }
      }
    }

    bubble.addEventListener('click', toggleChat);

    // Close on outside click (optional)
    document.addEventListener('click', function(e) {
      if (isOpen && !container.contains(e.target)) {
        toggleChat();
      }
    });

    // Listen for messages from iframe to close
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'amoiq-widget-close') {
        if (isOpen) {
          toggleChat();
        }
      }
      // Show badge when new message arrives (admin/bot) while chat is closed
      if (e.data && e.data.type === 'amoiq-widget-new-message') {
        showNewMessageBadge();
      }
    });
  }

  var DEFAULT_BUBBLE_STOPS = ['#CF8360', '#B5A2C6', '#6B84C5'];
  var DEFAULT_ICON_COLOR = '#0d0d0d';

  function parseHexColor(value) {
    if (!value || typeof value !== 'string') return null;
    var hex = value.trim();
    if (hex.charAt(0) !== '#') hex = '#' + hex;
    if (/^#([0-9a-fA-F]{3})$/.test(hex)) {
      return ('#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3)).toUpperCase();
    }
    if (/^#([0-9a-fA-F]{6})$/.test(hex)) return hex.toUpperCase();
    return null;
  }

  function hexToRgb(hex) {
    var parsed = parseHexColor(hex);
    if (!parsed) return null;
    return {
      r: parseInt(parsed.slice(1, 3), 16),
      g: parseInt(parsed.slice(3, 5), 16),
      b: parseInt(parsed.slice(5, 7), 16),
    };
  }

  function rgbaFromHex(hex, alpha) {
    var rgb = hexToRgb(hex);
    if (!rgb) return 'rgba(107, 132, 197, ' + alpha + ')';
    return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
  }

  function normalizeColorStops(value) {
    var stops = [];
    function push(item) {
      if (!item) return;
      if (Array.isArray(item)) {
        item.forEach(push);
        return;
      }
      if (typeof item === 'string' && item.indexOf(',') !== -1 && item.indexOf('(') === -1) {
        item.split(',').forEach(push);
        return;
      }
      if (typeof item === 'object') {
        push(item.from || item.start || item.warm);
        push(item.mid || item.middle || item.lavender);
        push(item.to || item.end || item.cool);
        return;
      }
      var hex = parseHexColor(item);
      if (hex) stops.push(hex);
    }
    push(value);
    return stops.slice(0, 3);
  }

  function getLoaderScriptEl() {
    if (document.currentScript && document.currentScript.getAttribute) {
      return document.currentScript;
    }
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('widget.v1') !== -1) return scripts[i];
    }
    return null;
  }

  function resolveColorStops(config) {
    var fromConfig = normalizeColorStops(
      config.colors || config.bubbleColors || config.color || config.bubbleColor || config.primaryColor
    );
    if (fromConfig.length) return fromConfig;

    var scriptEl = getLoaderScriptEl();
    if (scriptEl) {
      var fromAttrs = normalizeColorStops(
        scriptEl.getAttribute('data-colors') || scriptEl.getAttribute('data-color')
      );
      if (fromAttrs.length) return fromAttrs;
    }

    return DEFAULT_BUBBLE_STOPS.slice();
  }

  function resolveIconColor(config, stops) {
    var scriptEl = getLoaderScriptEl();
    var override = parseHexColor(
      config.iconColor ||
      config.bubbleIconColor ||
      (scriptEl && scriptEl.getAttribute('data-icon-color'))
    );
    if (override) return override;

    var rgb = hexToRgb(stops[0]);
    if (!rgb) return DEFAULT_ICON_COLOR;
    var luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luma < 0.45 ? '#FFFFFF' : DEFAULT_ICON_COLOR;
  }

  function resolveBubbleTheme(config) {
    var stops = resolveColorStops(config);
    var start = stops[0];
    var end = stops[stops.length - 1];
    var background;
    if (stops.length === 1) {
      background = start;
    } else if (stops.length === 2) {
      background = 'linear-gradient(135deg, ' + start + ' 0%, ' + stops[1] + ' 100%)';
    } else {
      background = 'linear-gradient(135deg, ' + start + ' 0%, ' + stops[1] + ' 52%, ' + stops[2] + ' 100%)';
    }
    return {
      background: background,
      iconColor: resolveIconColor(config, stops),
      shadowRest: '0 4px 20px ' + rgbaFromHex(end, 0.28) + ', 0 0 0 0 ' + rgbaFromHex(start, 0.22),
      shadowPulse: '0 4px 20px ' + rgbaFromHex(end, 0.38) + ', 0 0 0 0 ' + rgbaFromHex(start, 0.30),
      shadowHover: '0 6px 30px ' + rgbaFromHex(end, 0.42) + ', 0 0 0 4px ' + rgbaFromHex(start, 0.18),
    };
  }

  function getPositionStyles(position) {
    const positions = {
      'bottom-right': 'bottom: 20px; right: 20px;',
      'bottom-left': 'bottom: 20px; left: 20px;',
      'top-right': 'top: 20px; right: 20px;',
      'top-left': 'top: 20px; left: 20px;',
    };
    return positions[position] || positions['bottom-right'];
  }

  function getBaseUrl() {
    // In production, this should be https://webchat.amoiq.com
    // For development, detect current origin
    if (typeof window !== 'undefined') {
      const script = document.currentScript || 
        Array.from(document.getElementsByTagName('script')).pop();
      if (script && script.src) {
        const url = new URL(script.src);
        return url.origin;
      }
    }
    return window.location.origin;
  }

  function normalizeDomain(domain) {
    if (!domain || typeof domain !== 'string') return '';
    var normalized = domain.trim().toLowerCase();
    if (normalized.indexOf('://') !== -1) {
      try {
        normalized = new URL(normalized).hostname;
      } catch (_e) {
        // Keep best-effort fallback value.
      }
    }
    if (normalized.indexOf('/') !== -1) {
      normalized = normalized.split('/')[0];
    }
    if (normalized.indexOf(':') !== -1) {
      normalized = normalized.split(':')[0];
    }
    if (normalized.indexOf('www.') === 0) {
      normalized = normalized.substring(4);
    }
    return normalized;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }

  // Also try after a short delay in case config is set asynchronously
  setTimeout(initWidget, 100);
})();

