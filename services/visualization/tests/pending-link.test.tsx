import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NavigationPendingProvider, PendingLink, PendingNavigationStatus } from "@/components/pending-link";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...props}
    >
      {children}
    </a>
  )
}));

function PendingHarness({ resetKey }: { resetKey: string }) {
  return (
    <NavigationPendingProvider resetKey={resetKey}>
      <PendingLink href={`/dashboard?window=${resetKey}`} pendingKey="dashboard-window" pendingLabel="正在切换时间窗口">
        {resetKey}
      </PendingLink>
      <PendingNavigationStatus pendingKey="dashboard-window" label="正在切换时间窗口" testId="pending-status" />
    </NavigationPendingProvider>
  );
}

describe("pending navigation", () => {
  it("clears pending status when the navigation reset key changes", async () => {
    const { rerender } = render(<PendingHarness resetKey="6h" />);

    fireEvent.click(screen.getByRole("link", { name: "6h" }));

    expect(screen.getByTestId("pending-status")).toHaveTextContent("正在切换时间窗口");

    rerender(<PendingHarness resetKey="24h" />);

    await waitFor(() => {
      expect(screen.queryByTestId("pending-status")).not.toBeInTheDocument();
    });
  });
});
