//
// Proxy Backblaze S3 compatible API requests, sending notifications to a webhook
//
// Adapted from https://github.com/obezuk/worker-signed-s3-template
//
import { AwsClient } from 'aws4fetch'

// Extract the region from the endpoint

const endpointRegex = /^s3\.([a-zA-Z0-9-]+)\.backblazeb2\.com$/;
const [ , aws_region] = AWS_S3_ENDPOINT.match(endpointRegex);

const aws = new AwsClient({
    "accessKeyId": AWS_ACCESS_KEY_ID,
    "secretAccessKey": AWS_SECRET_ACCESS_KEY,
    "service": "s3",
    "region": aws_region,
});


addEventListener('fetch', function(event) {
    event.respondWith(handleRequest(event))
});


// These headers appear in the request, but are not passed upstream
const UNSIGNABLE_HEADERS = [
    'x-forwarded-proto',
    'x-real-ip',
]


// Filter out cf-* and any other headers we don't want to include in the signature
function filterHeaders(headers) {
    return Array.from(headers.entries())
      .filter(pair => !UNSIGNABLE_HEADERS.includes(pair[0]) && !pair[0].startsWith('cf-'));
}


// Verify the signature on the incoming request
async function verifySignature(request, body) {
    const authorization = request.headers.get('Authorization');
    if (!authorization) {
        return false;
    }

    // Parse the AWS V4 signature value
    const re = /^AWS4-HMAC-SHA256 Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=(.+)$/;
    let [ , credential, signedHeaders, signature] = authorization.match(re);

    credential = credential.split('/');
    signedHeaders = signedHeaders.split(';');

    // Verify that the request was signed with the expected key
    if (credential[0] != AWS_ACCESS_KEY_ID) {
        return false;
    }

    // Use the timestamp from the incoming signature
    const datetime = request.headers.get('x-amz-date');

    // Extract the headers that we want from the complete set of incoming headers
    const headersToSign = signedHeaders
        .map(key => ({
            name: key, 
            value: request.headers.get(key) 
        }))
        .reduce((obj, item) => (obj[item.name] = item.value, obj), {});

    const signedRequest = await aws.sign(request.url, {
        method: request.method,
        headers: headersToSign,
        body: body,
        aws: { datetime: datetime }
    });

    // All we need is the signature component of the Authorization header
    const [ , , , generatedSignature] = request.headers.get('Authorization').match(re);

    return signature === generatedSignature;
}


// Could add more detail regarding the specific error, but this enough for now
function errorResponse() {
    return new Response(
`<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
  <Error>
    <Type>Sender</Type>
    <Code>SignatureDoesNotMatch</Code>
    <Message>Signature validation failed.</Message>
  </Error>
  <RequestId>0300D815-9252-41E5-B587-F189759A21BF</RequestId>
</ErrorResponse>`, 
        { status: 403 });
}


// Where the magic happens...
async function handleRequest(event) {
    const request = event.request;

    // Set upstream target hostname.
    var url = new URL(request.url);
    url.hostname = AWS_S3_ENDPOINT;

    // Only handle requests signed by our configured key.
    if (!await verifySignature(request, request.body)) {
        return errorResponse();
    }

    // Certain headers appear in the incoming request but are
    // removed from the outgoing request. If they are in the
    // signed headers, B2 can't validate the signature.
    const headers = filterHeaders(request.headers);

    // Sign the new request
    var signedRequest = await aws.sign(url, {
        method: request.method,
        headers: headers,
        body: request.body
    });

    // Send the signed request to B2 and wait for the upstream response
    const response = await fetch(signedRequest);

    if (WEBHOOK_URL) {
        // Convert content length from a string to an integer
        let contentLength = request.headers.get('content-length');
        contentLength = contentLength ? parseInt(contentLength) : null;

        // This will fire the fetch to the webhook asynchronously so the
        // response is not delayed.
        event.waitUntil(
            fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contentLength: contentLength,
                    contentType: request.headers.get('content-type'),
                    method: request.method,
                    signatureTimestamp: request.headers.get('x-amz-date'),
                    status: response.status,
                    url: response.url
                })
            })
        );        
    }

    return response;
}
