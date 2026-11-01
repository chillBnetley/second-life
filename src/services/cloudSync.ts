/**
 * 云存档同步核心（第四阶段）。
 *
 * 设计：
 *  - 本地优先：所有读写先走 localStorage（离线可用、写快），登录后后台**节流同步**到云端；
 *  - 只做「数据搬运与冲突判定」，不依赖 React 与 Supabase SDK（依赖通过参数注入，便于单测）；
 *  - 冲突判定用 `updatedAt`：默认较新者胜；两端都在上次同步后被修改则判为冲突，交由 UI 让玩家选择。
 */
import type { GameState } from '../game/types';
import type { SaveMeta, StorageAdapter } from './storage';

export interface SyncSnapshot {
  id: string;
  updatedAt: number;
  /** 上次成功同步时本地存档的 updatedAt（用于判断「两端都改过」） */
  syncedAt: number;
}

export interface ConflictInfo {
  saveId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolution: 'local-wins' | 'remote-wins' | 'conflict';
}

/** 判断单份存档是否存在冲突 */
export function detectConflict(local: GameState, remoteMeta: SaveMeta | null, syncedAt: number | null): ConflictInfo['resolution'] {
  if (!remoteMeta) return 'local-wins';
  if (local.updatedAt === remoteMeta.updatedAt) return 'local-wins';
  const last = syncedAt ?? 0;
  const localChanged = local.updatedAt > last;
  const remoteChanged = remoteMeta.updatedAt > last;
  if (localChanged && remoteChanged) return 'conflict';
  return local.updatedAt > remoteMeta.updatedAt ? 'local-wins' : 'remote-wins';
}

export type SyncState = 'offline' | 'idle' | 'syncing' | 'synced' | 'error';

export interface CloudSyncHooks {
  /** 状态变化（UI 徽标用） */
  onState?: (state: SyncState, detail?: string) => void;
  /** 检测到冲突时回调；返回 'local' | 'remote' | 'skip' */
  onConflict?: (info: ConflictInfo) => Promise<'local' | 'remote' | 'skip'>;
}

const SYNC_KEY = 'secondlife:cloud-sync:v1';

interface SyncBook { [saveId: string]: { syncedAt: number; remoteUpdatedAt: number } }

const hasStorage = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };

export function readBook(): SyncBook {
  if (!hasStorage()) return {};
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{}') as SyncBook; } catch { return {}; }
}

export function writeBook(book: SyncBook) {
  if (!hasStorage()) return;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(book)); } catch { /* 忽略配额错误 */ }
}

/**
 * 节流同步器：本地为主，登录后把变化推送到云端。
 * 依赖注入 local/remote 适配器，便于在没有 Supabase 的情况下测试。
 */
export class CloudSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();
  private running = false;
  private state: SyncState = 'idle';

  constructor(
    private local: StorageAdapter,
    private remote: StorageAdapter,
    private hooks: CloudSyncHooks = {},
    /** 节流间隔（毫秒）；测试里传 0 立即执行 */
    private debounceMs = 5000,
  ) {}

  getState(): SyncState { return this.state; }

  private setState(state: SyncState, detail?: string) {
    if (this.state === state && !detail) return;
    this.state = state;
    this.hooks.onState?.(state, detail);
  }

  /** 标记某份存档需要同步（离线时排队，恢复后重试） */
  queue(saveId: string) {
    this.pending.add(saveId);
    this.setState('syncing');
    if (this.timer) return;
    if (this.debounceMs <= 0) { void this.flush(); return; }
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.debounceMs);
  }

  /** 立即同步所有排队的存档 */
  async flush(): Promise<{ pushed: number; conflicts: number; failed: number }> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; } // 手动同步时取消已排定的节流任务
    if (this.running) return { pushed: 0, conflicts: 0, failed: 0 };
    this.running = true;
    let pushed = 0, conflicts = 0, failed = 0;
    try {
      const ids = [...this.pending];
      this.pending.clear();
      for (const id of ids) {
        try {
          const localState = await this.local.load(id);
          if (!localState) continue;
          const book = readBook();
          const syncedAt = book[id]?.syncedAt ?? null;
          const remoteMeta = (await this.remote.list()).find((m) => m.id === id) ?? null;
          const resolution = detectConflict(localState, remoteMeta, syncedAt);
          if (resolution === 'conflict') {
            conflicts++;
            const choice = await this.hooks.onConflict?.({
              saveId: id, localUpdatedAt: localState.updatedAt, remoteUpdatedAt: remoteMeta?.updatedAt ?? 0, resolution,
            });
            if (choice === 'remote') {
              const remoteState = await this.remote.load(id);
              if (remoteState) await this.local.save(remoteState);
              book[id] = { syncedAt: (remoteState ?? localState).updatedAt, remoteUpdatedAt: remoteMeta?.updatedAt ?? 0 };
              continue;
            }
            if (choice === 'skip') continue;
          } else if (resolution === 'remote-wins') {
            const remoteState = await this.remote.load(id);
            if (remoteState) await this.local.save(remoteState);
            book[id] = { syncedAt: (remoteState ?? localState).updatedAt, remoteUpdatedAt: remoteMeta?.updatedAt ?? 0 };
            writeBook(book);
            continue;
          }
          await this.remote.save(localState);
          book[id] = { syncedAt: localState.updatedAt, remoteUpdatedAt: localState.updatedAt };
          writeBook(book);
          pushed++;
        } catch (e) {
          failed++;
          this.pending.add(id); // 失败留在队列里，下次重试
          this.setState('error', (e as Error).message);
        }
      }
      if (failed) this.setState('error');
      else this.setState('synced');
    } finally {
      this.running = false;
    }
    return { pushed, conflicts, failed };
  }

  /** 首次登录：把本地全部存档上传（云端已有的跳过） */
  async bootstrap(): Promise<{ uploaded: number; pulled: number }> {
    const metas = await this.local.list();
    const remote = await this.remote.list();
    const remoteIds = new Set(remote.map((m) => m.id));
    let uploaded = 0, pulled = 0;
    const book = readBook();
    for (const m of metas) {
      if (remoteIds.has(m.id)) continue;
      const s = await this.local.load(m.id);
      if (!s) continue;
      await this.remote.save(s);
      book[m.id] = { syncedAt: s.updatedAt, remoteUpdatedAt: s.updatedAt };
      uploaded++;
    }
    // 云端有、本地没有的存档拉回本地（换设备场景）
    const localIds = new Set(metas.map((m) => m.id));
    for (const r of remote) {
      if (localIds.has(r.id)) continue;
      const s = await this.remote.load(r.id);
      if (!s) continue;
      await this.local.save(s);
      pulled++;
    }
    writeBook(book);
    this.setState('synced');
    return { uploaded, pulled };
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
