/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        stone: {
          paper: "#F5F2ED",
          parchment: "#E7E3DC",
        },
        ink: {
          black: "#1C1917",
          charcoal: "#44403C",
        },
        gold: {
          antique: "#A8936A",
          light: "#C4AD87",
        },
        alert: "#DC2626",
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
}
