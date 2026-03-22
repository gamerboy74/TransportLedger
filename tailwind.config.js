module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: { 400: '#38bdf8', 600: '#0284c7' },
        surface: { 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a' },
        success: '#22c55e', danger: '#ef4444', warning: '#f59e0b',
      },
    },
  },
  plugins: [],
};
