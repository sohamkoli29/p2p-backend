const express = require('express')
const router = express.Router()
const verifyToken = require('../middleware/auth')

// Protected route — proves the JWT + role pipeline works end to end
router.get('/me', verifyToken, (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email },
    profile: req.profile,
  })
})

module.exports = router