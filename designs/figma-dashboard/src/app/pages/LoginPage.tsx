import { useState, useEffect, FormEvent } from 'react';
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
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [ssoLoading, setSsoLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [kcEnabled, setKcEnabled]         = useState<boolean | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);
  const [showLocal, setShowLocal]         = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const from     = (location.state as { from?: string })?.from ?? '/';

  // Handle Google OAuth direct redirect back with ?token= or ?error=
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token  = params.get('token');
    const err    = params.get('error');
    if (token) {
      // Google callback redirects with only ?token=. Decode the JWT so the
      // navbar/profile can show name + role (mirrors what api.login stores);
      // otherwise platform_user is never set and the profile shows blank.
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        api.storeAuthData({
          access_token: token,
          username: payload.username,
          role: payload.role,
          full_name: payload.full_name ?? null,
        });
      } catch {
        localStorage.setItem('platform_jwt', token);
      }
      navigate('/', { replace: true });
    } else if (err) {
      setError(GOOGLE_ERROR_MESSAGES[err] ?? 'Google sign-in failed.');
    }
  }, []);

  // MFA challenge state — set when backend returns mfa_required: true
  const [mfaToken, setMfaToken]       = useState<string | null>(null);
  const [mfaCode, setMfaCode]         = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    fetch('/auth/keycloak/config', { signal: controller.signal })
      .then(r => r.ok ? r.json() : { enabled: false })
      .then(data => setKcEnabled(data.enabled))
      .catch(() => setKcEnabled(false))
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => {
    fetch('/auth/google/config')
      .then(r => r.ok ? r.json() : { enabled: false })
      .then(data => setGoogleEnabled(data.enabled))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const handleSSOLogin = async () => {
    setSsoLoading(true);
    setError('');
    try {
      const res = await fetch(`/auth/keycloak/login-url?from=${encodeURIComponent(from)}`);
      if (!res.ok) throw new Error('Could not reach identity provider');
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      setError('Could not reach identity provider. Try local login below.');
      setSsoLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    setGoogleLoading(true);
    window.location.href = '/auth/google';
  };

  const handleLocalLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(username.trim(), password);
      if (result.mfa_required && result.mfa_token) {
        setMfaToken(result.mfa_token);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setLoading(true);
    try {
      await api.mfaChallenge(mfaToken, mfaCode.trim());
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code — try again.');
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  };

  const card: React.CSSProperties = {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: '2.5rem',
    width: 380,
    boxShadow: '0 4px 24px rgba(37,59,73,0.12)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: '0.95rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  };

  // MFA challenge screen — shown after successful password when server requires TOTP
  if (mfaToken) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={card}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔐</div>
            <p style={{ fontWeight: 700, color: '#1e293b', margin: 0, fontSize: '1.1rem' }}>
              Two-factor authentication
            </p>
            <p style={{ color: '#6b7280', margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
              Enter the 6-digit code from your authenticator app.
            </p>
          </div>
          {error && (
            <div style={{
              backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
              padding: '10px 12px', marginBottom: '1rem', color: '#dc2626', fontSize: '0.875rem',
            }}>
              {error}
            </div>
          )}
          <form onSubmit={handleMfaSubmit}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              placeholder="000000"
              style={{
                ...inputStyle,
                fontSize: '1.5rem',
                letterSpacing: '0.35em',
                textAlign: 'center',
                marginBottom: '1rem',
              }}
            />
            <button
              type="submit"
              disabled={loading || mfaCode.length !== 6}
              style={{
                width: '100%', padding: '11px',
                backgroundColor: loading ? '#6b7280' : '#1e293b',
                color: '#F59E0B', border: 'none', borderRadius: 6,
                fontSize: '1rem', fontFamily: 'inherit', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }}
            style={{
              marginTop: '1rem', width: '100%', background: 'none', border: 'none',
              color: '#9ca3af', fontSize: '0.8rem', cursor: 'pointer', padding: '4px 0',
            }}
          >
            ← Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f1f5f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={card}>
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

        {/* SSO button — shown when Keycloak is configured */}
        {kcEnabled && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button
              onClick={handleSSOLogin}
              disabled={ssoLoading}
              style={{
                width: '100%',
                padding: '11px',
                backgroundColor: ssoLoading ? '#6b7280' : '#1e293b',
                color: '#F59E0B',
                border: 'none',
                borderRadius: 6,
                fontSize: '1rem',
                fontFamily: 'inherit',
                fontWeight: 700,
                cursor: ssoLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                letterSpacing: 0.4,
              }}
            >
              {/* Google "G" icon */}
              {!ssoLoading && (
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
              )}
              {ssoLoading ? 'Redirecting…' : 'Sign in with Google (SSO)'}
            </button>
          </div>
        )}

        {/* Direct Google OAuth button — shown when GOOGLE_CLIENT_ID is configured */}
        {googleEnabled && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              style={{
                width: '100%',
                padding: '11px',
                backgroundColor: 'white',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: '1rem',
                fontFamily: 'inherit',
                fontWeight: 600,
                cursor: googleLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              {!googleLoading && (
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
              )}
              {googleLoading ? 'Redirecting…' : 'Sign in with Google'}
            </button>
          </div>
        )}

        {/* Loading state while checking KC */}
        {kcEnabled === null && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Loading…
          </div>
        )}

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

        {/* Separator when any SSO mode available */}
        {(kcEnabled || googleEnabled) && (
          <div style={{ position: 'relative', textAlign: 'center', marginBottom: '1rem' }}>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb' }} />
            <span style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'white',
              padding: '0 10px',
              color: '#9ca3af',
              fontSize: '0.75rem',
            }}>
              or
            </span>
          </div>
        )}

        {/* Local login — always shown when no SSO; collapsible when any SSO is active */}
        {(!kcEnabled && !googleEnabled) ? (
          <form onSubmit={handleLocalLogin}>
            <LocalForm
              username={username} setUsername={setUsername}
              password={password} setPassword={setPassword}
              loading={loading} inputStyle={inputStyle}
            />
          </form>
        ) : (kcEnabled || googleEnabled) ? (
          <>
            <button
              type="button"
              onClick={() => setShowLocal(v => !v)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: '0.8rem',
                cursor: 'pointer',
                padding: '4px 0',
                textAlign: 'center',
              }}
            >
              {showLocal ? 'Hide' : 'Admin / local login'}
            </button>
            {showLocal && (
              <form onSubmit={handleLocalLogin} style={{ marginTop: '1rem' }}>
                <LocalForm
                  username={username} setUsername={setUsername}
                  password={password} setPassword={setPassword}
                  loading={loading} inputStyle={inputStyle}
                />
              </form>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function LocalForm({ username, setUsername, password, setPassword, loading, inputStyle }: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  inputStyle: React.CSSProperties;
}) {
  return (
    <>
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
          style={inputStyle}
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
          style={inputStyle}
          onFocus={e => { e.target.style.borderColor = '#1e293b'; }}
          onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
        />
      </div>
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
          letterSpacing: 0.5,
        }}
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
    </>
  );
}
