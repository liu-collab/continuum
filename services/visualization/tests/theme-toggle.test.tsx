import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/theme-toggle";
import { AppI18nProvider } from "@/lib/i18n/client";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("toggles the app theme from the nav control", async () => {
    const user = userEvent.setup();

    render(
      <AppI18nProvider defaultLocale="en-US">
        <ThemeToggle />
      </AppI18nProvider>,
    );

    await user.click(screen.getByTestId("theme-toggle"));

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");

    await user.click(screen.getByTestId("theme-toggle"));

    expect(document.documentElement).toHaveClass("light");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });
});
