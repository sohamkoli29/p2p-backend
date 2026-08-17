const express = require('express')
const multer = require('multer')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')
const { notifyAdmins, notifyUser } = require('../services/notifications')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// POST /api/requisitions
router.post('/', verifyToken, requireRole('alemic'), async (req, res) => {
  const { department, justification, status, items } = req.body

  if (!department || typeof department !== 'string') {
    return res.status(400).json({ error: 'Department is required.' })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required.' })
  }
  if (!['draft', 'submitted'].includes(status)) {
    return res.status(400).json({ error: 'Status must be draft or submitted.' })
  }
  for (const item of items) {
    if (!item.item_name || !item.quantity || Number(item.quantity) <= 0) {
      return res.status(400).json({ error: 'Every line item needs a name and a quantity greater than 0.' })
    }
  }

  const { data: pr, error: prError } = await supabase
    .from('purchase_requisitions')
    .insert({
      requested_by: req.profile.id,
      department,
      justification: justification || null,
      status,
    })
    .select()
    .single()

  if (prError) {
    return res.status(500).json({ error: prError.message })
  }

  const lineItems = items.map((item) => ({
    requisition_id: pr.id,
    item_name: item.item_name,
    description: item.description || null,
    quantity: item.quantity,
    uom: item.uom || 'unit',
    estimated_unit_price: item.estimated_unit_price || null,
  }))

  const { error: itemsError } = await supabase.from('pr_line_items').insert(lineItems)

  if (itemsError) {
    await supabase.from('purchase_requisitions').delete().eq('id', pr.id)
    return res.status(500).json({ error: itemsError.message })
  }

  if (status === 'submitted') {
    notifyAdmins({
      title: 'New requisition awaiting approval',
      message: `${req.profile.full_name} (${department}) submitted a requisition.`,
      link: `/admin/requisitions/${pr.id}`,
      entityId: pr.id,
      type: 'pr_submitted',
    }).catch((err) => console.error('notifyAdmins failed:', err.message))
  }

  res.status(201).json({ ...pr, items: lineItems })
})

// GET /api/requisitions/mine
router.get('/mine', verifyToken, requireRole('alemic'), async (req, res) => {
  const { data, error } = await supabase
    .from('purchase_requisitions')
    .select('*, pr_line_items(*)')
    .eq('requested_by', req.profile.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/requisitions — admin, optionally filtered by ?status=
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { status } = req.query

  let query = supabase
    .from('purchase_requisitions')
    .select('*, pr_line_items(*)')
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: requisitions, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  if (requisitions.length === 0) return res.json([])

  const requesterIds = [...new Set(requisitions.map((pr) => pr.requested_by))]
  const { data: requesters, error: reqError } = await supabase
    .from('profiles')
    .select('id, full_name, department')
    .in('id', requesterIds)

  if (reqError) return res.status(500).json({ error: reqError.message })

  const requesterMap = Object.fromEntries(requesters.map((r) => [r.id, r]))
  const enriched = requisitions.map((pr) => ({ ...pr, requester: requesterMap[pr.requested_by] || null }))

  res.json(enriched)
})

// GET /api/requisitions/:id — now includes attachments list + linked PO
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params

  const { data: pr, error } = await supabase
    .from('purchase_requisitions')
    .select('*, pr_line_items(*)')
    .eq('id', id)
    .single()

  if (error || !pr) return res.status(404).json({ error: 'Requisition not found.' })

  const isOwner = pr.requested_by === req.profile.id
  const isAdmin = req.profile.role === 'admin'
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'You do not have access to this requisition.' })
  }

  const { data: requester } = await supabase
    .from('profiles')
    .select('id, full_name, department')
    .eq('id', pr.requested_by)
    .single()

  const { data: attachments } = await supabase
    .from('pr_attachments')
    .select('id, file_name, uploaded_at')
    .eq('requisition_id', id)
    .order('uploaded_at', { ascending: false })

  let purchaseOrder = null
  const { data: relatedRfq } = await supabase
    .from('rfqs')
    .select('id')
    .eq('requisition_id', id)
    .eq('status', 'awarded')
    .maybeSingle()

  if (relatedRfq) {
    const { data: awardedQuote } = await supabase
      .from('quotations')
      .select('id')
      .eq('rfq_id', relatedRfq.id)
      .eq('status', 'awarded')
      .maybeSingle()

    if (awardedQuote) {
      const { data: po } = await supabase
        .from('purchase_orders')
        .select('id, po_number, status, total_amount')
        .eq('quotation_id', awardedQuote.id)
        .maybeSingle()
      purchaseOrder = po || null
    }
  }

  res.json({ ...pr, requester, purchase_order: purchaseOrder, attachments: attachments || [] })
})

// POST /api/requisitions/:id/attachments — alemic: upload a supporting file to their own PR
router.post('/:id/attachments', verifyToken, requireRole('alemic'), upload.single('file'), async (req, res) => {
  const { id } = req.params
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' })

  const { data: pr, error: prError } = await supabase
    .from('purchase_requisitions')
    .select('id, requested_by')
    .eq('id', id)
    .single()

  if (prError || !pr) return res.status(404).json({ error: 'Requisition not found.' })
  if (pr.requested_by !== req.profile.id) {
    return res.status(403).json({ error: 'You do not have access to this requisition.' })
  }

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `pr-attachments/${id}/${Date.now()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false })

  if (uploadError) return res.status(500).json({ error: uploadError.message })

  const { data, error } = await supabase
    .from('pr_attachments')
    .insert({ requisition_id: id, file_path: path, file_name: req.file.originalname, uploaded_by: req.profile.id })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// GET /api/requisitions/:id/attachments/:attachmentId/url — signed URL, admin or PR owner
router.get('/:id/attachments/:attachmentId/url', verifyToken, async (req, res) => {
  const { id, attachmentId } = req.params

  const { data: pr, error: prError } = await supabase
    .from('purchase_requisitions')
    .select('id, requested_by')
    .eq('id', id)
    .single()

  if (prError || !pr) return res.status(404).json({ error: 'Requisition not found.' })

  const isAdmin = req.profile.role === 'admin'
  const isOwner = pr.requested_by === req.profile.id
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'You do not have access to this requisition.' })

  const { data: attachment, error: attError } = await supabase
    .from('pr_attachments')
    .select('file_path')
    .eq('id', attachmentId)
    .eq('requisition_id', id)
    .single()

  if (attError || !attachment) return res.status(404).json({ error: 'Attachment not found.' })

  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(attachment.file_path, 60 * 5)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ url: data.signedUrl })
})

// PATCH /api/requisitions/:id — approve/reject
router.patch('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params
  const { status, admin_notes } = req.body

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected.' })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('purchase_requisitions')
    .select('status, requested_by, department')
    .eq('id', id)
    .single()

  if (fetchError || !existing) return res.status(404).json({ error: 'Requisition not found.' })
  if (existing.status !== 'submitted') {
    return res.status(400).json({ error: `Cannot review a requisition with status "${existing.status}".` })
  }

  const { data, error } = await supabase
    .from('purchase_requisitions')
    .update({
      status,
      admin_notes: admin_notes || null,
      reviewed_by: req.profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  notifyUser({
    userId: existing.requested_by,
    title: status === 'approved' ? 'Requisition approved' : 'Requisition returned',
    message: `Your requisition for ${existing.department} was ${status}.`,
    link: `/dept/requisitions/${id}`,
    entityId: id,
    type: status === 'approved' ? 'pr_approved' : 'pr_rejected',
  }).catch((err) => console.error('notifyUser failed:', err.message))

  res.json(data)
})

module.exports = router