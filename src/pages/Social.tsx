import { Lock, Network, UserRound } from 'lucide-react';
import { useState } from 'react';
import { RelationGraph } from '../components/charts';
import { Button, Card, Chip, Empty, ResultCard, SectionTitle, StatBar } from '../components/ui';
import { interactionBlockReason, relationshipStatus } from '../game/engine';
import { INTERACTIONS, MOOD_LABEL, RELATION_LABEL, STAGE_META, affinityTier } from '../game/npcs';
import { dateParts, formatDate } from '../game/util';
import { useGame } from '../store';

export function Social() {
  const g = useGame();
  const s = g.state!;
  const met = s.npcs.filter((n) => n.met);
  const locked = s.npcs.length - met.length;
  const [sel, setSel] = useState<string>(met[0]?.id ?? '');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const npc = met.find((n) => n.id === sel) ?? met[0];
  const tier = npc ? affinityTier(npc.affinity) : null;
  const rel = npc ? relationshipStatus(s, npc.id) : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-black text-slate-50">社交圈</h1>
        <div className="flex gap-1 rounded-xl border border-white/10 p-1" role="tablist">
          <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')} className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs ${view === 'list' ? 'bg-white/10 text-white' : 'text-slate-400'}`}><UserRound className="h-3.5 w-3.5" />人物</button>
          <button role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')} className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs ${view === 'graph' ? 'bg-white/10 text-white' : 'text-slate-400'}`}><Network className="h-3.5 w-3.5" />关系网</button>
        </div>
      </div>

      {view === 'graph' && (
        <Card className="mb-5 p-4">
          <RelationGraph npcs={s.npcs} playerName={s.player.name} selectedId={npc?.id} onSelect={(id) => { setSel(id); setView('list'); }} />
          <p className="mt-1 text-center text-xs text-slate-500">实线粗细 = 与你的好感度；虚线 = 他们之间的关系。点击人物查看详情。</p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {met.map((n) => {
            const t = affinityTier(n.affinity);
            const on = n.id === npc?.id;
            return (
              <button key={n.id} onClick={() => setSel(n.id)} aria-pressed={on}
                className={`w-44 shrink-0 rounded-xl border p-3 text-left transition lg:w-auto ${on ? 'border-lantern-400/60 bg-lantern-400/[0.07]' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{n.avatar}</span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{n.name}</div>
                    <div className="truncate text-[11px] text-slate-400">{RELATION_LABEL[n.relation]} · {t.label}</div>
                  </div>
                </div>
                <div className="mt-2"><StatBar value={Math.max(0, n.affinity)} color={t.color} h="h-1.5" /></div>
              </button>
            );
          })}
          {locked > 0 && (
            <div className="flex w-44 shrink-0 items-center gap-2 rounded-xl border border-dashed border-white/10 p-3 text-xs text-slate-500 lg:w-auto">
              <Lock className="h-4 w-4" />还有 {locked} 位尚未结识。试试「行动 → 社交 → 结识新朋友」。
            </div>
          )}
        </div>

        {npc && tier ? (
          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-ink-700 text-4xl">{npc.avatar}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-2xl font-black text-slate-50">{npc.name}</h2>
                    <Chip color={tier.color}>{tier.label}</Chip>
                    {rel && <Chip color="#9a8cff">{STAGE_META[rel.stage].emoji} {rel.stageLabel}</Chip>}
                    {rel?.partner && <Chip color="#f2668b">恋人</Chip>}
                  </div>
                  <div className="text-sm text-slate-400">{npc.gender} · {npc.age} 岁 · {npc.role}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {npc.traits.map((t) => <Chip key={t}>{t}</Chip>)}
                    <Chip color="#7aa7ff">{MOOD_LABEL[npc.mood]}</Chip>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">{npc.background}</p>
              <div className="mt-2 text-xs text-slate-500">当前状态：{npc.status}</div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-400">好感度</span><span style={{ color: tier.color }}>{npc.affinity} / 100</span></div>
                <div className="relative"><StatBar value={Math.max(0, npc.affinity)} color={tier.color} /></div>
                {npc.affinity < 0 && <div className="mt-1 text-xs text-rose2-400">对方对你抱有负面印象（{npc.affinity}）。</div>}
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-400">信任</span><span className="text-jade-400">{npc.trust ?? 0} / 100</span></div>
                <StatBar value={Math.max(0, npc.trust ?? 0)} color="#3dd6a3" h="h-1.5" />
                <div className="mt-1 text-[11px] text-slate-500">信任来自守约、倾诉与按时还钱；关系阶段由好感度推导。</div>
              </div>
              {rel?.partner && <div className="mt-3 text-xs text-rose2-400">你们从第 {rel.partnerDay !== null ? rel.partnerDay + 1 : 1} 天起在一起。好感跌破 15 会分手。</div>}
              {rel?.romanceable && !rel.partner && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="rune" disabled={!rel.canConfess || !!s.pendingEvent} onClick={() => { if (window.confirm(`确定向${npc.name}表白吗？（消耗 2 行动点）`)) g.confess(npc.id); }}>表白</Button>
                  <span className="text-xs text-slate-500">{rel.canConfess ? '成功率与好感、魅力、信任有关' : `好感达到 50 才能表白（现在 ${Math.round(npc.affinity)}）`}</span>
                </div>
              )}
            </Card>

            {g.lastResult && <ResultCard result={g.lastResult} onClose={g.clearResult} />}

            <Card className="p-5">
              <SectionTitle>互动</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                {INTERACTIONS.map((it) => {
                  const reason = interactionBlockReason(s, npc, it.id);
                  return (
                    <div key={it.id}>
                      <Button className="w-full !justify-between !py-2.5" disabled={!!reason} onClick={() => g.npcInteract(npc.id, it.id)}>
                        <span>{it.label}</span><span className="text-xs text-slate-400">{it.ap} 点{it.money ? ` · ¥${it.money}` : ''}</span>
                      </Button>
                      <div className="mt-1 px-1 text-[11px] text-slate-500">{reason ?? it.desc}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle>共同记忆与互动记录</SectionTitle>
              {npc.memories.length === 0 ? <Empty>你们之间还没有留下什么故事。</Empty> : (
                <ul className="space-y-2">
                  {[...npc.memories].reverse().slice(0, 14).map((m, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: m.tone === 'good' ? '#3dd6a3' : m.tone === 'bad' ? '#e0446f' : '#8b90b3' }} />
                      <div><div className="text-slate-300">{m.text}</div><div className="text-[11px] text-slate-500">{formatDate(dateParts(s.startISO, m.day))}</div></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        ) : <Empty>你还没有认识任何人。</Empty>}
      </div>
    </div>
  );
}
