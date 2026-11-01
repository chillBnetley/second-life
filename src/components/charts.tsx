import { useId } from 'react';
import { ATTR_KEYS, ATTR_META } from '../game/content';
import { affinityTier } from '../game/npcs';
import type { Attrs, NPC } from '../game/types';
import { fmtMoney } from '../game/util';

/** 折线 + 面积图（财富曲线）。无外部依赖。 */
export function LineChart({ data, color = '#f6c25b', height = 150 }: { data: { x: number; y: number }[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  if (data.length < 2) return <div className="flex items-center justify-center text-xs text-slate-500" style={{ height }}>数据还不够，先过几天吧</div>;
  const W = 600, H = 200, pad = 8;
  const xs = data.map((d) => d.x), ys = data.map((d) => d.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  const px = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad * 2);
  const py = (y: number) => H - pad - ((y - y0) / (y1 - y0)) * (H - pad * 2);
  const pts = data.map((d) => `${px(d.x).toFixed(1)},${py(d.y).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `${line}L${px(x1)},${py(y0)}L${px(x0)},${py(y0)}Z`;
  const zeroY = py(0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="财富曲线">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".38" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {y0 < 0 && <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#e0446f" strokeDasharray="4 4" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>第 {x0} 天</span><span>最高 {fmtMoney(Math.max(...ys))} · 最低 {fmtMoney(Math.min(...ys))}</span><span>第 {x1} 天</span>
      </div>
    </div>
  );
}

/** 六维雷达图 */
export function Radar({ attrs, size = 240 }: { attrs: Attrs; size?: number }) {
  const id = useId().replace(/:/g, '');
  const c = 120, R = 82;
  const pt = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / ATTR_KEYS.length - Math.PI / 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r] as const;
  };
  const poly = (f: number) => ATTR_KEYS.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const shape = ATTR_KEYS.map((k, i) => pt(i, (R * Math.max(attrs[k], 3)) / 100).join(',')).join(' ');
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} className="mx-auto max-w-full" role="img" aria-label="属性雷达图">
      <defs>
        <radialGradient id={`r${id}`}><stop offset="0%" stopColor="#f6c25b" stopOpacity=".5" /><stop offset="100%" stopColor="#7c6cf0" stopOpacity=".35" /></radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(f)} fill="none" stroke="rgba(255,255,255,.1)" />)}
      {ATTR_KEYS.map((_, i) => <line key={i} x1={c} y1={c} x2={pt(i, R)[0]} y2={pt(i, R)[1]} stroke="rgba(255,255,255,.07)" />)}
      <polygon points={shape} fill={`url(#r${id})`} stroke="#f6c25b" strokeWidth="1.5" strokeLinejoin="round" style={{ transition: 'all .6s ease' }} />
      {ATTR_KEYS.map((k, i) => {
        const [x, y] = pt(i, R + 20);
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill={ATTR_META[k].color}>
            {ATTR_META[k].label} {attrs[k]}
          </text>
        );
      })}
    </svg>
  );
}

/** 人物关系网：玩家居中，已结识的 NPC 环绕；连线粗细代表好感度，虚线代表 NPC 之间的关系 */
export function RelationGraph({ npcs, playerName, onSelect, selectedId }: { npcs: NPC[]; playerName: string; onSelect: (id: string) => void; selectedId?: string }) {
  const met = npcs.filter((n) => n.met);
  const W = 420, H = 320, cx = W / 2, cy = H / 2, R = 118;
  const pos = new Map<string, [number, number]>();
  met.forEach((n, i) => {
    const a = (Math.PI * 2 * i) / Math.max(1, met.length) - Math.PI / 2;
    pos.set(n.id, [cx + Math.cos(a) * R * 1.22, cy + Math.sin(a) * R * 0.9]);
  });
  const seen = new Set<string>();
  const peer: { a: string; b: string; label: string }[] = [];
  for (const n of met) for (const l of n.links) {
    const key = [n.id, l.id].sort().join('|');
    if (pos.has(l.id) && !seen.has(key)) { seen.add(key); peer.push({ a: n.id, b: l.id, label: l.label }); }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="人物关系图">
      {peer.map((e) => {
        const [x1, y1] = pos.get(e.a)!, [x2, y2] = pos.get(e.b)!;
        return (
          <g key={`${e.a}${e.b}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.18)" strokeDasharray="3 4" />
            <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize="9" fill="#8b90b3" textAnchor="middle">{e.label}</text>
          </g>
        );
      })}
      {met.map((n) => {
        const [x, y] = pos.get(n.id)!;
        const t = affinityTier(n.affinity);
        return <line key={n.id} x1={cx} y1={cy} x2={x} y2={y} stroke={t.color} strokeOpacity=".75" strokeWidth={Math.max(0.6, Math.abs(n.affinity) / 25)} />;
      })}
      <circle cx={cx} cy={cy} r="26" fill="#1a1d35" stroke="#f6c25b" strokeWidth="2" />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#f6c25b" fontWeight="700">{playerName.slice(0, 4)}</text>
      {met.map((n) => {
        const [x, y] = pos.get(n.id)!;
        const t = affinityTier(n.affinity);
        const sel = n.id === selectedId;
        return (
          <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: 'pointer' }} tabIndex={0} role="button" aria-label={n.name}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(n.id); }}>
            <circle cx={x} cy={y} r={sel ? 21 : 18} fill="#121426" stroke={t.color} strokeWidth={sel ? 3 : 1.6} />
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="16">{n.avatar}</text>
            <text x={x} y={y + 31} textAnchor="middle" fontSize="10" fill="#c9cde6">{n.name}</text>
            <text x={x} y={y + 42} textAnchor="middle" fontSize="9" fill={t.color}>{t.label} {n.affinity}</text>
          </g>
        );
      })}
    </svg>
  );
}
