<?php
error_reporting(0);
ini_set('display_errors', 0);

// ── ASL Bug Monitor: server-side self-reporting ────────────────────────────
// When the Node.js backend on 127.0.0.1:3000 is unreachable, this proxy
// reports a critical bug to the central monitoring system so outages are
// detected even if nobody is looking at the site. Rate-limited: at most one
// report per cooldown window per server, so a crash loop can't spam.
$BUGMONITOR_URL = getenv("BUGMONITOR_URL") ?: "https://aslbugmonitor.agricconnect.org";
$BUGMONITOR_COOLDOWN = 300; // seconds

function report_backend_down($path, $curlError) {
    global $BUGMONITOR_URL, $BUGMONITOR_COOLDOWN;
    $lock = sys_get_temp_dir() . "/bugmonitor_biodigital_backend_down.lock";
    if (file_exists($lock) && (time() - @filemtime($lock)) < $BUGMONITOR_COOLDOWN) {
        return; // already reported recently
    }
    @file_put_contents($lock, time());

    $payload = json_encode([
        "app" => "biodigital-bsf-farm",
        "platform" => "web",
        "severity" => "critical",
        "title" => "BioDigital API backend is DOWN — 502 on " . $path,
        "error_type" => "BackendDown",
        "description" => "The PHP proxy on " . ($_SERVER['HTTP_HOST'] ?? '?') . " could not reach the Node.js backend on 127.0.0.1:3000. cURL error: " . $curlError,
        "route" => $path,
        "environment" => "production",
        "tags" => ["backend", "downtime", "proxy", "auto-reported"],
    ]);

    $ch = curl_init($BUGMONITOR_URL . "/api/v1/report");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ["Content-Type: application/json"],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 5,
    ]);
    @curl_exec($ch);
    @curl_close($ch);
}

$api_url = "http://127.0.0.1:3000";
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
$url = $api_url . $path;
if (!empty($_SERVER["QUERY_STRING"])) $url .= "?" . $_SERVER["QUERY_STRING"];
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_CUSTOMREQUEST => $_SERVER["REQUEST_METHOD"],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => true,
]);
$headers = [];
foreach (getallheaders() as $name => $value) {
    $lower = strtolower($name);
    if ($lower !== 'host' && $lower !== 'content-length') {
        $headers[] = "$name: $value";
    }
}
$headers[] = "X-Forwarded-For: " . ($_SERVER['REMOTE_ADDR'] ?? '');
$headers[] = "X-Forwarded-Proto: https";
$headers[] = "X-Forwarded-Host: api.biodigitaltechltd.com";
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
if (in_array(strtoupper($_SERVER["REQUEST_METHOD"]), ['POST', 'PUT', 'PATCH'])) {
    $body = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if ($contentType && !str_contains($contentType, 'multipart/form-data')) {
        $headers[] = "Content-Type: $contentType";
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
}
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$responseHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
if ($response === false) {
    // Node backend is down — alert the monitor, then respond as before.
    report_backend_down($path, curl_error($ch));
    http_response_code(502);
    echo json_encode(["error" => "Proxy error", "message" => "Failed to connect to backend: " . curl_error($ch)]);
    @curl_close($ch);
    exit;
}
@curl_close($ch);
foreach (explode("\r\n", $responseHeaders) as $header) {
    if (stripos($header, 'Transfer-Encoding: chunked') !== false) continue;
    if (stripos($header, 'Content-Encoding:') !== false) continue;
    if (!empty($header) && !stripos($header, 'HTTP/')) {
        header($header);
    }
}
http_response_code($httpCode);
echo $responseBody;
