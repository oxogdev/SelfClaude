import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bumped for higher contrast — original palette read fine at 25cm
        // but sat too close to mid-grey for comfortable scanning. Each
        // layer now shifts ~2 luma steps lighter so panes stand apart and
        // borders register without squinting.
        bg: {
          DEFAULT: '#08090c',
          subtle: '#13151b',
          panel: '#1d1f27',
          elevated: '#2a2d37',
        },
        border: {
          DEFAULT: '#3d4150',
          strong: '#525667',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
