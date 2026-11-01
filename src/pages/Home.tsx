import { Brain, Coins, Download, Play, Plus, Settings2, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AiSettings } from '../components/AiSettings';
import { CloudSyncCard } from '../components/CloudSync';
import { Onboarding, hasSeenOnboarding } from '../components/Onboarding';
import { Button, Card } from '../components/ui';
import { downloadSave, importSave, storage } from '../services/storage';
import type { SaveMeta } from '../services/storage';
import { useGame } from '../store';
import { fmtMoney } from '../game/util';

const FEATURES = [
  { icon: Brain, title: '六维成长', text: '智力、情商、体能、魅力、幸福感与健康，每一次选择都在塑造你。' },
  { icon: Coins, title: '真实的柴米油盐', text: '津贴、工资、房租与日常开销，把日子算明白才能过得好。' },
  { icon: Users, title: '有记忆的人们', text: '每个人都有性格与往事，他们会记得你做过的事。' },
];

export function Home({ go }: { go: (p: string) => void }) {
  const game = useGame();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [msg, setMsg] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(() => !hasSeenOnboarding());
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => storage.list().then(setSaves).catch(() => setSaves([]));
  useEffect(() => { refresh(); }, [game.state?.updatedAt]);

  const play = async (id: string) => { if (await game.loadGame(id)) go('/play'); };
  const del = async (m: SaveMeta) => {
    if (!window.confirm(`确定删除「${m.name}」的人生吗？此操作无法撤销。`)) return;
    await storage.remove(m.id);
    if (game.state?.id === m.id) game.closeGame();
    refresh();
  };
  const exp = async (id: string) => { const s = await storage.load(id); if (s) downloadSave(s); };
  const imp = async (f?: File) => {
    if (!f) return;
    try { const s = await importSave(f); game.adoptState(s); setMsg(`已导入「${s.player.name}」的存档`); refresh(); }
    catch (e) { setMsg((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 animate-float rounded-full bg-rune-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-64 h-80 w-80 animate-float rounded-full bg-lantern-500/15 blur-3xl [animation-delay:3s]" />

      <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-14 sm:pt-24">
        <p className="mb-4 text-sm text-lantern-300">十八岁，从零开始</p>
        <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight text-slate-50 sm:text-7xl">
          Second<br className="sm:hidden" /> <span className="bg-gradient-to-r from-lantern-300 via-lantern-500 to-rune-400 bg-clip-text text-transparent">Life</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
          一场由规则与想象共同驱动的人生模拟。你负责选择，世界负责回应：学业、工作、金钱、友情，以及那些没有标准答案的岔路口。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="gold" className="!px-6 !py-3 text-base" onClick={() => go('/create')}><Plus className="h-5 w-5" />开始新人生</Button>
          {saves[0] && <Button variant="ghost" className="!px-6 !py-3 text-base" onClick={() => play(saves[0].id)}><Play className="h-5 w-5" />继续「{saves[0].name}」</Button>}
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-4">
              <Icon className="mb-3 h-5 w-5 text-lantern-400" />
              <div className="font-display text-base font-semibold text-slate-100">{title}</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{text}</p>
            </Card>
          ))}
        </div>

        <Card className="mt-6 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-display text-base font-semibold text-slate-100">
                <Sparkles className="h-4 w-4 text-lantern-400" />AI 剧情引擎<span className="text-xs font-normal text-slate-500">可选</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">
                开启后，自由行动的理解、清晨事件与人物对话会由 AI 生成；没有 Key、断网、超时或内容不合规时会自动回落本地剧情，游戏不会卡住。
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                当前：{game.aiEnabled ? '已开启（每天有调用上限，连败会自动冷却）' : '已关闭，使用本地剧情'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => setAiSettingsOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" />AI 设置（填 API Key）
                </Button>
                <Button className="!px-3 !py-1.5 text-xs" onClick={() => go('/settings')}>更多设置</Button>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={game.aiEnabled}
              aria-label="启用 AI 剧情"
              onClick={game.toggleAi}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${game.aiEnabled ? 'border-jade-400/50 bg-jade-400/25' : 'border-white/15 bg-white/10'}`}
            >
              <span className={`absolute top-0.5 rounded-full bg-slate-100 transition-all ${game.aiEnabled ? 'left-[26px]' : 'left-0.5'}`} style={{ height: 22, width: 22 }} />
            </button>
          </div>
        </Card>

        <CloudSyncCard />

        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-slate-100">继续人生</h2>
            <div>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => imp(e.target.files?.[0])} />
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" />导入存档</Button>
            </div>
          </div>
          {msg && <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">{msg}</div>}
          {saves.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/12 p-8 text-center text-sm text-slate-500">还没有存档。点击「开始新人生」，写下你的第一天。</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {saves.map((m) => (
                <Card key={m.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-lg font-semibold text-slate-50">{m.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{m.age} 岁 · {m.dateLabel} · 第 {m.day + 1} 天</div>
                      <div className="mt-1 text-sm text-lantern-300">{fmtMoney(m.money)}</div>
                    </div>
                    <div className="flex gap-1">
                      <button aria-label="导出存档" onClick={() => exp(m.id)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><Download className="h-4 w-4" /></button>
                      <button aria-label="删除存档" onClick={() => del(m)} className="rounded-lg p-2 text-slate-400 hover:bg-rose2-500/15 hover:text-rose2-400"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <Button variant="rune" className="mt-3 w-full" onClick={() => play(m.id)}><Play className="h-4 w-4" />继续</Button>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {onboarding && <Onboarding onDone={() => setOnboarding(false)} />}

      {aiSettingsOpen && (
        <AiSettings
          onClose={() => setAiSettingsOpen(false)}
          onSaved={() => { if (!game.aiEnabled) game.toggleAi(); }}
        />
      )}
    </div>
  );
}
