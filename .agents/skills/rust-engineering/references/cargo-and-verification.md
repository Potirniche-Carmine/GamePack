# Cargo and Verification

Choose the sections relevant to dependencies, configurations, and the risks introduced by the change.

## Dependency value and trust

Reuse standard-library and existing-crate capabilities when they fit. A new dependency may be safer and simpler than maintaining bespoke parsing, cryptography, or synchronization. Evaluate its actual value, transitive footprint, MSRV, target support, maintenance, and relevant security advisories. Build scripts and proc macros execute during builds and deserve consideration as part of that trust boundary. Depth of investigation should match exposure and project policy.

Check the resolved version and enabled APIs, not only a crate's latest documentation. Keep lockfile changes intentional and follow the repository's lockfile policy; avoid unrelated updates while fixing an isolated problem.

## Feature discipline

Design features to add compatible capabilities. Cargo combines enabled features for a dependency within the applicable resolver contexts; setting `default-features = false` on one edge does not necessarily keep defaults disabled elsewhere. Use `cargo tree -e features` or `cargo tree -d` when feature activation or duplicate versions need explanation. See [Cargo's feature model](https://doc.rust-lang.org/cargo/reference/features.html).

Exercise configurations the project actually supports: defaults, relevant individual features or combinations, minimal or no-default builds, and target-specific paths when affected. `--all-features` is useful only for supported combinations and does not test that default-disabled code builds correctly. Do not change the resolver, feature surface, or MSRV as incidental cleanup.

## Compiler feedback

Prefer documented repository commands and CI scopes. Typical building blocks include `cargo fmt --check`, `cargo check`, `cargo test`, `cargo clippy`, and `cargo doc --no-deps`; adapt package, target, and feature selection to the change. Doctests can exercise public examples. Keep the existing lint policy; enabling every pedantic lint or promoting every warning is a separate decision.

Run the affected path early enough to catch API and ownership mistakes, then expand where cross-package or configuration effects justify it. A host build cannot verify another target, and a newer compiler cannot establish MSRV support. If a required toolchain, service, or target is unavailable, say what remains unverified.

## Tests that discriminate

Select tests by the behavior that could be wrong. Useful candidates include a regression reproducer, empty and limit-sized input, malformed representations, overflow and conversion boundaries, properties across many values, and failures during a state transition. Test an observable contract rather than the current implementation's spelling.

Use compile-fail cases when rejection is part of an API's promise, such as lifetime or typestate constraints. For concurrency, test ordering and shutdown interleavings; for async code, cancellation and partial progress may matter more than another happy-path test. Avoid arbitrary sleeps when a deterministic synchronization point can exercise the condition.

## Targeted dynamic verification

- Fuzz parsers and state machines when varied malformed input or operation sequences exercise meaningful risk. Bound harness resources and turn discovered failures into small regression cases.
- Use [Miri](https://github.com/rust-lang/miri) for supported tests where detecting undefined behavior adds value, especially around custom unsafe code. Its coverage and platform/FFI limitations constrain the conclusion.
- Use a concurrency model checker such as [Loom](https://docs.rs/loom/latest/loom/) for a small synchronization algorithm when the implementation can be modeled with its instrumented primitives. An ordinary thread test does not explore the same space, and a model only covers what it represents.

Install or introduce heavier tooling only when its benefit fits the task and the repository. Passing fuzzing, interpreter, or model-checking runs provide evidence for the explored cases, not a proof of correctness. Report actual commands, configurations, and meaningful limits without inflating the claim.
