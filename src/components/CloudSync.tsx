import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CLOUD_CONFIGURED, connectCloud, getSessionUser, sendMagicLink, signOutCloud } from '../services/supabase';
import { getSyncState, onSyncState, syncNow } from '../services/storage';
import type { SyncState } from '../services/cloudSync';
import { Button, Card, SectionTitle } from './ui';

const STATE_LABEL: Record<SyncState, string> = {
  offline: '未连接云端', idle: '未登录', syncing: '同步中…', synced: '已同步', error: '同步失败',
};

/** 第四阶段：云端同步（登录 + 状态 + 手动同步）。未配置 Supabase 时只显示说明。 */
export function CloudSyncCard() {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [state, setState] = useState<SyncState>(getSyncState());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const u = await getSessionUser();
      setUser(u);
      if (u) await connectCloud();
      setState(getSyncState());
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!CLOUD_CONFIGURED) return;
    void refresh();
    return onSyncState((s) => setState(s));
  }, [refresh]);

  const login = async () => {
    if (!email.trim()) { setMsg({ kind: 'err', text: '请先填写邮箱。' }); return; }
    setBusy(true);
    const r = await sendMagicLink(email);
    setBusy(false);
    setMsg(r.ok
      ? { kind: 'ok', text: '登录链接已发送，请查收邮箱并点击链接；回到本页后会自动连接云端。' }
      : { kind: 'err', text: r.error ?? '发送失败。' });
  };

  const logout = async () => {
    if (!window.confirm('退出云端账号？本地存档不会被删除。')) return;
    setBusy(true);
    await signOutCloud();
    setUser(null);
    setState(getSyncState());
    setBusy(false);
    setMsg({ kind: 'info', text: '已退出云端账号，本地存档仍然可用。' });
  };

  const sync = async () => {
    setBusy(true);
    const r = await syncNow();
    setBusy(false);
    setState(getSyncState());
    setMsg({ kind: r && r.failed === 0 ? 'ok' : 'err', text: r ? `推送 ${r.pushed} 份，冲突 ${r.conflicts} 份，失败 ${r.failed} 份。` : '当前没有可同步的云端连接。' });
  };

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-display text-base font-semibold text-slate-100">
            <Cloud className="h-4 w-4 text-rune-300" />云端同步
            <span className="text-xs font-normal text-slate-500">可选</span>
          </div>
          {!CLOUD_CONFIGURED ? (
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              还没有配置云端。在 <code className="rounded bg-black/30 px-1">.env</code> 里填好{' '}
              <code className="rounded bg-black/30 px-1">VITE_SUPABASE_URL</code> 与{' '}
              <code className="rounded bg-black/30 px-1">VITE_SUPABASE_ANON_KEY</code>，并在 Supabase 里执行{' '}
              <code className="rounded bg-black/30 px-1">supabase/schema.sql</code>，重启开发服务器后即可登录同步（本地存档始终可用）。
            </p>
          ) : user ? (
            <div className="mt-1 text-sm text-slate-400">
              <div>已登录：<span className="text-slate-200">{user.email ?? user.id}</span></div>
              <div className="mt-0.5 text-xs">云端状态：{STATE_LABEL[state]}</div>
            </div>
          ) : (
            <div className="mt-1">
              <p className="text-sm text-slate-400">用邮箱登录后，存档会自动同步到云端；换设备也能继续。</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com"
                  aria-label="登录邮箱" className="w-56 rounded-lg border border-white/12 bg-ink-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600" />
                <Button variant="rune" disabled={busy} onClick={login}>发送登录链接</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />刷新状态</Button>
              </div>
            </div>
          )}
          {msg && (
            <div className={`mt-2 rounded-lg border p-2 text-xs ${msg.kind === 'ok' ? 'border-jade-400/40 bg-jade-400/10 text-jade-400' : msg.kind === 'err' ? 'border-rose2-400/40 bg-rose2-500/10 text-rose2-400' : 'border-white/15 bg-white/5 text-slate-300'}`}>{msg.text}</div>
          )}
        </div>
        {CLOUD_CONFIGURED && user && (
          <div className="flex shrink-0 flex-col gap-2">
            <Button variant="ghost" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={sync}><RefreshCw className="h-3.5 w-3.5" />立即同步</Button>
            <Button variant="danger" className="!px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void logout()}><LogOut className="h-3.5 w-3.5" />退出</Button>
          </div>
        )}
      </div>
      {CLOUD_CONFIGURED && <p className="mt-2 text-[11px] text-slate-500">本地优先：断网也能继续玩，恢复后自动重试。前端只使用匿名 anon key，数据由 Supabase RLS 保护。</p>}
    </Card>
  );
}
