'use client';

import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

/**
 * Local development test page.
 * Widget uses domain (and optional tenant/site) – no login.
 * Run `npm run dev` and open http://localhost:3000/test
 * to debug the widget without embedding it in another page.
 */
function buildOrigin(domain: string, base: string): string {
  if (!domain) return base || 'http://localhost:3000';
  const d = domain.trim().toLowerCase();
  if (d === 'localhost' || d.startsWith('localhost:')) return base || 'http://localhost:3000';
  return d.startsWith('http') ? d : `https://${d}`;
}

export default function TestPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [domain, setDomain] = useState('localhost');
  const [tenantId, setTenantId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [openInNewTab, setOpenInNewTab] = useState(true);
  const [publishableKey, setPublishableKey] = useState(
    process.env.NEXT_PUBLIC_GATEWAY_API_KEY || ''
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const base = isMounted ? window.location.origin : '';
  const origin = buildOrigin(domain, base);
  const params = new URLSearchParams({
    domain: domain.trim() || 'localhost',
    origin,
    url: origin + '/',
  });
  if (publishableKey.trim()) params.set('publishableKey', publishableKey.trim());
  if (tenantId.trim()) params.set('tenantId', tenantId.trim());
  if (siteId.trim()) params.set('siteId', siteId.trim());
  const embedPath = `/embed?${params.toString()}`;
  const embedUrl = isMounted ? `${base}${embedPath}` : embedPath;

  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: 560,
      margin: '40px auto',
      padding: 24,
    }}>
      <h1 style={{ marginBottom: 8 }}>Chat Widget – Local test</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        No login. The widget needs <strong>domain</strong> (and optional tenant/site) so the Gateway can resolve your webchat integration.
      </p>

      <div style={{ marginBottom: 24, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 13 }}>
        <strong>What the widget needs to work</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, color: '#475569' }}>
          <li><strong>Domain</strong> – Must match a domain in your webchat integration (<code>webchat_integration</code>). Gateway uses it to resolve tenant and route requests.</li>
          <li><strong>Publishable key</strong> – For local dev, set <code>NEXT_PUBLIC_GATEWAY_API_KEY</code> in <code>.env</code> or paste it below. The test page passes it as <code>publishableKey</code> so the widget can bootstrap with your localhost integration.</li>
          <li><strong>Tenant ID</strong> (optional) – Gateway can resolve from domain if not provided.</li>
          <li><strong>Site ID</strong> (optional) – For multi-site tenants.</li>
        </ul>
      </div>
      <div style={{ marginBottom: 24, padding: 12, background: '#fef3c7', borderRadius: 8, fontSize: 13 }}>
        <strong>URL and routing</strong> – <code>NEXT_PUBLIC_GATEWAY_URL</code> must be the <strong>Gateway</strong>, not the communication API. If you point to the communication API, messages fail because domain-based tenant resolution happens at the gateway layer.
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Publishable Key <span style={{ color: '#666', fontWeight: 400 }}>(required for bootstrap)</span>
        </label>
        <input
          type="text"
          value={publishableKey}
          onChange={(e) => setPublishableKey(e.target.value)}
          placeholder="site_public_..."
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
        <p style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
          Your localhost integration key. This page will forward it to <code>/embed</code> as <code>publishableKey</code>.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Domain <span style={{ color: '#666', fontWeight: 400 }}>(required)</span>
        </label>
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com or localhost"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
        <p style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
          Same domain as in your webchat integration (e.g. <code>example.com</code> or <code>localhost</code>).
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Tenant ID <span style={{ color: '#666', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          type="text"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="Gateway resolves from domain if empty"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
          Site ID <span style={{ color: '#666', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          type="text"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          placeholder="For multi-site tenants"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={openInNewTab}
            onChange={(e) => setOpenInNewTab(e.target.checked)}
          />
          Open in new tab
        </label>
      </div>

      <a
        href={embedUrl}
        target={openInNewTab ? '_blank' : '_self'}
        rel={openInNewTab ? 'noopener noreferrer' : undefined}
        aria-disabled={!publishableKey.trim()}
        onClick={(e) => {
          if (!publishableKey.trim()) {
            e.preventDefault();
          }
        }}
        style={{
          display: 'inline-block',
          padding: '10px 20px',
          background: publishableKey.trim() ? '#2563eb' : '#94a3b8',
          color: 'white',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        {openInNewTab ? 'Open widget in new tab' : 'Open widget here'}
      </a>

      <p style={{ marginTop: 24, fontSize: 13, color: '#888' }}>
        Direct URL (copy for quick access):<br />
        <code style={{ background: '#f4f4f4', padding: '2px 6px', borderRadius: 4, fontSize: 12, wordBreak: 'break-all' }}>
          {embedUrl}
        </code>
      </p>
    </div>
  );
}
