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
        // ── Semantic aliases — dark intelligence theme ──
        ink:            '#dde2ea',
        'ink-active':   '#ffffff',
        body:           '#8b95a8',
        muted:          '#5a6275',
        hairline:       '#1e2332',
        'border-strong':'#2e3347',
        canvas:         '#141720',
        'surface-soft': '#0d0f17',
        'surface-strong':'#1d2032',
        'surface-dark': '#090b12',
        'surface-dark-elevated': '#141720',

        // ── Semantic status ──
        link: '#1b61c9',
        'link-active': '#1a3866',
        info: '#254fad',
        'info-border': '#458fff',
        success: '#006400',
        'success-border': '#39bf45',

        // ── Semantic error / warning ──
        error:          '#aa2d00',
        'error-bg':     '#fcede8',
        'error-border': '#f5c9b8',
        warning:        '#d9a441',

        // ── Brand ──
        brand: {
          DEFAULT: '#4f6ef7',
          50:  '#eef1fe',
          100: '#dde4fd',
          200: '#bbc9fb',
          300: '#99aef9',
          400: '#7793f8',
          500: '#4f6ef7',
          600: '#3a57e0',
          700: '#2b42c4',
          800: '#1e2f9e',
          900: '#131f6b',
          950: '#0b1245',
        },

        // ── Neutral gray scale ──
        neutral: {
          50:  '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#030712',
        },

        // ── Sidebar ──
        sidebar: {
          bg:     '#0f1117',
          hover:  '#ffffff0d',
          active: '#ffffff1a',
          text:   '#a0a8b4',
          'text-active': '#ffffff',
          border: '#ffffff14',
          accent: '#4f6ef7',
        },

        // ── Semantic status colors — dark ──
        status: {
          'new-bg':           '#131822',
          'new-text':         '#7d8ea8',
          'new-border':       '#1e2a38',
          'contacted-bg':     '#0f1a2e',
          'contacted-text':   '#7ca8f8',
          'contacted-border': '#1a2a50',
          'replied-bg':       '#130f28',
          'replied-text':     '#c084fc',
          'replied-border':   '#251850',
          'meeting-bg':       '#1e1808',
          'meeting-text':     '#fbbf24',
          'meeting-border':   '#3a2c10',
          'client-bg':        '#0d2218',
          'client-text':      '#4ade80',
          'client-border':    '#1a4432',
          'rejected-bg':      '#280f0f',
          'rejected-text':    '#f87171',
          'rejected-border':  '#501a1a',
          'active-bg':        '#0d2218',
          'active-border':    '#1a4432',
        },

        // ── Score badge colors — dark ──
        score: {
          'hot-bg':      '#0d2218',
          'hot-text':    '#4ade80',
          'hot-border':  '#1a4432',
          'warm-bg':     '#221a08',
          'warm-text':   '#fbbf24',
          'warm-border': '#3a2c10',
          'cold-bg':     '#131a24',
          'cold-text':   '#7d8ea8',
          'cold-border': '#1e2a38',
        },
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
        mono: ['JetBrains Mono', '"Fira Code"', 'monospace'],
      },

      fontSize: {
        'display-xl': ['48px', { lineHeight: '1.1', fontWeight: '500' }],
        'display-lg': ['40px', { lineHeight: '1.2', fontWeight: '400' }],
        'display-md': ['32px', { lineHeight: '1.2', fontWeight: '400' }],
        'title-xl':   ['26px', { lineHeight: '1.3', fontWeight: '600' }],
        'title-lg':   ['24px', { lineHeight: '1.35', fontWeight: '400', letterSpacing: '0.12px' }],
        'title-md':   ['20px', { lineHeight: '1.5',  fontWeight: '400' }],
        'title-sm':   ['18px', { lineHeight: '1.4',  fontWeight: '500' }],
        'label-md':   ['16px', { lineHeight: '1.4',  fontWeight: '500' }],
        'body-md':    ['14px', { lineHeight: '1.25', fontWeight: '400' }],
        'body-sm':    ['13px', { lineHeight: '1.5',  fontWeight: '400' }],
        caption:      ['14px', { lineHeight: '1.35', fontWeight: '500', letterSpacing: '0.16px' }],
        '2xs':        ['11px', { lineHeight: '1.4' }],
        '3xs':        ['10px', { lineHeight: '1.4' }],
      },

      borderRadius: {
        xs:   '2px',
        sm:   '6px',
        md:   '10px',
        lg:   '12px',
        xl:   '16px',
        '2xl':'20px',
        pill: '9999px',
      },

      spacing: {
        xxs:     '4px',
        xs:      '8px',
        sm:      '12px',
        section: '96px',
      },

      boxShadow: {
        'card':    '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-md': '0 4px 12px 0 rgb(0 0 0 / 0.08), 0 2px 4px -1px rgb(0 0 0 / 0.04)',
        'card-lg': '0 8px 24px 0 rgb(0 0 0 / 0.10), 0 4px 8px -2px rgb(0 0 0 / 0.06)',
        'brand':   '0 0 0 3px rgb(79 110 247 / 0.15)',
        'sidebar-glow': '0 0 8px rgb(79 110 247 / 0.08)',
        'cmd':     '0 25px 50px -12px rgb(0 0 0 / 0.35), 0 0 0 1px rgb(0 0 0 / 0.08)',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to:   { opacity: '0' },
        },
        'slide-in-from-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-in-from-left': {
          from: { transform: 'translateX(-100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',     opacity: '1' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
        'scale-in': {
          from: { transform: 'scale(0.96)', opacity: '0' },
          to:   { transform: 'scale(1)',    opacity: '1' },
        },
        'shimmer': {
          from: { backgroundPosition: '-200% 0' },
          to:   { backgroundPosition: '200% 0' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },

      animation: {
        'fade-in':             'fade-in 0.18s ease-out',
        'fade-out':            'fade-out 0.15s ease-in',
        'slide-in-from-right': 'slide-in-from-right 0.22s ease-out',
        'slide-in-from-left':  'slide-in-from-left 0.22s ease-out',
        'slide-in-from-bottom':'slide-in-from-bottom 0.18s ease-out',
        'scale-in':            'scale-in 0.15s ease-out',
        'shimmer':             'shimmer 1.6s linear infinite',
        'pulse-dot':           'pulse-dot 2s ease-in-out infinite',
      },

      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.1)',
      },
    },
  },
  plugins: [],
};

export default config;
