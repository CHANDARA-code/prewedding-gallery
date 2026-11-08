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
    },
    components: {
      Tabs: { itemSelectedColor: '#b83b68', inkBarColor: '#b83b68', itemHoverColor: '#d0668b', titleFontSize: 15 },
      Segmented: { itemSelectedBg: '#ffffff', trackBg: '#f3e7ea' },
      Button: { primaryShadow: 'none' },
    },
  };
}
