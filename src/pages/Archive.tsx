import { Download, Lock } from 'lucide-react';
import { useState } from 'react';
import { LineChart } from '../components/charts';
import { Button, Card, Chip, Empty, SectionTitle } from '../components/ui';
import { ACHIEVEMENTS, ATTR_KEYS, ATTR_META } from '../game/content';
import { lifeSummary } from '../game/engine';
import { monthlyStatement, netWorth } from '../game/finance';
import { achievementProgress, annualReviews } from '../game/review';
import { lifeScore } from '../game/life';
import { dateParts, formatDate, fmtMoney } from '../game/util';
import { downloadSave } from '../services/storage';
import { useGame } from '../store';

type Tab = 'timeline' | 'yearly' | 'threads' | 'wealth' | 'attrs' | 'achievements' | 'summary';
const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: '人生时间线' }, { id: 'yearly', label: '年度回顾' }, { id: 'threads', label: '剧情线' }, { id: 'wealth', label: '财富变化' }, { id: 'attrs', label: '属性变化' }, { id: 'achievements', label: '成就' }, { id: 'summary', label: '人生总结' },
];
const KIND: Record<string, string> = { action: '行动', event: '事件', social: '社交', work: '工作', finance: '财务', system: '系统', achievement: '成就' };
const KIND_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'event', label: '事件' }, { id: 'social', label: '社交' }, { id: 'work', label: '工作' }, { id: 'finance', label: '财务' },
];
/** 成就分类（仅用于档案页展示，不改变成就本身的数据结构） */
const ACH_CATEGORY: Record<string, string> = {
  first_savings: '财富', rich: '财富', savings_50k: '财富', invest_profit: '财富', first_invest: '财富',
  scholar: '学业', one_year: '生活', iron_body: '生活', bright_mind: '学业', charmer: '关系', joyful: '生活',
  friends5: '关系', bestie: '关系', everyone: '关系', first_job: '事业', salary_man: '事业',
  first_promotion: '事业', promoted3: '事业', perf_90: '事业', survived_layoff: '事业',
  first_asset: '生活', all_assets: '生活', in_debt: '隐藏',
  day_100: '生活', money_100k: '财富', savings_10k: '财富', skill_100: '事业',
  first_loan: '财富', loan_free: '财富', in_love: '关系', heartbreak: '关系', seasoned: '生活',
  work_365: '事业', asset_3: '生活', invest_3: '财富', loan_3: '财富', knowledge_200: '学业', fitness_90: '生活',
};

