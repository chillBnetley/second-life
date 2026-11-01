import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, DEFAULT_HOUSING, HOUSINGS, getHousingById, housingOf, moveCostOf } from '../content';
import { changeHousing, createNewGame, endDay, resolveEventChoice, sleepRecovery } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { dateParts } from '../util';
import { cleanState, seededRng, startedGame, TEST_INPUT } from './helpers';

function beforeMonthStart(s: GameState): GameState {
  const st = cleanState(s);
  while (dateParts(st.startISO, st.day + 1).d !== 1) st.day += 1;
  return st;
}

describe('居住定义与搬家', () => {
  it('默认居住无房租，租房有月租与舒适度', () => {
    expect(DEFAULT_HOUSING.rent).toBe(0);
    expect(housingOf(null)).toBe(DEFAULT_HOUSING);
    expect(getHousingById('studio')?.rent).toBe(1600);
    expect(moveCostOf('shared')).toBe(450);
    expect(moveCostOf('studio')).toBe(800);
    expect(moveCostOf(null)).toBe(200);
  });

  it('搬入合租：扣押金/搬家费并更新居住', () => {
    const s = cleanState(startedGame());
    s.player.money = 5000;
    const r = changeHousing(s, 'shared');
    expect(r.result.ok).toBe(true);
    expect(r.state.player.housing).toBe('shared');
    expect(r.state.player.money).toBe(4550);
    expect(r.state.transactions.some((t) => t.note.includes('搬入合租单间') && t.amount === -450)).toBe(true);
  });

  it('搬回家里花 ¥200，重复搬家与钱不够被拒', () => {
    const s = cleanState(startedGame());
    s.player.money = 5000;
    s.player.housing = 'shared';
    expect(changeHousing(s, 'shared').result.ok).toBe(false);
    const back = changeHousing(s, null);
    expect(back.result.ok).toBe(true);
    expect(back.state.player.housing).toBeNull();
    expect(back.state.player.money).toBe(4800);
    const poor = { ...s, player: { ...s.player, money: 10 } };
    expect(changeHousing(poor, 'studio').result.ok).toBe(false);
    expect(changeHousing(s, 'castle' as never).result.ok).toBe(false);
  });
});

describe('每月房租与舒适度', () => {
  it('月初自动扣房租并写入简报', () => {
    const s = beforeMonthStart(cleanState(startedGame()));
    s.player.money = 20000;
    s.player.housing = 'shared';
    const r = endDay(s, seededRng(21));
    expect(r.result.ok).toBe(true);
    expect(r.state.transactions.some((t) => t.category === '房租' && t.amount === -900)).toBe(true);
    expect(r.state.morningReport.join(' ')).toContain('房租');
  });

  it('住家里不产生房租扣款', () => {
    const s = beforeMonthStart(cleanState(startedGame()));
    s.player.money = 20000;
    s.player.housing = null;
    const r = endDay(s, seededRng(22));
    expect(r.state.transactions.some((t) => t.category === '房租')).toBe(false);
  });

  it('舒适度越高，睡眠恢复越多（公式 + 实际结算）', () => {
    const base = cleanState(startedGame());
    base.ap = 10;
    base.player.attrs.health = 30;
    base.todayCounts = { exercise: 1 };
    const home = { ...base, player: { ...base.player, housing: null } };
    const shared = { ...base, player: { ...base.player, housing: 'shared' as const } };
    const studio = { ...base, player: { ...base.player, housing: 'studio' as const } };

    // 公式层面：舒适度越高，恢复的健康/幸福越多
    expect(sleepRecovery(shared, 10).health).toBeGreaterThan(sleepRecovery(home, 10).health);
    expect(sleepRecovery(studio, 10).health).toBeGreaterThan(sleepRecovery(shared, 10).health);
    expect(sleepRecovery(studio, 10).happiness).toBeGreaterThan(sleepRecovery(home, 10).happiness);

    // 实际结算：整数属性上不会更差
    const fixedRng = () => 0.5;
    const a = endDay(home, fixedRng).state.player.attrs.health;
    const b = endDay(shared, fixedRng).state.player.attrs.health;
    const c = endDay(studio, fixedRng).state.player.attrs.health;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
});

describe('开局与迁移', () => {
  it('选择直接进入社会后默认开始租房，上大学则住家里/宿舍', () => {
    const rngA = seededRng(31);
    const sA = resolveEventChoice(createNewGame(TEST_INPUT, rngA), 'b', rngA).state;
    expect(sA.player.occupation).not.toBe('student');
    expect(sA.player.housing).toBe('shared');

    const rngB = seededRng(31);
    const sB = resolveEventChoice(createNewGame(TEST_INPUT, rngB), 'a', rngB).state;
    expect(sB.player.occupation).toBe('student');
    expect(sB.player.housing).toBeNull();
  });

  it('迁移：v8 老存档按身份推导居住方式，坏值清洗', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v8: Record<string, unknown> = { ...modern, version: 8 };
    const player = { ...(v8.player as Record<string, unknown>) };
    delete player.housing;
    v8.player = { ...player, occupation: 'student' };
    expect(migrate(v8).player.housing).toBeNull();
    v8.player = { ...player, occupation: 'employed' };
    expect(migrate(v8).player.housing).toBe('shared');

    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 9;
    raw.player = { ...(raw.player as Record<string, unknown>), housing: 'castle' };
    expect(migrate(raw).player.housing).toBeNull();
    raw.player = { ...(raw.player as Record<string, unknown>), housing: 'studio' };
    expect(migrate(raw).player.housing).toBe('studio');
    expect(migrate(raw).version).toBe(CURRENT_VERSION);
  });

  it('租房成就', () => {
    const s = cleanState(startedGame());
    s.player.housing = 'studio';
    expect(ACHIEVEMENTS.find((a) => a.id === 'renter')!.check(s)).toBe(true);
    expect(ACHIEVEMENTS.find((a) => a.id === 'studio_renter')!.check(s)).toBe(true);
    s.player.housing = 'shared';
    expect(ACHIEVEMENTS.find((a) => a.id === 'studio_renter')!.check(s)).toBe(false);
  });

  it('住宅选项表与常量一致', () => {
    expect(HOUSINGS.map((h) => h.id)).toEqual(['shared', 'studio']);
    for (const h of HOUSINGS) expect(h.comfort).toBeGreaterThan(DEFAULT_HOUSING.comfort);
  });
});