// Helper script to apply the guest-checkout migration: make Order.customerId
// nullable and add the guest contact columns.
// Run: node prisma/apply-guest-checkout-migration.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Applying guest-checkout changes to Order...');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Order" ALTER COLUMN "customerId" DROP NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Order"
      ADD COLUMN IF NOT EXISTS "isGuest" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "guestName" TEXT,
      ADD COLUMN IF NOT EXISTS "guestEmail" TEXT,
      ADD COLUMN IF NOT EXISTS "guestPhone" TEXT;
  `);

  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Order'
      AND column_name IN ('isGuest','guestName','guestEmail','guestPhone')
    ORDER BY column_name;
  `);
  console.log('Order guest columns:', JSON.stringify(cols));
}

main()
  .catch((e) => {
    console.error('Failed to apply guest-checkout migration:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
