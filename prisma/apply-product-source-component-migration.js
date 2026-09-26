// Helper script to add Product.sourceComponent (LARVAE | FRASS | RESIDUE) and
// backfill it from each product's catalogue category.
// Run: node prisma/apply-product-source-component-migration.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Adding sourceComponent to Product...');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
      ADD COLUMN IF NOT EXISTS "sourceComponent" TEXT;
  `);

  console.log('Backfilling sourceComponent from category...');

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "sourceComponent" = CASE
      WHEN "category" IN ('PROTEIN_FEED', 'FRESH_LARVAE', 'DRIED_LARVAE', 'INSECT_OIL') THEN 'LARVAE'
      WHEN "category" IN ('ORGANIC_FERTILIZER', 'LIQUID_FERTILIZER') THEN 'FRASS'
      WHEN "category" IN ('COMPOST', 'SOIL_CONDITIONER', 'BIOCHAR') THEN 'RESIDUE'
      ELSE "sourceComponent"
    END
    WHERE "sourceComponent" IS NULL
      AND "category" IN (
        'PROTEIN_FEED', 'FRESH_LARVAE', 'DRIED_LARVAE', 'INSECT_OIL',
        'ORGANIC_FERTILIZER', 'LIQUID_FERTILIZER',
        'COMPOST', 'SOIL_CONDITIONER', 'BIOCHAR'
      );
  `);

  console.log(`Product sourceComponent ready. Rows backfilled: ${updated}`);
}

main()
  .catch((e) => {
    console.error('Failed to add/backfill Product sourceComponent:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
