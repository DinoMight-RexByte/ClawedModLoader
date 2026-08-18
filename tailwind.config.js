/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "rgb(var(--color-bg) / <alpha-value>)",
          surface: "rgb(var(--color-surface) / <alpha-value>)",
          surfaceRaised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          border: "rgb(var(--color-border) / <alpha-value>)",
          text: "rgb(var(--color-text) / <alpha-value>)",
          muted: "rgb(var(--color-muted) / <alpha-value>)",
          subtle: "rgb(var(--color-subtle) / <alpha-value>)",
          backdrop: "rgb(var(--color-backdrop) / <alpha-value>)",
          accent: "rgb(var(--color-accent) / <alpha-value>)",
          accentText: "rgb(var(--color-accent-text) / <alpha-value>)",
          success: "rgb(var(--color-success) / <alpha-value>)",
          warning: "rgb(var(--color-warning) / <alpha-value>)",
          danger: "rgb(var(--color-danger) / <alpha-value>)"
        }
      },
      boxShadow: {
        panel: "0 16px 40px rgb(0 0 0 / 0.18)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};
