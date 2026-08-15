const express = require('express')
const router = express.Router()
const { auth } = require('../config/firebase')
const verifyToken = require('../middleware/auth')

router.get('/firebase-token', verifyToken, async (req, res) => {
  try {
    const token = await auth.createCustomToken(req.user.id)
    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router