export function Archive() {
  const { state: s } = useGame();
  const [tab, setTab] = useState<Tab>('timeline');
  const [onlyKey, setOnlyKey] = useState(true);
  const [kind, setKind] = useState('all');
  if (!s) return null;

  const logs = [...s.log].reverse()
    .filter((l) => (onlyKey ? l.importance >= 2 : true) && (kind === 'all' || l.kind === kind))
    .slice(0, 160);
  // 时间线按年份分组（新的在上）
  const byYear = new Map<number, typeof logs>();
  for (const l of logs) {
    const y = dateParts(s.startISO, l.day).y;
    const arr = byYear.get(y) ?? [];
    arr.push(l);
    byYear.set(y, arr);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const reviews = annualReviews(s);
  const hist = s.wealthHistory;
  const step = Math.max(1, Math.ceil(hist.length / 240));
  const curve = hist.filter((_, i) => i % step === 0 || i === hist.length - 1).map((w) => ({ x: w.day, y: w.money }));
  const spendBy: Record<string, number> = {};
  for (const t of s.transactions) if (t.amount < 0) spendBy[t.category] = (spendBy[t.category] ?? 0) - t.amount;
  const spendList = Object.entries(spendBy).sort((a, b) => b[1] - a[1]);
  const maxSpend = spendList[0]?.[1] ?? 1;
  const sum = lifeSummary(s);
  const score = lifeScore(s);
  const worth = netWorth(s);
  const months = monthlyStatement(s.transactions, s.startISO, 8);

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-black text-slate-50">人生档案</h1>
      <div role="tablist" className="scroll-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${tab === t.id ? 'border-lantern-400 bg-lantern-400/12 text-lantern-300' : 'border-white/12 text-slate-400 hover:text-white'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'timeline' && (
        <Card className="p-5">
          <SectionTitle right={
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} className="accent-amber-400" />只看重要事件
            </label>}>时间线</SectionTitle>
          <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="按类别筛选">
            {KIND_FILTERS.map((k) => (
              <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
                className={`rounded-full border px-3 py-1 text-xs transition ${kind === k.id ? 'border-lantern-400/60 text-lantern-300' : 'border-white/10 text-slate-500 hover:text-slate-200'}`}>{k.label}</button>
            ))}
          </div>
          {logs.length === 0 ? <Empty>还没有值得记录的事件。</Empty> : (
            <div className="space-y-6">
              {years.map((y) => (
                <div key={y}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-lantern-300">{y} 年</h3>
                    <span className="text-[11px] text-slate-500">{byYear.get(y)?.length ?? 0} 条记录</span>
                  </div>
                  <ol className="relative ml-2 border-l border-white/10">
                    {(byYear.get(y) ?? []).map((l) => (
                      <li key={l.id} className="relative pb-5 pl-5 last:pb-0">
                        <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${l.importance === 3 ? 'bg-lantern-400 shadow-[0_0_10px_#f6c25b]' : l.importance === 2 ? 'bg-rune-400' : 'bg-slate-600'}`} />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-100">{l.title}</span>
                          <Chip>{KIND[l.kind]}</Chip>
                          <span className="text-[11px] text-slate-500">{formatDate(dateParts(s.startISO, l.day))}</span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{l.text}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'yearly' && (
        reviews.length === 0 ? <Empty>还没有足够的数据生成年度回顾。先过完这一年吧。</Empty> : (
          <div className="space-y-4">
            {[...reviews].reverse().map((r) => (
              <Card key={r.year} className="p-5">
                <SectionTitle right={<span className="text-xs text-slate-500">{r.days} 天 · 解锁 {r.achievements} 项成就</span>}>{r.year} 年度回顾</SectionTitle>
                <p className="mb-3 text-sm text-slate-300">{r.headline}。</p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><div className="text-xs text-slate-500">收入</div><div className="mt-1 font-semibold text-jade-400">{fmtMoney(r.income)}</div></div>
                  <div><div className="text-xs text-slate-500">支出</div><div className="mt-1 font-semibold text-rose2-400">{fmtMoney(-r.expense)}</div></div>
                  <div><div className="text-xs text-slate-500">结余</div><div className={`mt-1 font-semibold ${r.net >= 0 ? 'text-jade-400' : 'text-rose2-400'}`}>{r.net >= 0 ? '+' : ''}{fmtMoney(r.net)}</div></div>
                </div>
                {r.keyMoments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {r.keyMoments.map((m) => <Chip key={m} color="#f6c25b">{m}</Chip>)}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'threads' && (
        <Card className="p-5">
          <SectionTitle right={<span className="text-xs text-slate-500">{s.storyThreads.filter((t) => t.status === 'open').length} 条进行中</span>}>剧情线</SectionTitle>
          {s.storyThreads.length === 0 ? (
            <Empty>还没有形成长期剧情线。做一些重要的抉择，它们会在这里留下痕迹。</Empty>
          ) : (
            <ul className="space-y-3">
              {[...s.storyThreads].sort((a, b) => b.lastDay - a.lastDay).map((t) => (
                <li key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{t.title}</span>
                    <Chip>{t.status === 'open' ? '进行中' : '已结束'}</Chip>
                    <span className="ml-auto text-[11px] text-slate-500">更新于第 {t.lastDay + 1} 天</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.summary || '暂无记录'}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'wealth' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: '当前财富', v: fmtMoney(s.player.money), c: s.player.money < 0 ? '#e0446f' : '#f6c25b' },
              { l: '累计收入', v: fmtMoney(s.stats.totalEarned), c: '#3dd6a3' },
              { l: '累计支出', v: fmtMoney(s.stats.totalSpent), c: '#e0446f' },
              { l: '工作天数', v: `${s.player.workDays} 天`, c: '#7aa7ff' },
            ].map((x) => (
              <Card key={x.l} className="p-4"><div className="text-xs text-slate-400">{x.l}</div><div className="mt-1 font-display text-xl font-black" style={{ color: x.c }}>{x.v}</div></Card>
            ))}
          </div>
          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-500">现金 + 储蓄 + 理财 - 借款</span>}>净资产</SectionTitle>
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
              <div><div className="text-xs text-slate-500">现金</div><div className="mt-1 font-semibold" style={{ color: worth.cash < 0 ? '#e0446f' : '#f6c25b' }}>{fmtMoney(worth.cash)}</div></div>
              <div><div className="text-xs text-slate-500">储蓄</div><div className="mt-1 font-semibold text-jade-400">{fmtMoney(worth.savings)}</div></div>
              <div><div className="text-xs text-slate-500">理财</div><div className="mt-1 font-semibold text-rune-300">{fmtMoney(worth.investments)}</div></div>
              <div><div className="text-xs text-slate-500">未还借款</div><div className="mt-1 font-semibold text-rose2-400">{fmtMoney(worth.debt)}</div></div>
              <div><div className="text-xs text-slate-500">合计</div><div className="mt-1 font-display text-lg font-black" style={{ color: worth.total < 0 ? '#e0446f' : '#f6c25b' }}>{fmtMoney(worth.total)}</div></div>
            </div>
          </Card>
          <Card className="p-5">
            <SectionTitle>月度收支</SectionTitle>
            {months.length === 0 ? <Empty>还没有完整的月度记录。</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2 font-normal">月份</th><th className="pb-2 text-right font-normal">收入</th><th className="pb-2 text-right font-normal">支出</th><th className="pb-2 text-right font-normal">结余</th></tr></thead>
                  <tbody>
                    {[...months].reverse().map((m) => (
                      <tr key={m.key} className="border-t border-white/5">
                        <td className="py-2 text-slate-300">{m.label}</td>
                        <td className="py-2 text-right text-jade-400">{fmtMoney(m.income)}</td>
                        <td className="py-2 text-right text-rose2-400">{fmtMoney(-m.expense)}</td>
                        <td className={`py-2 text-right font-medium ${m.net >= 0 ? 'text-jade-400' : 'text-rose2-400'}`}>{m.net >= 0 ? '+' : ''}{fmtMoney(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card className="p-5"><SectionTitle>财富曲线</SectionTitle><LineChart data={curve} height={180} /></Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <SectionTitle>支出构成</SectionTitle>
              {spendList.length === 0 ? <Empty>还没有支出记录。</Empty> : (
                <div className="space-y-2.5">
                  {spendList.map(([cat, v]) => (
                    <div key={cat}>
                      <div className="mb-1 flex justify-between text-xs"><span className="text-slate-300">{cat}</span><span className="text-slate-400">{fmtMoney(v)}</span></div>
                      <div className="h-1.5 rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-rune-500 to-lantern-400" style={{ width: `${(v / maxSpend) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <SectionTitle>最近收支</SectionTitle>
              {s.transactions.length === 0 ? <Empty>暂无记录。</Empty> : (
                <ul className="divide-y divide-white/5">
                  {[...s.transactions].reverse().slice(0, 12).map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0"><div className="truncate text-slate-200">{t.note}</div><div className="text-[11px] text-slate-500">第 {t.day + 1} 天 · {t.category}</div></div>
                      <span className={t.amount > 0 ? 'text-jade-400' : 'text-rose2-400'}>{t.amount > 0 ? '+' : ''}{fmtMoney(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'attrs' && (
        <Card className="p-5">
          <SectionTitle right={<span className="text-xs text-slate-500">{s.attrHistory.length} 个周快照</span>}>六维变化</SectionTitle>
          {s.attrHistory.length < 2 ? <Empty>还需要至少两周的数据才能画出变化曲线。</Empty> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {ATTR_KEYS.map((k) => {
                const series = s.attrHistory.map((h) => ({ x: h.day, y: h.attrs[k] }));
                const first = series[0].y;
                const last = series[series.length - 1].y;
                const delta = last - first;
                return (
                  <div key={k} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-slate-300">{ATTR_META[k].label}</span>
                      <span style={{ color: delta >= 0 ? '#3dd6a3' : '#e0446f' }}>{delta >= 0 ? '+' : ''}{delta}</span>
                    </div>
                    <LineChart data={series} color={ATTR_META[k].color} height={90} />
                    <div className="mt-1 text-[11px] text-slate-500">{first} → {last}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'achievements' && (
        <div>
          <div className="mb-3 text-sm text-slate-400">已解锁 {Object.keys(s.achievements).length} / {ACHIEVEMENTS.length}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACHIEVEMENTS.map((a) => {
              const day = s.achievements[a.id];
              const got = day !== undefined;
              const prog = achievementProgress(s, a.id);
              const cat = ACH_CATEGORY[a.id];
              return (
                <Card key={a.id} className={`p-4 ${got ? 'border-lantern-400/30' : 'opacity-80'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${got ? 'bg-lantern-400/15' : 'bg-white/5'}`}>{got ? a.icon : <Lock className="h-4 w-4 text-slate-500" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-100">{a.name}</span>
                        {cat && <Chip>{cat}</Chip>}
                      </div>
                      <div className="text-xs text-slate-400">{a.desc}</div>
                      {got && <div className="mt-0.5 text-[11px] text-lantern-300">第 {day + 1} 天达成</div>}
                      {!got && prog && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-white/[0.07]">
                            <div className="h-full rounded-full bg-gradient-to-r from-rune-500 to-lantern-400" style={{ width: `${Math.round((prog[0] / Math.max(1, prog[1])) * 100)}%` }} />
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">{prog[0].toLocaleString('zh-CN')} / {prog[1].toLocaleString('zh-CN')}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-4">
          <Card className="p-6">
            <SectionTitle right={<span className="text-xs text-slate-500">健康 / 能力 / 学识 / 事业 / 财富 / 关系</span>}>
              人生评分{typeof s.flags.lifeEnded === 'number' ? ' · 终局' : ' · 当前'}
            </SectionTitle>
            <div className="flex items-end gap-3">
              <div className="font-display text-5xl font-black text-lantern-300">{score.total}</div>
              <div className="pb-1.5 text-sm text-slate-400">/ 100 · {score.title}</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {score.parts.map((p) => (
                <div key={p.label}>
                  <div className="mb-1 flex justify-between text-xs"><span className="text-slate-300">{p.label}</span><span className="text-slate-400">{p.score} / {p.max}</span></div>
                  <div className="h-1.5 rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-gradient-to-r from-rune-500 to-lantern-400" style={{ width: `${Math.round((p.score / p.max) * 100)}%` }} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{p.detail}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <div className="text-xs text-slate-400">你的称号</div>
            <h2 className="font-display text-3xl font-black text-lantern-300">{sum.title}</h2>
            <div className="mt-4 space-y-2 text-[15px] leading-relaxed text-slate-300">{sum.lines.map((l, i) => <p key={i}>{l}</p>)}</div>
            <p className="mt-4 text-xs text-slate-500">人生还在继续，总结会随着你的选择而改写。</p>
            <Button className="mt-5" onClick={() => downloadSave(s)}><Download className="h-4 w-4" />导出存档（JSON）</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
