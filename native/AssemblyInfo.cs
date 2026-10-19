using System.Reflection;
[assembly:System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8",FrameworkDisplayName=".NET Framework 4.8")]
[assembly:AssemblyTitle(NZIP.Edition.Name)]
[assembly:AssemblyProduct(NZIP.Edition.Id)]
[assembly:AssemblyDescription("NZIP lightweight local archiver")]
#if NZIP_PAID
[assembly:AssemblyVersion("0.7.3.0")]
[assembly:AssemblyFileVersion("0.7.3.0")]
#else
[assembly:AssemblyVersion("0.6.4.0")]
[assembly:AssemblyFileVersion("0.6.4.0")]
#endif
[assembly:AssemblyCopyright("Copyright © 2026 NZIP contributors")]
