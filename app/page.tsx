export default function HomePage() {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      padding: '20px',
      textAlign: 'center'
    }}>
      <h1>Amoiq Chat Widget</h1>
      <p style={{ marginTop: '16px', color: '#6b7280' }}>
        This is the widget server. The chat interface is available at <code>/embed</code>
      </p>
      <p style={{ marginTop: '8px', fontSize: '14px', color: '#9ca3af' }}>
        Install the widget on your site using the script tag.
      </p>
    </div>
  );
}

