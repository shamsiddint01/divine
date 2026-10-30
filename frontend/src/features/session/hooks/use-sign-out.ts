import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { useLogout } from '../api/session';

/** Tizimdan chiqish: server sessiyasi bekor qilinadi, kesh tozalanadi, login sahifasiga o'tiladi. */
export function useSignOut() {
  const logout = useLogout();
  const navigate = useNavigate();
  return {
    pending: logout.isPending,
    signOut: () =>
      logout.mutate(undefined, {
        onSettled: () => {
          toast.success(t.topbar.loggedOut);
          void navigate('/login', { replace: true });
        },
      }),
  };
}
