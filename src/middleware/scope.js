const { prisma } = require('../config/database');
const { AppError } = require('./errorHandler');

/**
 * Resolves the admin (company) ID that the current user belongs to.
 *
 * - SUPER_ADMIN → no scope restriction (sees all)
 * - ADMIN       → the admin record they created (they OWN the company)
 * - MANAGER     → the admin record that manages them (managedById)
 * - All others  → limited to their own records
 */
async function resolveAdminId(user) {
  if (user.role === 'SUPER_ADMIN') return null; // no filter
  if (user.role === 'ADMIN') {
    // ADMIN users have managedById pointing to their Admin record
    return user.adminManaged?.id || user.id;
  }
  if (user.role === 'MANAGER') {
    return user.managedById || null;
  }
  // For DRIVER, BUYER, SUPPLIER — they belong to an admin via managedById
  return user.managedById || null;
}

/**
 * Middleware that attaches an `adminScope` object to the request.
 * Use the helper methods inside route handlers to filter queries.
 */
async function scopeMiddleware(req, res, next) {
  try {
    const adminId = await resolveAdminId(req.user);
    req.adminScope = {
      adminId,
      /**
       * Returns a Prisma `where` clause that filters by admin/company.
       * Pass the relation field name that links to Admin.
       *
       * Examples:
       *   scope.farmFilter()              → { adminId: '...' }
       *   scope.filter('adminId')          → { adminId: '...' }
       *   scope.filter('farm', 'adminId')  → { farm: { adminId: '...' } }
       */
      filter(ownField = 'adminId', throughRelation = null) {
        if (!adminId) return {}; // SUPER_ADMIN sees all
        if (throughRelation) {
          return { [throughRelation]: { [ownField]: adminId } };
        }
        return { [ownField]: adminId };
      },
      /** Check if the given adminId matches the current user's scope. */
      owns(ownerId) {
        if (!adminId) return true; // SUPER_ADMIN owns everything
        return ownerId === adminId;
      },
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { scopeMiddleware, resolveAdminId };
