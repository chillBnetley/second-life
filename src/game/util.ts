export type RNG = () => number;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const pick = <T>(arr: T[], rng: RNG = Math.random): T => arr[Math.floor(rng() * arr.length)];

export function weightedPick<T extends { weight: number }>(items: T[], rng: RNG = Math.random): T {
  const total = items.reduce((a, b) => a + Math.max(0, b.weight), 0);
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, it.weight);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** 把 1.5 这样的小数增量按概率变成整数（1 或 2），属性始终保持整数 */
export function resolveDelta(x: number, rng: RNG = Math.random): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const base = Math.floor(a);
  return sign * (base + (rng() < a - base ? 1 : 0));
}

export const uid = (prefix = 'id') =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

// ---------- 日期（UTC，避免时区问题） ----------
export interface DateParts { y: number; m: number; d: number; weekday: number }
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function dateParts(startISO: string, day: number): DateParts {
  const [y, m, d] = startISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + day));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), weekday: dt.getUTCDay() };
}
export const formatDate = (p: DateParts) => `${p.y}年${p.m}月${p.d}日`;
export const formatWeekday = (p: DateParts) => `星期${WEEK[p.weekday]}`;
export const isWeekend = (p: DateParts) => p.weekday === 0 || p.weekday === 6;

export function calcAge(birthISO: string, p: DateParts): number {
  const [by, bm, bd] = birthISO.split('-').map(Number);
  let age = p.y - by;
  if (p.m < bm || (p.m === bm && p.d < bd)) age--;
  return age;
}
export function isBirthday(birthISO: string, p: DateParts): boolean {
  const [, bm, bd] = birthISO.split('-').map(Number);
  return p.m === bm && p.d === bd;
}

export const fmtMoney = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(Math.round(n)).toLocaleString('zh-CN')}`;
export const fmtSigned = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}`;
