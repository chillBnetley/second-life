import { Briefcase, Send, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Chip, ResultCard, SectionTitle } from '../components/ui';
import { ACTIVITIES, ASSETS, ATTR_KEYS, ATTR_META, DEFAULT_HOUSING, HOUSINGS, INVESTMENT_PRODUCTS, JOBS, SKILL_KEYS, SKILL_META, TRACK_META, housingOf, moveCostOf, unmetRequirements } from '../game/content';
import type { Activity } from '../game/content';
import { activityBlockReason, bankLoanRate, careerStatus, getDate, getJob, loanLimit } from '../game/engine';
import type { ActivityCategory } from '../game/types';
import type { HousingId } from '../game/types';
import { fmtMoney, isWeekend } from '../game/util';
import { useGame } from '../store';

type Tab = ActivityCategory | 'free' | 'money';
const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'study', label: '学习', emoji: '📖' }, { id: 'work', label: '工作', emoji: '💼' }, { id: 'exercise', label: '运动', emoji: '🏃' },
  { id: 'social', label: '社交', emoji: '🗣️' }, { id: 'entertainment', label: '娱乐', emoji: '🎮' }, { id: 'rest', label: '休息', emoji: '🛌' },
  { id: 'money', label: '理财', emoji: '🏦' }, { id: 'free', label: '自由行动', emoji: '✍️' },
];
const EXAMPLES = ['去图书馆复习 3 小时', '花 200 元请朋友吃饭', '傍晚去公园跑步', '在家追剧放松一下', '花 300 块买本专业书认真读'];

const range = (v: number) => {
  const a = Math.abs(v), lo = Math.floor(a), hi = Math.ceil(a), sg = v < 0 ? '-' : '+';
  return lo === hi ? `${sg}${lo}` : lo === 0 ? `${sg}0~${hi}` : `${sg}${lo}~${hi}`;
};

function Row({ title, desc, ap, money, chips, disabledReason, onClick, label = '执行' }: {
  title: string; desc: string; ap: number; money?: number; chips?: ReactNode; disabledReason: string | null; onClick: () => void; label?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100">{title}</span>
            <Chip color="#f6c25b">{ap} 行动点</Chip>
            {!!money && <Chip color="#e0446f">{fmtMoney(money)}</Chip>}
          </div>
          <p className="mt-1 text-xs text-slate-400">{desc}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>
        </div>
        <Button variant="rune" className="shrink-0 !px-4" disabled={!!disabledReason} onClick={onClick}>{label}</Button>
      </div>
      {disabledReason && <div className="mt-2 text-xs text-rose2-400">{disabledReason}</div>}
    </Card>
  );
}

function effectChips(a: Activity) {
  const out: ReactNode[] = [];
  for (const k of ATTR_KEYS) {
    const v = a.effects.attrs?.[k];
    if (v) out.push(<Chip key={k} color={v > 0 ? ATTR_META[k].color : '#e0446f'}>{ATTR_META[k].label} {range(v)}</Chip>);
  }
  if (a.effects.knowledge) out.push(<Chip key="kn" color="#7aa7ff">学识 +{a.effects.knowledge}</Chip>);
  if (a.special === 'meet') out.push(<Chip key="meet" color="#f58fb4">可能结识新人物</Chip>);
  return out;
}

