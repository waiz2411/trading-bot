/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        terminal: {
          950: '#07090e',
          900: '#0b0f17',
          850: '#0f1420',
          800: '#141b2b',
          700: '#1e293b',
          600: '#334155',
          border: '#1e283d'
        },
        bull: {
          DEFAULT: '#10b981',
          glow: 'rgba(16, 185, 129, 0.2)',
          dark: '#059669'
        },
        bear: {
          DEFAULT: '#ef4444',
          glow: 'rgba(239, 68, 68, 0.2)',
          dark: '#dc2626'
        },
        accent: {
          DEFAULT: '#6366f1',
          glow: 'rgba(99, 102, 241, 0.25)'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    },
  },
  plugins: [],
}
