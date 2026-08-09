-- Enable RLS on every table
alter table profiles enable row level security;
alter table purchase_requisitions enable row level security;
alter table pr_line_items enable row level security;
alter table rfqs enable row level security;
alter table rfq_items enable row level security;
alter table rfq_vendors enable row level security;
alter table quotations enable row level security;
alter table quotation_items enable row level security;
alter table purchase_orders enable row level security;
alter table po_items enable row level security;
alter table grns enable row level security;
alter table grn_items enable row level security;
alter table invoices enable row level security;

-- Helper: current user's role, reused across policies
create function auth_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- ── profiles ──────────────────────────────────────────
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or auth_role() = 'admin');

create policy "profiles_update_own"
  on profiles for update
  using (id = auth.uid());

-- ── purchase_requisitions ─────────────────────────────
create policy "pr_select_own_or_admin"
  on purchase_requisitions for select
  using (requested_by = auth.uid() or auth_role() = 'admin');

create policy "pr_insert_alemic"
  on purchase_requisitions for insert
  with check (auth_role() = 'alemic' and requested_by = auth.uid());

create policy "pr_update_own_draft_or_admin"
  on purchase_requisitions for update
  using ((requested_by = auth.uid() and status = 'draft') or auth_role() = 'admin');

-- ── pr_line_items ──────────────────────────────────────
create policy "pr_items_select_via_parent"
  on pr_line_items for select
  using (exists (
    select 1 from purchase_requisitions pr
    where pr.id = requisition_id
    and (pr.requested_by = auth.uid() or auth_role() = 'admin')
  ));

create policy "pr_items_insert_owner"
  on pr_line_items for insert
  with check (exists (
    select 1 from purchase_requisitions pr
    where pr.id = requisition_id and pr.requested_by = auth.uid()
  ));

-- ── rfqs ────────────────────────────────────────────────
create policy "rfqs_admin_full_access"
  on rfqs for all
  using (auth_role() = 'admin');

create policy "rfqs_vendor_select_invited"
  on rfqs for select
  using (exists (
    select 1 from rfq_vendors rv where rv.rfq_id = id and rv.vendor_id = auth.uid()
  ));

create policy "rfqs_alemic_select_own_requisition"
  on rfqs for select
  using (exists (
    select 1 from purchase_requisitions pr
    where pr.id = requisition_id and pr.requested_by = auth.uid()
  ));

-- ── rfq_items ───────────────────────────────────────────
create policy "rfq_items_admin_full_access"
  on rfq_items for all
  using (auth_role() = 'admin');

create policy "rfq_items_select_via_rfq"
  on rfq_items for select
  using (exists (
    select 1 from rfqs r
    left join rfq_vendors rv on rv.rfq_id = r.id
    left join purchase_requisitions pr on pr.id = r.requisition_id
    where r.id = rfq_id
    and (rv.vendor_id = auth.uid() or pr.requested_by = auth.uid())
  ));

-- ── rfq_vendors ─────────────────────────────────────────
create policy "rfq_vendors_admin_full_access"
  on rfq_vendors for all
  using (auth_role() = 'admin');

create policy "rfq_vendors_select_own"
  on rfq_vendors for select
  using (vendor_id = auth.uid());

-- ── quotations ──────────────────────────────────────────
create policy "quotations_vendor_manage_own"
  on quotations for all
  using (vendor_id = auth.uid())
  with check (vendor_id = auth.uid());

create policy "quotations_admin_full_access"
  on quotations for all
  using (auth_role() = 'admin');

-- ── quotation_items ─────────────────────────────────────
create policy "quotation_items_admin_full_access"
  on quotation_items for all
  using (auth_role() = 'admin');

create policy "quotation_items_vendor_manage_own"
  on quotation_items for all
  using (exists (
    select 1 from quotations q where q.id = quotation_id and q.vendor_id = auth.uid()
  ));

-- ── purchase_orders ─────────────────────────────────────
create policy "po_admin_full_access"
  on purchase_orders for all
  using (auth_role() = 'admin');

create policy "po_vendor_select_own"
  on purchase_orders for select
  using (exists (
    select 1 from quotations q where q.id = quotation_id and q.vendor_id = auth.uid()
  ));

create policy "po_vendor_update_status"
  on purchase_orders for update
  using (exists (
    select 1 from quotations q where q.id = quotation_id and q.vendor_id = auth.uid()
  ));

-- ── po_items ────────────────────────────────────────────
create policy "po_items_admin_full_access"
  on po_items for all
  using (auth_role() = 'admin');

create policy "po_items_vendor_select"
  on po_items for select
  using (exists (
    select 1 from purchase_orders po
    join quotations q on q.id = po.quotation_id
    where po.id = po_id and q.vendor_id = auth.uid()
  ));

-- ── grns ────────────────────────────────────────────────
create policy "grns_admin_full_access"
  on grns for all
  using (auth_role() = 'admin');

create policy "grns_alemic_manage_own"
  on grns for all
  using (received_by = auth.uid())
  with check (received_by = auth.uid());

-- ── grn_items ───────────────────────────────────────────
create policy "grn_items_admin_full_access"
  on grn_items for all
  using (auth_role() = 'admin');

create policy "grn_items_alemic_manage_own"
  on grn_items for all
  using (exists (
    select 1 from grns g where g.id = grn_id and g.received_by = auth.uid()
  ));

-- ── invoices ────────────────────────────────────────────
create policy "invoices_admin_full_access"
  on invoices for all
  using (auth_role() = 'admin');

create policy "invoices_vendor_manage_own"
  on invoices for all
  using (vendor_id = auth.uid())
  with check (vendor_id = auth.uid());