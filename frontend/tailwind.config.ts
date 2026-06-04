import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // DESIGN.md primary tokens
        ink: '#181d26',
        'ink-active': '#0d1218',
        body: '#333840',
        muted: '#41454d',
        hairline: '#dddddd',
        'border-strong': '#9297a0',
        canvas: '#ffffff',
        'surface-soft': '#f8fafc',
        'surface-strong': '#e0e2e6',
        'surface-dark': '#181d26',
        'surface-dark-elevated': '#1d1f25',
        // Signature card surfaces
        'sig-coral': '#aa2d00',
        'sig-forest': '#0a2e0e',
        'sig-cream': '#f5e9d4',
        'sig-peach': '#fcab79',
        'sig-mint': '#a8d8c4',
        'sig-yellow': '#f4d35e',
        'sig-mustard': '#d9a441',
        // Semantic
        link: '#1b61c9',
        'link-active': '#1a3866',
        info: '#254fad',
        'info-border': '#458fff',
        success: '#006400',
        'success-border': '#39bf45',
      },
      fontFamily: {
        sans: [
          'Inter',
          'Inter Display',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'display-xl': ['48px', { lineHeight: '1.1', fontWeight: '500' }],
        'display-lg': ['40px', { lineHeight: '1.2', fontWeight: '400' }],
        'display-md': ['32px', { lineHeight: '1.2', fontWeight: '400' }],
        'title-lg': ['24px', { lineHeight: '1.35', fontWeight: '400', letterSpacing: '0.12px' }],
        'title-md': ['20px', { lineHeight: '1.5', fontWeight: '400' }],
        'title-sm': ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        'label-md': ['16px', { lineHeight: '1.4', fontWeight: '500' }],
        'body-md': ['14px', { lineHeight: '1.25', fontWeight: '400' }],
        caption: ['14px', { lineHeight: '1.35', fontWeight: '500', letterSpacing: '0.16px' }],
      },
      borderRadius: {
        xs: '2px',
        sm: '6px',
        md: '10px',
        lg: '12px',
        pill: '9999px',
      },
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        section: '96px',
      },
    },
  },
  plugins: [],
};

export default config;
