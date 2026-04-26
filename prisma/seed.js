#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

const SUPER_ADMIN = {
  email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@biodigital.com',
  password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!',
  fullName: 'Super Admin',
  phoneNumber: '+233200000000',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
};

async function main() {
  console.log('🌱 Seeding default super admin...');

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, 12);

  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: {},
    create: {
      email: SUPER_ADMIN.email,
      password: hashedPassword,
      fullName: SUPER_ADMIN.fullName,
      phoneNumber: SUPER_ADMIN.phoneNumber,
      role: SUPER_ADMIN.role,
      status: SUPER_ADMIN.status,
      emailVerified: true,
    },
  });

  console.log(`✅ Super admin ready: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
