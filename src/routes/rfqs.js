const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')
const { notifyVendors } = require('../services/notifications')

// POST /api/rfqs — admin: create an RFQ from an approved PR
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { requisition_id, deadline, items, vendor_ids } = req.body

  if (!requisition_id) return res.status(400).json({ error: 'requisition_id is required.' })
  if (!deadline) return res.status(400).json({ error: 'Deadline is required.' })
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Select at least one line item.' })
  }
  if (!Array.isArray(vendor_ids) || vendor_ids.length === 0) {
    return res.status(400).json({ error: 'Select at least one vendor.' })
  }
  for (const item of items) {
    if (!item.pr_line_item_id || !item.quantity || Number(item.quantity) <= 0) {
      return res.status(400).json({ error: 'Every RFQ line item needs a quantity greater than 0.' })
    }
  }

  const { data: pr, error: prError } = await supabase
    .from('purchase_requisitions')
    .select('id, status, department')
    .eq('id', requisition_id)
    .single()

  if (prError || !pr) return res.status(404).json({ error: 'Requisition not found.' })
  if (pr.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved requisitions can be sourced via RFQ.' })
  }

  const { data: prItems, error: prItemsError } = await supabase
    .from('pr_line_items')
    .select('id')
    .eq('requisition_id', requisition_id)

  if (prItemsError) return res.status(500).json({ error: prItemsError.message })

  const validItemIds = new Set(prItems.map((i) => i.id))
  const invalidItem = items.find((i) => !validItemIds.has(i.pr_line_item_id))
  if (invalidItem) {
    return res.status(400).json({ error: 'One or more line items do not belong to this requisition.' })
  }

  const { data: vendors, error: vendorsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'vendor')
    .in('id', vendor_ids)

  if (vendorsError) return res.status(500).json({ error: vendorsError.message })
  if (vendors.length !== vendor_ids.length) {
    return res.status(400).json({ error: 'One or more selected vendors are invalid.' })
  }

  const { data: rfq, error: rfqError } = await supabase
    .from('rfqs')
    .insert({ requisition_id, created_by: req.profile.id, deadline, status: 'open' })
    .select()
    .single()

  if (rfqError) return res.status(500).json({ error: rfqError.message })

  const rfqItems = items.map((item) => ({
    rfq_id: rfq.id,
    pr_line_item_id: item.pr_line_item_id,
    quantity: item.quantity,
  }))

  const { error: itemsError } = await supabase.from('rfq_items').insert(rfqItems)
  if (itemsError) {
    await supabase.from('rfqs').delete().eq('id', rfq.id)
    return res.status(500).json({ error: itemsError.message })
  }

  const rfqVendors = vendor_ids.map((vendor_id) => ({ rfq_id: rfq.id, vendor_id }))
  const { error: vendorInsertError } = await supabase.from('rfq_vendors').insert(rfqVendors)
  if (vendorInsertError) {
    await supabase.from('rfqs').delete().eq('id', rfq.id)
    return res.status(500).json({ error: vendorInsertError.message })
  }

  notifyVendors({
    vendorIds: vendor_ids,
    title: 'New RFQ invitation',
    message: `You've been invited to quote on a ${pr.department} requisition.`,
    link: `/vendor/rfqs/${rfq.id}`,
    entityId: rfq.id,
    type: 'rfq_invite',
  }).catch((err) => console.error('notifyVendors failed:', err.message))

  res.status(201).json({ ...rfq, items: rfqItems, vendor_ids })
})

// GET /api/rfqs/mine — vendor: RFQs this vendor has been invited to
// Must stay before GET /:id, or Express treats "mine" as an :id value.
router.get('/mine', verifyToken, requireRole('vendor'), async (req, res) => {
  const { data: invites, error } = await supabase
    .from('rfq_vendors')
    .select('responded, invited_at, rfqs(*, purchase_requisitions(department), rfq_items(id))')
    .eq('vendor_id', req.profile.id)
    .order('invited_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const enriched = invites.map((inv) => ({
    ...inv.rfqs,
    department: inv.rfqs?.purchase_requisitions?.department,
    item_count: inv.rfqs?.rfq_items?.length ?? 0,
    responded: inv.responded,
  }))

  res.json(enriched)
})

// GET /api/rfqs — admin: list all RFQs
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('rfqs')
    .select('*, purchase_requisitions(department), rfq_items(id), rfq_vendors(id)')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const enriched = data.map((rfq) => ({
    ...rfq,
    department: rfq.purchase_requisitions?.department,
    item_count: rfq.rfq_items?.length ?? 0,
    vendor_count: rfq.rfq_vendors?.length ?? 0,
  }))

  res.json(enriched)
})

// GET /api/rfqs/:id — admin (full access) or an invited vendor
// For vendors, also attaches their own quotation (if any) so the frontend
// can render a read-only "already quoted" view instead of the form.
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params

  const { data: rfq, error } = await supabase
    .from('rfqs')
    .select(`
      *,
      purchase_requisitions(id, department),
      rfq_items(*, pr_line_items(item_name, uom)),
      rfq_vendors(*, profiles(full_name, company_name))
    `)
    .eq('id', id)
    .single()

  if (error || !rfq) return res.status(404).json({ error: 'RFQ not found.' })

  const isAdmin = req.profile.role === 'admin'
  const isInvitedVendor = rfq.rfq_vendors.some((rv) => rv.vendor_id === req.profile.id)

  if (!isAdmin && !isInvitedVendor) {
    return res.status(403).json({ error: 'You do not have access to this RFQ.' })
  }

  let myQuotation = null
  if (req.profile.role === 'vendor') {
    const { data: quotation } = await supabase
      .from('quotations')
      .select('*, quotation_items(*)')
      .eq('rfq_id', id)
      .eq('vendor_id', req.profile.id)
      .maybeSingle()
    myQuotation = quotation || null
  }

  res.json({ ...rfq, my_quotation: myQuotation })
})

module.exports = router