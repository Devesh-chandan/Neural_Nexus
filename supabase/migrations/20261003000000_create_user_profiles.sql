create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  user_type text not null default 'client' check (user_type in ('client', 'rm')),
  legal_name text not null,
  rm_id text,
  employee_id text,
  institution text,
  branch_code text,
  department text,
  access_tier text,
  operating_jurisdiction text,
  authorised_product_types jsonb,
  date_of_birth date,
  employment_status text,
  national_tax_id text,
  liquid_net_worth numeric(18, 2) check (liquid_net_worth is null or liquid_net_worth > 0),
  annual_income numeric(18, 2) check (annual_income is null or annual_income > 0),
  source_of_funds text,
  previous_investment_exposure_pct numeric(5, 2)
    check (previous_investment_exposure_pct between 0 and 100),
  risk_appetite text check (risk_appetite in ('conservative', 'moderate', 'aggressive')),
  investment_horizon_years numeric(4, 2)
    check (investment_horizon_years between 0.25 and 10),
  loss_tolerance_pct numeric(5, 2) check (loss_tolerance_pct between 0 and 100),
  current_portfolio_concentration_pct numeric(5, 2)
    check (current_portfolio_concentration_pct between 0 and 100),
  experience text check (experience in ('novice', 'intermediate', 'experienced')),
  case_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, user_type, legal_name)
  values (
    new.id,
    case when new.raw_app_meta_data ->> 'user_type' = 'rm' then 'rm' else 'client' end,
    coalesce(nullif(new.raw_user_meta_data ->> 'legal_name', ''), 'New user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_user_profile();

alter table public.user_profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile"
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;
grant update (
  legal_name,
  date_of_birth,
  employment_status,
  national_tax_id,
  liquid_net_worth,
  annual_income,
  source_of_funds,
  previous_investment_exposure_pct,
  risk_appetite,
  investment_horizon_years,
  loss_tolerance_pct,
  current_portfolio_concentration_pct,
  experience
) on public.user_profiles to authenticated;
