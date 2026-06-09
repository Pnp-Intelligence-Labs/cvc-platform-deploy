import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';

/**
 * Handles the Keycloak OIDC redirect after authentication.
 * KC redirects to /app/auth/callback?code=...&state=...
 * This page exchanges the code for a platform JWT via the backend.
 */
export default function OIDCCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');
    const errorDesc = params.get('error_description');

    if (errorParam) {
      setError(errorDesc || `Sign-in was cancelled or denied (${errorParam}).`);
      return;
    }

    if (!code || !state) {
      setError('Missing code or state — did you navigate here directly? Please start from the login page.');
      return;
    }

    fetch('/auth/keycloak/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Exchange failed (${r.status})`);
        }
        return r.json();
      })
      .then(data => {
        api.storeAuthData(data);
        // Recover pre-auth destination from the signed state JWT.
        // The backend already validated state; this decode is UI-only.
        let destination = '/';
        try {
          const statePayload = JSON.parse(atob(state!.split('.')[1]));
          if (statePayload.from && typeof statePayload.from === 'string') {
            destination = statePayload.from;
          }
        } catch { /* fall back to '/' */ }
        navigate(destination, { replace: true });
      })
      .catch(err => setError(String(err)));
  }, [navigate]);

  if (error) {
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
          width: 400,
          boxShadow: '0 4px 24px rgba(37,59,73,0.12)',
        }}>
          <p style={{ color: '#dc2626', fontWeight: 700, marginBottom: '0.5rem', fontSize: '1rem' }}>
            Sign-in failed
          </p>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            {error}
          </p>
          <a
            href="/app/login"
            style={{
              display: 'inline-block',
              padding: '9px 18px',
              backgroundColor: '#1e293b',
              color: '#F59E0B',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: '0.875rem',
              textDecoration: 'none',
            }}
          >
            Back to login
          </a>
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
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 36,
          height: 36,
          backgroundColor: '#F59E0B',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1rem',
        }}>
          <span style={{ color: '#1e293b', fontWeight: 'bold', fontSize: '1rem' }}>S</span>
        </div>
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>Completing sign-in…</p>
      </div>
    </div>
  );
}
