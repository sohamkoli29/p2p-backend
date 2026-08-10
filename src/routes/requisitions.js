const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')

// POST /api/requisitions — create a PR with line items
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

  // Step 1: create the PR
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

  // Step 2: create line items
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
    // Compensating rollback — Supabase's REST API has no cross-table
    // transaction here, so we manually undo the PR insert on failure.
    await supabase.from('purchase_requisitions').delete().eq('id', pr.id)
    return res.status(500).json({ error: itemsError.message })
  }

  res.status(201).json({ ...pr, items: lineItems })
})

// GET /api/requisitions/mine — the logged-in alemic's own requisitions
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

module.exports = router