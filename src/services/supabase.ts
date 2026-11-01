/**
 * 第四阶段：Supabase 账号与云存档（前端只使用 anon key；安全依赖 RLS，见 supabase/schema.sql）。
 * 未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 时全部降级为不可用，不影响单机玩法。
 */
import type { GameState } from '../game/types';
import type { SaveMeta, StorageAdapter } from './storage';
import { metaOf, parseSave, attachRemoteStorage, detachRemoteStorage, syncNow, getSyncState, onSyncState } from './storage';

export const SUPABASE_URL = (() => { try { return import.meta.env?.VITE_SUPABASE_URL ?? ''; } catch { return ''; } })();
export const SUPABASE_ANON_KEY = (() => { try { return import.meta.env?.VITE_SUPABASE_ANON_KEY ?? ''; } catch { return ''; } })();
export const CLOUD_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** 极简客户端接口，便于在没有真实 SDK 的环境里替换/测试 */
export interface SupabaseLike {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string; email?: string } } | null } }>;
    signInWithOtp(a: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error: { message: string } | null }>;
    signOut(): Promise<unknown>;
    onAuthStateChange(cb: (event: string, session: unknown) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

let clientPromise: Promise<SupabaseLike | null> | null = null;
export async function getSupabase(): Promise<SupabaseLike | null> {
  if (!CLOUD_CONFIGURED) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY) as unknown as SupabaseLike);
  }
  return clientPromise;
}

export async function getSessionUser(): Promise<{ id: string; email?: string } | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await getSupabase();
  if (!sb) return { ok: false, error: '云端未配置（需要 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。' };
  const redirect = typeof location !== 'undefined' ? location.origin + location.pathname : undefined;
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOutCloud(): Promise<void> {
  const sb = await getSupabase();
  detachRemoteStorage();
  if (sb) await sb.auth.signOut();
}

/** 映射 public.saves 表 */
export class SupabaseStorage implements StorageAdapter {
  constructor(private sb: SupabaseLike, private userId: string) {}

  async list(): Promise<SaveMeta[]> {
    const { data, error } = await this.sb.from('saves').select('id, meta, updated_at').eq('user_id', this.userId).order('updated_at', { ascending: false });
    if (error) throw new Error(`云端读取存档列表失败：${error.message}`);
    return ((data ?? []) as { meta: SaveMeta }[]).map((r) => r.meta);
  }

  async load(id: string): Promise<GameState | null> {
    const { data, error } = await this.sb.from('saves').select('data').eq('id', id).eq('user_id', this.userId).maybeSingle();
    if (error) throw new Error(`云端读取存档失败：${error.message}`);
    const row = data as { data?: unknown } | null;
    if (!row?.data) return null;
    try { return parseSave(JSON.stringify(row.data)); } catch { return null; }
  }

  async save(state: GameState): Promise<void> {
    const { error } = await this.sb.from('saves').upsert({
      id: state.id, user_id: this.userId, meta: metaOf(state), data: state,
      version: state.version, updated_at: new Date(state.updatedAt).toISOString(),
    });
    if (error) throw new Error(`云端保存失败：${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.sb.from('saves').delete().eq('id', id).eq('user_id', this.userId);
    if (error) throw new Error(`云端删除失败：${error.message}`);
  }

  async getLastId(): Promise<string | null> {
    const { data } = await this.sb.from('profiles').select('last_save_id').eq('id', this.userId).maybeSingle();
    return (data as { last_save_id?: string | null } | null)?.last_save_id ?? null;
  }

  async setLastId(id: string): Promise<void> {
    await this.sb.from('profiles').upsert({ id: this.userId, last_save_id: id, updated_at: new Date().toISOString() });
  }
}

/** 登录后连接云端并做首次双向补齐 */
export async function connectCloud(): Promise<{ uploaded: number; pulled: number } | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const user = await getSessionUser();
  if (!user) return null;
  return attachRemoteStorage(new SupabaseStorage(sb, user.id));
}

/** 应用启动时自动恢复（已登录则连接） */
export async function resumeCloud(): Promise<boolean> {
  if (!CLOUD_CONFIGURED) return false;
  const user = await getSessionUser();
  if (!user) return false;
  await connectCloud();
  return true;
}

export { getSyncState, onSyncState, syncNow };
