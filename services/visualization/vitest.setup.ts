import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.PLATFORM_USER_ID ??= "550e8400-e29b-41d4-a716-446655440000";

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: ResizeObserverMock
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  writable: true,
  configurable: true,
  value() {}
});
