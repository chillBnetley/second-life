import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Sparkles, Trash2, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { clearAiConfig, getAiConfig, saveAiConfig, testAiConnection } from '../services/aiConfig';
import type { AiConfigStatus } from '../services/aiConfig';
import { Button, Modal, SectionTitle } from './ui';

type Busy = null | 'save' | 'test' | 'clear' | 'refresh';

/**
 * 网页内 AI 设置：填入 API Key 即可使用，不再需要手改 .env。
 * key 只会发给本机代理并保存在 `.ai-config.json`，不会进入前端包 / 存档 / localStorage。
 */
export function AiSettings({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [status, setStatus] = useState<AiConfigStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    const s = await getAiConfig();
    setStatus(s);
    if (s.reachable && s.model) setModel(s.model);
    setBusy(null);
    return s;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy('save');
    setMessage(null);
    const r = await saveAiConfig(apiKey, model);
    setBusy(null);
    if (!r.ok) { setMessage({ kind: 'err', text: r.error ?? '保存失败。' }); return; }
    setApiKey('');
    if (r.status) setStatus(r.status);
    setMessage({ kind: 'ok', text: '已保存到本机代理，现在可以直接使用 AI 了。' });
    onSaved?.();
  };

  const test = async () => {
    setBusy('test');
    setMessage(null);
    const r = await testAiConnection();
    setBusy(null);
    setMessage({ kind: r.ok ? 'ok' : 'err', text: r.message });
  };

  const clear = async () => {
    if (!window.confirm('清除网页里保存的 API Key？如果 .env 里配置了 key，会继续使用 .env 的配置。')) return;
    setBusy('clear');
    setMessage(null);
    const r = await clearAiConfig();
    setBusy(null);
    if (!r.ok) { setMessage({ kind: 'err', text: r.error ?? '清除失败。' }); return; }
    if (r.status) setStatus(r.status);
    setMessage({ kind: 'info', text: '已清除网页保存的配置。' });
  };

  const unreachable = status !== null && !status.reachable;
  const configured = !!status?.configured;

  return (
    <Modal onClose={onClose}>
      <SectionTitle icon={Sparkles} right={
        <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
      }>AI 设置</SectionTitle>

      {/* 状态行 */}
      <div className={`mb-4 rounded-xl border p-3 text-sm ${unreachable ? 'border-rose2-400/40 bg-rose2-500/10 text-rose2-400' : configured ? 'border-jade-400/40 bg-jade-400/10 text-jade-400' : 'border-lantern-400/30 bg-lantern-400/10 text-lantern-300'}`}>
        {unreachable ? (
          <div className="flex items-start gap-2">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">连不上本机 AI 代理</div>
              <div className="mt-1 text-xs text-slate-400">请在项目目录运行 <code className="rounded bg-black/30 px-1">npm.cmd run server</code>（PowerShell 若提示禁止运行脚本），保持窗口开着后点刷新。</div>
            </div>
          </div>
        ) : configured ? (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">AI 已配置 · 模型 {status?.model}</div>
              <div className="mt-1 text-xs text-slate-400">
                来源：{status?.source === 'runtime' ? '网页设置（保存在本机 .ai-config.json）' : '.env 文件'}
                {status?.keyHint ? ` · Key ${status.keyHint}` : ''}
                {typeof status?.callsLeft === 'number' ? ` · 今日剩余 ${status.callsLeft} 次调用` : ''}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">代理在线，但还没有配置 API Key</div>
              <div className="mt-1 text-xs text-slate-400">在下面填入你的 DeepSeek API Key 并保存即可，不需要修改任何文件。</div>
            </div>
          </div>
        )}
      </div>

      {/* 表单 */}
      <label className="mb-1 block text-xs text-slate-400" htmlFor="ai-key"><KeyRound className="mr-1 inline h-3.5 w-3.5" />DeepSeek API Key</label>
      <input
        id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false}
        placeholder={configured ? '已配置；如需更换请粘贴新的 key' : 'sk-...'}
        className="w-full rounded-xl border border-white/12 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
      />
      <div className="mt-3 flex items-center gap-3">
        <label className="text-xs text-slate-400" htmlFor="ai-model">模型</label>
        <input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false}
          className="w-48 rounded-lg border border-white/12 bg-ink-900 px-2 py-1.5 text-sm text-slate-100" />
        <span className="text-[11px] text-slate-500">默认 deepseek-chat</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="gold" onClick={save} disabled={busy !== null || !apiKey.trim()}>{busy === 'save' ? '保存中…' : '保存并使用'}</Button>
        <Button variant="rune" onClick={test} disabled={busy !== null}>{busy === 'test' ? '测试中…' : '测试连接'}</Button>
        <Button variant="ghost" onClick={() => void refresh()} disabled={busy !== null}><RefreshCw className="h-4 w-4" />刷新状态</Button>
        {configured && status?.source === 'runtime' && (
          <Button variant="danger" onClick={clear} disabled={busy !== null}><Trash2 className="h-4 w-4" />清除网页配置</Button>
        )}
      </div>

      {message && (
        <div className={`mt-3 rounded-lg border p-2.5 text-xs ${message.kind === 'ok' ? 'border-jade-400/40 bg-jade-400/10 text-jade-400' : message.kind === 'err' ? 'border-rose2-400/40 bg-rose2-500/10 text-rose2-400' : 'border-white/15 bg-white/5 text-slate-300'}`}>
          {message.text}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        安全说明：Key 只发送给本机运行的 AI 代理，并保存在项目根目录的 <code className="rounded bg-black/30 px-1">.ai-config.json</code>（已加入 .gitignore），
        不会写入浏览器存档、不会进入打包产物、也不会回传给网页。也可以继续用 <code className="rounded bg-black/30 px-1">.env</code> 配置，网页配置优先。
        「测试连接」会发起一次很小的真实请求（约几十 token）。
      </p>
    </Modal>
  );
}
