using System.Reflection;
[assembly:AssemblyTitle(NZIP.Edition.Name)]
[assembly:AssemblyProduct(NZIP.Edition.Id)]
[assembly:AssemblyDescription("NZIP lightweight local archiver")]
#if NZIP_PAID
[assembly:AssemblyVersion("0.7.1.0")]
[assembly:AssemblyFileVersion("0.7.1.0")]
#else
[assembly:AssemblyVersion("0.6.2.0")]
[assembly:AssemblyFileVersion("0.6.2.0")]
#endif
[assembly:AssemblyCopyright("Copyright © 2026 NZIP contributors")]
