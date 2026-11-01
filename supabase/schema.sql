-- Second Life · 第四阶段云端存档 schema
-- 在 Supabase SQL Editor 里执行一次即可（需要先开启 Email 登录）。
-- 前端只使用 anon key，安全完全由下面的 RLS 策略保证。

create table if not exists public.saves (
  id          text primary key,
  user_id     uuid not null references auth.users on delete cascade,
  meta        jsonb not null,          -- SaveMeta：列表展示用，避免拉整档
  data        jsonb not null,          -- 完整 GameState（jsonb）
  version     int  not null,
  updated_at  timestamptz not null default now()
);
create index if not exists saves_user_updated_idx on public.saves (user_id, updated_at desc);

alter table public.saves enable row level security;

drop policy if exists "own saves select" on public.saves;
drop policy if exists "own saves insert" on public.saves;
drop policy if exists "own saves update" on public.saves;
drop policy if exists "own saves delete" on public.saves;

create policy "own saves select" on public.saves for select using (auth.uid() = user_id);
create policy "own saves insert" on public.saves for insert with check (auth.uid() = user_id);
create policy "own saves update" on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saves delete" on public.saves for delete using (auth.uid() = user_id);

-- 每用户最近游玩的存档（可选）
create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  last_save_id  text,
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;

create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- 单档大小限制（可选，1MB）与每用户数量限制（≤10）可用触发器实现，这里先留注释：
-- create or replace function public.enforce_save_limits() returns trigger language plpgsql as $$
-- begin
--   if (select count(*) from public.saves where user_id = new.user_id and id <> new.id) >= 10 then
--     raise exception '云端存档数量已达上限（10）';
--   end if;
--   return new;
-- end $$;
-- create trigger saves_limits before insert or update on public.saves for each row execute function public.enforce_save_limits();
