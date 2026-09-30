-- ============================================================
-- CodeUp — Patch #40: نظام ترتيب المنشورات (Ranked Timeline)
-- ============================================================
-- تم فحص جدول posts فعليًا (غير موثّق بالريبو، أُنشئ من لوحة Supabase):
-- الأعمدة الحالية فقط: id, profile_id, content, created_at.
-- لا يوجد status/deleted_at/is_pinned/post_type ولا حتى updated_at.
-- كمان اكتُشف أثناء الفحص: لا توجد أي سياسة UPDATE على posts إطلاقًا —
-- يعني زر "تعديل المنشور" بالواجهة (الموجود من قبل) لم يكن يعمل فعليًا
-- لأي مستخدم عادي (RLS ترفضه صامتًا). هذا الباتش يصلحه كأثر جانبي.
--
-- القرار المعماري الأهم هنا: الفيد الحالي (renderHomeFeed) يدمج 3 أنواع
-- محتوى (posts + submissions + announcements) بترتيب created_at واحد
-- مشترك. إضافة "ترتيب ذكي" حقيقي (Ranking) للمنشورات فقط كان سيتعارض
-- مع هذا الدمج (لا يمكن مزج "ترتيب بالنقاط" مع "ترتيب بالتاريخ" بمصفوفة
-- واحدة مباشرة). الحل الأقل تغييرًا: بدل نقاط منفصلة، نحسب
-- "effective_created_at" — تاريخ منشور مُعدَّل (مُبكَّر افتراضيًا) حسب
-- التفاعل ونوع المنشور، بحد أقصى +96 ساعة (يُحاكي Time Decay تلقائيًا:
-- الأثر ثابت وقت الحساب، فيصغر نسبيًا كل ما مرّ وقت وظهرت منشورات أحدث
-- طبيعيًا — بدون أي صيغة "decay" صريحة إضافية). كود الواجهة الحالي
-- (فرز بـcreated_at، تصفّح بمؤشر created_at) يبقى **بدون أي تغيير** —
-- فقط نستبدل القيمة اللي يقرأها بـeffective_created_at بدل created_at
-- الخام، وهذا هو "أقل تغيير ممكن" الحقيقي هنا.
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة جديدة على posts (فقط الضرورية، بدون أي عمود زائد)
-- ------------------------------------------------------------
alter table posts add column if not exists updated_at timestamptz not null default now();
alter table posts add column if not exists status text not null default 'published'
  check (status in ('published','hidden','deleted'));
alter table posts add column if not exists deleted_at timestamptz;
alter table posts add column if not exists is_pinned boolean not null default false;
alter table posts add column if not exists pinned_until timestamptz;
alter table posts add column if not exists post_type text not null default 'general'
  check (post_type in ('general','question','educational','announcement','course_announcement','contest_result','admin'));

create index if not exists idx_posts_status_created on posts(status, created_at desc);
create index if not exists idx_posts_pinned on posts(is_pinned) where is_pinned = true;

create or replace function posts_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_posts_updated_at on posts;
create trigger trg_posts_updated_at before update on posts
  for each row execute function posts_set_updated_at();

-- ------------------------------------------------------------
-- 2) RLS: القراءة حسب الحالة (published للجميع، الباقي لصاحبه/سوبر أدمن)
--    + إضافة UPDATE (كانت غائبة تمامًا — ضرورية لكل من: تعديل المحتوى،
--    الحذف الناعم status=deleted، والتثبيت الإداري)
-- ------------------------------------------------------------
drop policy if exists "posts: أي مستخدم مسجّل يشوف" on posts;
create policy "posts: قراءة حسب الحالة والصلاحية" on posts
  for select using (
    status = 'published' or profile_id = auth.uid() or is_super_admin(auth.uid())
  );

drop policy if exists "posts: صاحبه أو سوبر أدمن يعدّل" on posts;
create policy "posts: صاحبه أو سوبر أدمن يعدّل" on posts
  for update using (profile_id = auth.uid() or is_super_admin(auth.uid()))
  with check (profile_id = auth.uid() or is_super_admin(auth.uid()));

