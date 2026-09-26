// Shared helpers for deriving BSF batch output (larvae / frass) from activity
// logs. Source of truth used by the post-processing routes and the admin
// dashboard stats so both surfaces aggregate output identically.

// The three source components a catalogue product can be drawn from. These map
// to the Stage-4 (Harvesting) fractions recorded on the harvest form —
// Larvae + Frass + Residue — which is the output breakdown surfaced when a
// product is created from a completed batch on the Products page.
const SOURCE_COMPONENTS = ['LARVAE', 'FRASS', 'RESIDUE'];

// Human label for each source component (used by the Products page picker).
const SOURCE_COMPONENT_LABELS = {
  LARVAE:  'Larvae',
  FRASS:   'Frass',
  RESIDUE: 'Residue',
};

/**
 * Extract harvest fractions recorded on the Stage 4 (Harvesting) form
 * (most recent wins). The data is stored on the transition entry created when
 * that form is submitted — under the current flow that is the "Stage 5 Entry"
 * (advancing 4 → 5); older batches may have it on the "Stage 4 Entry".
 * Returns null when no harvest transition log exists.
 */
function extractHarvest(activityLogs) {
  const log = [...activityLogs].find(
    (l) =>
      l.action === 'NOTE_ADDED' &&
      l.metadata?.type === 'STAGE_TRANSITION' &&
      (Number(l.metadata?.stageNumber) === 4 || Number(l.metadata?.stageNumber) === 5) &&
      (l.metadata?.harvestBsfLarvae != null ||
        l.metadata?.harvestFrass != null ||
        l.metadata?.harvestPrepupae != null ||
        l.metadata?.harvestRecycled != null),
  );
  if (!log) return null;
  const m = log.metadata;
  return {
    harvestBsfLarvae: m.harvestBsfLarvae ?? null,
    harvestFrass:     m.harvestFrass     ?? null,
    harvestPrepupae:  m.harvestPrepupae  ?? null,
    harvestRecycled:  m.harvestRecycled  ?? null,
    harvestTotalKg:   m.harvestTotalKg   ?? null,
    stageWeight:      m.stageWeight      ?? null,
    actualWeight:     m.actualWeight     ?? null,
    // Raw Stage 4 form fields (the harvest* keys above are the legacy aliases).
    larvaeHarvested:  m.larvaeHarvested  ?? null,
    residue:          m.residue          ?? null,
  };
}

/**
 * Extract output breakdown from the End Batch (OUTPUT_RECORDED) log, or fall
 * back to a SEGREGATION_OUTPUT recorded directly in the post-processing page.
 */
function extractOutput(activityLogs) {
  // Use the OUTPUT_RECORDED log only if it contains a product breakdown.
  // The "Record Output" action stores only { fertilizerOutput, qualityScore } (no product fields),
  // while the "End Batch" action stores the full product map. Skip the former.
  const formal = [...activityLogs].find((l) => {
    if (l.action !== 'OUTPUT_RECORDED') return false;
    const m = l.metadata ?? {};
    return (
      m.bsfLarvaeKg != null ||
      m.bsfMealKg != null ||
      m.bsfOilKg != null ||
      m.frassFertilizerKg != null ||
      m.recycledLarvaeKg != null ||
      m.prepupaeWeight != null
    );
  });
  if (formal) {
    const m = formal.metadata ?? {};
    return {
      bsfLarvaeKg:       m.bsfLarvaeKg       ?? null,
      bsfMealKg:         m.bsfMealKg         ?? null,
      bsfOilKg:          m.bsfOilKg          ?? null,
      frassFertilizerKg: m.frassFertilizerKg ?? null,
      recycledLarvaeKg:  m.recycledLarvaeKg  ?? null,
      prepupaeWeight:    m.prepupaeWeight     ?? null,
      totalOutputKg:     m.totalOutputKg     ?? null,
    };
  }

  // Fall back to the most recent SEGREGATION_OUTPUT recorded in post-processing
  const seg = [...activityLogs].find(
    (l) => l.action === 'NOTE_ADDED' && l.metadata?.type === 'SEGREGATION_OUTPUT',
  );
  if (!seg) return null;
  const p = seg.metadata.products ?? {};
  const total = Object.values(p).reduce((s, v) => s + (Number(v) || 0), 0);
  return {
    frassFertilizerKg: p['Frass Fertilizer']        ?? null,
    prepupaeWeight:    p['Prepupae']                 ?? null,
    bsfLarvaeKg:       p['BSF Larvae']               ?? null,
    bsfMealKg:         p['BSF Meal']                 ?? null,
    bsfOilKg:          p['BSF Oil']                  ?? null,
    recycledLarvaeKg:  p['Live Larvae (recycled)']   ?? null,
    totalOutputKg:     total > 0 ? total : null,
  };
}

