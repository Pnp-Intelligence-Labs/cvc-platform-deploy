import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api/client';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  // null = still checking (may be refreshing), true = authenticated, false = redirect
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    // With 15-min access tokens, silently refresh if near expiry before deciding.
    api.ensureFreshToken().then(() => {
      if (!api.isLoggedIn()) {
        navigate('/login', { state: { from: location.pathname }, replace: true });
        setReady(false);
      } else {
        setReady(true);
      }
    });
  }, [navigate, location.pathname]);

  // Checking or refreshing — render nothing to avoid flash of protected content
  if (ready !== true) return null;

  return <>{children}</>;
}
