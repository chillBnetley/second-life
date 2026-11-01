/** 本地设置（AI 开关 / 音效 / 减少动画），存 localStorage，刷新后保持。 */
export interface Settings {
  /** 是否启用 AI 剧情（默认跟随构建变量 VITE_AI_ENABLED） */
  aiEnabled: boolean;
  sfx: boolean;
  reduceMotion: boolean;
}

const KEY = 'secondlife:settings:v1';

const envAi = (): boolean => {
  try { return import.meta.env?.VITE_AI_ENABLED === 'true'; } catch { return false; }
};

const DEFAULTS: Settings = { aiEnabled: envAi(), sfx: false, reduceMotion: false };

const hasStorage = () => {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
};

export function getSettings(): Settings {
  if (!hasStorage()) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      aiEnabled: typeof parsed.aiEnabled === 'boolean' ? parsed.aiEnabled : DEFAULTS.aiEnabled,
      sfx: typeof parsed.sfx === 'boolean' ? parsed.sfx : DEFAULTS.sfx,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : DEFAULTS.reduceMotion,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  if (hasStorage()) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 存储不可用时仅本次生效 */ }
  }
  return next;
}

export const SETTINGS_CHANGED = 'secondlife:settings-changed';
