import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  aiCooldownLeft, applyForJob, applyNpcSummary, bankLoanRate, buyAsset, buyInvestment, canCallAi, changeHousing, confess, createNewGame, deposit, dismissLifeEnd, dismissYearReview, endDay, injectEvent, interactWithNpc,
  loanLimit, performActivity, performFreeAction, performOvertime, performWork, quitJob, recordAiCall, repayBankLoan, resolveEventChoice, rewriteNpcLine, sellInvestment, takeBankLoan, withdraw,
} from './game/engine';
import type { InteractionKind } from './game/npcs';
import type { ActionResult, CreateInput, Deltas, EngineResult, GameState, HousingId, InvestmentProduct } from './game/types';
import { aiContinueThread, aiGenerateEvent, aiInterpretAction, aiNpcDialogue, aiSummarizeMemories } from './services/ai';
import { getSettings, saveSettings } from './services/settings';
import { storage } from './services/storage';

export interface Toast { id: number; text: string; kind: 'info' | 'warn' | 'gold' }
/** AI 当前可用状态：关闭 / 正常 / 熔断冷却中 / 今日额度用完 */
export type AiStatus = 'off' | 'on' | 'cooldown' | 'budget';

export interface GameApi {
  ready: boolean;
  state: GameState | null;
  lastResult: ActionResult | null;
  toasts: Toast[];
  aiEnabled: boolean;
  aiStatus: AiStatus;
  toggleAi(): void;
  newGame(input: CreateInput): void;
  loadGame(id: string): Promise<boolean>;
  adoptState(s: GameState): void;
  closeGame(): void;
  activity(id: string): ActionResult;
  work(): ActionResult;
  overtime(): ActionResult;
  applyJob(id: string): ActionResult;
  quit(): ActionResult;
  depositMoney(amount: number): ActionResult;
  withdrawMoney(amount: number): ActionResult;
  invest(product: InvestmentProduct, amount: number): ActionResult;
  divest(id: string): ActionResult;
  takeLoan(amount: number): ActionResult;
  repayLoan(amount: number): ActionResult;
  purchaseAsset(id: string): ActionResult;
  moveHouse(id: HousingId | null): ActionResult;
  freeAction(text: string): Promise<ActionResult>;
  npcInteract(npcId: string, kind: InteractionKind): ActionResult;
  confess(npcId: string): ActionResult;
  chooseEvent(choiceId: string): ActionResult;
  dismissYearReview(): ActionResult;
  dismissLifeEnd(): ActionResult;
  endDay(): ActionResult;
  dismissToast(id: number): void;
  clearResult(): void;
}

export const GameContext = createContext<GameApi | null>(null);
export const useGame = (): GameApi => {
  const g = useContext(GameContext);
  if (!g) throw new Error('useGame 必须在 GameProvider 内使用');
  return g;
};

const emptyDeltas = (): Deltas => ({ attrs: {}, money: 0, knowledge: 0, ap: 0, npc: [] });

