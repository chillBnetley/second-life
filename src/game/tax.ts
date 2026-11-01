/** 工资与个税（第三阶段 3.1.7）：纯函数，便于单测与平衡调整。 */
/** 五险一金个人缴纳比例（养老 8% + 医疗 2% + 失业 0.5% + 公积金 7%） */
export const INSURANCE_RATE = 0.175;
/** 个税起征点（月） */
export const TAX_THRESHOLD = 5000;

interface Bracket { limit: number; rate: number; quick: number }
/** 综合所得月度税率表（简化版） */
const BRACKETS: Bracket[] = [
  { limit: 3000, rate: 0.03, quick: 0 },
  { limit: 12000, rate: 0.1, quick: 210 },
  { limit: 25000, rate: 0.2, quick: 1410 },
  { limit: 35000, rate: 0.25, quick: 2660 },
  { limit: 55000, rate: 0.3, quick: 4410 },
  { limit: Infinity, rate: 0.35, quick: 7160 },
];

/** 按月度应纳税所得额计算个税 */
export function monthlyTax(taxable: number): number {
  if (!Number.isFinite(taxable) || taxable <= 0) return 0;
  const b = BRACKETS.find((x) => taxable <= x.limit) ?? BRACKETS[BRACKETS.length - 1];
  return Math.max(0, Math.round(taxable * b.rate - b.quick));
}

export interface SalaryInput {
  /** 本次税前工资 */
  gross: number;
  /** 兼职不缴五险一金 */
  partTime: boolean;
  /** 本月此前的税前收入 / 已缴五险一金 / 已缴个税（用于累计计税） */
  monthGross: number;
  monthInsurance: number;
  monthTax: number;
}

export interface SalaryBreakdown {
  gross: number;
  insurance: number;
  tax: number;
  net: number;
  /** 本月累计应纳税所得额（展示用） */
  taxable: number;
}

/** 计算一笔工资的五险一金、个税与到手金额（累计到本月，避免多笔收入少缴税） */
export function salaryBreakdown(input: SalaryInput): SalaryBreakdown {
  const gross = Math.max(0, Math.round(input.gross));
  const insurance = input.partTime ? 0 : Math.round(gross * INSURANCE_RATE);
  const totalGross = input.monthGross + gross;
  const totalInsurance = input.monthInsurance + insurance;
  const taxable = Math.max(0, totalGross - totalInsurance - TAX_THRESHOLD);
  const totalTax = monthlyTax(taxable);
  const tax = Math.max(0, totalTax - Math.max(0, input.monthTax));
  return { gross, insurance, tax, net: gross - insurance - tax, taxable };
}

/** 本月到手（用于 UI 展示） */
export function monthNet(gross: number, insurance: number, tax: number): number {
  return Math.max(0, Math.round(gross) - Math.round(insurance) - Math.round(tax));
}
