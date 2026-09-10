# Trigonometry Master

Deterministic trigonometric approximations using binary128 arithmetic for Ethereum-compatible environments.

This library provides a stateless trigonometric module built for smart contracts that require deterministic numerical computation. It is designed for research-oriented and engineering-focused on-chain applications where reproducibility and modularity are important.

## Overview

The **Trigonometry Master** is part of a modular mathematical system designed with the **Diamond Pattern** architecture in mind. It implements core trigonometric and inverse trigonometric functions using **IEEE-754 binary128** floating-point representation through `bytes16`.

The library is intended for deterministic on-chain numerical workflows such as:

- numerical analysis
- optimization algorithms
- differential equation solvers
- geometric and scientific computation
- verifiable mathematical research on EVM-based platforms

## Key Features

- **Diamond Pattern Compatibility**  
  Designed to integrate cleanly into modular smart contract systems based on the Diamond Pattern.

- **Binary128 Arithmetic**
  Values and arithmetic use `bytes16` IEEE-754 binary128 operations. This representation has roughly 34 decimal digits of arithmetic precision, but it does not by itself guarantee 34-decimal trigonometric-function accuracy.

- **Deterministic Execution**  
  Produces identical outputs across all EVM-compatible nodes, enabling reproducible and verifiable computation.

- **Stateless Library Design**  
  Uses optimized stateless trigonometric logic without persistent storage dependencies.

## Trigonometry Master

### Supported Methods

The library provides the following methods:

- `sin`
- `cos`
- `tan`
- `cot`
- `arcsin`
- `arccos`
- `arctan`

These methods are internally routed through dedicated modules for:

- sine / cosine
- tangent / cotangent
- inverse trigonometric operations

### Design Scope

The library is designed as a set of **deterministic, pure-function trigonometric primitives** for on-chain mathematical computation.

Its primary purpose is to support advanced numerical applications such as:

- optimization routines
- differential equation methods
- geometric algorithms
- scientific and engineering calculations
- blockchain-based numerical experimentation

## Precision Model

Values and arithmetic use `bytes16` values based on the IEEE-754 binary128 format. The implemented trigonometric functions also use angle reduction and finite polynomial approximations, so their function error is determined by those algorithms as well as the arithmetic format.

The current sine core retains Taylor terms through x¹³ and the cosine core through x¹² on the reduced interval [-π/4, π/4]. The leading omitted Taylor terms at the interval edge are approximately 2.1e-14 for sine and 3.9e-13 for cosine; these estimates exclude range-reduction and arithmetic error. The library therefore does not claim binary128-level empirical accuracy for its trigonometric functions.

The current accuracy test harness converts values through a 1e12 fixed-point scale. Its benchmark output is consequently observable only to 1e-12 and should be read as a measured harness-level result, not as a 34-decimal accuracy measurement.

## Supported Trigonometric Argument Range

`sin`, `cos`, `tan`, and `cot` accept finite input angles only when `|x| <= 2^32` radians (approximately 4.29e9). The current reducer divides by a binary128 `2π` constant, converts the quotient to `int256`, and subtracts the corresponding multiple of `2π`. It intentionally rejects NaN, infinity, and finite angles outside this range rather than attempting unreliable large-argument reduction or allowing an internal conversion overflow.

This is not broad binary128-domain argument reduction. Accurate support for arbitrary large binary128 angles requires a multiprecision method such as Payne-Hanek. For valid in-range inputs, `tan` and `cot` retain their separate pole behavior and return NaN when their respective denominator is approximately zero.

## NaN and Infinity Behavior

`sin`, `cos`, `tan`, and `cot` reject NaN with `TRIG_NAN_ANGLE` and signed infinity with `TRIG_INFINITE_ANGLE`; these inputs cannot enter angle reduction. `asin` and `acos` return canonical NaN for NaN, infinity, and finite values outside `[-1, 1]`. `atan` returns canonical NaN for NaN and returns the signed π/2 limit for signed infinity. These input cases are distinct from finite mathematical failures: valid in-range tangent and cotangent poles return NaN.

This precision model is especially useful for smart contract applications where traditional integer-based arithmetic is insufficient for:

- trigonometric evaluation
- inverse trigonometric approximation
- iterative numerical methods
- error-sensitive mathematical workflows

## Architecture Notes

The library is built for modular integration and is suitable for systems following a **Diamond Pattern** structure. Its stateless nature makes it appropriate for reusable deployment in larger mathematical or scientific smart contract frameworks.

The trigonometric functions are separated by logical responsibility into dedicated internal modules, improving maintainability, extensibility, and clarity of implementation.

## Benchmark Methodology

The accuracy suite reports `estimateGas` simulation values through `TrigonometryHarness` and obtains numerical outputs through a separate `eth_call`; its gas values are estimates, not transaction receipts. Repeating a deterministic pure call or estimate with the same input is a duplicate consistency check, not an independent statistical sample.

The gas suite reports `transaction_receipt_gas` for the direct `TrigonometryHarness` path. It also reports a trivial `benchmarkIdentity(bytes16)` transaction with the same one-`bytes16` ABI argument shape as a separate calldata/intrinsic baseline; this baseline is never subtracted from trigonometric gas. Its duplicate transactions are separate EVM transactions, so warm-access state does not persist from one measurement to the next. Outputs remain separately checked with `eth_call`.

Harness-direct receipt gas excludes `TrigonometryFacet`, Diamond fallback/delegatecall routing, deployment, `diamondCut` installation, and `MathLib` deployment. The focused production-path benchmark deploys a minimal Diamond with the trigonometry facet, reports those deployment and installation receipts separately, and compares four direct-harness calls with Diamond-routed calls. Those local measurements exclude optional facets and chain-specific conditions such as fee policy, so they are descriptive rather than a universal production-cost estimate.

## Intended Use Cases

This library is suitable for projects involving:

- on-chain scientific computation
- deterministic simulation components
- mathematical tooling for blockchain research
- geometric calculations with explicit error validation
- educational and experimental numerical smart contracts

## License

Distributed under the **MIT License**.

```text
Copyright (c) 2026 TRIGONOMETRY MASTER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```
