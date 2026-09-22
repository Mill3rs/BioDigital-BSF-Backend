#!/usr/bin/env node
// ============================================================
// BioDigital BSF — Backfill missing Product.createdById
// ============================================================
// The bagging-approval flow in src/routes/post-processing.js used to
// create catalogue products without `createdById`. Per-company scoping
// (productCompanyScopes in src/routes/products.js) hides any product
// that has neither a farm link nor a creator, so a product produced
// from a farm-less batch was invisible to the company that made it
// even though it existed in the database.
//
// This script restores the ownership link on already-written rows.
// It is idempotent: it only touches products whose createdById is null.
//
// Usage:
//   node scripts/backfill-product-ownership.js                 # dry run
//   node scripts/backfill-product-ownership.js --apply         # write changes
//   node scripts/backfill-product-ownership.js --apply --email admin@company.com
//
// Ownership is inferred from the product's farm when it has one.
// Otherwise the ADMIN user given by --email (or ADMIN_EMAIL env var) is
// used, falling back to the only ADMIN user in the database.
// ============================================================

const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const emailArg = (() => {
  const i = args.indexOf('--email');
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return process.env.ADMIN_EMAIL || null;
})();

async function resolveFallbackOwner() {
  if (emailArg) {
    const user = await prisma.user.findUnique({
      where: { email: emailArg },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (!user) throw new Error(`No user found with email ${emailArg}`);
    return user;
  }

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, fullName: true, email: true, role: true },
  });

  if (admins.length === 0) {
    throw new Error('No ADMIN user found — pass --email <address> to choose an owner');
  }
  if (admins.length > 1) {
    throw new Error(
      `Multiple ADMIN users found (${admins.map((a) => a.email).join(', ')}) — pass --email <address> to choose an owner`,
    );
  }
  return admins[0];
}

async function main() {
  const orphans = await prisma.product.findMany({
    where: { createdById: null },
    select: { id: true, name: true, farmId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (orphans.length === 0) {
    console.log('✅  No products with a missing createdById — nothing to do.');
    return;
  }

  console.log(`\nFound ${orphans.length} product(s) with no owner:\n`);

  // Fallback owner is only needed for products that have no farm either.
  const needsFallback = orphans.some((p) => !p.farmId);
  const fallbackOwner = needsFallback ? await resolveFallbackOwner() : null;

  const plan = [];

  for (const product of orphans) {
    let owner = null;
    let source = '';

    if (product.farmId) {
      const farm = await prisma.farm.findUnique({
        where: { id: product.farmId },
        select: { id: true, name: true, adminId: true, managerId: true },
      });

      if (farm) {
        // Prefer the farm's manager, else any ADMIN belonging to the company.
        if (farm.managerId) {
          owner = await prisma.user.findUnique({
            where: { id: farm.managerId },
            select: { id: true, fullName: true, email: true },
          });
          if (owner) source = `farm "${farm.name}" manager`;
        }
        if (!owner && farm.adminId) {
          owner = await prisma.user.findFirst({
            where: { role: 'ADMIN', managedById: farm.adminId },
            select: { id: true, fullName: true, email: true },
          });
          if (owner) source = `farm "${farm.name}" company admin`;
        }
      }
    }

    if (!owner && fallbackOwner) {
      owner = fallbackOwner;
      source = 'fallback admin';
    }

    plan.push({ product, owner, source });
  }

  for (const { product, owner, source } of plan) {
    const when = product.createdAt ? product.createdAt.toISOString() : 'unknown';
    if (owner) {
      console.log(`  • "${product.name}"  (created ${when})`);
      console.log(`      → ${owner.fullName || owner.email} <${owner.email}>  [${source}]`);
    } else {
      console.log(`  • "${product.name}"  (created ${when})`);
      console.log('      → NO OWNER RESOLVED — skipped');
    }
  }

  const applicable = plan.filter((p) => p.owner);

  if (!APPLY) {
    console.log(
      `\nDry run — ${applicable.length} product(s) would be updated. Re-run with --apply to write.\n`,
    );
    return;
  }

  for (const { product, owner } of applicable) {
    await prisma.product.update({
      where: { id: product.id },
      data: { createdById: owner.id },
    });
  }

  console.log(`\n✅  Backfilled createdById on ${applicable.length} product(s).\n`);
}

main()
  .catch((err) => {
    console.error(`\n❌  ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
