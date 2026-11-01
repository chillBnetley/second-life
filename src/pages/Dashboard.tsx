import { Coins, Moon, ScrollText, Sparkles, Sunrise, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { LineChart, Radar } from '../components/charts';
import { ATTR_ICON, Button, Card, Chip, Modal, SectionTitle, StatBar } from '../components/ui';
import { ATTR_KEYS, ATTR_META } from '../game/content';
import { getAge, getJob, getStatusTags } from '../game/engine';
import { annualReviews } from '../game/review';
import { lifeStageFor, lifeScore } from '../game/life';
import { fmtMoney } from '../game/util';
import { useGame } from '../store';

const TONE = { good: '#3dd6a3', warn: '#f6c25b', bad: '#e0446f', neutral: '#9aa0c8' } as const;
const KIND_ICON: Record<string, string> = { action: '•', event: '⚡', social: '💬', work: '💼', finance: '💰', system: '🌙', achievement: '🏆' };

export function Dashboard({ go }: { go: (p: string) => void }) {
  const { state: s, endDay, dismissYearReview, dismissLifeEnd } = useGame();
  if (!s) return null;
  const p = s.player;
  const job = getJob(s);
  const recent = s.transactions.filter((t) => t.day > s.day - 30);
  const income = recent.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const spend = recent.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
  const curve = s.wealthHistory.slice(-45).map((w) => ({ x: w.day, y: w.money }));
  const logs = s.log.slice(-8).reverse();
  const done = Object.entries(s.todayCounts).filter(([, n]) => n);
  const LABEL: Record<string, string> = { study: '学习', work: '工作', exercise: '运动', social: '社交', entertainment: '娱乐', rest: '休息' };
  // 跨年后弹一次「年度回顾」：数据来自 review.ts 的纯函数，看过即清除标记
  const reviewYear = typeof s.flags.pendingReviewYear === 'number' ? s.flags.pendingReviewYear : null;
  const review = reviewYear !== null ? annualReviews(s).find((r) => r.year === reviewYear) ?? null : null;
  // 人生阶段与终局
  const stage = lifeStageFor(getAge(s));
  const ended = typeof s.flags.lifeEnded === 'number';
  const endSeen = typeof s.flags.lifeEndedSeen === 'number' && s.flags.lifeEndedSeen === s.flags.lifeEnded;
  const score = ended ? lifeScore(s) : null;

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lantern-500/15 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-black text-slate-50">{p.name}</h1>
            <div className="mt-1 text-sm text-slate-400">{getAge(s)} 岁 · 第 {s.day + 1} 天{job ? ` · ${job.name}` : ''}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip color="#9a8cff">{stage.emoji} {stage.label}</Chip>
              {getStatusTags(s).map((t) => <Chip key={t.label} color={TONE[t.tone]}>{t.label}</Chip>)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">今日行动点</div>
            <div className="font-display text-4xl font-black text-lantern-300">{s.ap}<span className="text-lg text-slate-500"> / {s.maxAp}</span></div>
            <div className="mt-1 flex justify-end gap-1">
              {Array.from({ length: s.maxAp }).map((_, i) => <span key={i} className={`h-1.5 w-5 rounded-full ${i < s.ap ? 'bg-lantern-400' : 'bg-white/10'}`} />)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="gold" onClick={() => go('/actions')}><Zap className="h-4 w-4" />去行动</Button>
          <Button variant="ghost" onClick={() => endDay()} disabled={!!s.pendingEvent}><Moon className="h-4 w-4" />结束今天</Button>
        </div>
        {done.length > 0 && (
          <div className="mt-3 text-xs text-slate-400">今天已做：{done.map(([k, n]) => `${LABEL[k] ?? k}×${n}`).join('、')}</div>
        )}
      </Card>

      {s.morningReport.length > 0 && (
        <Card className="border-rune-400/25 p-4">
          <SectionTitle icon={Sunrise}>今晨简报</SectionTitle>
          <ul className="space-y-1.5 text-sm text-slate-300">{s.morningReport.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Card>
      )}

      <section aria-label="人物属性" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ATTR_KEYS.map((k) => {
          const Icon = ATTR_ICON[k];
          const v = p.attrs[k];
          const low = (k === 'health' || k === 'happiness') && v < 30;
          return (
            <Card key={k} className={`p-4 ${low ? 'border-rose2-500/40' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm" style={{ color: ATTR_META[k].color }}><Icon className="h-4 w-4" />{ATTR_META[k].label}</span>
                <span className="font-display text-2xl font-black text-slate-50">{v}</span>
              </div>
              <div className="mt-2.5"><StatBar value={v} color={ATTR_META[k].color} /></div>
              <div className="mt-2 text-[11px] text-slate-500">{ATTR_META[k].desc}</div>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-5">
          <SectionTitle icon={Coins} right={<button onClick={() => go('/archive')} className="text-xs text-lantern-300 hover:underline">查看详情</button>}>财富</SectionTitle>
          <div className="font-display text-3xl font-black" style={{ color: p.money < 0 ? '#e0446f' : '#f6c25b' }}>{fmtMoney(p.money)}</div>
          <div className="mb-3 mt-1 flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-jade-400"><TrendingUp className="h-3.5 w-3.5" />近30天收入 {fmtMoney(income)}</span>
            <span className="flex items-center gap-1 text-rose2-400"><TrendingDown className="h-3.5 w-3.5" />支出 {fmtMoney(spend)}</span>
          </div>
          <LineChart data={curve} height={110} />
        </Card>
        <Card className="p-5">
          <SectionTitle>能力雷达</SectionTitle>
          <Radar attrs={p.attrs} size={220} />
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle icon={ScrollText} right={<button onClick={() => go('/archive')} className="text-xs text-lantern-300 hover:underline">完整时间线</button>}>最新事件</SectionTitle>
        <ul className="divide-y divide-white/5">
          {logs.map((l) => (
            <li key={l.id} className="flex gap-3 py-2.5">
              <span className="w-5 shrink-0 text-center">{KIND_ICON[l.kind]}</span>
              <div className="min-w-0">
                <div className={`text-sm ${l.importance >= 2 ? 'font-medium text-slate-100' : 'text-slate-300'}`}>{l.title}<span className="ml-2 text-[11px] font-normal text-slate-500">第 {l.day + 1} 天</span></div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{l.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {review && (
        <Modal onClose={() => dismissYearReview()} wide>
          <SectionTitle icon={Sparkles} right={<span className="text-xs text-slate-500">{review.days} 天 · 解锁 {review.achievements} 项成就</span>}>
            {review.year} 年度回顾
          </SectionTitle>
          <p className="text-sm leading-relaxed text-slate-300">{review.headline}。</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-white/10 p-3"><div className="text-xs text-slate-500">收入</div><div className="mt-1 font-semibold text-jade-400">{fmtMoney(review.income)}</div></div>
            <div className="rounded-xl border border-white/10 p-3"><div className="text-xs text-slate-500">支出</div><div className="mt-1 font-semibold text-rose2-400">{fmtMoney(-review.expense)}</div></div>
            <div className="rounded-xl border border-white/10 p-3"><div className="text-xs text-slate-500">结余</div><div className={`mt-1 font-semibold ${review.net >= 0 ? 'text-jade-400' : 'text-rose2-400'}`}>{review.net >= 0 ? '+' : ''}{fmtMoney(review.net)}</div></div>
          </div>
          {review.keyMoments.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs text-slate-500">这一年最重要的事</div>
              <div className="flex flex-wrap gap-1.5">{review.keyMoments.map((m) => <Chip key={m} color="#f6c25b">{m}</Chip>)}</div>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="gold" onClick={() => dismissYearReview()}>开始新的一年</Button>
          </div>
        </Modal>
      )}      {score && ended && !endSeen && (
        <Modal onClose={() => dismissLifeEnd()} wide>
          <SectionTitle icon={Sparkles} right={<span className="text-xs text-slate-500">人生评分</span>}>人生终局 · {score.title}</SectionTitle>
          <div className="mb-4 text-center">
            <div className="font-display text-5xl font-black text-lantern-300">{score.total}</div>
            <div className="mt-1 text-xs text-slate-500">满分 100</div>
          </div>
          <div className="space-y-2">
            {score.parts.map((p) => (
              <div key={p.label}>
                <div className="mb-0.5 flex justify-between text-xs"><span className="text-slate-300">{p.label}</span><span className="text-slate-400">{p.score} / {p.max}</span></div>
                <div className="h-1.5 rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full bg-gradient-to-r from-rune-500 to-lantern-400" style={{ width: `${Math.round((p.score / p.max) * 100)}%` }} />
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{p.detail}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">你走完了这一段人生，最终得到「{score.title}」的评价。分数只统计健康、能力、学识、事业、财富与关系，不代表唯一的活法。</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={() => { dismissLifeEnd(); go('/archive'); }}>查看完整人生档案</Button>
            <Button variant="gold" onClick={() => dismissLifeEnd()}>我知道了</Button>
          </div>
        </Modal>
      )}

    </div>
  );
}
