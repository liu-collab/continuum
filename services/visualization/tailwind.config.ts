import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        border: "var(--border)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)"
      },
      boxShadow: {
        soft: "0 12px 50px rgba(15, 23, 42, 0.08)"
      },
      borderRadius: {
        xl: "1.25rem"
      },
      backgroundImage: {
        "page-glow":
          "radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%), radial-gradient(circle at top right, rgba(245, 158, 11, 0.14), transparent 26%)"
      }
    }
  },
  plugins: []
};

export default config;
