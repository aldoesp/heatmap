/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        text: {
          DEFAULT: '#e6edf3',
          dim: '#8b98a5',
        },
        accent: {
          DEFAULT: '#10b981',
          soft: 'rgba(16, 185, 129, 0.14)',
          border: 'rgba(16, 185, 129, 0.30)',
        },
        danger: {
          DEFAULT: '#f87171',
          soft: 'rgba(248, 113, 113, 0.14)',
        },
        glass: {
          bg: 'rgba(255, 255, 255, 0.05)',
          'bg-soft': 'rgba(255, 255, 255, 0.035)',
          'bg-fallback': 'rgba(17, 24, 32, 0.92)',
          border: 'rgba(255, 255, 255, 0.10)',
          'border-soft': 'rgba(255, 255, 255, 0.07)',
        },
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        bar: '24px',
        item: '16px',
        card: '20px',
      },
      transitionTimingFunction: {
        ui: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      transitionDuration: {
        ui: '200ms',
      },
      backdropBlur: {
        ui: '16px',
      },
      boxShadow: {
        glass: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 12px 32px rgba(0, 0, 0, 0.45)',
        'glass-light': 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      },
      keyframes: {
        'pin-pulse': {
          '0%, 100%': { transform: 'rotate(-45deg) scale(1)' },
          '50%': { transform: 'rotate(-45deg) scale(1.12)' },
        },
        'scan-pop': {
          from: { transform: 'scale(0.6)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'pin-pulse': 'pin-pulse 2s ease-in-out infinite',
        'scan-pop': 'scan-pop 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};