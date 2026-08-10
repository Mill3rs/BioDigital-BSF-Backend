/**
 * One-off verification script for per-company data isolation.
 * Runs against the LOCAL dev database (biodigital@localhost:5432/biodigital).
 * Creates two companies with products/orders, verifies the scoping queries
 * return only the requesting company's data, then cleans up.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://iso_test:iso_test123@localhost:5432/biodigital' } },
});

function productCompanyScopes(adminId, userId) {
  return [
    { farm: { adminId } },
    { createdBy: { managedById: adminId } },
    { createdById: userId },
  ];
}

function orderCompanyScopes(adminId, userId) {
  return [
    { items: { some: { variant: { product: { farm: { adminId } } } } } },
    { items: { some: { variant: { product: { createdBy: { managedById: adminId } } } } } },
    { createdById: userId },
  ];
}

async function main() {
  const adminA = await prisma.admin.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!adminA) throw new Error('No Admin record found in local DB');
  const adminAUser = await prisma.user.findFirst({ where: { managedById: adminA.id, role: 'ADMIN' } });
  if (!adminAUser) throw new Error('No ADMIN user found for company A');

  const stamp = Date.now();
  const adminB = await prisma.admin.create({ data: { companyName: `Isolation Test B ${stamp}` } });
  const adminBUser = await prisma.user.create({
    data: {
      email: `isolation-b-${stamp}@test.local`,
      fullName: 'Isolation Test B',
      role: 'ADMIN',
      password: 'x',
      managedById: adminB.id,
    },
  });

  // Track created rows for cleanup: { kind, id }
  const created = [];

  const deleteVehicle = async (id) => { try { await prisma.vehicle.delete({ where: { id } }); } catch (e) { /* ignore */ } };

  try {
    // ── Products (admin-created, no farm link) ────────────────────────────────
    const pA = await prisma.product.create({
      data: {
        name: `Isolation Product A ${stamp}`,
        category: 'COMPOST',
        slug: `isolation-product-a-${stamp}`,
        createdById: adminAUser.id,
        variants: { create: [{ name: 'Standard', sku: `SKU-A-${stamp}`, quantity: 5, price: 10, unitType: 'kg' }] },
      },
      include: { variants: true },
    });
    created.push({ kind: 'product', id: pA.id });
    const pB = await prisma.product.create({
      data: {
        name: `Isolation Product B ${stamp}`,
        category: 'COMPOST',
        slug: `isolation-product-b-${stamp}`,
        createdById: adminBUser.id,
        variants: { create: [{ name: 'Standard', sku: `SKU-B-${stamp}`, quantity: 5, price: 10, unitType: 'kg' }] },
      },
      include: { variants: true },
    });
    created.push({ kind: 'product', id: pB.id });

    // ── Product list scoping ─────────────────────────────────────────────────
    const scopeA = { OR: productCompanyScopes(adminA.id, adminAUser.id) };
    const scopeB = { OR: productCompanyScopes(adminB.id, adminBUser.id) };
    const productsA = await prisma.product.findMany({ where: scopeA, select: { id: true } });
    const productsB = await prisma.product.findMany({ where: scopeB, select: { id: true } });
    const aHasA = productsA.some((p) => p.id === pA.id);
    const aHasB = productsA.some((p) => p.id === pB.id);
    const bHasB = productsB.some((p) => p.id === pB.id);
    const bHasA = productsB.some((p) => p.id === pA.id);

    // ── Order scoping ─────────────────────────────────────────────────────────
    const orderA = await prisma.order.create({
      data: {
        orderNumber: `ORD-ISO-A-${stamp}`,
        customerId: adminAUser.id,
        createdById: adminAUser.id,
        subtotal: 20,
        tax: 3,
        shippingCost: 0,
        discount: 0,
        total: 23,
        paymentMethod: 'CASH_ON_DELIVERY',
        deliveryAddress: { line1: 'Test' },
        items: { create: [{ variantId: pA.variants[0].id, quantity: 2, price: 10, subtotal: 20 }] },
      },
    });
    created.push({ kind: 'order', id: orderA.id });
    const orderB = await prisma.order.create({
      data: {
        orderNumber: `ORD-ISO-B-${stamp}`,
        customerId: adminBUser.id,
        createdById: adminBUser.id,
        subtotal: 20,
        tax: 3,
        shippingCost: 0,
        discount: 0,
        total: 23,
        paymentMethod: 'CASH_ON_DELIVERY',
        deliveryAddress: { line1: 'Test' },
        items: { create: [{ variantId: pB.variants[0].id, quantity: 2, price: 10, subtotal: 20 }] },
      },
    });
    created.push({ kind: 'order', id: orderB.id });

    const ordersA = await prisma.order.findMany({ where: { OR: orderCompanyScopes(adminA.id, adminAUser.id) }, select: { id: true } });
    const ordersB = await prisma.order.findMany({ where: { OR: orderCompanyScopes(adminB.id, adminBUser.id) }, select: { id: true } });
    const oAHasA = ordersA.some((o) => o.id === orderA.id);
    const oAHasB = ordersA.some((o) => o.id === orderB.id);
    const oBHasB = ordersB.some((o) => o.id === orderB.id);
    const oBHasA = ordersB.some((o) => o.id === orderA.id);

    // ── Waste scoping ─────────────────────────────────────────────────────────
    const wasteA = await prisma.wasteRecord.create({
      data: {
        sourceName: `Isolation Waste A ${stamp}`,
        sourceType: 'AGRICULTURAL',
        quantity: 10,
        unit: 'kg',
        date: new Date(),
        recordedById: adminAUser.id,
      },
    });
    created.push({ kind: 'waste', id: wasteA.id });
    const wasteB = await prisma.wasteRecord.create({
      data: {
        sourceName: `Isolation Waste B ${stamp}`,
        sourceType: 'AGRICULTURAL',
        quantity: 10,
        unit: 'kg',
        date: new Date(),
        recordedById: adminBUser.id,
      },
    });
    created.push({ kind: 'waste', id: wasteB.id });
    const wasteScope = (adminId) => ({ OR: [{ farm: { adminId } }, { recordedBy: { managedById: adminId } }] });
    const wastesA = await prisma.wasteRecord.findMany({ where: wasteScope(adminA.id), select: { id: true } });
    const wastesB = await prisma.wasteRecord.findMany({ where: wasteScope(adminB.id), select: { id: true } });
    const wAHasA = wastesA.some((w) => w.id === wasteA.id);
    const wAHasB = wastesA.some((w) => w.id === wasteB.id);
    const wBHasB = wastesB.some((w) => w.id === wasteB.id);
    const wBHasA = wastesB.some((w) => w.id === wasteA.id);

    // ── Waste stats scoping (dashboard leak) ─────────────────────────────────
    const statsA = await prisma.wasteRecord.aggregate({ where: wasteScope(adminA.id), _count: true });
    const statsB = await prisma.wasteRecord.aggregate({ where: wasteScope(adminB.id), _count: true });
    const wStatsAExcludesB = !(await prisma.wasteRecord.count({ where: { id: wasteB.id, ...wasteScope(adminA.id) } }));
    const wStatsBExcludesA = !(await prisma.wasteRecord.count({ where: { id: wasteA.id, ...wasteScope(adminB.id) } }));

    // ── Vehicle scoping ──────────────────────────────────────────────────────
    const vehicleA = await prisma.vehicle.create({
      data: { plateNumber: `ISO-A-${stamp}`, type: 'Van', adminId: adminA.id },
    });
    created.push({ kind: 'vehicle', id: vehicleA.id });
    const vehicleB = await prisma.vehicle.create({
      data: { plateNumber: `ISO-B-${stamp}`, type: 'Van', adminId: adminB.id },
    });
    created.push({ kind: 'vehicle', id: vehicleB.id });
    const vehiclesA = await prisma.vehicle.findMany({ where: { adminId: adminA.id }, select: { id: true } });
    const vehiclesB = await prisma.vehicle.findMany({ where: { adminId: adminB.id }, select: { id: true } });
    const vAHasA = vehiclesA.some((v) => v.id === vehicleA.id);
    const vAHasB = vehiclesA.some((v) => v.id === vehicleB.id);
    const vBHasB = vehiclesB.some((v) => v.id === vehicleB.id);
    const vBHasA = vehiclesB.some((v) => v.id === vehicleA.id);

    const checks = {
      'A sees own product': aHasA,
      'A does NOT see B product': !aHasB,
      'B sees own product': bHasB,
      'B does NOT see A product': !bHasA,
      'A sees own order': oAHasA,
      'A does NOT see B order': !oAHasB,
      'B sees own order': oBHasB,
      'B does NOT see A order': !oBHasA,
      'A sees own waste': wAHasA,
      'A does NOT see B waste': !wAHasB,
      'B sees own waste': wBHasB,
      'B does NOT see A waste': !wBHasA,
      'A waste stats exclude B': wStatsAExcludesB,
      'B waste stats exclude A': wStatsBExcludesA,
      'A sees own vehicle': vAHasA,
      'A does NOT see B vehicle': !vAHasB,
      'B sees own vehicle': vBHasB,
      'B does NOT see A vehicle': !vBHasA,
    };

    let allPass = true;
    for (const [label, ok] of Object.entries(checks)) {
      console.log(`${ok ? '✅' : '❌'} ${label}`);
      if (!ok) allPass = false;
    }
    console.log(allPass ? '\nALL ISOLATION CHECKS PASSED' : '\nSOME CHECKS FAILED');
    process.exitCode = allPass ? 0 : 1;
  } finally {
    // ── Cleanup (reverse order) ───────────────────────────────────────────────
    for (const rec of created.reverse()) {
      try {
        if (rec.kind === 'order') {
          await prisma.orderItem.deleteMany({ where: { orderId: rec.id } });
          await prisma.order.delete({ where: { id: rec.id } });
        } else if (rec.kind === 'waste') {
          await prisma.wasteRecord.delete({ where: { id: rec.id } });
        } else if (rec.kind === 'product') {
          await prisma.productVariant.deleteMany({ where: { productId: rec.id } });
          await prisma.product.delete({ where: { id: rec.id } });
        } else if (rec.kind === 'vehicle') {
          await deleteVehicle(rec.id);
        }
      } catch (e) { console.error('cleanup error:', e.message); }
    }
    try {
      await prisma.user.delete({ where: { id: adminBUser.id } });
      await prisma.admin.delete({ where: { id: adminB.id } });
    } catch (e) { console.error('cleanup admin error:', e.message); }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