/**
 * Aggregate all BAGGING_RECORD logs for a batch into a map of
 * { product -> { baggedKg, bagCount, records[] } }.
 */
function aggregateBagging(activityLogs) {
  const map = {};
  for (const l of activityLogs) {
    if (l.action !== 'NOTE_ADDED' || l.metadata?.type !== 'BAGGING_RECORD') continue;
    const m = l.metadata;
    const product = m.product;
    if (!product) continue;
    if (!map[product]) map[product] = { baggedKg: 0, bagCount: 0, records: [] };
    map[product].baggedKg  += m.baggedKg  ?? 0;
    map[product].bagCount  += m.bagCount   ?? 0;
    map[product].records.push({
      id:           l.id,
      baggedKg:     m.baggedKg    ?? 0,
      bagCount:     m.bagCount    ?? 0,
      notes:        m.notes       ?? null,
      costPrice:    m.costPrice   ?? null,
      sellingPrice: m.sellingPrice ?? null,
      productId:    m.productId   ?? null,
      recordedBy:   l.performedBy?.fullName ?? null,
      recordedAt:   l.timestamp,
    });
  }
  return map;
}

/**
 * Sum larvae / frass output across an array of batches (each batch must include
 * its activityLogs). Mirrors the per-batch precedence used by the
 * post-processing summary: stage-4 harvest first, then End-Batch output.
 */
function summarizeBatchOutputs(batches) {
  let larvaeKg = 0;
  let frassKg  = 0;

  for (const batch of batches) {
    const harvest = extractHarvest(batch.activityLogs ?? []);
    const output  = extractOutput(batch.activityLogs ?? []);

    larvaeKg += Number(harvest?.harvestBsfLarvae ?? output?.bsfLarvaeKg       ?? 0) || 0;
    frassKg  += Number(harvest?.harvestFrass     ?? output?.frassFertilizerKg ?? 0) || 0;
  }

  const round = (n) => Math.round(n * 100) / 100;
  return {
    larvaeKg: round(larvaeKg),
    frassKg:  round(frassKg),
    totalKg:  round(larvaeKg + frassKg),
  };
}

/**
 * Aggregate PRODUCT_ALLOCATION logs — amounts of a batch consumed by catalogue
 * products created from the Products page. Each record deducts from the
 * batch's remaining output.
 */
