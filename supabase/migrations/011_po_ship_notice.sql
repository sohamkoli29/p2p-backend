alter table purchase_orders
  add column accepted_at timestamptz,
  add column declined_at timestamptz,
  add column decline_reason text,
  add column ship_notice_path text,
  add column shipped_at timestamptz;

-- Private bucket for ship-notice attachments. Uploads/reads go through the
-- backend using the service role key, which bypasses storage RLS — so no
-- storage.objects policies are needed; access control lives entirely in
-- Express (see the route guards below).
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;