let toastSeq = 1;
/** AI 清晨事件的触发概率（与本地事件互斥） */
const AI_EVENT_CHANCE = 0.25;

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState | null>(null);
  const [ready, setReady] = useState(false);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => getSettings().aiEnabled);
  const ref = useRef<GameState | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /** 提交新状态：更新内存 + 写入存档（刷新后不丢进度） */
  const commit = useCallback((s: GameState) => {
    ref.current = s;
    setState(s);
    storage.save(s).then(() => storage.setLastId(s.id)).catch((e: Error) => toast(e.message, 'warn'));
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        const id = await storage.getLastId();
        if (id) { const s = await storage.load(id); if (s) { ref.current = s; setState(s); } }
      } finally { setReady(true); }
    })();
  }, []);

  /**
   * 应用一次引擎结果。`aiOk` 有值表示这次操作调用过 AI：
   * 顺带把「调用次数 / 失败熔断」写进存档（同一事务，只写一次盘）。
   */
  const apply = useCallback((r: EngineResult, aiOk?: boolean): ActionResult => {
    let next = r.state;
    if (aiOk !== undefined) next = recordAiCall(r.state, aiOk).state;
    if (next !== ref.current) commit(next);
    setLastResult(r.result);
    if (!r.result.ok) toast(r.result.text, 'warn');
    r.result.unlocked?.forEach((u) => toast(`成就解锁：${u}`, 'gold'));
    return r.result;
  }, [commit, toast]);

  const run = useCallback((fn: (s: GameState) => EngineResult): ActionResult => {
    const cur = ref.current;
    if (!cur) return { ok: false, title: '无存档', text: '还没有开始游戏。', deltas: emptyDeltas() };
    return apply(fn(cur));
  }, [apply]);

  /** 失败但没有状态变化时的空结果（AI 拒绝等） */
  const failAs = (title: string, text: string): ActionResult => ({ ok: false, title, text, deltas: emptyDeltas() });

  /** 清晨 AI 事件：本地结算先落地，AI 慢返回时用 day 做乐观并发校验；失败静默回落 */
  const aiMorningEvent = useCallback(async () => {
    const cur = ref.current;
    if (!cur || cur.pendingEvent || !canCallAi(cur)) return;
    if (Math.random() > AI_EVENT_CHANCE) return;
    const day = cur.day;
    const thread = cur.storyThreads.find((t) => t.status === 'open' && day - t.lastDay >= 7 && day - t.lastDay <= 20);
    const ev = thread && Math.random() < 0.5
      ? await aiContinueThread(cur, thread)
      : await aiGenerateEvent(cur);
    const latest = ref.current;
    if (!latest) return;
    if (!ev) { commit(recordAiCall(latest, false).state); return; }
    if (latest.day !== day || latest.pendingEvent) {
      // AI 返回时一天已经过去，或已经有别的事件：丢弃，不污染当前状态
      commit(recordAiCall(latest, false).state);
      return;
    }
    const inj = injectEvent(latest, ev, day);
    commit(recordAiCall(inj.result.ok ? inj.state : latest, inj.result.ok).state);
    if (inj.result.ok) toast('新的一天，有什么事情正在发生……', 'info');
  }, [commit, toast]);

  /** 记忆过多时异步压缩成摘要（失败静默，只影响长期记忆的丰富度） */
  const aiCompactMemories = useCallback(async (npcId: string) => {
    const cur = ref.current;
    if (!cur || !canCallAi(cur)) return;
    const npc = cur.npcs.find((n) => n.id === npcId);
    if (!npc || npc.memories.length < 30) return;
    const summary = await aiSummarizeMemories(cur, npcId);
    const latest = ref.current;
    if (!latest) return;
    if (!summary) { commit(recordAiCall(latest, false).state); return; }
    const ap = applyNpcSummary(latest, npcId, summary);
    commit(recordAiCall(ap.result.ok ? ap.state : latest, ap.result.ok).state);
  }, [commit]);

  /** NPC 互动后的 AI 台词：只替换文案，不改任何数值 */
  const aiNpcLine = useCallback(async (npcId: string, kind: InteractionKind, base: ActionResult) => {
    const cur = ref.current;
    if (!cur) return;
    const npc = cur.npcs.find((n) => n.id === npcId);
    if (!npc || !canCallAi(cur)) return;
    const aff = base.deltas.npc.find((x) => x.name === npc.name)?.affinity ?? 0;
    const tone = aff > 0 ? 'good' : aff < 0 ? 'bad' : 'ok';
    const line = await aiNpcDialogue(cur, npcId, `${kind}|${tone}|${base.title}`);
    const latest = ref.current;
    if (!latest) return;
    if (!line) { commit(recordAiCall(latest, false).state); return; }
    const rw = rewriteNpcLine(latest, npcId, line);
    commit(recordAiCall(rw.result.ok ? rw.state : latest, rw.result.ok).state);
    if (!rw.result.ok) return;
    // 先展示模板台词，AI 台词返回后平滑替换结果卡文案
    const text = rw.state.log[rw.state.log.length - 1]?.text;
    if (text) setLastResult((prev) => (prev && prev.title === base.title ? { ...prev, text } : prev));
    void aiCompactMemories(npcId);
  }, [commit, aiCompactMemories]);

  const toggleAi = useCallback(() => {
    const next = !aiEnabled;
    setAiEnabled(next);
    saveSettings({ aiEnabled: next });
    toast(next ? 'AI 剧情已开启：事件与对话会更丰富（失败时自动回落本地）' : 'AI 剧情已关闭，继续使用本地剧情', 'info');
  }, [aiEnabled, toast]);

  const aiStatus: AiStatus = !aiEnabled || !state
    ? 'off'
    : aiCooldownLeft(state) > 0
      ? 'cooldown'
      : canCallAi(state) ? 'on' : 'budget';

  const api = useMemo<GameApi>(() => ({
    ready, state, lastResult, toasts, aiEnabled, aiStatus, toggleAi,
    newGame(input) { setLastResult(null); commit(createNewGame(input)); },
    async loadGame(id) {
      const s = await storage.load(id);
      if (!s) { toast('存档读取失败。', 'warn'); return false; }
      ref.current = s; setState(s); setLastResult(null);
      storage.setLastId(id).catch(() => undefined);
      return true;
    },
    adoptState(s) { ref.current = s; setState(s); setLastResult(null); storage.setLastId(s.id).catch(() => undefined); },
    closeGame() { ref.current = null; setState(null); setLastResult(null); },
    activity: (id) => run((s) => performActivity(s, id)),
    work: () => run((s) => performWork(s)),
    overtime: () => run((s) => performOvertime(s)),
    applyJob: (id) => run((s) => applyForJob(s, id)),
    quit: () => run((s) => quitJob(s)),
    depositMoney: (amount) => run((s) => deposit(s, amount)),
    withdrawMoney: (amount) => run((s) => withdraw(s, amount)),
    invest: (product, amount) => run((s) => buyInvestment(s, product, amount)),
    divest: (id) => run((s) => sellInvestment(s, id)),
    takeLoan: (amount) => run((s) => takeBankLoan(s, amount)),
    repayLoan: (amount) => run((s) => repayBankLoan(s, amount)),
    purchaseAsset: (id) => run((s) => buyAsset(s, id)),
    moveHouse: (id) => run((s) => changeHousing(s, id)),
    async freeAction(text) {
      const cur = ref.current;
      if (!cur) return run((s) => performFreeAction(s, text));
      // AI 只给提案；提案不合规或 AI 不可用时，回落到本地解析。两条路径都会经过规则引擎校验。
      if (!aiEnabled || !canCallAi(cur)) return apply(performFreeAction(cur, text));
      const res = await aiInterpretAction(cur, text);
      const latest = ref.current ?? cur;
      if (res.kind === 'proposal') {
        const r = performFreeAction(latest, text, Math.random, res.proposal);
        if (r.result.ok) return apply(r, true);
        // 提案越界：把具体原因告诉玩家，再按本地解析结算，而不是静默回落
        const fallback = performFreeAction(latest, text);
        if (fallback.result.ok) {
          toast(`AI 的提议不符合规则（${r.result.text}），已按普通方式结算。`, 'warn');
          return apply(fallback, true);
        }
        return apply(r, true);
      }
      if (res.kind === 'reject') {
        return apply({ state: latest, result: failAs('AI 拒绝了这次行动', res.reason) }, true);
      }
      return apply(performFreeAction(latest, text), false);
    },
    npcInteract: (npcId, kind) => {
      const r = run((s) => interactWithNpc(s, npcId, kind));
      if (aiEnabled && r.ok) void aiNpcLine(npcId, kind, r);
      return r;
    },
    confess: (npcId) => run((s) => confess(s, npcId)),
    chooseEvent: (choiceId) => run((s) => resolveEventChoice(s, choiceId)),
    dismissYearReview: () => run((s) => dismissYearReview(s)),
    dismissLifeEnd: () => run((s) => dismissLifeEnd(s)),
    endDay: () => {
      const r = run((s) => endDay(s));
      if (aiEnabled && r.ok) void aiMorningEvent();
      return r;
    },
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    clearResult: () => setLastResult(null),
  }), [ready, state, lastResult, toasts, aiEnabled, aiStatus, toggleAi, commit, run, apply, toast, aiMorningEvent, aiNpcLine]);

  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
}
