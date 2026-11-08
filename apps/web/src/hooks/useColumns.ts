import { Grid } from 'antd';

/** Grid columns per antd breakpoint (spec 7.5): xs 2, sm/md 3, lg 4, xl+ 5. */
export function columnsFor(screens: Partial<Record<string, boolean>>): number {
  if (screens.xl || screens.xxl) return 5;
  if (screens.lg) return 4;
  if (screens.sm || screens.md) return 3;
  return 2;
}

export function useColumns(): number {
  return columnsFor(Grid.useBreakpoint());
}

export function useIsMobile(): boolean {
  const screens = Grid.useBreakpoint();
  // Before the first breakpoint measurement every flag is undefined; assume desktop-ish only once `sm` is known.
  return screens.sm === false || (!screens.sm && !screens.md && !screens.lg);
}
