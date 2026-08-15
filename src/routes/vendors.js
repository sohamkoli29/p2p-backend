const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const verifyToken = require('../middleware/auth')
const requireRole = require('../middleware/requireRole')

// GET /api/vendors — admin: list all vendor accounts, for RFQ invitations
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, company_name')
    .eq('role', 'vendor')
    .order('full_name')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router