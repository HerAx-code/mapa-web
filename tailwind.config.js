/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#E1F5EE',
          100: '#C3EBDd',
          200: '#87D7BB',
          300: '#4BC399',
          400: '#1DAF77',
          500: '#0F6E56',  // primary brand teal
          600: '#085041',
          700: '#06402F',
          800: '#04301F',
          900: '#02200F',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Warm humanist display for patient-facing headlines (the redesign) —
        // reads as a companion, not an admin panel. Use via `font-display`.
        display: ['"Bricolage Grotesque"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      })
    },
  ],
}
