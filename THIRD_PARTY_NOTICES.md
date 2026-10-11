# Third-party software

NZIP uses the unmodified official 7-Zip command-line program and library as an external archive engine. Copyright (C) Igor Pavlov. Licensed primarily under GNU LGPL 2.1 or later, with BSD licenses and the unRAR restriction for parts of 7z.dll. Complete upstream licenses accompany the binaries in 7zip/License.txt and 7zip/COPYING.LESSER.txt.

7-Zip source code and archives: https://www.7-zip.org/download.html
7-Zip project: https://www.7-zip.org/
GNU LGPL 2.1: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html

The engine is replaceable through NZIP_7Z_PATH. NZIP uses no Bandizip code, artwork or trademarks; Bandizip is referenced to describe familiar workflows.

NZIP 0.6.2 uses Windows Forms from the system .NET Framework 4.8. It does not distribute or load WebView2, Electron, Chromium or Node.js. Previous experimental implementations remain in the source tree for reference; their SDK/runtime files are not included in this release.

RAR regression fixtures in tests/fixtures come from libarchive (see that directory's README.md and LIBARCHIVE-COPYING). They are test data only and are not included in the NZIP release package.
