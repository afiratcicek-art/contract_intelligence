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
        "stone-paper":        "#F5F2ED",
        "parchment":          "#E7E3DC",
        "ink-black":          "#1C1917",
        "ink-charcoal":       "#44403C",
        "gold":               "#6B5D3F",
        "gold-light":         "#C4AD87",
        "alert-red":          "#A93226",
        "success-green":      "#1F6B4E",
        "slate-deep":         "#1F2228",
        "slate-mid":          "#2E3340",
        "copper":             "#A0714A",
        "off-white":          "#E8E6E0",
        "secondary-text":     "#C4B49C",
        "alert-red-dark":     "#E07060",
        "success-green-dark": "#4DB88A",
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body:    ["Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
}
