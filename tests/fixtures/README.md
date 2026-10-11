These uuencoded RAR regression fixtures come from libarchive, version v3.8.2 unless noted otherwise:

- `rar5-stored.rar.uu`: `libarchive/test/test_read_format_rar5_stored.rar.uu`
- `rar4.rar.uu`: `libarchive/test/test_read_format_rar.rar.uu` (includes a link; used to verify safety rejection)
- `rar3-lowdist.rar.uu`: `libarchive/test/test_read_format_rar3_lowdist_reset.rar.uu` from upstream master, retrieved 2026-10-11 (this fixture is newer than v3.8.2).

Upstream: https://github.com/libarchive/libarchive/tree/v3.8.2/libarchive/test
License: see `LIBARCHIVE-COPYING`. Fixtures are only used for tests and are not shipped with NZIP.
