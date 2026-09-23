import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('NexusQuant UI Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0a0d14',
          color: '#e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'monospace'
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            backgroundColor: '#111726',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            padding: '28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <h2 style={{ color: '#f87171', fontSize: '18px', fontWeight: 'bold', margin: '0 0 12px 0' }}>
              ⚠️ Application Interface Notice
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0', lineHeight: 1.6 }}>
              A temporary display state occurred. The automated backend and MetaTrader 5 trading loops continue running normally in the background.
            </p>
            <pre style={{
              backgroundColor: '#070a10',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#cbd5e1',
              overflowX: 'auto',
              marginBottom: '20px',
              border: '1px solid #1e293b'
            }}>
              {this.state.error?.message || 'Rendering exception'}
            </pre>
            <button
              onClick={() => { window.location.reload(); }}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              🔄 Reload Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
