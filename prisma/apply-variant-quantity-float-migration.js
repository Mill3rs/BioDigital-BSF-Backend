// Helper script to widen ProductVariant.quantity from Int to Double precision so
// fractional (2-decimal) quantities can be stored.
// Run: node prisma/apply-variant-quantity-float-migration.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Widening ProductVariant.quantity to double precision...');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductVariant"
      ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::double precision;
  `);

  console.log('ProductVariant.quantity widened successfully!');
}

main()
  .catch((e) => {
    console.error('Failed to widen ProductVariant.quantity:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
