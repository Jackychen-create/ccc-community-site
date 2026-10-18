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

-- ─────────────────────────────────────────────
-- v1.7.3：補索引；後台統計改在資料庫裡算好再回傳（不用把全部觀看紀錄抓到伺服器）
-- ─────────────────────────────────────────────
create index if not exists watch_progress_video on public.watch_progress (video_id);
create index if not exists notes_video on public.notes (video_id);
create index if not exists feedback_video on public.feedback (video_id);

-- 每位研究員（不含管理員）：看過幾場、看完幾場、最近一次、看完的影片編號
-- 「看過」＝進度大於 0；「看完」＝看到 95% 以上（片長用影片的，沒有就用觀看紀錄的）
create or replace function public.admin_member_progress()
returns table (user_id uuid, watched int, completed int, last_watched_at timestamptz, done_ids bigint[])
language sql stable set search_path = ''
as $$
  select p.user_id,
         count(*)::int,
         (count(*) filter (where d.dur > 0 and p.position_sec >= d.dur * 0.95))::int,
         max(p.updated_at),
         coalesce(array_agg(p.video_id) filter (where d.dur > 0 and p.position_sec >= d.dur * 0.95), '{}'::bigint[])
  from public.watch_progress p
  join public.members m on m.user_id = p.user_id
  left join public.videos v on v.id = p.video_id
  cross join lateral (select coalesce(nullif(v.duration_sec, 0), nullif(p.duration_sec, 0)) as dur) d
  where p.position_sec > 0
  group by p.user_id;
$$;

-- 每一場（只算研究員）：幾個人看過、幾個人看完、平均看到幾 %
create or replace function public.admin_video_stats()
returns table (video_id bigint, viewers int, completed int, avg_pct int)
language sql stable set search_path = ''
as $$
  select p.video_id,
         count(*)::int,
         (count(*) filter (where d.dur > 0 and p.position_sec >= d.dur * 0.95))::int,
         round(avg(case when d.dur > 0 then least(1, p.position_sec::numeric / d.dur) else 0 end) * 100)::int
  from public.watch_progress p
  join public.members m on m.user_id = p.user_id
  left join public.videos v on v.id = p.video_id
  cross join lateral (select coalesce(nullif(v.duration_sec, 0), nullif(p.duration_sec, 0)) as dur) d
  where p.position_sec > 0
  group by p.video_id;
$$;

-- 只有伺服器（service role）可以呼叫，瀏覽器拿到的公開金鑰不行
revoke execute on function public.admin_member_progress() from public, anon, authenticated;
revoke execute on function public.admin_video_stats() from public, anon, authenticated;
grant execute on function public.admin_member_progress() to service_role;
grant execute on function public.admin_video_stats() to service_role;

-- ─────────────────────────────────────────────
-- v1.8：研究員綁定交易所帳號（BingX），網站每天自動同步交易量
-- ─────────────────────────────────────────────
create table if not exists public.exchange_links (
  user_id       uuid not null references auth.users(id) on delete cascade,
  exchange      text not null check (exchange in ('BingX')),
  exchange_uid  text not null check (exchange_uid ~ '^\d{5,15}$'),
  direct        boolean,                              -- BingX 回覆是不是直屬邀請
  bound_at      timestamptz not null default now(),
  primary key (user_id, exchange),
  unique (exchange, exchange_uid)                     -- 一個 BingX UID 只能綁一位研究員
);
alter table public.exchange_links enable row level security;
-- 上次同步結果存在 settings 的 bingx_sync（不用另外建表）

-- ── v1.8.1：門檻改成 100 萬 USDT（UM 先不算，在 rules.js 的 EXCHANGES 拿掉，資料庫不用改）──
update public.settings set value = '1000000'::jsonb where key = 'volume_threshold';

