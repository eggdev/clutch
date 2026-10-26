# Tooling installation

Run installer for changes to apps/cli or the template/review export lists.
The CLI tests use real Git repositories and committed fixture sources.

Assert that fresh and repeated installs converge, updates accept only managed
or known legacy hashes, custom files stop all writes, and check stays read-only.
Exercise symlink parents, partial installs and preservation of project verify.
Full template installation must also exclude the template's own verify.

For export changes, additionally commit the candidate source and invoke the
actual CLI against a disposable repository. Check its JSON, installed hashes,
repeat behavior and untouched project verify. Tests against fixture source alone
do not prove that the real committed export list includes the intended assets.
