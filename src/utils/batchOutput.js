// Shared helpers for deriving BSF batch output (larvae / frass) from activity
// logs. Source of truth used by the post-processing routes and the admin
// dashboard stats so both surfaces aggregate output identically.

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

module.exports = {
  extractHarvest,
  extractOutput,
  aggregateBagging,
  summarizeBatchOutputs,
};
