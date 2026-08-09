create table purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references profiles(id),
  department text not null,
  justification text,
  status pr_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pr_line_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references purchase_requisitions(id) on delete cascade,
  item_name text not null,
  description text,
  quantity numeric not null check (quantity > 0),
  uom text not null default 'unit',
  estimated_unit_price numeric check (estimated_unit_price >= 0),
  created_at timestamptz not null default now()
);