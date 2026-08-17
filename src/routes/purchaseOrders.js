const express = require('express')
const multer = require('multer')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')
const { notifyAdmins } = require('../services/notifications')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// GET /api/purchase-orders/mine — vendor: POs generated from their own awarded quotes
// Must stay before GET /:id, or Express treats "mine" as an :id value.
router.get('/mine', verifyToken, requireRole('vendor'), async (req, res) => {
  const { data: quotes, error: quotesError } = await supabase
    .from('quotations')
    .select('id')
    .eq('vendor_id', req.profile.id)
    .eq('status', 'awarded')

  if (quotesError) return res.status(500).json({ error: quotesError.message })

  const quotationIds = quotes.map((q) => q.id)
  if (quotationIds.length === 0) return res.json([])

  const { data: pos, error } = await supabase
    .from('purchase_orders')
    .select('*, quotations(rfq_id, rfqs(purchase_requisitions(department)))')
    .in('quotation_id', quotationIds)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const enriched = pos.map((po) => ({
    ...po,
    department: po.quotations?.rfqs?.purchase_requisitions?.department,
    has_ship_notice: !!po.ship_notice_path,
  }))

  res.json(enriched)
})

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

// GET /api/purchase-orders/:id — admin (full), the requesting alemic, or the winning vendor
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
    has_ship_notice: !!po.ship_notice_path,
  })
})

// GET /api/purchase-orders/:id/ship-notice-url — generates a short-lived
// signed URL on demand, instead of storing an expiring link in the DB
router.get('/:id/ship-notice-url', verifyToken, async (req, res) => {
  const { id } = req.params

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('ship_notice_path, quotations(vendor_id, rfqs(purchase_requisitions(requested_by)))')
    .eq('id', id)
    .single()

  if (poError || !po) return res.status(404).json({ error: 'Purchase order not found.' })
  if (!po.ship_notice_path) return res.status(404).json({ error: 'No ship notice uploaded yet.' })

  const isAdmin = req.profile.role === 'admin'
  const isVendorOwner = po.quotations?.vendor_id === req.profile.id
  const isRequestingAlemic = po.quotations?.rfqs?.purchase_requisitions?.requested_by === req.profile.id

  if (!isAdmin && !isVendorOwner && !isRequestingAlemic) {
    return res.status(403).json({ error: 'You do not have access to this file.' })
  }

  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(po.ship_notice_path, 60 * 5) // valid 5 minutes

  if (error) return res.status(500).json({ error: error.message })
  res.json({ url: data.signedUrl })
})

// PATCH /api/purchase-orders/:id/respond — vendor: accept or decline
router.patch('/:id/respond', verifyToken, requireRole('vendor'), async (req, res) => {
  const { id } = req.params
  const { action, decline_reason } = req.body

  if (!['accept', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'action must be accept or decline.' })
  }

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('id, status, po_number, quotations(vendor_id)')
    .eq('id', id)
    .single()

  if (poError || !po) return res.status(404).json({ error: 'Purchase order not found.' })
  if (po.quotations?.vendor_id !== req.profile.id) {
    return res.status(403).json({ error: 'You do not have access to this purchase order.' })
  }
  if (po.status !== 'issued') {
    return res.status(400).json({ error: `Cannot respond to a PO with status "${po.status}".` })
  }

  const updates = action === 'accept'
    ? { status: 'accepted', accepted_at: new Date().toISOString() }
    : { status: 'declined', declined_at: new Date().toISOString(), decline_reason: decline_reason || null }

  const { data, error } = await supabase
    .from('purchase_orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  notifyAdmins({
    title: action === 'accept' ? 'PO accepted' : 'PO declined',
    message: `Purchase order ${data.po_number} was ${action === 'accept' ? 'accepted' : 'declined'} by the vendor.`,
    link: `/admin/purchase-orders/${id}`,
    entityId: id,
    type: action === 'accept' ? 'po_accepted' : 'po_declined',
  }).catch((err) => console.error('notifyAdmins failed:', err.message))

  res.json(data)
})

// POST /api/purchase-orders/:id/ship-notice — vendor: upload a file, only after accepting
router.post('/:id/ship-notice', verifyToken, requireRole('vendor'), upload.single('file'), async (req, res) => {
  const { id } = req.params

  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' })

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('id, status, po_number, quotations(vendor_id)')
    .eq('id', id)
    .single()

  if (poError || !po) return res.status(404).json({ error: 'Purchase order not found.' })
  if (po.quotations?.vendor_id !== req.profile.id) {
    return res.status(403).json({ error: 'You do not have access to this purchase order.' })
  }
  if (po.status !== 'accepted') {
    return res.status(400).json({ error: 'Ship notice can only be uploaded after accepting the PO.' })
  }

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `ship-notices/${id}/${Date.now()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false })

  if (uploadError) return res.status(500).json({ error: uploadError.message })

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ ship_notice_path: path, shipped_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  notifyAdmins({
    title: 'Ship notice uploaded',
    message: `Vendor uploaded a ship notice for ${po.po_number}.`,
    link: `/admin/purchase-orders/${id}`,
    entityId: id,
    type: 'ship_notice',
  }).catch((err) => console.error('notifyAdmins failed:', err.message))

  res.json({ ...data, has_ship_notice: true })
})

module.exports = router