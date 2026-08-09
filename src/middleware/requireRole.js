// Usage: router.get('/admin-only', verifyToken, requireRole('admin'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.profile) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    if (!allowedRoles.includes(req.profile.role)) {
      return res.status(403).json({
        error: `Access denied — requires role: ${allowedRoles.join(' or ')}`,
      })
    }

    next()
  }
}

module.exports = requireRole