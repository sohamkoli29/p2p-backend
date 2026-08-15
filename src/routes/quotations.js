const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')
const { notifyAdmins } = require('../services/notifications')

// POST /api/quotations — vendor: submit a quote for an RFQ they were invited to
router.post('/', verifyToken, requireRole('vendor'), async (req, res) => {
  const { rfq_id, lead_time_days, notes, items } = req.body

  if (!rfq_id) return res.status(400).json({ error: 'rfq_id is required.' })
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one priced item is required.' })
  }
  for (const item of items) {
    if (!item.rfq_item_id || item.unit_price === undefined || Number(item.unit_price) < 0) {
      return res.status(400).json({ error: 'Every item needs a valid unit price.' })
    }
    if (!item.quantity || Number(item.quantity) <= 0) {
      return res.status(400).json({ error: 'Every item needs a quantity greater than 0.' })
    }
  }

  const { data: rfq, error: rfqError } = await supabase
    .from('rfqs')
    .select('id, status, deadline')
    .eq('id', rfq_id)
    .single()

  if (rfqError || !rfq) return res.status(404).json({ error: 'RFQ not found.' })
  if (rfq.status !== 'open') return res.status(400).json({ error: 'This RFQ is no longer accepting quotes.' })
  if (new Date(rfq.deadline) < new Date()) return res.status(400).json({ error: 'The quote deadline has passed.' })

  const { data: invite, error: inviteError } = await supabase
    .from('rfq_vendors')
    .select('id, responded')
    .eq('rfq_id', rfq_id)
    .eq('vendor_id', req.profile.id)
    .maybeSingle()

  if (inviteError) return res.status(500).json({ error: inviteError.message })
  if (!invite) return res.status(403).json({ error: 'You were not invited to this RFQ.' })
  if (invite.responded) return res.status(400).json({ error: 'You have already submitted a quote for this RFQ.' })

  const { data: rfqItems, error: rfqItemsError } = await supabase
    .from('rfq_items')
    .select('id')
    .eq('rfq_id', rfq_id)

  if (rfqItemsError) return res.status(500).json({ error: rfqItemsError.message })

  const validIds = new Set(rfqItems.map((i) => i.id))
  const invalidItem = items.find((i) => !validIds.has(i.rfq_item_id))
  if (invalidItem) return res.status(400).json({ error: 'One or more items do not belong to this RFQ.' })

  const totalAmount = items.reduce((sum, i) => sum + Number(i.unit_price) * Number(i.quantity), 0)

  const { data: quotation, error: quoteError } = await supabase
    .from('quotations')
    .insert({
      rfq_id,
      vendor_id: req.profile.id,
      status: 'submitted',
      lead_time_days: lead_time_days || null,
      total_amount: totalAmount,
      notes: notes || null,
    })
    .select()
    .single()

  if (quoteError) return res.status(500).json({ error: quoteError.message })

  const quotationItems = items.map((item) => ({
    quotation_id: quotation.id,
    rfq_item_id: item.rfq_item_id,
    unit_price: item.unit_price,
    quantity: item.quantity,
  }))

  const { error: itemsError } = await supabase.from('quotation_items').insert(quotationItems)
  if (itemsError) {
    await supabase.from('quotations').delete().eq('id', quotation.id)
    return res.status(500).json({ error: itemsError.message })
  }

  await supabase.from('rfq_vendors').update({ responded: true }).eq('id', invite.id)

  notifyAdmins({
    title: 'New quote received',
    message: `${req.profile.full_name} submitted a quote.`,
    link: `/admin/rfqs/${rfq_id}`,
    entityId: rfq_id,
    type: 'quote_submitted',
  }).catch((err) => console.error('notifyAdmins failed:', err.message))

  res.status(201).json({ ...quotation, items: quotationItems })
})

module.exports = router