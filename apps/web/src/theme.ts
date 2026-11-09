import type { ThemeConfig } from 'antd';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A soft, wedding-appropriate palette: blush rose on warm ivory. */
export function buildTheme(): ThemeConfig {
  return {
    token: {
      colorPrimary: '#b83b68',
      colorInfo: '#b83b68',
      colorLink: '#b83b68',
      colorBgLayout: '#fbf6f3',
      colorBgContainer: '#ffffff',
      colorText: '#3d2c33',
      colorTextSecondary: '#7d6870',
      colorBorder: '#ead9dd',
      colorBorderSecondary: '#f3e7ea',
      borderRadius: 10,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
      motion: !prefersReducedMotion(),
      // Strong curves (see .claude/skills/animate): every dropdown, modal, toast, tooltip and tab ink bar.
      // Built-in eases are too weak; durations stay inside the UI budget (100 / 200 / 300 ms).
      motionEaseOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
      motionEaseOutCirc: 'cubic-bezier(0.23, 1, 0.32, 1)',
      motionEaseOutQuint: 'cubic-bezier(0.23, 1, 0.32, 1)',
      motionEaseInOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
      motionEaseInOutCirc: 'cubic-bezier(0.77, 0, 0.175, 1)',
      motionDurationFast: '0.1s',
      motionDurationMid: '0.18s',
      motionDurationSlow: '0.26s',
    },
    components: {
      Tabs: { itemSelectedColor: '#b83b68', inkBarColor: '#b83b68', itemHoverColor: '#d0668b', titleFontSize: 15 },
      Segmented: { itemSelectedBg: '#ffffff', trackBg: '#f3e7ea' },
      Button: { primaryShadow: 'none' },
    },
  };
}
