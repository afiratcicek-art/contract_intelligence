/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "stone-paper":        "var(--color-bg-primary)",
        "parchment":          "var(--color-bg-secondary)",
        "ink-black":          "var(--color-text-primary)",
        "ink-charcoal":       "var(--color-text-secondary)",
        "gold":               "var(--color-accent)",
        "gold-light":         "var(--color-accent-light)",
        "alert-red":          "var(--color-alert-red)",
        "success-green":      "var(--color-success)",
        "slate-deep":         "var(--color-bg-primary)",
        "slate-mid":          "var(--color-bg-secondary)",
        "copper":             "var(--color-copper)",
        "off-white":          "var(--color-text-primary)",
        "secondary-text":     "var(--color-text-secondary)",
        "alert-red-dark":     "var(--color-alert-red)",
        "success-green-dark": "var(--color-success)",
      },
      fontFamily: {
        display: ["var(--font-brand)"],
        body:    ["var(--font-ui)"],
        mono:    ["var(--font-meta)"],
      },
    },
  },
  plugins: [],
}
