import { useState, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api/client';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = (location.state as { from?: string })?.from ?? '/companies';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(username.trim(), password);
      navigate(from, { replace: true });
    } catch {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f1f5f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: 12,
        padding: '2.5rem',
        width: 380,
        boxShadow: '0 4px 24px rgba(37,59,73,0.12)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: '0.75rem' }}>
            <div style={{
              width: 36, height: 36,
              backgroundColor: '#F59E0B',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: '#1e293b', fontWeight: 'bold', fontSize: '1rem' }}>S</span>
            </div>
            <span style={{ color: '#1e293b', fontSize: '1.35rem', fontWeight: 700, letterSpacing: 0.3 }}>
              SLAM Intelligence
            </span>
          </div>
          <p style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem' }}>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: 6, color: '#374151', fontSize: '0.875rem', fontWeight: 600 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="Enter username"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = '#1e293b'; }}
              onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: 6, color: '#374151', fontSize: '0.875rem', fontWeight: 600 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Enter password"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = '#1e293b'; }}
              onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
            />
          </div>

          {error && (
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: '1rem',
              color: '#dc2626',
              fontSize: '0.875rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px',
              backgroundColor: loading ? '#6b7280' : '#1e293b',
              color: '#F59E0B',
              border: 'none',
              borderRadius: 6,
              fontSize: '1rem',
              fontFamily: 'inherit',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
              letterSpacing: 0.5,
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
