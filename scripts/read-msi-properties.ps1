param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
$installer=New-Object -ComObject WindowsInstaller.Installer
$database=$null;$view=$null
try {
    $database=$installer.OpenDatabase([IO.Path]::GetFullPath($Path),0)
    $view=$database.OpenView('SELECT `Property`, `Value` FROM `Property`')
    $view.Execute()
    $result=@{}
    while($record=$view.Fetch()){
        try{if($record.StringData(1) -in @('ProductName','ProductVersion')){$result[$record.StringData(1)]=$record.StringData(2)}}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)}
    }
    $result|ConvertTo-Json -Compress
} finally {
    foreach($item in @($view,$database,$installer)){if($null -ne $item){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)}}
}
