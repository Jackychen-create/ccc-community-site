-- 會員影片網站資料庫
-- 在 Supabase 的 SQL Editor 貼上整份執行。可以重複執行，不會刪掉既有資料。

-- ─────────────────────────────────────────────
-- 邀請碼
-- ─────────────────────────────────────────────
create table if not exists public.invite_codes (
  code        text primary key,
  max_uses    int  not null default 1 check (max_uses >= 0),
  used_count  int  not null default 0,
  note        text,
  disabled    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.invite_codes add column if not exists disabled boolean not null default false;

-- ─────────────────────────────────────────────
-- 會員（用邀請碼註冊的人）
-- 管理員不在這張表，管理員由環境變數 ADMIN_EMAILS 決定
-- ─────────────────────────────────────────────
create table if not exists public.members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  invite_code text,
  banned      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 影片（直播留檔）
-- ─────────────────────────────────────────────
create table if not exists public.videos (
  id            bigint generated always as identity primary key,
  title         text not null,
  description   text,
  r2_key        text not null unique,
  published_at  date not null default current_date,
  created_at    timestamptz not null default now()
);
alter table public.videos add column if not exists is_published boolean not null default false;
alter table public.videos add column if not exists duration_sec int;
alter table public.videos add column if not exists size_bytes   bigint;
alter table public.videos add column if not exists thumb_key    text;
alter table public.videos add column if not exists hosts        text[] not null default '{}';  -- 主講人，例如 {CCC,OC}

-- ─────────────────────────────────────────────
-- 教材附件（PDF 等，掛在某支影片底下）
-- ─────────────────────────────────────────────
create table if not exists public.attachments (
  id          bigint generated always as identity primary key,
  video_id    bigint not null references public.videos(id) on delete cascade,
  title       text not null,
  r2_key      text not null unique,
  size_bytes  bigint,
  created_at  timestamptz not null default now()
);
create index if not exists attachments_video_id_idx on public.attachments(video_id);

-- ─────────────────────────────────────────────
-- 觀看進度（續播用）
-- ─────────────────────────────────────────────
create table if not exists public.watch_progress (
  user_id       uuid   not null references auth.users(id) on delete cascade,
  video_id      bigint not null references public.videos(id) on delete cascade,
  position_sec  int    not null default 0,
  duration_sec  int,
  updated_at    timestamptz not null default now(),
  primary key (user_id, video_id)
);

-- ─────────────────────────────────────────────
-- 權限：全部只允許後端（service role）存取
-- 開啟 RLS 但不給任何 policy = 前端直接查一律拒絕
-- ─────────────────────────────────────────────
alter table public.invite_codes   enable row level security;
alter table public.members        enable row level security;
alter table public.videos         enable row level security;
alter table public.attachments    enable row level security;
alter table public.watch_progress enable row level security;

-- 使用一次邀請碼（原子操作）：成功回傳 true；無效、停用或用完回傳 false
create or replace function public.use_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.invite_codes
     set used_count = used_count + 1
   where code = p_code
     and not disabled
     and used_count < max_uses;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- 建帳號失敗時，把邀請碼次數還回去
create or replace function public.refund_invite_code(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.invite_codes
     set used_count = greatest(used_count - 1, 0)
   where code = p_code;
$$;

revoke all on function public.use_invite_code(text)    from public, anon, authenticated;
revoke all on function public.refund_invite_code(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- v1.4：章節、每月資格、通知、會員筆記
-- ─────────────────────────────────────────────
alter table public.videos  add column if not exists chapters jsonb not null default '[]'::jsonb;  -- [{t: 秒, title: "開盤區間"}]
alter table public.videos  add column if not exists notified_at timestamptz;                      -- 上次寄新影片通知的時間
alter table public.members add column if not exists access_until date;                           -- 觀看資格到哪一天（空白＝不限）
alter table public.members add column if not exists note text;                                   -- 管理員備註，例如本月交易量
alter table public.members add column if not exists notify boolean not null default true;        -- 新影片寄信通知

create table if not exists public.notes (
  id          bigint generated always as identity primary key,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  video_id    bigint not null references public.videos(id) on delete cascade,
  t_sec       int    not null default 0 check (t_sec >= 0),
  body        text   not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes(user_id, video_id);
alter table public.notes enable row level security;

-- ─────────────────────────────────────────────
-- v1.5：每月交易量（OKX、Bybit、UM 任一間達標就有當月觀看資格）
-- ─────────────────────────────────────────────
create table if not exists public.volumes (
  user_id     uuid not null references auth.users(id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),   -- 例如 2026-10
  amounts     jsonb not null default '{}'::jsonb,                 -- {"OKX": 1200000, "Bybit": 0, "UM": 3500000}（USDT）
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (user_id, month)
);
alter table public.volumes enable row level security;

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);
alter table public.settings enable row level security;
insert into public.settings (key, value) values ('volume_threshold', '3300000'::jsonb) on conflict (key) do nothing;

-- ─────────────────────────────────────────────
-- v1.6：達標日起算一個月、教學課程
-- ─────────────────────────────────────────────
alter table public.volumes add column if not exists qualified_at date;   -- 這個月第一次達標的日期；資格＝這天起一個月
alter table public.videos add column if not exists course_host text;     -- 教學課程：哪位主講（CCC、X、OC）；直播留檔是空的
alter table public.videos add column if not exists course_part int;      -- 教學課程：第幾份（1–6）
alter table public.videos drop constraint if exists videos_course_part_check;
alter table public.videos add constraint videos_course_part_check check (
  (course_host is null and course_part is null) or (course_host is not null and course_part between 1 and 6)
);
create unique index if not exists videos_course_slot on public.videos (course_host, course_part) where course_host is not null;

-- ─────────────────────────────────────────────
-- v1.7：觀看分段、研究員提問／回報、網站出錯紀錄
-- ─────────────────────────────────────────────
alter table public.watch_progress add column if not exists buckets jsonb not null default '{}'::jsonb;  -- 每 30 秒一格看過幾次

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  video_id    bigint references public.videos(id) on delete set null,
  t           int,
  kind        text not null default 'question' check (kind in ('question', 'problem')),
  body        text not null check (char_length(body) between 1 and 2000),
  status      text not null default 'open' check (status in ('open', 'done')),
  reply       text,
  replied_by  text,
  replied_at  timestamptz,
  seen_reply  boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_user on public.feedback (user_id, created_at desc);
create index if not exists feedback_status on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  kind        text not null check (kind in ('video', 'api', 'js', 'search_empty', 'upload')),
  message     text not null,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists client_errors_time on public.client_errors (created_at desc);
create index if not exists client_errors_user_day on public.client_errors (user_id, created_at desc);
alter table public.client_errors enable row level security;
