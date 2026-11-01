import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConflictInfo } from '../services/cloudSync';
import { onConflictRequest } from '../services/storage';
import { Button, Modal } from './ui';

const fmt = (ts: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '未知');

/**
 * 云同步冲突弹窗：同一份存档在本地与云端都被修改过时，让玩家选择保留哪一端。
 * 挂在 Layout 上，任何页面都可能弹出；30 秒无操作按「保留本地」处理（在 storage.ts 里兜底）。
 */
export function ConflictModal() {
  const [info, setInfo] = useState<ConflictInfo | null>(null);
  const resolver = useRef<((choice: 'local' | 'remote' | 'skip') => void) | null>(null);

  useEffect(() => onConflictRequest((next, resolve) => {
    setInfo(next);
    resolver.current = resolve;
  }), []);

  const pick = (choice: 'local' | 'remote' | 'skip') => {
    resolver.current?.(choice);
    resolver.current = null;
    setInfo(null);
  };

  if (!info) return null;
  return (
    <Modal onClose={() => pick('skip')} wide>
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-lantern-400" />
        <h2 className="font-display text-lg font-semibold text-slate-100">存档冲突</h2>
      </div>
      <p className="text-sm leading-relaxed text-slate-300">
        同一份存档在这台设备与云端都被修改过，需要你决定保留哪一份。选中的版本会覆盖另一端。
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-lantern-400/40 bg-lantern-400/5 p-3">
          <div className="text-xs text-slate-400">本地（这台设备）</div>
          <div className="mt-1 text-sm text-slate-200">{fmt(info.localUpdatedAt)}</div>
        </div>
        <div className="rounded-xl border border-rune-400/40 bg-rune-400/5 p-3">
          <div className="text-xs text-slate-400">云端</div>
          <div className="mt-1 text-sm text-slate-200">{fmt(info.remoteUpdatedAt)}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button onClick={() => pick('skip')}>稍后再说（本次跳过）</Button>
        <Button variant="rune" onClick={() => pick('remote')}>使用云端覆盖本地</Button>
        <Button variant="gold" onClick={() => pick('local')}>保留本地并上传</Button>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">不确定的话可以「稍后再说」，先导出本地存档备份，再重新打开页面处理。</p>
    </Modal>
  );
}
