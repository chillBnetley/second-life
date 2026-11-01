/**
 * 存档适配层。第一阶段使用 LocalStorage；第四阶段只需实现 SupabaseAdapter 并在 makeStorage() 中切换，
 * 其余代码只依赖 StorageAdapter 接口（全部为 async，方便无缝迁移到网络存储）。
 */
import { getAge, getDate } from '../game/engine';
import { migrate } from '../game/migrate';
import type { GameState } from '../game/types';
import { formatDate, uid } from '../game/util';

export interface SaveMeta { id: string; name: string; age: number; dateLabel: string; day: number; money: number; updatedAt: number }
export interface StorageAdapter {
  list(): Promise<SaveMeta[]>;
  load(id: string): Promise<GameState | null>;
  save(state: GameState): Promise<void>;
  remove(id: string): Promise<void>;
  getLastId(): Promise<string | null>;
  setLastId(id: string): Promise<void>;
}

export const metaOf = (s: GameState): SaveMeta => ({
  id: s.id, name: s.player.name, age: getAge(s), dateLabel: formatDate(getDate(s)), day: s.day, money: Math.round(s.player.money), updatedAt: s.updatedAt,
});

/** 校验并迁移外部存档（导入文件 / 旧版本）。无法识别则抛错。 */
export function parseSave(json: string): GameState {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('文件不是有效的 JSON。'); }
  // 所有外部存档都必须经过迁移链（补字段 / 升级版本），坏数据在这里被拦下
  return migrate(raw);
}

const IDX = 'secondlife:index:v1';
const key = (id: string) => `secondlife:save:${id}`;
const LAST = 'secondlife:last';

class LocalStorageAdapter implements StorageAdapter {
  private readIndex(): SaveMeta[] {
    try { const v = JSON.parse(localStorage.getItem(IDX) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  async list() { return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt); }
  async load(id: string) {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    try { return parseSave(raw); } catch { return null; }
  }
  async save(state: GameState) {
    try {
      localStorage.setItem(key(state.id), JSON.stringify(state));
      const idx = this.readIndex().filter((m) => m.id !== state.id);
      idx.push(metaOf(state));
      localStorage.setItem(IDX, JSON.stringify(idx));
    } catch (e) {
      throw new Error('存档失败：浏览器存储空间可能已满。请导出存档后清理旧存档。');
    }
  }
  async remove(id: string) {
    localStorage.removeItem(key(id));
    localStorage.setItem(IDX, JSON.stringify(this.readIndex().filter((m) => m.id !== id)));
    if (localStorage.getItem(LAST) === id) localStorage.removeItem(LAST);
  }
  async getLastId() { return localStorage.getItem(LAST); }
  async setLastId(id: string) { localStorage.setItem(LAST, id); }
}

/**
 * 第四阶段：云端（Supabase）由 supabase.ts 在登录后挂到 DelegatingStorage 上。
 * 这里不直接 import supabase，避免循环依赖与未配置时的额外加载。
 */
import { CloudSync } from './cloudSync';
import type { ConflictInfo, SyncState } from './cloudSync';

/** 冲突请求（由 UI 弹窗决定保留哪一端） */
export type ConflictResolver = (choice: 'local' | 'remote' | 'skip') => void;
const conflictListeners = new Set<(info: ConflictInfo, resolve: ConflictResolver) => void>();
/** 订阅冲突请求；返回取消订阅函数 */
export function onConflictRequest(fn: (info: ConflictInfo, resolve: ConflictResolver) => void) {
  conflictListeners.add(fn);
  return () => { conflictListeners.delete(fn); };
}
function askConflict(info: ConflictInfo): Promise<'local' | 'remote' | 'skip'> {
  return new Promise((resolve) => {
    if (!conflictListeners.size) { resolve('local'); return; } // 没有 UI 时默认保留本地
    let settled = false;
    const done: ConflictResolver = (choice) => { if (!settled) { settled = true; resolve(choice); } };
    conflictListeners.forEach((fn) => fn(info, done));
    // 安全兜底：30 秒无操作按「保留本地」处理，避免同步队列永久挂起
    setTimeout(() => done('local'), 30_000);
  });
}

class DelegatingStorage implements StorageAdapter {
  private local: StorageAdapter;
  private remote: StorageAdapter | null = null;
  private syncer: CloudSync | null = null;
  private listeners = new Set<(s: SyncState, detail?: string) => void>();
  private state: SyncState = 'idle';

  constructor(local: StorageAdapter) { this.local = local; }

  getState(): SyncState { return this.state; }
  onState(fn: (s: SyncState, detail?: string) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(s: SyncState, detail?: string) { this.state = s; this.listeners.forEach((f) => f(s, detail)); }

  async list() { return this.local.list(); }
  async load(id: string) { return this.local.load(id); }
  async save(state: GameState) {
    await this.local.save(state);
    this.syncer?.queue(state.id);
  }
  async remove(id: string) {
    await this.local.remove(id);
    try { await this.remote?.remove(id); } catch { /* 离线删除失败留待下次 */ }
  }
  getLastId() { return this.local.getLastId(); }
  setLastId(id: string) { return this.local.setLastId(id); }

  /** 登录后连接云端：首次双向补齐 + 开始同步 */
  async attachRemote(remote: StorageAdapter): Promise<{ uploaded: number; pulled: number }> {
    this.remote = remote;
    this.syncer = new CloudSync(this.local, remote, {
      onState: (s, d) => this.emit(s, d),
      onConflict: (info) => askConflict(info),
    });
    const r = await this.syncer.bootstrap();
    this.emit('synced');
    return r;
  }
  detachRemote() {
    this.syncer?.dispose();
    this.syncer = null;
    this.remote = null;
    this.emit('idle');
  }
  async syncNow() { return this.syncer ? this.syncer.flush() : null; }
}

const localAdapter = new LocalStorageAdapter();
const delegating = new DelegatingStorage(localAdapter);

export function attachRemoteStorage(remote: StorageAdapter) { return delegating.attachRemote(remote); }
export function detachRemoteStorage() { delegating.detachRemote(); }
export function syncNow() { return delegating.syncNow(); }
export function getSyncState(): SyncState { return delegating.getState(); }
export function onSyncState(fn: (s: SyncState, d?: string) => void) { return delegating.onState(fn); }

export function makeStorage(): StorageAdapter {
  return delegating;
}
export const storage: StorageAdapter = makeStorage();

export function downloadSave(s: GameState) {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `secondlife-${s.player.name}-day${s.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
/** 导入：生成新的存档 id，避免覆盖已有存档 */
export async function importSave(file: File): Promise<GameState> {
  const s = parseSave(await file.text());
  s.id = uid('save');
  s.updatedAt = Date.now();
  await storage.save(s);
  return s;
}
