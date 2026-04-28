"use client";

import type { Route } from "next";
import Link, { type LinkProps } from "next/link";
import { Loader2 } from "lucide-react";
import React, {
  createContext,
  type AnchorHTMLAttributes,
  useCallback,
  type ReactNode,
  useContext,
  useMemo,
  useState
} from "react";

type PendingLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | "href" | "children" | "onClick"> & {
  href: Route;
  children: ReactNode;
  pendingLabel: string;
  pendingKey?: string;
  inlinePending?: boolean;
  testId?: string;
  onClick?: AnchorHTMLAttributes<HTMLAnchorElement>["onClick"];
  scroll?: LinkProps["scroll"];
};

type NavigationPendingContextValue = {
  pendingKey: string | null;
  setPendingKey(nextPendingKey: string): void;
};

const NavigationPendingContext = createContext<NavigationPendingContextValue | null>(null);

export function NavigationPendingProvider({ children }: { children: ReactNode }) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const setNavigationPendingKey = useCallback((nextPendingKey: string) => {
    setPendingKey(nextPendingKey);
  }, []);
  const value = useMemo(() => ({
    pendingKey,
    setPendingKey: setNavigationPendingKey
  }), [pendingKey, setNavigationPendingKey]);

  return (
    <NavigationPendingContext.Provider value={value}>
      {children}
    </NavigationPendingContext.Provider>
  );
}

export function PendingLink({
  href,
  children,
  pendingLabel,
  pendingKey,
  inlinePending = true,
  testId = "pending-link",
  onClick,
  ...props
}: PendingLinkProps) {
  const [pending, setPending] = useState(false);
  const navigationPending = useContext(NavigationPendingContext);
  const isPending = pendingKey ? navigationPending?.pendingKey === pendingKey || pending : pending;

  return (
    <Link
      href={href}
      aria-busy={isPending}
      data-testid={testId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          if (pendingKey) {
            navigationPending?.setPendingKey(pendingKey);
          }
          setPending(true);
        }
      }}
      {...props}
    >
      {isPending && inlinePending ? (
        <span className="mb-3 flex items-center gap-2 text-[14px] leading-[1.43] text-[var(--primary)]" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </span>
      ) : null}
      {children}
    </Link>
  );
}

export function PendingNavigationStatus({
  pendingKey,
  label,
  className = "notice notice-info",
  testId = "navigation-pending-status"
}: {
  pendingKey: string;
  label: string;
  className?: string;
  testId?: string;
}) {
  const navigationPending = useContext(NavigationPendingContext);

  if (navigationPending?.pendingKey !== pendingKey) {
    return null;
  }

  return (
    <div role="status" data-testid={testId} className={className}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PendingContentBoundary({
  pendingKey,
  fallback,
  children,
  className,
  testId
}: {
  pendingKey: string;
  fallback: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const navigationPending = useContext(NavigationPendingContext);
  const pending = navigationPending?.pendingKey === pendingKey;

  return (
    <div className={className} data-testid={testId} aria-busy={pending}>
      {pending ? fallback : children}
    </div>
  );
}
