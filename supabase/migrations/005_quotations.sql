create table quotations (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id),
  vendor_id uuid not null references profiles(id),
  status quotation_status not null default 'submitted',
  lead_time_days integer check (lead_time_days >= 0),
  total_amount numeric not null check (total_amount >= 0),
  attachment_url text,
  notes text,
  submitted_at timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

create table quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  rfq_item_id uuid not null references rfq_items(id),
  unit_price numeric not null check (unit_price >= 0),
  quantity numeric not null check (quantity > 0)
);