# Cloudflare Worker B2 Webhook

Proxy Backblaze S3 compatible API requests, optionally sending notifications to a webhook.

* Incoming requests must be signed with the same credentials that you configure in the worker. The worker validates the AWS V4 signature on all downstream (incoming) requests and then signs the upstream (outgoing) request.
* Notifications are dispatched asynchronously to avoid delaying the response to the client.

You can use any S3 SDK or CLI to send requests as long as you set the endpoint URL to the worker endpoint:

```bash
% export AWS_ACCESS_KEY_ID=<your b2 application key id>
% export AWS_SECRET_ACCESS_KEY=<your b2 application key> 
% aws s3 cp --endpoint-url https://cf-b2-webhook.<your-subdomain>.workers.dev hello.txt s3://<your-bucket-name>/hello.txt
upload: hello.txt to s3://<your-bucket-name>/hello.txt
```

Informal testing suggests that there appears to be negligible performance overhead imposed by the signature verification and resigning.

## Configuration

You must configure `AWS_ACCESS_KEY_ID` and `AWS_S3_ENDPOINT` in `wrangler.toml`. Configure `WEBHOOK_URL` if you wish to supply a webhook URL.

```toml
[vars]
AWS_ACCESS_KEY_ID = "<your b2 application key id>"
AWS_S3_ENDPOINT = "<your S3 endpoint - e.g. s3.us-west-001.backblazeb2.com >"
WEBHOOK_URL = "<e.g. https://api.example.com/webhook/1 >"
```

You must also configure `AWS_SECRET_ACCESS_KEY` as a [secret](https://blog.cloudflare.com/workers-secrets-environment/):

```bash
echo "<your b2 application key>" | wrangler secret put AWS_SECRET_ACCESS_KEY
```

## Webhook Notification

If you set `WEBHOOK_URL`, the worker POSTs a JSON payload to that URL for each request that it processes. For example:

```json
{
  "contentLength": "14",
  "contentType": "text/plain",
  "method": "PUT",
  "signatureTimestamp": "20220224T193204Z",
  "status": 200,
  "url": "https://s3.us-west-004.backblazeb2.com/my-private-bucket/tester.txt"
}
```

You can customize the `handleRequest()` function to add additional data as you require.

## Limitations

When putting objects, most clients send a SHA-256 hash of the payload in the `x-amz-content-sha256` header. If this header is not present, then the entire request, including its body, must fit into available memory so the worker can create the hash. [Cloudflare Workers have 128MB available for use](https://developers.cloudflare.com/workers/platform/limits#worker-limits), of which about 30MB is used by the system. Objects larger than about 80-90MB should be processed in multiple parts.

If the `x-amz-content-sha256` is present, as is usually the case, then the worker does not have to read the request body into memory, and there is no upper limit on payload size.

## Wrangler

You can use this repository as a template for your own worker using [`wrangler`](https://github.com/cloudflare/wrangler):

```bash
wrangler generate projectname https://github.com/Backblaze-B2-Samples/cf-b2-webhook
```

## Serverless

To deploy using serverless add a [`serverless.yml`](https://serverless.com/framework/docs/providers/cloudflare/) file.


## Acknowledgements

Based on [https://github.com/obezuk/worker-signed-s3-template](https://github.com/obezuk/worker-signed-s3-template)