-- ملاحظة: سياسات DELETE الحالية (حذف فعلي) بقيت كما هي بدون أي تغيير —
-- الحذف الناعم الآن هو المسار الافتراضي بالواجهة، والحذف الفعلي يبقى
-- متاحًا كخيار إداري أقوى لمن يملك صلاحيته أصلًا (سوبر أدمن/صاحب المنشور).

-- ------------------------------------------------------------
-- 3) تثبيت المنشورات — سوبر أدمن فقط (نفس نمط الصلاحيات الحالي بالمشروع)
-- ------------------------------------------------------------
create or replace function pin_post(p_post_id uuid, p_pinned_until timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'تثبيت المنشورات متاح لسوبر أدمن فقط';
  end if;
  update posts set is_pinned = true, pinned_until = p_pinned_until where id = p_post_id;
end;
$$;

create or replace function unpin_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin(auth.uid()) then
    raise exception 'إلغاء التثبيت متاح لسوبر أدمن فقط';
  end if;
  update posts set is_pinned = false, pinned_until = null where id = p_post_id;
end;
$$;

-- ------------------------------------------------------------
-- 4) دالة الفيد المرتَّب — SECURITY INVOKER (بدون تجاوز RLS، تحترم
--    صلاحيات القراءة الحالية تلقائيًا على posts/reactions/comments)
-- ------------------------------------------------------------
create or replace function get_ranked_posts(p_cursor_rank int default 0, p_limit int default 20)
returns table (
  id uuid, profile_id uuid, content text, created_at timestamptz,
  effective_created_at timestamptz, post_type text, is_pinned boolean,
  likes_count bigint, comments_count bigint, global_rank bigint,
  full_name text, avatar_url text
)
language sql stable security invoker set search_path = public as $$
  with base as (
    select p.id, p.profile_id, p.content, p.created_at, p.post_type, p.is_pinned, p.pinned_until
    from posts p
    where p.status = 'published'
      and (
        p.created_at > now() - interval '30 days'
        or (p.is_pinned and (p.pinned_until is null or p.pinned_until > now()))
      )
  ),
  scored as (
    select b.*,
      (select count(*) from reactions r where r.target_type = 'post' and r.target_id = b.id) as likes_count,
      (select count(*) from comments c where c.post_id = b.id and c.deleted_at is null) as comments_count,
      (b.is_pinned and (b.pinned_until is null or b.pinned_until > now())) as pin_active
    from base b
  ),
  boosted as (
    select *,
      least(
        likes_count * 2 + comments_count * 3 +
        case post_type
          when 'admin' then 24
          when 'announcement' then 20
          when 'course_announcement' then 20
          when 'contest_result' then 12
          when 'educational' then 8
          when 'question' then 4
          else 0
        end,
      96) as boost_hours
    from scored
  ),
  final as (
    select id, profile_id, content, created_at, post_type, is_pinned, likes_count, comments_count,
      case when pin_active then now() + interval '10 years'
           else created_at + (boost_hours || ' hours')::interval
      end as effective_created_at
    from boosted
  ),
  diversified as (
    -- تنويع: أفضل منشور لكل صاحب أولًا (دورة 1)، ثم ثاني أفضل منشور لكل صاحب (دورة 2)، وهكذا —
    -- يمنع امتلاء الصفحة بمنشورات شخص واحد رغم وجود منشورات مؤهلة من غيره
    select *, row_number() over (partition by profile_id order by effective_created_at desc) as author_rank
    from final
  ),
  positioned as (
    select *, row_number() over (order by author_rank asc, effective_created_at desc, id) as global_rank
    from diversified
  )
  select po.id, po.profile_id, po.content, po.created_at, po.effective_created_at, po.post_type, po.is_pinned,
    po.likes_count, po.comments_count, po.global_rank, pr.full_name, pr.avatar_url
  from positioned po
  join profiles pr on pr.id = po.profile_id
  where po.global_rank > p_cursor_rank
  order by po.global_rank
  limit p_limit;
$$;

grant execute on function get_ranked_posts(int, int) to authenticated;
grant execute on function pin_post(uuid, timestamptz) to authenticated;
grant execute on function unpin_post(uuid) to authenticated;
