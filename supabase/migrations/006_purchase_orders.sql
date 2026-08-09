create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  quotation_id uuid not null references quotations(id),
  status po_status not null default 'issued',
  total_amount numeric not null check (total_amount >= 0),
  created_at timestamptz not null default now()
);

create table po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  quotation_item_id uuid not null references quotation_items(id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0)
);