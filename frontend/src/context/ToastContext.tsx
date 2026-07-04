import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useToast } from "../hooks/useToast";
import type { ToastType } from "../hooks/useToast";
import ToastContainer from "../components/ToastContainer";

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <ToastCtx.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastCtx.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
  return ctx;
}
