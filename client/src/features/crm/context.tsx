import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  ActionEnvelope,
  ActionResult,
  CrmBootstrap,
  CrmCommand,
} from '@crm/shared/crm';
import type { User } from '@crm/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useCrmStore } from '@/store/crm-store';

interface CrmContextValue {
  data: CrmBootstrap | null;
  error: string;
  revision: number;
  refresh: () => void;
  actor: User;
  notice: string;
  notify: (message: string) => void;
}
const CrmContext = createContext<CrmContextValue | null>(null);
export function CrmProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)!;
  const actorId = useCrmStore((state) => state.actorId);
  const [data, setData] = useState<CrmBootstrap | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, notify] = useState('');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<CrmBootstrap>('/crm/bootstrap', { signal: controller.signal })
      .then(setData)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [revision]);
  const actor =
    user.role === 'ADMIN'
      ? (data?.actors.find((row) => row.id === actorId) ?? user)
      : user;
  return (
    <CrmContext.Provider
      value={{ data, error, revision, refresh, actor, notice, notify }}
    >
      {children}
    </CrmContext.Provider>
  );
}
export function useCrm() {
  const value = useContext(CrmContext);
  if (!value) throw new Error('CRM pages require a workspace');
  return value;
}
export function useRecord<T>(path: string) {
  const { revision } = useCrm();
  const [state, setState] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<T>(path, { signal: controller.signal })
      .then((data) => setState({ path, data }))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data: state?.path === path ? state.data : null, error, loading };
}
export function useCommand() {
  const { actor, refresh, notify } = useCrm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<{ input: string; envelope: ActionEnvelope } | null>(null);
  async function execute(
    command: CrmCommand,
    expectedVersion: number,
    message: string,
    onDecision?: (decisions: ActionResult['decisions']) => void,
  ) {
    setPending(true);
    setError('');
    const input = JSON.stringify({
      command,
      expectedVersion,
      actorId: actor.id,
    });
    const envelope =
      last.current?.input === input
        ? last.current.envelope
        : {
            command,
            expectedVersion,
            actorId: actor.id,
            idempotencyKey: crypto.randomUUID(),
          };
    last.current = { input, envelope };
    try {
      const result = await api<ActionResult>('/crm/actions', {
        method: 'POST',
        body: JSON.stringify(envelope),
      });
      last.current = null;
      if (result.status === 'NEEDS_DECISION' && onDecision) {
        onDecision(result.decisions);
        return null;
      }
      if (result.status !== 'APPLIED')
        throw new Error(
          result.errors.map((row) => row.message).join(' ') ||
            result.decisions.map((row) => row.prompt).join(' ') ||
            'The activity could not be completed.',
        );
      refresh();
      notify(message);
      return result;
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    } finally {
      setPending(false);
    }
  }
  return { execute, pending, error, setError };
}
