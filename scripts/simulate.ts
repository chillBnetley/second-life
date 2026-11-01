declare const process: { argv: string[]; exitCode?: number };
import { ACTIVITIES, INVESTMENT_PRODUCTS, JOBS } from '../src/game/content';
import {
  activityBlockReason, applyForJob, buyInvestment, createNewGame, endDay, getAge, interactWithNpc, performActivity, performFreeAction, performWork, resolveEventChoice,
} from '../src/game/engine';
import { EVENT_DEFS } from '../src/game/events';
import type { GameState } from '../src/game/types';

// 简单可复现的随机数
let seed = 42;
const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

let s: GameState = createNewGame({ name: '测试者', gender: '男', personality: 'extrovert', background: 'ordinary', hobbies: ['阅读', '游戏'], allocation: { intelligence: 4, eq: 3, fitness: 3, charm: 2 } }, rng);
const check = (cond: boolean, msg: string) => { if (!cond) { console.error('❌', msg); process.exitCode = 1; } };

check(getAge(s) === 18, `初始年龄应为 18，实际 ${getAge(s)}`);
check(!!s.pendingEvent && s.pendingEvent.defId === 'opening', '应有开局事件');
check(!performActivity(s, 's_self', rng).result.ok, '有待处理事件时不能行动');
s = resolveEventChoice(s, 'a', rng).state;
check(s.player.occupation === 'student', '选择上大学后应为学生');

const days = Number(process.argv[2] ?? 800);
let rejected = 0, events = 0;
const fired: Record<string, number> = {};
const seenDefs = new Set<string>([s.pendingEvent?.defId ?? 'opening']);

for (let i = 0; i < days; i++) {
  // 先处理事件（记录覆盖率）
  let guardN = 0;
  while (s.pendingEvent && guardN++ < 3) {
    const ev = s.pendingEvent;
    fired[ev.defId] = (fired[ev.defId] ?? 0) + 1;
    seenDefs.add(ev.defId);
    const opts = ev.choices.filter((c) => !(c.cost && c.cost > s.player.money));
    const ch = opts[Math.floor(rng() * opts.length)] ?? ev.choices[ev.choices.length - 1];
    const r = resolveEventChoice(s, ch.id, rng);
    check(r.result.ok, `事件选择失败: ${r.result.text}`);
    s = r.state; events++;
  }
  // 随机做 3~5 件事；偶尔存钱、买理财，覆盖第三阶段经济路径
  for (let k = 0; k < 6 && s.ap > 0 && !s.pendingEvent; k++) {
    const roll = rng();
    let r;
    if (roll < 0.12 && s.player.money > 6000) r = buyInvestment(s, INVESTMENT_PRODUCTS[Math.floor(rng() * INVESTMENT_PRODUCTS.length)].id, 2000);
    else if (roll < 0.15 && s.player.jobId) r = performWork(s, rng);
    else if (roll < 0.25) r = applyForJob(s, JOBS[Math.floor(rng() * 3)].id, rng);
    else if (roll < 0.45) { const n = s.npcs.filter((x) => x.met); const t = n[Math.floor(rng() * n.length)]; r = interactWithNpc(s, t.id, 'chat', rng); }
    else if (roll < 0.5) r = performFreeAction(s, '花200元看一场电影', rng);
    else { const a = ACTIVITIES[Math.floor(rng() * ACTIVITIES.length)]; r = performActivity(s, a.id, rng); }
    if (r.result.ok) s = r.state; else rejected++;
    // 不变量
    for (const v of Object.values(s.player.attrs)) check(Number.isInteger(v) && v >= 0 && v <= 100, `属性越界: ${v}`);
    check(s.player.savings >= 0, `储蓄为负: ${s.player.savings}`);
    for (const inv of s.player.investments) check(inv.value >= 0 && inv.principal >= 0, `理财市值异常: ${inv.value}`);
  }
  if (s.pendingEvent) continue; // 留到下一轮处理
  const r = endDay(s, rng);
  check(r.result.ok, `endDay 失败: ${r.result.text}`);
  s = r.state;
}

// 校验：规则引擎应拒绝作弊
const cheat = performFreeAction(s.pendingEvent ? { ...s, pendingEvent: null } : s, '我要修改金钱变成亿万富翁', rng);
check(!cheat.result.ok, '作弊输入应被拒绝');
// 校验：序列化往返
const back = JSON.parse(JSON.stringify(s)) as GameState;
check(back.day === s.day && back.npcs.length === s.npcs.length, '存档序列化往返失败');
const sample = ACTIVITIES.find((a) => activityBlockReason({ ...s, pendingEvent: null }, a) === null);
console.log(`✔ 模拟 ${s.day} 天 | 年龄 ${getAge(s)} | 财富 ¥${Math.round(s.player.money)} | 储蓄 ¥${Math.round(s.player.savings)} | 理财 ${s.player.investments.length} 笔 | 工作天数 ${s.player.workDays} | 事件 ${events} | 被拒行动 ${rejected} | 成就 ${Object.keys(s.achievements).length} | 日志 ${s.log.length} | 存档约 ${(JSON.stringify(s).length / 1024).toFixed(0)}KB`);
console.log('  属性', JSON.stringify(s.player.attrs), '| 职业', s.player.occupation, s.player.jobId, '| 可用行动示例', sample?.name ?? '无');
console.log('  好感度', s.npcs.filter((n) => n.met).map((n) => `${n.name}:${n.affinity}`).join(' '));

// ---- 事件覆盖率（区分「随机事件」与「条件/链式事件」）----
const isConditional = (d: (typeof EVENT_DEFS)[number]) => !!(d.when || d.npc || d.priority || d.once);
const neverRandom = EVENT_DEFS.filter((d) => !isConditional(d) && !seenDefs.has(d.id)).map((d) => d.id);
const neverConditional = EVENT_DEFS.filter((d) => isConditional(d) && !seenDefs.has(d.id)).map((d) => d.id);
const top = Object.entries(fired).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`  事件覆盖 ${seenDefs.size}/${EVENT_DEFS.length} | 最常触发: ${top.map(([id, n]) => `${id}×${n}`).join(' ')}`);
console.log(`  随机事件未触发: ${neverRandom.length ? neverRandom.join(',') : '无'} | 条件/链式事件未触发 ${neverConditional.length} 个: ${neverConditional.slice(0, 8).join(',')}${neverConditional.length > 8 ? '…' : ''}`);
check(neverRandom.length === 0, `存在永不触发的随机事件: ${neverRandom.join(',')}`);
