/**
 * AI 相关的纯函数：输入降噪、内容过滤、台词校验、事件标题去重。
 *
 * 这里**不是**安全防线（真正的防线是 game/validate.ts 与规则引擎），
 * 目的是提高提示词质量、降低模型被注入的概率，并过滤明显不适配游戏基调的文案。
 * 全部是纯函数，便于单测。
 */

/** 控制字符与零宽字符 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g;
/** 常见提示词注入句式（只做降噪，不能替代校验层） */
const INJECTION = [
  /忽略(以上|之前|上面|前面)(的)?(所有)?(指令|提示|要求|规则)/g,
  /ignore\s+(all\s+)?(previous|above)\s+(instructions?|prompts?|rules?)/gi,
  /你现在是|从现在开始你|扮演一个|进入开发者模式|DAN\s*模式/gi,
  /(system|assistant|developer)\s*[:：]/gi,
  /```[\s\S]*?```/g,
  /<\/?[a-z][^>]*>/gi,
];

/**
 * 玩家自由输入进提示词前的降噪：去控制字符、压缩空白、去掉代码块与注入句式，最后截断。
 * 处理后的文本仍然只被当作「数据」，最终能否执行由校验层决定。
 */
export function sanitizePlayerInput(text: unknown, max = 120): string {
  let t = typeof text === 'string' ? text : '';
  t = t.replace(CONTROL, '').replace(/\s+/g, ' ');
  for (const re of INJECTION) t = t.replace(re, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, max);
}

/** 粗粒度内容黑名单：命中则丢弃 AI 文案并回落本地模板 */
const BLOCKED: RegExp[] = [
  /(色情|裸体|性行为|做爱|强奸|恋童)/,
  /(杀人|分尸|自杀方法|自残|虐待)/,
  /(制毒|毒品交易|贩毒|洗钱|诈骗教程|黑客教程|破解软件|炸弹|爆炸物|枪支弹药)/,
  /(制作|制造|组装).{0,6}(炸弹|爆炸物|枪支)/,
];

export function containsBlockedContent(text: unknown): boolean {
  const t = typeof text === 'string' ? text : '';
  return BLOCKED.some((re) => re.test(t));
}

/** 台词/摘要的数值断言（数值只能由引擎产生，AI 文案里出现即为幻觉） */
export const NUMERIC_CLAIM = /(好感|属性|智力|情商|体能|魅力|幸福|健康|金钱|财富|行动点)\s*[+＋\-－]?\s*\d/;

/**
 * 清理 NPC 台词：去换行/引号、压缩空白、截断到 max 字。
 * 返回 null 表示不可用（空、或含数值断言）。
 */
export function cleanNpcLine(raw: unknown, max = 60): string | null {
  let t = typeof raw === 'string' ? raw : '';
  t = t.replace(CONTROL, ' ').replace(/[\r\n\t「」"“”']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (NUMERIC_CLAIM.test(t) || containsBlockedContent(t)) return null;
  return t.slice(0, max);
}

/** 清理记忆摘要：允许稍长（≤200 字），同样拒绝数值断言与黑名单内容 */
export function cleanSummary(raw: unknown, max = 200): string | null {
  let t = typeof raw === 'string' ? raw : '';
  t = t.replace(CONTROL, ' ').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (NUMERIC_CLAIM.test(t) || containsBlockedContent(t)) return null;
  return t.slice(0, max);
}

/** 标题归一化：去掉标点与空白，只留文字，用于相似度比较 */
const normalizeTitle = (t: string) => t.replace(/[\s，。！？、,.!?：:；;"'「」()（）\-—…]/g, '');

/** 两个字串的字符二元组 Jaccard 相似度（0~1） */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    if (s.length === 1) set.add(s);
    return set;
  };
  const ga = grams(x);
  const gb = grams(y);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/**
 * 事件标题是否与最近事件过于相似（AI 重复生成相似事件的防护）。
 * recentTitles 传最近的标题列表（建议 10 条），阈值默认 0.72。
 */
export function isDuplicateTitle(title: string, recentTitles: string[], threshold = 0.6): boolean {
  return recentTitles.some((t) => titleSimilarity(title, t) >= threshold);
}

/** 从事件日志里取最近 N 个事件标题（供 isDuplicateTitle 使用） */
export function recentEventTitles(log: { kind: string; title: string }[], n = 10): string[] {
  return log
    .filter((l) => l.kind === 'event')
    .slice(-n)
    .map((l) => l.title);
}