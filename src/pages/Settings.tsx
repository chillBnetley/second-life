import { Download, Info, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, SectionTitle } from '../components/ui';
import { getSettings, saveSettings } from '../services/settings';
import { resetOnboarding } from '../components/Onboarding';
import { downloadSave, importSave, parseSave, storage } from '../services/storage';
import { useGame } from '../store';
import type { Settings as SettingsShape } from '../services/settings';

const VERSION = '0.1.0';

interface ToggleProps { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }
function Toggle({ label, desc, checked, onChange, disabled }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-white/8 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-100">{label}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{desc}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${checked ? 'border-jade-400/50 bg-jade-400/25' : 'border-white/15 bg-white/10'}`}>
        <span className={`absolute top-0.5 rounded-full bg-slate-100 transition-all ${checked ? 'left-[26px]' : 'left-0.5'}`} style={{ height: 22, width: 22 }} />
      </button>
    </div>
  );
}

export function Settings({ go }: { go: (p: string) => void }) {
  const game = useGame();
  const [cfg, setCfg] = useState<SettingsShape>(() => getSettings());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<SettingsShape>) => { setCfg(saveSettings(patch)); };

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', cfg.reduceMotion);
  }, [cfg.reduceMotion]);

  const exportAll = async () => {
    const metas = await storage.list();
    let n = 0;
    for (const m of metas) {
      const s = await storage.load(m.id);
      if (s) { downloadSave(s); n++; await new Promise((r) => setTimeout(r, 150)); }
    }
    setMsg({ kind: 'ok', text: n ? `已导出 ${n} 份存档（浏览器可能会提示下载多个文件）。` : '还没有存档可以导出。' });
  };

  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const raw = await f.text();
      const s = parseSave(raw);
      await importSave(f);
      game.adoptState(s);
      setMsg({ kind: 'ok', text: `已导入「${s.player.name}」的存档。` });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const clearAll = () => {
    if (!window.confirm('清除本机所有 Second Life 数据（存档 + 设置）？此操作无法撤销，建议先导出存档。')) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('secondlife:')) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
      game.closeGame();
      setMsg({ kind: 'ok', text: '已清除本机数据，正在返回首页…' });
      setTimeout(() => go('/'), 600);
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-1 pb-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-black text-slate-50">设置</h1>
        <Button onClick={() => go('/')}>返回首页</Button>
      </div>

      <Card className="p-5">
        <SectionTitle icon={Sparkles}>AI 剧情</SectionTitle>
        <Toggle label="启用 AI 剧情" disabled={!game.ready}
          desc="开启后自由行动、清晨事件与人物对话由 AI 生成；没有 Key、断网或内容不合规时自动回落本地剧情。API Key 在首页「AI 设置」里填写。"
          checked={game.aiEnabled} onChange={() => game.toggleAi()} />
      </Card>

      <Card className="p-5">
        <SectionTitle>体验</SectionTitle>
        <Toggle label="减少动画" desc="关闭漂浮光斑、弹窗弹出与数值过渡动画，也适合低配设备。"
          checked={cfg.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
        <Toggle label="音效（预留）" desc="音效系统尚未实现，这个开关先记录你的偏好。"
          checked={cfg.sfx} onChange={(v) => update({ sfx: v })} />
        <div className="mt-3 border-t border-white/8 pt-3">
          <Button onClick={() => { resetOnboarding(); go('/'); }}>重播新手引导</Button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>存档</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportAll()}><Download className="h-4 w-4" />导出全部存档</Button>
          <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />导入存档</Button>
          <Button variant="danger" onClick={clearAll}><Trash2 className="h-4 w-4" />清除本机数据</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
        {msg && <div className={`mt-3 rounded-lg border p-2 text-xs ${msg.kind === 'ok' ? 'border-jade-400/40 bg-jade-400/10 text-jade-400' : 'border-rose2-400/40 bg-rose2-500/10 text-rose2-400'}`}>{msg.text}</div>}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Info}>关于</SectionTitle>
        <ul className="space-y-1.5 text-sm text-slate-300">
          <li>Second Life · 第二人生模拟器 <span className="text-slate-500">v{VERSION}</span></li>
          <li className="text-xs text-slate-400">AI 只是「提议者」：所有数值由本地规则引擎裁决，AI 无法直接改钱、改属性或跳过限制。</li>
          <li className="text-xs text-slate-400">开启 AI 时，你在「自由行动」里输入的文字会发送给第三方 AI 服务（DeepSeek）用于生成剧情；不开启则完全离线。</li>
          <li className="text-xs text-slate-400">存档默认保存在本机浏览器；配置并登录云同步后才会写入你的 Supabase 项目。</li>
        </ul>
      </Card>
    </div>
  );
}
