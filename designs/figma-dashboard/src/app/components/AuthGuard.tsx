import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api/client';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!api.isLoggedIn()) {
      navigate('/login', { state: { from: location.pathname }, replace: true });
    }
  }, [navigate, location.pathname]);

  if (!api.isLoggedIn()) return null;

  return <>{children}</>;
}
