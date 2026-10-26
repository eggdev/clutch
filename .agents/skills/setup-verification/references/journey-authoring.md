# Author a verification journey

Use when the requested outcome has no mapped proof. Read its acceptance criterion,
product contract, current feature map and source entry point first.

1. Name actor, platform, goal and observable result. Existing mechanics do not
   authorize changing the expected result.
2. Reuse a flow that proves it; extend one that reaches the right state but misses
   an observation; create a new flow only when neither fits.
3. Choose one-time exploration versus a permanent regression test using the
   project's test policy. A route list or click sequence without assertions is
   not a journey. Avoid a permanent end-to-end test for logic a public API test proves.
4. Record entry command/route, fixture owner, side effects, actions and expected
   observations, proof artifacts, cleanup and unverified boundaries. Include the
   relevant failure or returning-state condition, not an exhaustive invented matrix.
5. Resolve commands/selectors from the actual surface. Register retained flows
   in verify's feature index and configuration; keep temporary experiments in
   task scratch space. No selected tests must fail the verification request.
6. Execute, check side effects, retain revision and action/result proof, then clean
   owned resources. Missing fixtures are prerequisites, never justification for
   an auth bypass or use of live personal data.

A draft is complete only when drafting was the requested destination. A usable
journey requires executed proof. Report product defects separately from map drift;
do not change expectations to fit the current result.
