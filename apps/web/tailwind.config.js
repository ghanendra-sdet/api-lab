/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        method: {
          get: "#237834",     /* was #2f9e44 — darkened for ≥4.5:1 on white */
          post: "#b36200",    /* was #e8a400 — darkened for ≥4.5:1 on white */
          put: "#1864ab",     /* was #1c7ed6 — darkened for ≥4.5:1 on white */
          patch: "#862e9c",   /* was #ae3ec9 — darkened for ≥4.5:1 on white */
          delete: "#c92a2a",  /* was #e03131 — darkened for ≥4.5:1 on white */
          head: "#343a40",    /* was #495057 — darkened slightly */
          options: "#343a40", /* was #495057 — darkened slightly */
        },
      },
    },
  },
  plugins: [],
};
