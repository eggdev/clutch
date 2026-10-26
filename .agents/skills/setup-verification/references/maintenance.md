# Maintain verification

Read the committed verify skill and feature index. Select the requested scope;
a full maintenance pass covers every mapped flow, while a task-specific update
names the subset it covers. Do not report a partial pass as a complete audit.

1. Check index entries against journey files and executable flow names.
2. Read the source entry points for each selected journey and relevant changes.
   Identify expected observations that may have drifted. Source review does not
   replace execution.
3. Group recipes that share fixture/runtime state to avoid duplicate setup. Execute through
   verify, using its actual launch model. Doctor before the first drive and after
   surprising behavior; reset a wedged UI even if its process health is green.
4. Classify mismatch: documentation drift, harness gap, product regression or
   missing prerequisite. Change only verification-owned files for maintenance;
   preserve product expectations unless an approved contract changed.
5. Re-drive each changed harness path, including its failure condition. Clean
   residue from failed iterations and verify saved evidence survives cleanup.
6. Return clean, changed or blocked with exact flow coverage and source revision.
   Commit changed tooling; create a PR only when that destination is authorized.

For formal checks also record property, covered code, assumptions, bound and
last synchronization revision. A passing stale model is not product proof.
Demonstrate that a disposable broken variant violates the property, then restore
and rerun. Do not install a formal tool merely because a concurrency test exists;
choose it only when the property and cost justify it.
