#!/usr/bin/env node
// ============================================================
// BioDigital BSF — Reset / Create Super Admin
// ============================================================
// Uses bcryptjs (same library as auth.js) so the hash is
// always compatible with the login route.
//
// Usage:
//   node scripts/reset_admin.js
//
// Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars to
// override the defaults, or edit the constants below.
// ============================================================

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

// ⚠ normalizeEmail() in auth.js strips dots from Gmail local-parts by default.
// The email stored in the DB must match the normalised form so login lookups work.
// e.g. 'anansis.systems@gmail.com' → 'anansissystems@gmail.com'
const RAW_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'anansis.systems@gmail.com';
// Replicate express-validator normalizeEmail: lowercase + remove dots for gmail
const EMAIL = (() => {
  const lower = RAW_EMAIL.toLowerCase();
  const [local, domain] = lower.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return local.replace(/\./g, '') + '@' + domain;
  }
  return lower;
})();
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Admin123@';
const COMPANY  = 'BioDigital BSF';
const PHONE    = '+233200000000';
const COUNTRY  = 'Ghana';

async function main() {
  console.log(`\n🔐  Hashing password with bcryptjs (10 rounds)…`);
  const hash = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  if (existing) {
    // Update password only
    await prisma.user.update({
      where: { email: EMAIL },
      data: {
        password:  hash,
        role:      'SUPER_ADMIN',
        status:    'ACTIVE',
        emailVerified: true,
        updatedAt: new Date(),
      },
    });
    console.log(`✅  Password updated for existing super admin: ${EMAIL}`);
  } else {
    // Create Admin org record first
    const admin = await prisma.admin.create({
      data: {
        companyName:  COMPANY,
        country:      COUNTRY,
        phoneNumber:  PHONE,
        subscription: 'ACTIVE',
      },
    });

    // Create User linked to org
    await prisma.user.create({
      data: {
        email:         EMAIL,
        password:      hash,
        fullName:      'Super Admin',
        phoneNumber:   PHONE,
        role:          'SUPER_ADMIN',
        status:        'ACTIVE',
        emailVerified: true,
        managedById:   admin.id,
      },
    });

    console.log(`✅  Super admin created: ${EMAIL}`);
  }

  console.log(`\n   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`\n⚠️   Change the password immediately after first login.\n`);
}

main()
  .catch((err) => {
    console.error('❌  Failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
