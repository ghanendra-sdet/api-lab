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
          get: "#2f9e44",
          post: "#e8a400",
          put: "#1c7ed6",
          patch: "#ae3ec9",
          delete: "#e03131",
          head: "#495057",
          options: "#495057",
        },
      },
    },
  },
  plugins: [],
};
