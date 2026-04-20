import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-muted": "var(--surface-muted)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)"
      },
      boxShadow: {
        soft: "0 1px 2px rgba(24, 24, 27, 0.04), 0 1px 3px rgba(24, 24, 27, 0.06)",
        overlay: "0 10px 40px rgba(24, 24, 27, 0.18)"
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.75rem"
      }
    }
  },
  plugins: []
};

export default config;
