
# Script to kill "Ghost" Chrome processes from Puppeteer/WhatsApp
# Filters by command line to avoid closing your personal browser.

Write-Host "Searching for Zombie Chrome processes related to wwebjs..."

try {
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*wwebjs_auth*" }

    if ($processes) {
        Write-Host "Found $($processes.Count) zombie processes. Killing..."
        $processes | ForEach-Object { 
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                Write-Host " -> Killed PID $($_.ProcessId)"
            }
            catch {
                Write-Host " -> Failed to kill PID $($_.ProcessId) (Access Denied?)"
            }
        }
    }
    else {
        Write-Host "No zombie processes found. You are clean!"
    }

    # Kill process on Port 3004
    $port = 3004
    $tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($tcp) {
        Write-Host "Found process on port $port (PID $($tcp.OwningProcess)). Killing..."
        Stop-Process -Id $tcp.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host " -> Port $port released."
    }

}
catch {
    Write-Host "Error querying processes. Ensure you are running as the same user."
    Write-Host $_
}
