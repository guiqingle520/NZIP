using System;
namespace NZIP {
    // The standalone extraction module is redistributable and never activates a paid client.
    internal static class LicenseGate {
        sealed class Scope:IDisposable {public void Dispose(){}}
        public static IDisposable Enter(){return new Scope();}
    }
}
