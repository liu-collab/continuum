import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        surface: "var(--surface)",
        "surface-muted": "var(--surface-muted)",
        "surface-hover": "var(--surface-hover)",
        "surface-active": "var(--surface-active)",
        text: "var(--text)",
        foreground: "var(--text)",
        muted: "var(--text-secondary)",
        "muted-foreground": "var(--text-muted)",
        card: "var(--surface)",
        "card-foreground": "var(--text)",
        border: "var(--border)",
        "border-hover": "var(--border-hover)",
        "border-strong": "var(--border-strong)",
        accent: "var(--amber)",
        "accent-foreground": "var(--canvas)",
        "accent-soft": "var(--amber-bg)",
        success: "var(--emerald)",
        warning: "var(--amber)",
        danger: "var(--rose)",
        primary: "var(--primary)"
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
