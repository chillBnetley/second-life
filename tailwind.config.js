/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07080f', 900: '#0b0d18', 800: '#121426', 700: '#1a1d35', 600: '#252945' },
        lantern: { 300: '#ffd98a', 400: '#f6c25b', 500: '#e9a63a', 600: '#c98324' },
        jade: { 400: '#3dd6a3', 500: '#22b888' },
        rune: { 300: '#b7acff', 400: '#9a8cff', 500: '#7c6cf0', 600: '#6150d6' },
        rose2: { 400: '#f2668b', 500: '#e0446f' },
      },
      fontFamily: {
        display: ['"Noto Serif SC"', '"Songti SC"', 'STSong', 'SimSun', 'serif'],
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
        pop: { '0%': { transform: 'scale(.94)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        rise: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        glow: { '0%,100%': { boxShadow: '0 0 0 0 rgba(246,194,91,.0)' }, '50%': { boxShadow: '0 0 22px 2px rgba(246,194,91,.35)' } },
      },
      animation: {
        float: 'float 9s ease-in-out infinite',
        pop: 'pop .22s ease-out both',
        rise: 'rise .3s ease-out both',
        glow: 'glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
