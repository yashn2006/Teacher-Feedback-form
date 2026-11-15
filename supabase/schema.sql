-- SIES Teacher Evaluation System: database schema for Supabase (PostgreSQL 15+).
--
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.
-- It is safe to run on an empty project. It does not drop anything.
--
-- Design notes
-- 1. Only the Express server talks to this database, using the Postgres connection
--    string. Row Level Security is switched on for every table with NO policies, so
--    the public Supabase API (anon key) cannot read or write anything.
-- 2. Feedback is anonymous. `submissions` records WHO has submitted (to stop a second
--    submission). `responses` and `response_ratings` hold the answers and have no link
--    to the student, and `responses` keeps only the date, not the time.
-- 3. Rows that have feedback attached cannot be deleted (ON DELETE RESTRICT), so
--    history is never lost by accident.

create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  level       text not null check (level in ('FY', 'SY', 'TY', 'PG-I', 'PG-II')),
  course      text not null,
  division    text not null default 'A',
  semesters   text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists teachers (
  id             uuid primary key default gen_random_uuid(),
  employee_code  text not null unique,
  name           text not null,
  department     text not null,
  designation    text not null,
  email          text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists subjects (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  class_id    uuid not null references classes (id) on delete cascade,
  semester    text not null,
  credits     integer not null default 3 check (credits between 0 and 20),
  created_at  timestamptz not null default now(),
  unique (class_id, code)
);

-- Who teaches which subject in which academic year.
-- A subject may have more than one teacher; each teacher is rated separately.
create table if not exists assignments (
  id             uuid primary key default gen_random_uuid(),
  subject_id     uuid not null references subjects (id) on delete cascade,
  teacher_id     uuid not null references teachers (id) on delete restrict,
  academic_year  text not null check (academic_year ~ '^\d{4}-\d{2}$'),
  created_at     timestamptz not null default now(),
  unique (subject_id, teacher_id, academic_year)
);
create index if not exists assignments_subject_idx on assignments (subject_id);

create table if not exists students (
  id                    uuid primary key default gen_random_uuid(),
  roll_number           text not null unique check (roll_number = upper(roll_number)),
  name                  text not null,
  class_id              uuid not null references classes (id) on delete restrict,
  semester              text not null,
  attendance_percent    numeric(5, 2) not null check (attendance_percent between 0 and 100),
  attended_classes      integer not null default 0 check (attended_classes >= 0),
  total_classes         integer not null default 0 check (total_classes >= 0),
  must_change_password  boolean not null default true,
  password_hash         text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists students_class_sem_idx on students (class_id, semester);

create table if not exists admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  name           text not null,
  role           text not null check (role in ('admin', 'hod')),
  course         text,
  designation    text not null default '',
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  -- an HOD must belong to a course; an admin must not
  check ((role = 'hod' and course is not null) or (role = 'admin' and course is null))
);
create unique index if not exists admins_email_key on admins (lower(email));

-- One form per class + semester + academic year, shared by all its teachers.
create table if not exists forms (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  class_id        uuid not null references classes (id) on delete restrict,
  semester        text not null,
  academic_year   text not null check (academic_year ~ '^\d{4}-\d{2}$'),
  min_attendance  numeric(5, 2) not null default 75 check (min_attendance between 0 and 100),
  open_date       date not null,
  close_date      date not null,
  status          text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (close_date >= open_date),
  unique (class_id, semester, academic_year)
);

create table if not exists form_questions (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid not null references forms (id) on delete cascade,
  category    text not null,
  text        text not null,
  sort_order  integer not null,
  unique (form_id, sort_order)
);

-- Who has submitted. This is what enforces "one submission per student per form".
create table if not exists submissions (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references forms (id) on delete restrict,
  student_id    uuid not null references students (id) on delete cascade,
  reference_id  text not null unique,
  submitted_at  timestamptz not null default now(),
  unique (form_id, student_id)
);
create index if not exists submissions_form_idx on submissions (form_id);

-- The anonymous answers. One row per teacher per submitted form. No student link.
create table if not exists responses (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references forms (id) on delete restrict,
  assignment_id  uuid not null references assignments (id) on delete restrict,
  comment        text check (comment is null or char_length(comment) <= 500),
  submitted_on   date not null default ((now() at time zone 'Asia/Kolkata')::date)
);
create index if not exists responses_form_idx on responses (form_id);
create index if not exists responses_assignment_idx on responses (assignment_id);

create table if not exists response_ratings (
  response_id  uuid not null references responses (id) on delete cascade,
  question_id  uuid not null references form_questions (id) on delete restrict,
  score        smallint not null check (score between 1 and 5),
  primary key (response_id, question_id)
);
create index if not exists response_ratings_question_idx on response_ratings (question_id);

-- Lock every table away from the public Supabase API.
alter table classes           enable row level security;
alter table teachers          enable row level security;
alter table subjects          enable row level security;
alter table assignments       enable row level security;
alter table students          enable row level security;
alter table admins            enable row level security;
alter table forms             enable row level security;
alter table form_questions    enable row level security;
alter table submissions       enable row level security;
alter table responses         enable row level security;
alter table response_ratings  enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
  end if;
end
$$;
