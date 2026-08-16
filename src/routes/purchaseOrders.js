    const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')

// GET /api/purchase-orders — admin: list all POs
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { data: pos, error } = await supabase
    .from('purchase_orders')
    .select('*, quotations(vendor_id, rfq_id, profiles(full_name, company_name), rfqs(purchase_requisitions(department)))')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const enriched = pos.map((po) => ({
    ...po,
    vendor_name: po.quotations?.profiles?.full_name,
    company_name: po.quotations?.profiles?.company_name,
    department: po.quotations?.rfqs?.purchase_requisitions?.department,
  }))

  res.json(enriched)
})

// GET /api/purchase-orders/:id — admin (full), the requesting alemic
// (read-only), or the winning vendor (read-only — used from Day 12 onward)
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params

  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      po_items(*, quotation_items(*, rfq_items(pr_line_items(item_name, uom)))),
      quotations(vendor_id, rfq_id, profiles(full_name, company_name),
        rfqs(purchase_requisitions(id, department, requested_by)))
    `)
    .eq('id', id)
    .single()

  if (error || !po) return res.status(404).json({ error: 'Purchase order not found.' })

  const isAdmin = req.profile.role === 'admin'
  const isVendorOwner = po.quotations?.vendor_id === req.profile.id
  const isRequestingAlemic = po.quotations?.rfqs?.purchase_requisitions?.requested_by === req.profile.id

  if (!isAdmin && !isVendorOwner && !isRequestingAlemic) {
    return res.status(403).json({ error: 'You do not have access to this purchase order.' })
  }

  res.json({
    ...po,
    vendor_name: po.quotations?.profiles?.full_name,
    company_name: po.quotations?.profiles?.company_name,
    department: po.quotations?.rfqs?.purchase_requisitions?.department,
  })
})

module.exports = router