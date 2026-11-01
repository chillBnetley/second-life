/** 测试公共工具：可复现随机数、开局状态、机器人玩家、不变量检查。 */
import { ACTIVITIES, JOBS } from '../content';
import {
  choiceBlockReason, applyForJob, createNewGame, endDay, getDate, interactWithNpc, performActivity, performFreeAction, performWork, resolveEventChoice,
} from '../engine';
import type { CreateInput, GameState } from '../types';
import type { RNG } from '../util';

/** LCG：同一种子必定产生同一串随机数（黄金快照测试依赖它） */
export function seededRng(seed = 42): RNG {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

export const TEST_INPUT: CreateInput = {
  name: '测试者', gender: '男', personality: 'extrovert', background: 'ordinary', hobbies: ['阅读', '游戏'],
  allocation: { intelligence: 4, eq: 3, fitness: 3, charm: 2 },
};

/** 新游戏 + 处理掉开局岔路口（选「上大学」→ 学生身份） */
export function startedGame(seed = 7): GameState {
  const rng = seededRng(seed);
  let s = createNewGame(TEST_INPUT, rng);
  const first = s.pendingEvent?.choices[0];
  if (s.pendingEvent && first) s = resolveEventChoice(s, first.id, rng).state;
  return s;
}

/** 造一个「没有待处理事件、行动点充足」的状态，便于单条规则测试 */
export function cleanState(s: GameState): GameState {
  return { ...structuredClone(s), pendingEvent: null, ap: s.maxAp };
}

/** 把 day 推到最近的一个周末（周六/周日），用于「周末不上班」规则 */
export function toWeekend(s: GameState): GameState {
  const st = cleanState(s);
  const wd = getDate(st).weekday;
  const add = wd === 6 ? 0 : wd === 0 ? 0 : 6 - wd;
  st.day += add;
  return st;
}

/** 机器人玩一天：先处理事件，再随机做几件事（不含 endDay） */
export function playDay(s: GameState, rng: RNG): { state: GameState; rejected: number; events: number } {
  let st = s;
  let rejected = 0;
  let events = 0;
  for (let guard = 0; st.pendingEvent && guard < 4; guard++) {
    const ev = st.pendingEvent;
    const opts = ev.choices.filter((c) => choiceBlockReason(st, c.id) === null);
    if (!opts.length) throw new Error(`事件无可用选项：${ev.defId}，day=${st.day}，money=${st.player.money}`);
    const ch = opts[Math.floor(rng() * opts.length)];
    const r = resolveEventChoice(st, ch.id, rng);
    if (!r.result.ok) throw new Error(r.result.text);
    st = r.state;
    events++;
  }
  for (let k = 0; k < 6 && st.ap > 0 && !st.pendingEvent; k++) {
    const roll = rng();
    let r;
    if (roll < 0.15 && st.player.jobId) r = performWork(st, rng);
    else if (roll < 0.25) r = applyForJob(st, JOBS[Math.floor(rng() * 3)].id, rng);
    else if (roll < 0.45) {
      const met = st.npcs.filter((n) => n.met);
      r = interactWithNpc(st, met[Math.floor(rng() * met.length)].id, 'chat', rng);
    } else if (roll < 0.5) r = performFreeAction(st, '花200元看一场电影', rng);
    else {
      const a = ACTIVITIES[Math.floor(rng() * ACTIVITIES.length)];
      r = performActivity(st, a.id, rng);
    }
    if (r.result.ok) st = r.state;
    else rejected++;
  }
  return { state: st, rejected, events };
}

export function runDays(start: GameState, days: number, rng: RNG): GameState {
  let s = start;
  const target = start.day + days;
  for (let rounds = 0; s.day < target && rounds < days * 20; rounds++) {
    s = playDay(s, rng).state;
    if (s.pendingEvent) continue;
    const r = endDay(s, rng);
    if (!r.result.ok) throw new Error(r.result.text);
    s = r.state;
  }
  if (s.day !== target) throw new Error(`模拟未推进至目标日期：${s.day}/${target}`);
  return s;
}

/** 返回所有被违反的不变量（空数组 = 全部通过） */
export function invariants(s: GameState): string[] {
  const bad: string[] = [];
  for (const [k, v] of Object.entries(s.player.attrs)) {
    if (!Number.isInteger(v) || v < 0 || v > 100) bad.push(`属性 ${k} 越界：${v}`);
  }
  if (!Number.isInteger(s.ap) || s.ap < 0 || s.ap > s.maxAp) bad.push(`行动点越界：${s.ap}/${s.maxAp}`);
  if (!Number.isFinite(s.player.money)) bad.push('金钱不是有限数');
  if (!Number.isFinite(s.player.knowledge) || s.player.knowledge < 0) bad.push(`学识越界：${s.player.knowledge}`);
  if (!Number.isInteger(s.day) || s.day < 0) bad.push(`天数越界：${s.day}`);
  for (const [k, v] of Object.entries(s.player.skills ?? {})) {
    if (!Number.isInteger(v) || v < 0 || v > 100) bad.push(`技能 ${k} 越界：${v}`);
  }
  if (!Number.isInteger(s.player.performance) || s.player.performance < 0 || s.player.performance > 100) bad.push(`绩效越界：${s.player.performance}`);
  if (s.player.bankLoan) {
    const l = s.player.bankLoan;
    if (!Number.isInteger(l.remaining) || l.remaining <= 0) bad.push(`贷款剩余异常：${l.remaining}`);
    if (!Number.isInteger(l.monthly) || l.monthly <= 0) bad.push(`月供异常：${l.monthly}`);
    if (!Number.isFinite(l.rate) || l.rate <= 0 || l.rate > 1) bad.push(`利率异常：${l.rate}`);
    if (!Number.isInteger(s.player.credit) || s.player.credit < 300 || s.player.credit > 850) bad.push(`信用分越界：${s.player.credit}`);
  }
  for (const [k, v] of Object.entries(s.player.trackDays ?? {})) {
    if (!Number.isInteger(v) || v < 0) bad.push(`行业天数 ${k} 越界：${v}`);
  }
  for (const n of s.npcs) {
    if (!Number.isFinite(n.affinity) || n.affinity < -100 || n.affinity > 100) bad.push(`${n.name} 好感越界：${n.affinity}`);
    if (!Number.isInteger(n.trust) || n.trust < -100 || n.trust > 100) bad.push(`${n.name} 信任越界：${n.trust}`);
    if (!['stranger', 'acquaintance', 'friend', 'close', 'best'].includes(n.stage)) bad.push(`${n.name} 阶段非法：${n.stage}`);
    if (n.memories.length > 40) bad.push(`${n.name} 记忆超过 40 条：${n.memories.length}`);
  }
  if (s.log.length > 700) bad.push(`日志超过 700 条：${s.log.length}`);
  if (s.transactions.length > 700) bad.push(`账本超过 700 条：${s.transactions.length}`);
  if (s.pendingEvent) {
    const round = JSON.parse(JSON.stringify(s.pendingEvent));
    if (JSON.stringify(round) !== JSON.stringify(s.pendingEvent)) bad.push('待处理事件含不可序列化内容');
    if (!s.pendingEvent.choices.length) bad.push('事件没有选项');
  }
  return bad;
}
