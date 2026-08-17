create table pr_attachments (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references purchase_requisitions(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table pr_attachments enable row level security;

create policy "pr_attachments_select_via_parent"
  on pr_attachments for select
  using (exists (
    select 1 from purchase_requisitions pr
    where pr.id = requisition_id
    and (pr.requested_by = auth.uid() or auth_role() = 'admin')
  ));

-- Renamed for consistency with ship_notice_path — this column always
-- stores a private Storage path, never a public URL.
alter table quotations rename column attachment_url to attachment_path;