create table rfqs (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references purchase_requisitions(id),
  created_by uuid not null references profiles(id),
  deadline timestamptz not null,
  status rfq_status not null default 'open',
  created_at timestamptz not null default now()
);

create table rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  pr_line_item_id uuid not null references pr_line_items(id),
  quantity numeric not null check (quantity > 0)
);

create table rfq_vendors (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  vendor_id uuid not null references profiles(id),
  invited_at timestamptz not null default now(),
  responded boolean not null default false,
  unique (rfq_id, vendor_id)
);