"""Connection adapters, credential envelope, egress policy, and TOFU pinning.

The pipeline is the only runtime that decrypts connection credentials (ADR 0004
/ ROADMAP §5.2). This package holds the cross-runtime envelope format (mirrors
``app/src/lib/connections/crypto.ts``), the outbound egress policy, the
protocol StorageAdapters, and the trust-on-first-use host-key logic.
"""
