// Helper script to add waste classification + instructions to ProcessingBatch
// Run: node prisma/apply-batch-waste-fields.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Adding waste fields to ProcessingBatch...');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProcessingBatch"
      ADD COLUMN IF NOT EXISTS "wasteType" TEXT,
      ADD COLUMN IF NOT EXISTS "specificWasteItem" TEXT,
      ADD COLUMN IF NOT EXISTS "instructions" TEXT;
  `);

  console.log('ProcessingBatch waste fields added successfully!');
}

main()
  .catch(e => {
    console.error('Failed to add ProcessingBatch waste fields:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