-- ── v1.9：Bybit 也可以綁定、自動抓交易量；每天的同步改由這裡（東京）發出 ──
-- Bybit 會擋美國 IP，GitHub Actions 的主機在美國，所以排程改用 Supabase 的 pg_cron + pg_net 叫網站
alter table public.exchange_links drop constraint if exists exchange_links_exchange_check;
alter table public.exchange_links add constraint exchange_links_exchange_check check (exchange in ('BingX', 'Bybit'));
-- 上次同步結果改存在 settings 的 auto_sync（{ BingX: {...}, Bybit: {...} }）

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- 每天台灣時間 02:17（UTC 18:17）呼叫 /api/cron/sync。密碼放在 Vault 的 cron_secret（跟 Cloudflare 的 CRON_SECRET 一樣），
-- 由管理員在 SQL Editor 執行：select vault.create_secret('那串密碼', 'cron_secret');  還沒設定時這個排程什麼都不做
-- 網址換了就改下面的 url，再執行一次這段
select cron.unschedule(jobid) from cron.job where jobname = 'daily-volume-sync';
select cron.schedule('daily-volume-sync', '17 18 * * *', $cron$
  select net.http_post(
    url := 'https://ccc-community-site.pages.dev/api/cron/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s where s.name = 'cron_secret';
$cron$);

-- ── v1.10：Discord 審核機器人 ──
-- 研究員在 Discord 按「申請加入實驗室」→ 選交易所 → 填 UID；Bybit、BingX 自動確認，OKX、UM 由管理員在審核頻道按通過
-- 設定（身分組、申請頻道、審核頻道、邀請連結）存在 settings 的 discord
create table if not exists public.discord_applications (
  id                 bigserial primary key,
  discord_user_id    text not null check (discord_user_id ~ '^\d{17,20}$'),
  discord_name       text,
  exchange           text not null check (exchange in ('OKX', 'UM', 'Bybit', 'BingX')),
  exchange_uid       text not null check (exchange_uid ~ '^\d{5,20}$'),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  auto               boolean not null default false,       -- 交易所 API 自動確認的
  reviewed_by        text,                                 -- 審核的管理員（Discord 名稱）或「Bybit 自動確認」
  review_message_id  text,                                 -- 審核頻道那則訊息
  note               text,                                 -- 為什麼要人工審
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz
);
create index if not exists discord_applications_user_idx on public.discord_applications (discord_user_id, created_at desc);
create index if not exists discord_applications_created_idx on public.discord_applications (created_at desc);
-- 同一個交易所 UID 只能讓一個人通過
create unique index if not exists discord_applications_uid_approved on public.discord_applications (exchange, exchange_uid) where status = 'approved';
alter table public.discord_applications enable row level security;

-- ── v1.11：研究員可以填四間交易所的 UID（OKX、UM 不用驗證，只是讓管理員對得到人）──
alter table public.exchange_links drop constraint if exists exchange_links_exchange_check;
alter table public.exchange_links add constraint exchange_links_exchange_check check (exchange in ('BingX', 'Bybit', 'OKX', 'UM'));
alter table public.exchange_links drop constraint if exists exchange_links_exchange_uid_check;
alter table public.exchange_links add constraint exchange_links_exchange_uid_check check (exchange_uid ~ '^\d{5,20}$');

-- ── v1.12：交易量改成「每人一輪」──
-- 每人從加入那天（台灣日期）起算，每一輪剛好一個月；volumes 一列＝一個人的一輪（period_start～period_end）
-- 規則在 public/assets/js/shared/rules.js（periodOf）
alter table public.volumes add column if not exists period_start date;
alter table public.volumes add column if not exists period_end date;
-- 舊資料（以月份記的）換成那個人那個月所在的一輪：用加入日算第一輪
update public.volumes v set
  period_start = (m.created_at at time zone 'Asia/Taipei')::date,
  period_end = ((m.created_at at time zone 'Asia/Taipei')::date + interval '1 month' - interval '1 day')::date
from public.members m
where m.user_id = v.user_id and v.period_start is null;
delete from public.volumes where period_start is null;
alter table public.volumes drop constraint if exists volumes_pkey;
alter table public.volumes alter column period_start set not null;
alter table public.volumes alter column period_end set not null;
alter table public.volumes add primary key (user_id, period_start);
alter table public.volumes drop column if exists month;

-- ── v1.14：Discord 私人申請頻道（像 Ticket Tool）──
-- 按「申請加入實驗室」→ 機器人開一個只有申請人和管理員看得到的頻道；一個人同時只有一個開著的
create table if not exists public.discord_tickets (
  channel_id       text primary key check (channel_id ~ '^\d{17,20}$'),
  discord_user_id  text not null check (discord_user_id ~ '^\d{17,20}$'),
  discord_name     text,
  status           text not null default 'open' check (status in ('open', 'closed')),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        text
);
create unique index if not exists discord_tickets_one_open on public.discord_tickets (discord_user_id) where status = 'open';
alter table public.discord_tickets enable row level security;
-- 申請是在哪個申請頻道送的、通過後給他的專用實驗室密碼（只能用一次）
alter table public.discord_applications add column if not exists channel_id text;
alter table public.discord_applications add column if not exists invite_code text;

-- ── v1.15：直播預告 ──
-- 後台排好直播時間 → 機器人發到 Discord「🧪實驗室」頻道（提及實驗室研究員）；改時間、取消、開播前 30 分鐘提醒都回覆在公告下面
create table if not exists public.lives (
  id                  bigserial primary key,
  title               text not null check (char_length(title) between 1 and 60),
  starts_at           timestamptz not null,
  note                text check (note is null or char_length(note) <= 500),
  link                text check (link is null or link ~ '^https://'),
  mention             boolean not null default true,          -- 公告時提及 @實驗室研究員
  status              text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  discord_channel_id  text,
  discord_message_id  text,
  reminded_at         timestamptz,                             -- 開播前提醒發了沒
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists lives_starts_idx on public.lives (starts_at);
alter table public.lives enable row level security;
-- 每 5 分鐘看有沒有 30 分鐘內要開始的直播，發提醒（密碼一樣用 Vault 的 cron_secret）
select cron.unschedule(jobid) from cron.job where jobname = 'live-reminder';
select cron.schedule('live-reminder', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://ccc-community-site.pages.dev/api/cron/lives',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from vault.decrypted_secrets s where s.name = 'cron_secret';
$cron$);

-- ── v1.16.2：每天同步交易量改成兩次（台灣 10:17、18:17）──
-- Bybit 的交易量隔天（T+1）才更新，原本台灣半夜 02:17 跑太早，前一天的還沒出來
select cron.unschedule(jobid) from cron.job where jobname = 'daily-volume-sync';
select cron.schedule('daily-volume-sync', '17 2,10 * * *', $cron$
  select net.http_post(
    url := 'https://ccc-community-site.pages.dev/api/cron/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s where s.name = 'cron_secret';
$cron$);

-- ── v1.16.4：UM 可以填 MT5 帳號或名字（不限數字），其他交易所還是 UID ──
alter table public.exchange_links drop constraint if exists exchange_links_exchange_uid_check;
alter table public.exchange_links add constraint exchange_links_exchange_uid_check
  check ((exchange = 'UM' and char_length(exchange_uid) between 2 and 40) or exchange_uid ~ '^\d{5,20}$');
alter table public.discord_applications drop constraint if exists discord_applications_exchange_uid_check;
alter table public.discord_applications add constraint discord_applications_exchange_uid_check
  check ((exchange = 'UM' and char_length(exchange_uid) between 2 and 40) or exchange_uid ~ '^\d{5,20}$');

-- ── v1.16.5：UM 改回填 UID，另外填註冊 UM 用的 Email（管理員對帳用）──
alter table public.exchange_links add column if not exists account_email text check (account_email is null or char_length(account_email) <= 254);
alter table public.discord_applications add column if not exists account_email text check (account_email is null or char_length(account_email) <= 254);
alter table public.exchange_links drop constraint if exists exchange_links_exchange_uid_check;
alter table public.exchange_links add constraint exchange_links_exchange_uid_check check (exchange_uid ~ '^\d{5,20}$');
alter table public.discord_applications drop constraint if exists discord_applications_exchange_uid_check;
alter table public.discord_applications add constraint discord_applications_exchange_uid_check check (exchange_uid ~ '^\d{5,20}$');

-- ── v1.16.7：UM 改填 MT5 帳號＋開戶的英文姓名（UM 代理後台只看得到帳號和姓名，看不到 Email）──
-- account_email 留著（之前填過的不刪），之後不再用
alter table public.exchange_links add column if not exists account_name text check (account_name is null or char_length(account_name) <= 60);
alter table public.discord_applications add column if not exists account_name text check (account_name is null or char_length(account_name) <= 60);

-- ── v1.16.14：直播預告加主講人（可以複選，選項跟影片一樣在 config.js 的 HOSTS）──
alter table public.lives add column if not exists hosts text[] not null default '{}';

-- ── v1.17.0：贈送名額（免綁交易所、觀看不限期）──
-- 實驗室密碼標成 free → 用它註冊不用填交易所 UID，access_until 留空白（不限），研究員也標成 free
alter table public.invite_codes add column if not exists free boolean not null default false;
alter table public.members      add column if not exists free boolean not null default false;

-- ── v1.18.0：進度里程碑（這一輪交易量跨過 25／50／75／100% 各通知一次）──
create table if not exists public.milestones (
  user_id      uuid not null references public.members(user_id) on delete cascade,
  period_start date not null,
  level        int  not null check (level in (25, 50, 75, 100)),
  reached_at   timestamptz not null default now(),
  dm_sent      boolean not null default false,   -- Discord 私訊送出了
  seen         boolean not null default false,   -- 研究員在網站上看過恭喜了
  primary key (user_id, period_start, level)
);
alter table public.milestones enable row level security;

-- ── v1.19.0：徽章、外觀主題 ──
create table if not exists public.badges (
  user_id   uuid not null references public.members(user_id) on delete cascade,
  badge     text not null check (char_length(badge) <= 40),   -- id 在 shared/rules.js 的 BADGES
  earned_at timestamptz not null default now(),
  seen      boolean not null default false,                   -- 研究員在網站上看過恭喜了
  primary key (user_id, badge)
);
alter table public.badges enable row level security;
alter table public.members add column if not exists theme text check (theme is null or char_length(theme) <= 20); -- id 在 shared/rules.js 的 THEMES
