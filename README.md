# SnapLogic Cache

> A CloudFlare Worker for caching SnapLogic API Responses

[![TypeScript](https://badgen.net/badge/icon/typescript?icon=typescript&label)](https://www.typescriptlang.org)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://choosealicense.com/licenses/isc)

[![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)](https://yarnpkg.com)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white)](https://workers.dev)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/atxadam/snaplogic-cache)

## About

This [CloudFlare Workers](https://workers.dev) application is designed for a
caching proxy with [SnapLogic](https://www.snaplogic.com) to save on requests to
API endpoints if the data is frequently accessed and infrequently changed.

All requests will be cached (POST, GET, etc) if the response from SnapLogic is a
`200 OK`. To bypass or refresh the cache set a `Cache-Control: no-cache` header.
This will force the cache to expire for the request data and return and cache a new
hit to the target endpoint.

## Getting Started

To setup the project locally, use

```sh
npx wrangler generate snaplogic-cache https://github.com/atxadam/snaplogic-cache
```

then run `yarn install` to install the required dependencies; setup the configuration
variables (as seen below) and start a [wrangler](https://developers.cloudflare.com/workers/wrangler/)
session with `yarn start`.

To publish to CloudFlare using wrangler simply `yarn publish`

## Configuration

- If running locally, create and set variables in [.dev.vars](.dev.vars)
- If running in production, set the following variables in the Project->Settings->Variables

| Parameter | Type | Description |
| --- | --- | --- |
| ttl | int | Time To Live in cache, must be greater than 0
| targetProtocol | string | Target server protocol http[s] (typically https) |
| targetHostname | string | Target server hostname (typically elastic.snaplogic.com) |
| targetPort | int | Target server port number (typically 443) |
| requireHTTPS | bool | Require all requests to be HTTPS, or fail with a 426 status code |

## Basic [yarn](https://yarnpkg.com) Scripts

- `build` Compiles the TypeScript to ECMAScript
- `start` Runs [CloudFlare Wrangler](https://developers.cloudflare.com/workers/wrangler/)
   in development mode
- `publish` Publishes the application as a CloudFlare Worker
- `clean` Removes dist/*
- `lint` Runs eslint src/**/*.{ts,tsx}
- `lint:fix` Runs `lint` with the --fix option
- `test` Does nothing, put test plans here

## Code Styling

This project is comprised of [TypeScript](https://www.typescriptlang.org) and
follows the [Google TypeScript Style Guidelines](https://google.github.io/styleguide/tsguide.html)
with the exception of using [TSDoc](https://tsdoc.org) for documentation.

## History

See [CHANGELOG.md](CHANGELOG.md)

## License

[ISC](https://choosealicense.com/licenses/isc)
