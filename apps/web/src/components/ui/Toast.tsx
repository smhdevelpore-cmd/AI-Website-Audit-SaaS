import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastTone = "success" | "critical" | "neutral";

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** Announce something that happened. Returns the id, so a test can dismiss it by id. */
  show: (toast: { title: string; description?: string; tone?: ToastTone }) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONES: Record<ToastTone, string> = {
  success: "border-success-strong bg-tint-success text-success-strong",
  critical: "border-critical-strong bg-tint-critical text-critical-strong",
  neutral: "border-line-strong bg-surface text-ink",
};

/**
 * A polite live region. Toasts are a courtesy, never the only report of an outcome: the screen
 * that raised one also reflects the result inline.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastContextValue["show"]>((toast) => {
    const id = nextId.current++;
    setToasts((current) => [
      ...current,
      {
        id,
        title: toast.title,
        tone: toast.tone ?? "neutral",
        ...(toast.description ? { description: toast.description } : {}),
      },
    ]);
    return id;
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm shadow-sm ${TONES[toast.tone]}`}
          >
            <div>
              <p className="font-medium">{toast.title}</p>
              {toast.description === undefined ? null : <p className="mt-0.5">{toast.description}</p>}
            </div>
            <button
              type="button"
              aria-label={`Dismiss: ${toast.title}`}
              onClick={() => dismiss(toast.id)}
              className="rounded px-1 text-base leading-none"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
