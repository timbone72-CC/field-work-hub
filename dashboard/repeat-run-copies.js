/* Phase 6B: bounded prior-visit requirements reuse. Read-only server evidence;
 * old run/photo IDs never become new work-order, assignment or photo identities. */
const RepeatRunCopies = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  history(rows, workOrderId, currentRunId) {
    if (!this.uuid.test(workOrderId) || !this.uuid.test(currentRunId)
      || !Array.isArray(rows) || rows.length > 26)
      throw Error('Unable to verify bounded visit history.');
    const seen = new Set();
    for (const run of rows) {
      if (!run || !this.uuid.test(run.id) || run.work_order_id !== workOrderId
        || !Number.isSafeInteger(run.run_sequence) || run.run_sequence < 1
        || seen.has(run.id))
        throw Error('Visit history did not match this work order.');
      seen.add(run.id);
    }
    return {
      earlier: rows.slice(0, 25).filter(run => run.id !== currentRunId),
      more: rows.length > 25
    };
  },
  sourceSnapshot(rows, workOrderId, runId) {
    if (!this.uuid.test(workOrderId) || !this.uuid.test(runId)
      || !Array.isArray(rows) || rows.length !== 1
      || rows[0]?.id !== runId || rows[0]?.work_order_id !== workOrderId
      || !Object.prototype.hasOwnProperty.call(rows[0], 'requirement_snapshot'))
      throw Error('The selected historical visit is unavailable or changed. Load visits again.');
    return rows[0].requirement_snapshot;
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = RepeatRunCopies;
