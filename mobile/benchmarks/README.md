# Station search benchmark

From `mobile/`, run:

```bash
node benchmarks/station.bench.cjs
```

Run on a controlled, idle host with a consistent Node version and hardware.
The benchmark retains the original limit of 500 ms for 100 searches and checks
that every query returns results. Service loading is outside the timed region.
This command is separate from `npm test`; the regular station test keeps the
same 100 result checks without a machine-dependent deadline.
