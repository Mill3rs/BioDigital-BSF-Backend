<?php
// PHP proxy for Node.js backend
// Forwards all /api/* requests to the backend on port 3000
$api_url = "http://127.0.0.1:3000";
$request_uri = $_SERVER["REQUEST_URI"];
$path = preg_replace("#^/api#", "", $request_uri);
$url = $api_url . $path;

$headers = [];
foreach (getallheaders() as $name => $value) {
    if (strtolower($name) !== "host" && strtolower($name) !== "content-length") {
        $headers[] = "$name: $value";
    }
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER["REQUEST_METHOD"]);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

if (in_array($_SERVER["REQUEST_METHOD"], ["POST", "PUT", "PATCH"])) {
    $body = file_get_contents("php://input");
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

if (!empty($_SERVER["QUERY_STRING"])) {
    curl_setopt($ch, CURLOPT_URL, $url . "?" . $_SERVER["QUERY_STRING"]);
}

if (!empty($_FILES)) {
    $multipart = [];
    foreach ($_FILES as $key => $file) {
        if (is_array($file["name"])) {
            for ($i = 0; $i < count($file["name"]); $i++) {
                $multipart[$key . "[" . $i . "]"] = new CURLFile($file["tmp_name"][$i], $file["type"][$i], $file["name"][$i]);
            }
        } else {
            $multipart[$key] = new CURLFile($file["tmp_name"], $file["type"], $file["name"]);
        }
    }
    curl_setopt($ch, CURLOPT_POSTFIELDS, $multipart);
}

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    header("Content-Type: application/json");
    echo json_encode(["error" => "Proxy error", "message" => $error]);
    exit;
}

$response_headers = substr($response, 0, $header_size);
$response_body = substr($response, $header_size);

foreach (explode("\r\n", $response_headers) as $header) {
    if (!empty($header) && !preg_match("/^Transfer-Encoding:/i", $header)) {
        header($header, false);
    }
}

http_response_code($http_code);
echo $response_body;
