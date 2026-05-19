import { useState, useEffect } from 'react';
import { AUTH_HEADER as AUTH } from '../api/client';

interface TeamMember {
  username: string;
  full_name: string | null;
  role: string;
}

export function useTeamMembers(): string[] {
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    fetch('/auth/team', { headers: AUTH })
      .then(r => r.ok ? r.json() : { team: [] })
      .then(d => setMembers((d.team as TeamMember[]).map(m => m.username)))
      .catch(() => {});
  }, []);
  return members;
}
