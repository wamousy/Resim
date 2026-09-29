# HTTP.sys reports PID 4 at the TCP layer; resolve the application in its queue.
function Test-ResimHttpQueueOwner([string]$State, [int]$ProcessId, [int]$Port) {
    $queuePattern = '(?m)^Request queue name:'
    $processPattern = '(?m)^\s+ID:\s*' + $ProcessId + ',\s*image:'
    $urlPattern = '(?im)^\s+HTTP://127\.0\.0\.1:' + $Port + '(?::127\.0\.0\.1)?/\s*$'
    foreach ($queue in [regex]::Split($State, $queuePattern)) {
        if ($queue -match $processPattern -and $queue -match $urlPattern) { return $true }
    }
    return $false
}
