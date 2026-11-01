import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, migrate } from '../migrate';
import type { GameState } from '../types';
import { parseSave } from '../../services/storage';
import { startedGame } from './helpers';

/** 造一份 v1 老存档：把 v2 新字段全部删掉 */
function v1Fixture(): Record<string, unknown> {
  const modern = JSON.parse(JSON.stringify(startedGame())) as Record<string, unknown>;
  const v1: Record<string, unknown> = { ...modern, version: 1 };
  delete v1.storyThreads;
  delete v1.ai;
  v1.npcs = (v1.npcs as Record<string, unknown>[]).map((n) => {
    const copy = { ...n };
    delete copy.summary;
    return copy;
  });
  return v1;
}

describe('migrate：版本升级链', () => {
  it('v1 存档升级到当前版本并补齐新字段', () => {
    const raw = v1Fixture();
    const s = migrate(raw);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.storyThreads).toEqual([]);
    expect(s.ai).toEqual({ day: 0, calls: 0, failures: 0, cooldownUntil: 0 });
    expect(s.npcs.every((n) => n.summary === '')).toBe(true);
    expect(s.day).toBe((raw as { day: number }).day);
    expect(s.player.name).toBe((raw as unknown as GameState).player.name);
  });

  it('迁移不修改传入的原始对象', () => {
    const raw = v1Fixture();
    migrate(raw);
    expect(raw.version).toBe(1);
    expect('storyThreads' in raw).toBe(false);
  });

  it('当前版本存档原样通过', () => {
    const modern = JSON.parse(JSON.stringify(startedGame()));
    const s = migrate(modern);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.player.money).toBe(modern.player.money);
  });

  it('非法剧情线被清洗，数量上限 6 条', () => {
    const raw = v1Fixture();
    raw.version = 2;
    raw.storyThreads = [
      { id: 'ok', title: '旧事', summary: 'x', openedDay: 1, lastDay: 2, status: 'open', npcIds: ['mom'] },
      { title: '缺 id', summary: 'y' },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`, title: `线${i}`, summary: '', openedDay: 0, lastDay: i, status: i % 2 ? 'closed' : 'open', npcIds: [],
      })),
    ];
    const s = migrate(raw);
    expect(s.storyThreads.length).toBeLessThanOrEqual(6);
    expect(s.storyThreads.every((t) => !!t.id && !!t.title)).toBe(true);
    expect(s.storyThreads.every((t) => t.status === 'open' || t.status === 'closed')).toBe(true);
  });

  it('未来版本存档拒绝读取', () => {
    expect(() => migrate({ ...v1Fixture(), version: CURRENT_VERSION + 5 })).toThrow(/更新/);
  });

  it('损坏/非本游戏存档抛错', () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate({})).toThrow();
    expect(() => migrate({ player: {}, npcs: [], day: 0 })).toThrow();
    expect(() => migrate({ player: { attrs: {} }, npcs: [], day: 'x' })).toThrow();
  });

  it('缺可选集合时兜底补齐', () => {
    const raw = v1Fixture();
    delete raw.log;
    delete raw.transactions;
    delete raw.achievements;
    delete raw.flags;
    delete raw.stats;
    const s = migrate(raw);
    expect(s.log).toEqual([]);
    expect(s.transactions).toEqual([]);
    expect(s.achievements).toEqual({});
    expect(s.flags).toEqual({});
    expect(s.stats.actionsDone).toBe(0);
  });
});

describe('parseSave：外部存档入口走迁移链', () => {
  it('老存档字符串可直接读取', () => {
    const s = parseSave(JSON.stringify(v1Fixture()));
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.storyThreads).toEqual([]);
  });

  it('非 JSON 给出明确错误', () => {
    expect(() => parseSave('not json')).toThrow(/JSON/);
  });

  it('随机 JSON 不会被当成存档', () => {
    expect(() => parseSave(JSON.stringify({ hello: 'world' }))).toThrow();
  });
});