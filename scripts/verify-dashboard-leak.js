/**
 * Verifies the exact dashboard leak: an ADMIN whose company has NO farms must
 * not see another company's farm-less waste/orders in /admin/stats/summary
 * scoping. Runs against the local dev DB.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://iso_test:iso_test123@localhost:5432/biodigital' } },
});

// Mirrors the /admin/stats/summary scoping (admin.js)
function dashboardWhereFor(adminId, userId) {
  const wasteWhere = {
    OR: [
      { farm: { adminId } },
      { recordedBy: { managedById: adminId } },
    ],
  };
  const processWhere = {
    OR: [
      { farm: { adminId } },
      { createdBy: { managedById: adminId } },
    ],
  };
  const orderWhere = {
    OR: [
      { items: { some: { variant: { product: { farm: { adminId } } } } } },
      { items: { some: { variant: { product: { createdBy: { managedById: adminId } } } } } },
      { createdById: userId },
    ],
  };
  return { wasteWhere, processWhere, orderWhere };
}

async function main() {
  // Company A: BSF (has farm "test", has farm-less waste records)
  const adminA = await prisma.admin.findFirst({ where: { companyName: 'BSF' } });
  if (!adminA) throw new Error('Company A (BSF) not found');
  const adminAUser = await prisma.user.findFirst({ where: { managedById: adminA.id, role: 'ADMIN' } });

  // Company B: Nas BSF Farm (akuafoplusmobile) — NO farms
  const adminB = await prisma.admin.findFirst({ where: { companyName: { contains: 'Nas BSF Farm' } } });
  if (!adminB) throw new Error('Company B (Nas BSF Farm) not found');
  const adminBUser = await prisma.user.findFirst({ where: { managedById: adminB.id, role: 'ADMIN' } });
  if (!adminBUser) throw new Error('akuafoplusmobile not found');

  // Sanity: B has no farms
  const bFarmCount = await prisma.farm.count({ where: { adminId: adminB.id } });
  console.log(`Company B farm count: ${bFarmCount}`);

  const { wasteWhere: wB, orderWhere: oB, processWhere: pB } = dashboardWhereFor(adminB.id, adminBUser.id);
  const { wasteWhere: wA } = dashboardWhereFor(adminA.id, adminAUser.id);

  const bWasteCount = await prisma.wasteRecord.count({ where: wB });
  const aWasteCount = await prisma.wasteRecord.count({ where: wA });
  const bOrders = await prisma.order.count({ where: oB });
  const bBatches = await prisma.processingBatch.count({ where: pB });

  console.log(`Company B sees ${bWasteCount} waste records (company A has ${aWasteCount})`);
  console.log(`Company B sees ${bOrders} orders, ${bBatches} batches`);

  // Cross-check: every waste record B sees must belong to B (recordedBy.managedById = B)
  const bWaste = await prisma.wasteRecord.findMany({ where: wB, select: { id: true, sourceName: true, recordedBy: { select: { managedById: true } }, farm: { select: { adminId: true } } } });
  const foreign = bWaste.filter(
    (w) => w.recordedBy?.managedById !== adminB.id && w.farm?.adminId !== adminB.id
  );
  console.log(`Foreign waste records visible to B: ${foreign.length}`);
  if (foreign.length) console.log(JSON.stringify(foreign, null, 2).slice(0, 600));

  const pass =
    bFarmCount === 0 &&
    foreign.length === 0 &&
    bOrders === 0 &&
    bBatches === 0;

  console.log(pass ? '\n✅ DASHBOARD LEAK FIXED' : '\n❌ LEAK STILL PRESENT');
  process.exitCode = pass ? 0 : 1;
}

main()
  .catch((e) => { console.error('FATAL:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