export function Actions() {
  const g = useGame();
  const s = g.state!;
  const [tab, setTab] = useState<Tab>('study');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('500');
  const [loanAmount, setLoanAmount] = useState('5000');
  const [busy, setBusy] = useState(false);
  const job = getJob(s);
  const career = careerStatus(s);
  const weekend = isWeekend(getDate(s));
  const investValue = s.player.investments.reduce((a, i) => a + Math.round(i.value), 0);
  const home = housingOf(s.player.housing);
  const housingOptions: { id: HousingId | null; name: string; emoji: string; rent: number; comfort: number; desc: string }[] = [
    { id: null, ...DEFAULT_HOUSING },
    ...HOUSINGS.map((h) => ({ ...h, id: h.id as HousingId | null })),
  ];

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const r = await g.freeAction(text);
    setBusy(false);
    if (r.ok) setText('');
  };

  const workBlock = (): string | null => {
    if (!job) return '你还没有工作。';
    if (s.pendingEvent) return '眼前有一件事需要你先做决定。';
    if (job.weekdaysOnly && weekend) return '今天是周末，这份工作不用上班。';
    if (s.todayCounts.work) return '今天已经上过班了。';
    if (job.ap > s.ap) return `行动点不足（需要 ${job.ap}）。`;
    return null;
  };
  const overtimeBlock = (): string | null => {
    if (!job) return '你还没有工作。';
    if (!s.todayCounts.work) return '要先正常上班，才谈得上加班。';
    if (s.flags.overtimeDay === s.day) return '今天已经加过班了。';
    if (s.ap < 3) return '行动点不足（需要 3）。';
    return null;
  };

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-black text-slate-50">今天做点什么？</h1>
      <div role="tablist" className="scroll-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${tab === t.id ? 'border-lantern-400 bg-lantern-400/12 text-lantern-300' : 'border-white/12 text-slate-400 hover:text-white'}`}>
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {g.lastResult && <ResultCard result={g.lastResult} onClose={g.clearResult} />}

      {tab !== 'work' && tab !== 'free' && (
        <div className="grid gap-3 md:grid-cols-2">
          {ACTIVITIES.filter((a) => a.category === tab).map((a) => (
            <Row key={a.id} title={a.name} desc={a.desc} ap={a.ap} money={a.money} chips={effectChips(a)}
              disabledReason={activityBlockReason(s, a)} onClick={() => g.activity(a.id)} />
          ))}
        </div>
      )}

      {tab === 'work' && (
        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle icon={Briefcase}>当前工作</SectionTitle>
            {job ? (
              <>
                <div className="font-display text-xl font-bold text-slate-50">{job.name} <Chip color={job.partTime ? '#7aa7ff' : '#f6c25b'}>{job.partTime ? '兼职' : '全职'}</Chip> <Chip color="#9a8cff">{TRACK_META[job.track].label}</Chip></div>
                <p className="mt-1 text-sm text-slate-400">{job.desc} 每次约 {fmtMoney(job.wage)}，耗时 {job.ap} 行动点{job.weekdaysOnly ? '，仅工作日' : ''}。已累计工作 {s.player.workDays} 天。</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><div className="text-slate-500">职业线</div><div className="mt-0.5 text-slate-200">{TRACK_META[job.track].label} · 本线 {career.trackDays} 天</div></div>
                  <div><div className="text-slate-500">本职技能</div><div className="mt-0.5 text-slate-200">{SKILL_META[TRACK_META[job.track].skill].label} {career.skill}</div></div>
                  <div className="col-span-2">
                    <div className="text-slate-500">绩效 {career.performance}/100</div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${career.performance}%`, background: career.performance >= 80 ? '#3dd6a3' : career.performance <= 35 ? '#e0446f' : '#f6c25b' }} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {career.performance >= 85 ? '保持两个月就有晋升机会' : career.performance <= 30 ? '再低两个月会被裁员' : '每月初评估，出勤与加班影响绩效'}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SKILL_KEYS.map((k) => (
                    <Chip key={k} color="#9a8cff">{SKILL_META[k].label} {s.player.skills[k] ?? 0}</Chip>
                  ))}
                </div>
                {career.next && <div className="mt-2 text-xs text-jade-400">下一个目标：{career.next.name}（条件已满足，绩效连续两月 ≥85 会自动晋升）</div>}
                {s.player.monthGross > 0 && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
                    本月工资：税前 {fmtMoney(s.player.monthGross)} · 五险一金 {fmtMoney(s.player.monthInsurance)} · 个税 {fmtMoney(s.player.monthTax)} · 到手 {fmtMoney(s.player.monthGross - s.player.monthInsurance - s.player.monthTax)}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="gold" disabled={!!workBlock()} onClick={() => g.work()}>去上班</Button>
                  <Button variant="ghost" disabled={!!overtimeBlock()} onClick={() => g.overtime()}>加班（3 点）</Button>
                  <Button variant="danger" onClick={() => { if (window.confirm(`确定辞去「${job.name}」吗？`)) g.quit(); }}>辞职</Button>
                </div>
                {(workBlock() || overtimeBlock()) && <div className="mt-2 text-xs text-slate-500">{workBlock() ?? overtimeBlock()}</div>}
              </>
            ) : <p className="text-sm text-slate-400">你目前没有工作。在下方的职位列表中选择一份应聘吧。</p>}
          </Card>
          <div>
            <SectionTitle>职位列表</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {JOBS.map((j) => {
                const unmet = unmetRequirements(s, j);
                const student = s.player.occupation === 'student' && !j.partTime;
                const reason = j.id === s.player.jobId ? '这是你当前的工作。' : student ? '在读期间只能申请兼职。' : unmet.length ? `条件不足：${unmet.join('、')}` : s.pendingEvent ? '请先处理眼前的事件。' : s.ap < 2 ? '行动点不足（应聘需要 2）。' : null;
                return (
                  <Row key={j.id} title={j.name} desc={`${j.desc} 约 ${fmtMoney(j.wage)}/次 · ${j.ap} 点${j.weekdaysOnly ? ' · 仅工作日' : ''}`} ap={2}
                    chips={<><Chip color={j.partTime ? '#7aa7ff' : '#f6c25b'}>{j.partTime ? '兼职' : '全职'}</Chip><Chip color="#9a8cff">{TRACK_META[j.track].label}</Chip>{Object.keys(j.req).length === 0 ? <Chip>无门槛</Chip> : null}</>}
                    disabledReason={reason} onClick={() => g.applyJob(j.id)} label="应聘" />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'money' && (
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle icon={TrendingUp}>资金概览</SectionTitle>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-xs text-slate-500">现金</div><div className="mt-1 text-lg font-semibold" style={{ color: s.player.money < 0 ? '#e0446f' : '#f6c25b' }}>{fmtMoney(s.player.money)}</div></div>
              <div><div className="text-xs text-slate-500">储蓄</div><div className="mt-1 text-lg font-semibold text-jade-400">{fmtMoney(s.player.savings)}</div></div>
              <div><div className="text-xs text-slate-500">理财市值</div><div className="mt-1 text-lg font-semibold text-rune-300">{fmtMoney(investValue)}</div></div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">储蓄年化 2%，每月初计息；理财每月初按产品波动结算（结果会写进今晨简报）。转入 / 取出不消耗行动点，单笔 ¥100 起。</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="金额"
                className="w-28 rounded-lg border border-white/12 bg-ink-900 px-2 py-1.5 text-sm text-slate-100" />
              <Button variant="ghost" onClick={() => { const n = Number(amount); if (n > 0) g.depositMoney(n); }}>存入储蓄</Button>
              <Button variant="ghost" onClick={() => { const n = Number(amount); if (n > 0) g.withdrawMoney(n); }}>取出储蓄</Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-500">舒适度影响睡眠恢复</span>}>居住</SectionTitle>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-100">{home.emoji} {home.name}</div>
                <div className="mt-0.5 text-xs text-slate-400">{home.desc}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-400">
                <div>月租 {home.rent ? fmtMoney(home.rent) : '免费'}</div>
                <div>舒适度 {home.comfort}/100</div>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {housingOptions.map((h) => {
                const current = (h.id ?? null) === s.player.housing;
                const cost = moveCostOf(h.id ?? null);
                return (
                  <div key={String(h.id)} className={`rounded-xl border p-3 ${current ? 'border-jade-400/40 bg-jade-400/[0.06]' : 'border-white/10'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-200">{h.emoji} {h.name}</span>
                      {current && <Chip color="#3dd6a3">当前</Chip>}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{h.rent ? `月租 ${fmtMoney(h.rent)}` : '无房租'} · 舒适度 {h.comfort}</div>
                    {!current && (
                      <Button variant="rune" className="mt-2 !px-3 !py-1 text-xs" disabled={!!s.pendingEvent || s.player.money < cost}
                        onClick={() => g.moveHouse(h.id ?? null)}>{h.id ? '搬入' : '搬回家里'}（¥{cost}）</Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">搬家一次性支付押金/搬家费（首月房租的一半，搬回家里 ¥200），之后每月初自动扣房租。舒适度越高，睡眠恢复的健康与幸福感越多。</p>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-500">信用分 {Math.round(s.player.credit)} · 可贷 {fmtMoney(loanLimit(s))}</span>}>银行贷款</SectionTitle>
            {s.player.bankLoan ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div><div className="text-xs text-slate-500">剩余应还</div><div className="mt-0.5 text-rose2-400">{fmtMoney(s.player.bankLoan.remaining)}</div></div>
                  <div><div className="text-xs text-slate-500">每月还款</div><div className="mt-0.5 text-slate-200">{fmtMoney(s.player.bankLoan.monthly)}</div></div>
                  <div><div className="text-xs text-slate-500">年利率</div><div className="mt-0.5 text-slate-200">{(s.player.bankLoan.rate * 100).toFixed(1)}%</div></div>
                  <div><div className="text-xs text-slate-500">借款日</div><div className="mt-0.5 text-slate-200">第 {s.player.bankLoan.startedDay + 1} 天</div></div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">每月初自动扣款；现金不足视为逾期，信用分 -15。提前还款会提升信用分。</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={100} step={100} value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} aria-label="提前还款金额"
                    className="w-28 rounded-lg border border-white/12 bg-ink-900 px-2 py-1.5 text-sm text-slate-100" />
                  <Button variant="ghost" disabled={!!s.pendingEvent} onClick={() => { const n = Number(loanAmount); if (n > 0) g.repayLoan(n); }}>提前还款</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-slate-400">
                  信用分越高，可贷额度越高、利率越低。贷款每月初自动扣款，逾期会扣信用分；按时还清会提升信用分。
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>年利率约 {(bankLoanRate(s) * 100).toFixed(1)}%</span>
                  <span>· 最低 ¥1,000</span>
                  {loanLimit(s) <= 0 && <span className="text-rose2-400">信用分不足，暂时无法贷款</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min={1000} step={1000} value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} aria-label="贷款金额"
                    className="w-28 rounded-lg border border-white/12 bg-ink-900 px-2 py-1.5 text-sm text-slate-100" />
                  <Button variant="rune" disabled={!!s.pendingEvent || loanLimit(s) <= 0} onClick={() => { const n = Number(loanAmount); if (n > 0) g.takeLoan(n); }}>申请贷款</Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle>理财产品</SectionTitle>
            <p className="mb-3 text-xs text-slate-500">买入金额使用上方的数字（默认 ¥500）。收益与风险都由规则引擎按参数结算，不接入真实行情。</p>
            <div className="space-y-2">
              {INVESTMENT_PRODUCTS.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-100">
                      {p.name}
                      <Chip color={p.risk === '低' ? '#3dd6a3' : p.risk === '中' ? '#f6c25b' : '#e0446f'}>{p.risk}风险</Chip>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">{p.desc} 月均 {(p.meanRate * 100).toFixed(2)}%，波动 ±{(p.vol * 100).toFixed(1)}%</p>
                  </div>
                  <Button variant="rune" className="shrink-0 !px-3" disabled={!!s.pendingEvent}
                    onClick={() => { const n = Number(amount); if (n > 0) g.invest(p.id, n); }}>买入</Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-500">{s.player.assets.length}/{ASSETS.length} 已拥有</span>}>资产（长期加成）</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {ASSETS.map((a) => {
                const owned = s.player.assets.includes(a.id);
                return (
                  <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-100"><span className="text-lg">{a.emoji}</span>{a.name}</div>
                      {owned ? <Chip color="#3dd6a3">已拥有</Chip> : <Chip color="#f6c25b">{fmtMoney(a.price)}</Chip>}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{a.desc}</p>
                    {!owned && (
                      <Button variant="rune" className="mt-2 !px-3 !py-1 text-xs" disabled={!!s.pendingEvent || s.player.money < a.price}
                        onClick={() => g.purchaseAsset(a.id)}>购买</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle right={<span className="text-xs text-slate-500">{s.player.investments.length} 笔持仓</span>}>我的持仓</SectionTitle>
            {s.player.investments.length === 0 ? (
              <p className="text-sm text-slate-500">还没有持仓。选一个产品试试，每月初会结算一次。</p>
            ) : (
              <ul className="space-y-2">
                {s.player.investments.map((i) => {
                  const def = INVESTMENT_PRODUCTS.find((p) => p.id === i.product);
                  const gain = Math.round(i.value) - i.principal;
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
                      <div className="min-w-0">
                        <div className="text-sm text-slate-100">
                          {def?.name ?? '理财'}
                          <span className={`ml-2 text-xs ${gain >= 0 ? 'text-jade-400' : 'text-rose2-400'}`}>{gain >= 0 ? '+' : ''}{fmtMoney(gain)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          本金 {fmtMoney(i.principal)} · 市值 {fmtMoney(i.value)}
                          {i.lastRate !== undefined ? ` · 上次月结 ${i.lastRate.toFixed(1)}%` : ''}
                        </div>
                      </div>
                      <Button variant="ghost" className="shrink-0" disabled={!!s.pendingEvent} onClick={() => g.divest(i.id)}>卖出</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'free' && (
        <Card className="p-5">
          <SectionTitle icon={Sparkles}>自由行动</SectionTitle>
          <p className="mb-3 text-sm text-slate-400">用一句话描述你想做的事。系统会理解你的意图，并由规则引擎核算行动点、花费与收益——无法凭空获得金钱或属性。</p>
          <textarea value={text} maxLength={120} rows={3} onChange={(e) => setText(e.target.value)} aria-label="自由行动输入"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
            placeholder="例如：去图书馆复习 3 小时 / 花 200 元请朋友吃饭"
            className="w-full resize-none rounded-xl border border-white/12 bg-ink-900 p-3 text-slate-100 placeholder:text-slate-600" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => <button key={e} onClick={() => setText(e)} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:text-white">{e}</button>)}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-500">{text.length}/120 · 剩余 {s.ap} 行动点</span>
            <Button variant="gold" onClick={submit} disabled={busy || !text.trim()}><Send className="h-4 w-4" />{busy ? '处理中…' : '执行'}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
