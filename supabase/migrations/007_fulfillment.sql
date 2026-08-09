create table grns (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  received_by uuid not null references profiles(id),
  status grn_status not null default 'partial',
  notes text,
  received_at timestamptz not null default now()
);

create table grn_items (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references grns(id) on delete cascade,
  po_item_id uuid not null references po_items(id),
  quantity_received numeric not null check (quantity_received >= 0),
  condition text default 'good'
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  po_id uuid not null references purchase_orders(id),
  grn_id uuid references grns(id),
  vendor_id uuid not null references profiles(id),
  amount numeric not null check (amount >= 0),
  status invoice_status not null default 'submitted',
  attachment_url text,
  match_notes text,
  submitted_at timestamptz not null default now(),
  unique (po_id, invoice_number)
);