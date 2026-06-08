import { useState, FormEvent, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api/client';

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_denied:        'Google sign-in was cancelled.',
  google_token_failed:  'Could not complete Google sign-in. Please try again.',
  google_userinfo_failed: 'Could not retrieve your Google account info. Please try again.',
  domain_not_allowed:   'Your Google account domain is not authorized for this platform.',
  no_account:           'No account found for your Google identity. Contact your administrator.',
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = (location.state as { from?: string })?.from ?? '/';

  // Handle Google OAuth redirect back with ?token= or ?error=
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token  = params.get('token');
    const err    = params.get('error');
    if (token) {
      localStorage.setItem('platform_jwt', token);
      navigate('/', { replace: true });
    } else if (err) {
      setError(GOOGLE_ERROR_MESSAGES[err] ?? 'Google sign-in failed.');
    }
  }, []);

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
              Vertical OS
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '1.25rem 0' }}>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
          <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
        </div>

        <a
          href="/auth/google"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            padding: '10px',
            backgroundColor: 'white',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'background-color 0.15s',
            boxSizing: 'border-box',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#f9fafb'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'white'; }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
