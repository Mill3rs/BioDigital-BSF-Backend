#!/usr/bin/env node
// ============================================================
// BioDigital BSF — Repair malformed stored upload URLs
// ============================================================
// The product image upload route used to build URLs from multer's `file.path`,
// which is an ABSOLUTE filesystem path. That produced values like:
//
//   http://localhost:3000//Applications/.../uploads/images/products/x.png
//
// which the browser cannot fetch (broken image) and which leaked the server's
// directory layout. Every stored upload URL is meant to be a relative
// '/uploads/...' path — see resolveImageUrl() on the web client.
//
// This script rewrites any stored upload URL that still carries a scheme, host
// or absolute filesystem prefix back to its relative form. It is idempotent:
// values that already start with '/uploads/' are left untouched.
//
// Usage:
//   node scripts/fix-upload-urls.js            # dry run
//   node scripts/fix-upload-urls.js --apply    # write changes
// ============================================================

const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const MARKER = '/uploads/';

/**
 * Reduce a stored upload URL to its relative '/uploads/...' form.
 * Returns null when there is nothing to change (already relative, or not an
 * upload path at all — e.g. an external avatar URL or a data URI).
 */
function normalizeUploadUrl(value) {
  if (typeof value !== 'string' || !value) return null;

  const index = value.indexOf(MARKER);
  if (index === -1) return null; // not an upload path
  if (index === 0) return null; // already relative — nothing to do

  return value.slice(index);
}

async function main() {
  const changes = [];

  // --- Product.images -------------------------------------------------------
  const products = await prisma.product.findMany({
    select: { id: true, name: true, images: true },
  });

  for (const product of products) {
    const images = product.images || [];
    const fixed = images.map((img) => normalizeUploadUrl(img) ?? img);
    if (fixed.some((img, i) => img !== images[i])) {
      changes.push({
        model: 'Product',
        id: product.id,
        label: product.name,
        before: images,
        after: fixed,
        apply: () =>
          prisma.product.update({ where: { id: product.id }, data: { images: fixed } }),
      });
    }
  }

  // --- ProductVariant.images ------------------------------------------------
  const variants = await prisma.productVariant.findMany({
    select: { id: true, name: true, images: true },
  });

  for (const variant of variants) {
    const images = variant.images || [];
    const fixed = images.map((img) => normalizeUploadUrl(img) ?? img);
    if (fixed.some((img, i) => img !== images[i])) {
      changes.push({
        model: 'ProductVariant',
        id: variant.id,
        label: variant.name,
        before: images,
        after: fixed,
        apply: () =>
          prisma.productVariant.update({ where: { id: variant.id }, data: { images: fixed } }),
      });
    }
  }

  if (changes.length === 0) {
    console.log('✅  No malformed upload URLs found — nothing to do.');
    return;
  }

  console.log(`\nFound ${changes.length} record(s) with malformed upload URLs:\n`);

  for (const change of changes) {
    console.log(`  • ${change.model} "${change.label}" (${change.id})`);
    change.before.forEach((url, i) => {
      if (url !== change.after[i]) {
        console.log(`      - ${url}`);
        console.log(`      + ${change.after[i]}`);
      }
    });
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write.\n');
    return;
  }

  for (const change of changes) await change.apply();

  console.log(`\n✅  Repaired ${changes.length} record(s).\n`);
}

main()
  .catch((err) => {
    console.error(`\n❌  ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
