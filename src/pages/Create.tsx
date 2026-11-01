import { ArrowLeft, Dices, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Radar } from '../components/charts';
import { Button, Card, Chip, SectionTitle } from '../components/ui';
import {
  ALLOCATION_MAX_EACH, ALLOCATION_POOL, ATTR_META, BACKGROUNDS, FEMALE_NAMES, HOBBIES, MALE_NAMES, PERSONALITIES,
} from '../game/content';
import { buildInitialAttrs } from '../game/engine';
import type { BackgroundKey, CreateInput, PersonalityKey } from '../game/types';
import { fmtMoney, pick } from '../game/util';
import { useGame } from '../store';

const ALLOC_KEYS = ['intelligence', 'eq', 'fitness', 'charm'] as const;

export function Create({ go }: { go: (p: string) => void }) {
  const game = useGame();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'男' | '女'>('女');
  const [personality, setPersonality] = useState<PersonalityKey>('extrovert');
  const [background, setBackground] = useState<BackgroundKey>('ordinary');
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [alloc, setAlloc] = useState<CreateInput['allocation']>({ intelligence: 0, eq: 0, fitness: 0, charm: 0 });
  const [err, setErr] = useState('');

  const used = ALLOC_KEYS.reduce((a, k) => a + alloc[k], 0);
  const left = ALLOCATION_POOL - used;
  const attrs = useMemo(() => buildInitialAttrs({ personality, background, allocation: alloc }), [personality, background, alloc]);
  const bg = BACKGROUNDS[background];

  const bump = (k: (typeof ALLOC_KEYS)[number], d: number) =>
    setAlloc((a) => {
      const v = a[k] + d;
      if (v < 0 || v > ALLOCATION_MAX_EACH || (d > 0 && left <= 0)) return a;
      return { ...a, [k]: v };
    });
  const toggleHobby = (h: string) => setHobbies((cur) => (cur.includes(h) ? cur.filter((x) => x !== h) : cur.length >= 3 ? cur : [...cur, h]));
  const rollName = () => setName(pick(gender === '女' ? FEMALE_NAMES : MALE_NAMES));

  const start = () => {
    if (!name.trim()) return setErr('给你的角色起个名字吧。');
    if (hobbies.length === 0) return setErr('至少选择一项兴趣爱好（最多 3 项）。');
    game.newGame({ name, gender, personality, background, hobbies, allocation: alloc });
    go('/play');
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <button onClick={() => go('/')} className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" />返回首页</button>
      <h1 className="font-display text-3xl font-black text-slate-50">创建你的角色</h1>
      <p className="mt-1 text-sm text-slate-400">出身与性格决定起点，但不决定终点。</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle>基本信息</SectionTitle>
            <label className="mb-1 block text-xs text-slate-400" htmlFor="name">姓名</label>
            <div className="flex gap-2">
              <input id="name" value={name} maxLength={12} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="最多 12 个字"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-ink-900 px-3 py-2 text-slate-100 placeholder:text-slate-600" />
              <Button onClick={rollName} aria-label="随机取名"><Dices className="h-4 w-4" />随机</Button>
            </div>
            <div className="mt-3 flex gap-2" role="radiogroup" aria-label="性别">
              {(['女', '男'] as const).map((g) => (
                <button key={g} role="radio" aria-checked={gender === g} onClick={() => setGender(g)}
                  className={`rounded-xl border px-5 py-1.5 text-sm transition ${gender === g ? 'border-lantern-400 bg-lantern-400/10 text-lantern-300' : 'border-white/12 text-slate-400 hover:text-white'}`}>{g}</button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>性格</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.entries(PERSONALITIES) as [PersonalityKey, (typeof PERSONALITIES)[PersonalityKey]][]).map(([k, p]) => (
                <button key={k} onClick={() => setPersonality(k)} aria-pressed={personality === k}
                  className={`rounded-xl border p-3 text-left transition ${personality === k ? 'border-lantern-400 bg-lantern-400/[0.08]' : 'border-white/10 hover:border-white/25'}`}>
                  <div className="font-medium text-slate-100">{p.emoji} {p.label}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{p.desc}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Object.entries(p.mods).map(([a, v]) => <Chip key={a} color={ATTR_META[a as keyof typeof ATTR_META].color}>{ATTR_META[a as keyof typeof ATTR_META].label} {v! > 0 ? '+' : ''}{v}</Chip>)}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>家庭背景</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.entries(BACKGROUNDS) as [BackgroundKey, (typeof BACKGROUNDS)[BackgroundKey]][]).map(([k, b]) => (
                <button key={k} onClick={() => setBackground(k)} aria-pressed={background === k}
                  className={`rounded-xl border p-3 text-left transition ${background === k ? 'border-lantern-400 bg-lantern-400/[0.08]' : 'border-white/10 hover:border-white/25'}`}>
                  <div className="font-medium text-slate-100">{b.emoji} {b.label}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{b.desc}</div>
                  <div className="mt-1.5 text-xs text-lantern-300">启动资金 {fmtMoney(b.money)} · 月津贴 {fmtMoney(b.allowance)}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-400">{hobbies.length}/3</span>}>兴趣爱好</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {HOBBIES.map((h) => (
                <button key={h} onClick={() => toggleHobby(h)} aria-pressed={hobbies.includes(h)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${hobbies.includes(h) ? 'border-lantern-400 bg-lantern-400/10 text-lantern-300' : 'border-white/12 text-slate-400 hover:text-white'}`}>{h}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">从事与爱好相符的活动时，会获得额外的幸福感。</p>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-sm text-lantern-300">可分配 {left} 点</span>}>初始属性</SectionTitle>
            <div className="space-y-3">
              {ALLOC_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <div className="w-14 text-sm" style={{ color: ATTR_META[k].color }}>{ATTR_META[k].label}</div>
                  <button aria-label={`减少${ATTR_META[k].label}`} onClick={() => bump(k, -1)} disabled={alloc[k] <= 0} className="rounded-lg border border-white/12 p-1.5 hover:bg-white/10 disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                  <div className="w-8 text-center text-slate-100">+{alloc[k]}</div>
                  <button aria-label={`增加${ATTR_META[k].label}`} onClick={() => bump(k, 1)} disabled={left <= 0 || alloc[k] >= ALLOCATION_MAX_EACH} className="rounded-lg border border-white/12 p-1.5 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                  <div className="ml-auto text-sm text-slate-300">{attrs[k]}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="text-center">
              <div className="font-display text-xl font-bold text-slate-50">{name.trim() || '未命名'}</div>
              <div className="text-xs text-slate-400">18 岁 · {PERSONALITIES[personality].label} · {bg.label}</div>
            </div>
            <div className="my-2"><Radar attrs={attrs} /></div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {(['happiness', 'health'] as const).map((k) => (
                <div key={k} className="flex justify-between"><span style={{ color: ATTR_META[k].color }}>{ATTR_META[k].label}</span><span>{attrs[k]}</span></div>
              ))}
              <div className="col-span-2 flex justify-between border-t border-white/10 pt-2"><span className="text-slate-400">启动资金</span><span className="text-lantern-300">{fmtMoney(bg.money)}</span></div>
            </div>
            {err && <div role="alert" className="mt-3 rounded-lg bg-rose2-500/10 px-3 py-2 text-sm text-rose2-400">{err}</div>}
            <Button variant="gold" className="mt-4 w-full !py-3" onClick={start}>踏入人生</Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
