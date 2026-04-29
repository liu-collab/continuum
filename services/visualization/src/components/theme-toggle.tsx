"use client";

import React from "react";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppI18n } from "@/lib/i18n/client";

type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";

function resolveStoredTheme(): AppTheme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  if (typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const { t } = useAppI18n();
  const [theme, setTheme] = useState<AppTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const nextTheme = resolveStoredTheme();
    applyTheme(nextTheme);
    setTheme(nextTheme);
    setMounted(true);
  }, []);

  function toggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  if (!mounted) {
    return <span className="global-nav-utility-button global-nav-icon-button" aria-hidden="true" />;
  }

  const dark = theme === "dark";
  const label = dark ? t("common.switchToLight") : t("common.switchToDark");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="global-nav-utility-button global-nav-icon-button"
      data-testid="theme-toggle"
    >
      {dark ? <Sun size={14} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={14} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}
