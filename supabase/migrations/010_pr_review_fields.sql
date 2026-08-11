alter table purchase_requisitions
  add column admin_notes text,
  add column reviewed_by uuid references profiles(id),
  add column reviewed_at timestamptz;