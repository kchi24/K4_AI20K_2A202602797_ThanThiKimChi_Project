/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Brand palette from the PaceWise design brief.
        primary: { DEFAULT: '#4F7DF3', dark: '#3F6FE8', deeper: '#3461D6', light: '#EEF4FF', ink: '#3461D6' },
        success: { DEFAULT: '#52B788', light: '#EAF8F1', ink: '#2F7A56' },
        warning: { DEFAULT: '#F2B84B', light: '#FFF7E6', ink: '#8A5A00' },
        danger: { DEFAULT: '#E97979', light: '#FFF1F1', ink: '#B43E3E' },
        accent: { DEFAULT: '#8B7CF6', light: '#F3F0FF', ink: '#5B4BC4' },
        canvas: '#F8FAFC',
        ink: '#1F2937',
        muted: '#64748B',
        line: '#E7ECF3',
      },
      fontSize: {
        caption: ['13px', '18px'],
        body: ['15px', '24px'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 16px rgba(15, 23, 42, 0.04)',
        pop: '0 12px 40px rgba(15, 23, 42, 0.16)',
      },
      borderRadius: {
        xl2: '1.125rem',
      },
    },
  },
  plugins: [],
};
