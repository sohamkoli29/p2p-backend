const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')

// POST /api/requisitions — create a PR with line items (Day 5)
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

  res.status(201).json({ ...pr, items: lineItems })
})

// GET /api/requisitions/mine — the logged-in alemic's own requisitions (Day 5)
// NOTE: this must stay registered before GET /:id, or Express will treat
// "mine" as an :id value.
router.get('/mine', verifyToken, requireRole('alemic'), async (req, res) => {
  const { data, error } = await supabase
    .from('purchase_requisitions')
    .select('*, pr_line_items(*)')
    .eq('requested_by', req.profile.id)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(data)
})

// GET /api/requisitions — admin: list all, optionally filtered by ?status=
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { status } = req.query

  let query = supabase
    .from('purchase_requisitions')
    .select('*, pr_line_items(*)')
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data: requisitions, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  if (requisitions.length === 0) {
    return res.json([])
  }

  // Attach requester name/department manually — avoids depending on
  // Supabase's auto-generated foreign key constraint name for embeds.
  const requesterIds = [...new Set(requisitions.map((pr) => pr.requested_by))]
  const { data: requesters, error: reqError } = await supabase
    .from('profiles')
    .select('id, full_name, department')
    .in('id', requesterIds)

  if (reqError) return res.status(500).json({ error: reqError.message })

  const requesterMap = Object.fromEntries(requesters.map((r) => [r.id, r]))
  const enriched = requisitions.map((pr) => ({
    ...pr,
    requester: requesterMap[pr.requested_by] || null,
  }))

  res.json(enriched)
})

// GET /api/requisitions/:id — admin (any PR) or alemic (own PR only)
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

  res.json({ ...pr, requester })
})

// PATCH /api/requisitions/:id — admin: approve or reject a submitted PR
router.patch('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params
  const { status, admin_notes } = req.body

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected.' })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('purchase_requisitions')
    .select('status')
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
  res.json(data)
})

module.exports = router