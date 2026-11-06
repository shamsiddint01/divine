import { useEffect } from 'react';
import { SessionLoader } from '@/features/session/components/RequireAuth';
import { startViewSession } from '@/shared/lib/view-session';

/** Superadmin havolasi: `/view#token=…`. Token fragmentda, shuning uchun serverga va loglarga bormaydi. */
export function ViewEntry() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (token) startViewSession(token);
    window.location.replace('/');
  }, []);
  return <SessionLoader />;
}
