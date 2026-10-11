namespace NZIP {
    internal static class Edition {
#if NZIP_PAID
        public static readonly bool Paid=true;
#if NZIP_PREVIEW
        public const string Id="NZIPPaidPreview", Name="NZIP 收费版（测试）", LicenseFolder="NZIP Paid Preview";
#else
        public const string Id="NZIPPaid", Name="NZIP 收费版", LicenseFolder="NZIP Paid";
#endif
#else
        public static readonly bool Paid=false;
        public const string Id="NZIP", Name="NZIP", LicenseFolder="NZIP Paid";
#endif
        public const string Executable=Id+".exe";
    }
}
