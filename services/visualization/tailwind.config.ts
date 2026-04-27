import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        "surface-active": "var(--surface-active)",
        foreground: "var(--text)",
        muted: "var(--text-secondary)",
        "muted-foreground": "var(--text-muted)",
        card: "var(--surface)",
        "card-foreground": "var(--text)",
        border: "var(--border)",
        "border-hover": "var(--border-hover)",
        accent: "var(--amber)",
        "accent-foreground": "#0c0e12",
        "accent-soft": "var(--amber-bg)",
        success: "var(--emerald)",
        warning: "var(--amber)",
        danger: "var(--rose)"
      },
      boxShadow: {
        soft: "var(--shadow-sm)",
        overlay: "var(--shadow-lg)"
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        xl: "0.625rem"
      }
    }
  },
  plugins: []
};

export default config;
