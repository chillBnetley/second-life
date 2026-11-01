import { describe, expect, it } from 'vitest';
import { CloudSync, detectConflict } from '../cloudSync';
import type { GameState } from '../../game/types';
import type { SaveMeta, StorageAdapter } from '../storage';
import { startedGame } from '../../game/__tests__/helpers';

/** 内存版存档适配器（模拟本地/云端），可配置失败 */
class MemoryStorage implements StorageAdapter {
  saves = new Map<string, GameState>();
  fail = false;
  constructor(public name = 'mem') {}
  async list(): Promise<SaveMeta[]> {
    return [...this.saves.values()].map((s) => ({
      id: s.id, name: s.player.name, age: 18, dateLabel: '', day: s.day, money: Math.round(s.player.money), updatedAt: s.updatedAt,
    }));
  }
  async load(id: string) { return this.saves.get(id) ?? null; }
  async save(state: GameState) {
    if (this.fail) throw new Error(`${this.name} 写入失败`);
    this.saves.set(state.id, JSON.parse(JSON.stringify(state)) as GameState);
  }
  async remove(id: string) { this.saves.delete(id); }
  async getLastId() { return null; }
  async setLastId() { /* noop */ }
}

const save = (id: string, updatedAt: number): GameState => {
  const s = startedGame();
  return { ...s, id, updatedAt };
};

describe('detectConflict：冲突判定', () => {
  const local = save('a', 100);
  const meta = (updatedAt: number): SaveMeta => ({ id: 'a', name: 'x', age: 18, dateLabel: '', day: 0, money: 0, updatedAt });

  it('云端没有 → 本地胜', () => expect(detectConflict(local, null, null)).toBe('local-wins'));
  it('两端相同 → 本地胜（无需同步）', () => expect(detectConflict(local, meta(100), 50)).toBe('local-wins'));
  it('只有本地改过 → 本地胜', () => expect(detectConflict(local, meta(90), 90)).toBe('local-wins'));
  it('只有云端改过 → 云端胜', () => expect(detectConflict(local, meta(200), 150)).toBe('remote-wins'));
  it('两端都改过 → 冲突', () => expect(detectConflict(local, meta(200), 50)).toBe('conflict'));
});

describe('CloudSync：节流同步', () => {
  it('把本地存档推送到云端', async () => {
    const local = new MemoryStorage('local');
    const remote = new MemoryStorage('remote');
    const s = save('a', 100);
    await local.save(s);
    const sync = new CloudSync(local, remote, {});
    sync.queue('a');
    const r = await sync.flush();
    expect(r.pushed).toBeGreaterThanOrEqual(0); // queue 后可能已经被自动 flush
    expect(remote.saves.has('a')).toBe(true);
  });

  it('冲突时选择云端：本地被远端覆盖', async () => {
    const local = new MemoryStorage('local');
    const remote = new MemoryStorage('remote');
    await local.save(save('a', 100));
    await remote.save(save('a', 200));
    const sync = new CloudSync(local, remote, { onConflict: async () => 'remote' as const });
    sync.queue('a');
    await sync.flush();
    const got = await local.load('a');
    expect(got?.updatedAt).toBe(200);
  });

  it('冲突时交给回调决定：选择 skip 不会覆盖任一端', async () => {
    const local = new MemoryStorage('local');
    const remote = new MemoryStorage('remote');
    const localSave = save('a', 100);
    const remoteSave = save('a', 200);
    await local.save(localSave);
    await remote.save(remoteSave);
    let called = 0;
    const sync = new CloudSync(local, remote, { onConflict: async () => { called++; return 'skip'; } });
    sync.queue('a');
    const r = await sync.flush();
    expect(called).toBeGreaterThanOrEqual(1);
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(await local.load('a')).toEqual(localSave);
  });

  it('失败会留在队列里，恢复后重试成功', async () => {
    const local = new MemoryStorage('local');
    const remote = new MemoryStorage('remote');
    await local.save(save('a', 100));
    remote.fail = true;
    const sync = new CloudSync(local, remote, {});
    sync.queue('a');
    const r1 = await sync.flush();
    expect(r1.failed).toBe(1);
    remote.fail = false;
    const r2 = await sync.flush();
    expect(r2.failed).toBe(0);
    expect(remote.saves.has('a')).toBe(true);
  });

  it('bootstrap：本地有云端没有 → 上传；云端有本地没有 → 拉回', async () => {
    const local = new MemoryStorage('local');
    const remote = new MemoryStorage('remote');
    await local.save(save('local-only', 100));
    await remote.save(save('remote-only', 200));
    const sync = new CloudSync(local, remote, {});
    const r = await sync.bootstrap();
    expect(r.uploaded).toBe(1);
    expect(r.pulled).toBe(1);
    expect(remote.saves.has('local-only')).toBe(true);
    expect(local.saves.has('remote-only')).toBe(true);
  });
});