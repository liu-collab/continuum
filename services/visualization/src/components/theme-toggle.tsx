"use client";

import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const cls = document.documentElement.classList;
    setLight(cls.contains("light"));
    const obs = new MutationObserver(() => setLight(cls.contains("light")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  function toggle() {
    const html = document.documentElement;
    const next = !html.classList.contains("light");
    if (next) {
      html.classList.add("light");
      localStorage.setItem("theme", "light");
    } else {
      html.classList.remove("light");
      localStorage.setItem("theme", "dark");
    }
    setLight(next);
  }

  if (!mounted) {
    return <div style={{ width: 28, height: 28 }} />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark" : "Switch to light"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "var(--radius-md)",
        border: "none",
        background: "transparent",
        color: "var(--text-muted)",
        cursor: "pointer",
        transition: "all 80ms ease"
      }}
    >
      {light ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