function aggregateAllocations(activityLogs) {
  const records = [];
  const byProduct = {};
  // Amounts drawn per source component (LARVAE / FRASS / RESIDUE). Records
  // created before the component field existed carry no component and only
  // count towards the batch total.
  const byComponent = {};
  let totalKg = 0;
  for (const l of activityLogs) {
    if (l.action !== 'NOTE_ADDED' || l.metadata?.type !== 'PRODUCT_ALLOCATION') continue;
    const m = l.metadata;
    const kg = Number(m.quantityKg) || 0;
    if (kg <= 0) continue;
    totalKg += kg;
    const name = m.productName ?? 'Product';
    byProduct[name] = (byProduct[name] ?? 0) + kg;
    const component = SOURCE_COMPONENTS.includes(m.component) ? m.component : null;
    if (component) byComponent[component] = (byComponent[component] ?? 0) + kg;
    records.push({
      id:          l.id,
      productId:   m.productId   ?? null,
      productName: name,
      component,
      quantityKg:  kg,
      recordedBy:  l.performedBy?.fullName ?? null,
      recordedAt:  l.timestamp,
    });
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { totalKg: round(totalKg), byProduct, byComponent, records };
}

/** Total positive product-level weight recorded for a batch. */
function sumAvailableKg(harvest, output) {
  const rows = [
    harvest?.harvestFrass     ?? output?.frassFertilizerKg,
    harvest?.harvestPrepupae  ?? output?.prepupaeWeight,
    harvest?.harvestBsfLarvae ?? output?.bsfLarvaeKg,
    output?.bsfMealKg,
    output?.bsfOilKg,
    harvest?.harvestRecycled  ?? output?.recycledLarvaeKg,
    harvest?.residue,
  ];
  return rows.reduce((s, v) => s + (Number(v) > 0 ? Number(v) : 0), 0);
}

/**
 * Per-component output for a batch: the Stage-4 harvest fractions (Larvae /
 * Frass / Residue). Batches that only carry an End-Batch output fall back to
 * the larvae / frass product weights, leaving residue at 0.
 */
function extractComponents(harvest, output) {
  return {
    LARVAE:  Number(harvest?.harvestBsfLarvae ?? harvest?.larvaeHarvested ?? output?.bsfLarvaeKg ?? 0) || 0,
    FRASS:   Number(harvest?.harvestFrass ?? output?.frassFertilizerKg ?? 0) || 0,
    RESIDUE: Number(harvest?.residue ?? 0) || 0,
  };
}

/**
 * Availability broken down by source component (Larvae / Frass / Residue):
 * recorded output minus what has been bagged and minus what has been allocated
 * to catalogue products for that component.
 */
function componentAvailability(harvest, output, bagging, allocation) {
  const available = extractComponents(harvest, output);
  const round = (n) => Math.round(n * 100) / 100;

  // Bagging products are keyed by product name; map the ones that belong to a
  // source component. Meal / Oil / Prepupae stay outside the three components.
  const baggedFor = (key) => {
    if (key === 'LARVAE') {
      return (bagging['BSF Larvae']?.baggedKg ?? 0) +
             (bagging['Live Larvae (recycled)']?.baggedKg ?? 0);
    }
    if (key === 'FRASS') return bagging['Frass Fertilizer']?.baggedKg ?? 0;
    return 0;
  };

  const components = {};
  for (const key of SOURCE_COMPONENTS) {
    const availableKg = Number(available[key]) || 0;
    const baggedKg    = baggedFor(key);
    const allocatedKg = allocation.byComponent[key] ?? 0;
    components[key] = {
      label:       SOURCE_COMPONENT_LABELS[key],
      availableKg: round(availableKg),
      baggedKg:    round(baggedKg),
      allocatedKg: round(allocatedKg),
      remainingKg: round(Math.max(0, availableKg - baggedKg - allocatedKg)),
    };
  }
  return components;
}

/**
 * Availability summary for a batch: recorded output minus what has been bagged
 * and minus what has been allocated to catalogue products. `components` breaks
 * the same figures down per source component (Larvae / Frass / Residue).
 */
function batchOutputSummary(batch) {
  const harvest = extractHarvest(batch.activityLogs ?? []);
  const output  = extractOutput(batch.activityLogs ?? []);
  const bagging = aggregateBagging(batch.activityLogs ?? []);
  const allocation = aggregateAllocations(batch.activityLogs ?? []);

  const availableKg = sumAvailableKg(harvest, output);
  const baggedKg = Object.values(bagging).reduce((s, d) => s + (d.baggedKg ?? 0), 0);
  const round = (n) => Math.round(n * 100) / 100;

  return {
    availableKg: round(availableKg),
    baggedKg:    round(baggedKg),
    allocatedKg: allocation.totalKg,
    remainingKg: round(Math.max(0, availableKg - baggedKg - allocation.totalKg)),
    components:  componentAvailability(harvest, output, bagging, allocation),
  };
}

module.exports = {
  SOURCE_COMPONENTS,
  SOURCE_COMPONENT_LABELS,
  extractHarvest,
  extractOutput,
  extractComponents,
  aggregateBagging,
  aggregateAllocations,
  batchOutputSummary,
  summarizeBatchOutputs,
};
