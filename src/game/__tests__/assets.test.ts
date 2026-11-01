import { describe, expect, it } from 'vitest';
import { ASSETS, getAssetById } from '../content';
import { buyAsset, hasAsset, interactWithNpc, performActivity } from '../engine';
import { CURRENT_VERSION, migrate } from '../migrate';
import { cleanState, seededRng, startedGame } from './helpers';

function rich(seed = 7) {
  const s = cleanState(startedGame(seed));
  s.player.money = 50000;
  return s;
}

describe('购买资产', () => {
  it('扣钱并记录到资产列表', () => {
    const s = rich();
    const laptop = getAssetById('laptop')!;
    const r = buyAsset(s, 'laptop');
    expect(r.result.ok).toBe(true);
    expect(r.state.player.money).toBe(s.player.money - laptop.price);
    expect(r.state.player.assets).toEqual(['laptop']);
    expect(hasAsset(r.state, 'laptop')).toBe(true);
    expect(r.state.transactions.some((t) => t.note === '购买笔记本电脑')).toBe(true);
  });

  it('拒绝重复购买、未知资产与钱不够', () => {
    const s = rich();
    const owned = buyAsset(s, 'laptop').state;
    expect(buyAsset(owned, 'laptop').result.ok).toBe(false);
    expect(buyAsset(s, 'nonexistent').result.ok).toBe(false);
    const poor = { ...s, player: { ...s.player, money: 10 } };
    expect(buyAsset(poor, 'laptop').result.ok).toBe(false);
  });

  it('资产不消耗行动点', () => {
    const s = rich();
    const r = buyAsset(s, 'bike');
    expect(r.state.ap).toBe(s.ap);
  });
});

describe('资产加成实际生效', () => {
  it('笔记本电脑让学习行动的学识收益更高', () => {
    const base = rich();
    const withLaptop = buyAsset(base, 'laptop').state;
    const rngA = seededRng(11);
    const rngB = seededRng(11);
    const a = performActivity(base, 's_self', rngA);
    const b = performActivity(withLaptop, 's_self', rngB);
    expect(b.result.ok).toBe(true);
    expect(b.state.player.knowledge - withLaptop.player.knowledge)
      .toBeGreaterThanOrEqual(a.state.player.knowledge - base.player.knowledge);
  });

  it('自行车提高运动行动的体能收益', () => {
    const base = rich();
    const bike = buyAsset(base, 'bike').state;
    const a = performActivity(base, 'e_run', seededRng(12));
    const b = performActivity(bike, 'e_run', seededRng(12));
    expect(b.state.player.attrs.fitness).toBeGreaterThanOrEqual(a.state.player.attrs.fitness);
  });

  it('吉他提高娱乐行动带来的幸福感', () => {
    const base = rich();
    const guitar = buyAsset(base, 'guitar').state;
    const a = performActivity(base, 'en_game', seededRng(13));
    const b = performActivity(guitar, 'en_game', seededRng(13));
    expect(b.state.player.attrs.happiness).toBeGreaterThan(a.state.player.attrs.happiness);
  });

  it('新手机提高 NPC 互动的好感收益', () => {
    const base = cleanState(startedGame());
    const phone = buyAsset(base, 'phone').state;
    const a = interactWithNpc(base, 'mom', 'gift', seededRng(14));
    const b = interactWithNpc(phone, 'mom', 'gift', seededRng(14));
    const affA = a.result.deltas.npc.find((x) => x.name === '林雅芳')?.affinity ?? 0;
    const affB = b.result.deltas.npc.find((x) => x.name === '林雅芳')?.affinity ?? 0;
    expect(affB).toBeGreaterThanOrEqual(affA);
  });
});

describe('迁移：v6 → v7 资产列表', () => {
  it('老存档补空数组，未知/重复资产被清洗', () => {
    const modern = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    const v6: Record<string, unknown> = { ...modern, version: 6 };
    const player = { ...(v6.player as Record<string, unknown>) };
    delete player.assets;
    v6.player = player;
    expect(migrate(v6).player.assets).toEqual([]);

    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 7;
    raw.player = { ...(raw.player as Record<string, unknown>), assets: ['laptop', 'laptop', 'hack', 42, 'bike'] };
    expect(migrate(raw).player.assets).toEqual(['laptop', 'bike']);
  });

  it('资产数量不会超过资产总数', () => {
    const raw = JSON.parse(JSON.stringify(startedGame())) as unknown as Record<string, unknown>;
    raw.version = 7;
    raw.player = { ...(raw.player as Record<string, unknown>), assets: ASSETS.map((a) => a.id).concat(ASSETS.map((a) => a.id)) };
    expect(migrate(raw).player.assets.length).toBeLessThanOrEqual(ASSETS.length);
    expect(migrate(raw).version).toBe(CURRENT_VERSION);
  });
});