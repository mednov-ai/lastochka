import { useAuth } from '../ui/auth-context';
import { Workspace } from '../ui/workspace';
import { AlfaSettings } from '../ui/alfa-settings';

export default function Integrations() {
  const { auth } = useAuth();
  return (
    <Workspace title="Интеграции">
      {auth?.state === 'FULL' && auth.account?.role === 'ADMIN' ? (
        <AlfaSettings />
      ) : auth?.state === 'FULL' ? (
        <p className="notice">Настройки интеграций доступны администратору.</p>
      ) : null}
    </Workspace>
  );
}
