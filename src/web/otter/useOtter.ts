import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OtterAction,
  OtterMode,
  OtterReply,
  OtterScope,
  OtterStatus,
} from "../../shared/types";
import type { Severity } from "../../shared/facts";
import { api } from "../workspace/api";

export interface OtterTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: OtterAction[];
  outOfScope?: boolean;
  withheld?: boolean;
  demo?: boolean;
  failed?: boolean;
  question?: string;
  seeing?: string;
}

export interface OtterThread {
  key: string;
  kind: "global" | "vulnerability";
  advisoryId?: string;
  nodeId?: string;
  severity?: Severity;
  title: string;
  subtitle: string;
  turns: OtterTurn[];
}

interface Saved {
  global: OtterThread;
  branches: OtterThread[];
  activeKey: string;
}

export const GLOBAL_KEY = "global";

const emptyGlobal = (): OtterThread => ({
  key: GLOBAL_KEY,
  kind: "global",
  title: "OTTER",
  subtitle: "Your guide to this RootLine scan",
  turns: [],
});

const storageKey = (scanId: string) => `rootline-otter:${scanId}`;

function load(scanId?: string): Saved {
  if (scanId)
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(scanId)) || "null") as Saved | null;
      if (saved?.global?.key === GLOBAL_KEY && Array.isArray(saved.branches)) return saved;
    } catch {
      // Session storage is optional; the conversation still works in memory.
    }
  return { global: emptyGlobal(), branches: [], activeKey: GLOBAL_KEY };
}

let counter = 0;
const turnId = () => `${Date.now().toString(36)}-${++counter}`;

export function useOtter(scanId?: string) {
  const [state, setState] = useState<Saved>(() => load(scanId));
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<OtterMode>("auto");
  const [status, setStatus] = useState<OtterStatus | null>(null);
  const loadedFor = useRef(scanId);

  useEffect(() => {
    if (loadedFor.current === scanId) return;
    loadedFor.current = scanId;
    setState(load(scanId));
    setPending({});
    setDrafts({});
  }, [scanId]);

  useEffect(() => {
    if (!scanId) return;
    try {
      sessionStorage.setItem(storageKey(scanId), JSON.stringify(state));
    } catch {
      // Ignore quota or privacy-mode failures.
    }
  }, [scanId, state]);

  const refreshStatus = useCallback(() => {
    api<OtterStatus>("/otter/status")
      .then(setStatus)
      .catch((e: Error) =>
        setStatus({
          configured: false,
          modes: { auto: false, fast: false, deep: false },
          transcription: false,
          message: e.message,
        }),
      );
  }, []);

  const updateThread = useCallback((key: string, update: (t: OtterThread) => OtterThread) => {
    setState((s) =>
      key === GLOBAL_KEY
        ? { ...s, global: update(s.global) }
        : { ...s, branches: s.branches.map((b) => (b.key === key ? update(b) : b)) },
    );
  }, []);

  const threadFor = (key: string) =>
    key === GLOBAL_KEY ? state.global : state.branches.find((b) => b.key === key);

  const request = useCallback(
    async (key: string, history: OtterTurn[], question: string, scope: OtterScope, seeing: string) => {
      if (!scanId) return;
      setPending((p) => ({ ...p, [key]: true }));
      const messages = [
        ...history
          .filter((t) => !t.failed && !t.outOfScope)
          .slice(-12)
          .map((t) => ({ role: t.role, content: t.content })),
        { role: "user" as const, content: question },
      ];
      try {
        const reply = await api<OtterReply>(`/scans/${scanId}/otter`, { mode, scope, messages });
        updateThread(key, (t) => ({
          ...t,
          turns: [
            ...t.turns,
            {
              id: turnId(),
              role: "assistant",
              content: reply.answer,
              actions: reply.actions,
              outOfScope: reply.outOfScope,
              withheld: reply.withheld,
              demo: reply.demo,
              question: reply.outOfScope ? question : undefined,
              seeing,
            },
          ],
        }));
      } catch (error) {
        updateThread(key, (t) => ({
          ...t,
          turns: [
            ...t.turns,
            {
              id: turnId(),
              role: "assistant",
              content: (error as Error).message || "OTTER could not answer.",
              failed: true,
              question,
            },
          ],
        }));
      } finally {
        setPending((p) => ({ ...p, [key]: false }));
      }
    },
    [mode, scanId, updateThread],
  );

  const send = useCallback(
    (key: string, question: string, scope: OtterScope, seeing: string) => {
      const thread = key === GLOBAL_KEY ? state.global : state.branches.find((b) => b.key === key);
      if (!thread || pending[key]) return;
      const history = thread.turns;
      updateThread(key, (t) => ({
        ...t,
        turns: [...t.turns, { id: turnId(), role: "user", content: question, seeing }],
      }));
      setDrafts((d) => ({ ...d, [key]: "" }));
      void request(key, history, question, scope, seeing);
    },
    [pending, request, state, updateThread],
  );

  const retry = useCallback(
    (key: string, failedId: string, scope: OtterScope, seeing: string) => {
      const thread = key === GLOBAL_KEY ? state.global : state.branches.find((b) => b.key === key);
      const index = thread?.turns.findIndex((t) => t.id === failedId) ?? -1;
      if (!thread || index < 1 || pending[key]) return;
      const failed = thread.turns[index];
      const history = thread.turns.slice(0, index - 1);
      updateThread(key, (t) => ({ ...t, turns: t.turns.filter((turn) => turn.id !== failedId) }));
      void request(key, history, failed.question ?? thread.turns[index - 1].content, scope, seeing);
    },
    [pending, request, state, updateThread],
  );

  const openBranch = useCallback(
    (branch: Omit<OtterThread, "turns" | "kind">) => {
      setState((s) => ({
        ...s,
        activeKey: branch.key,
        branches: s.branches.some((b) => b.key === branch.key)
          ? s.branches
          : [...s.branches, { ...branch, kind: "vulnerability", turns: [] }],
      }));
    },
    [],
  );

  const closeBranch = useCallback((key: string) => {
    setState((s) => ({
      ...s,
      branches: s.branches.filter((b) => b.key !== key),
      activeKey: s.activeKey === key ? GLOBAL_KEY : s.activeKey,
    }));
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }, []);

  const setActiveKey = useCallback(
    (key: string) => setState((s) => ({ ...s, activeKey: key })),
    [],
  );

  const active = threadFor(state.activeKey) ?? state.global;

  return {
    global: state.global,
    branches: state.branches,
    active,
    activeKey: active.key,
    setActiveKey,
    openBranch,
    closeBranch,
    send,
    retry,
    pending,
    drafts,
    setDraft: (key: string, value: string) => setDrafts((d) => ({ ...d, [key]: value })),
    mode,
    setMode,
    status,
    refreshStatus,
  };
}

export type Otter = ReturnType<typeof useOtter>;
