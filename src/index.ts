'use strict';
/**
 * CloudFlare Worker for caching SnapLogic API Responses
 */
import { Buffer } from 'node:buffer';

/** Define our environmental variables from CloudFlare */
export interface Env {
  /** TTL for response cache in seconds */
  ttl: number;
  /** Target Protocol for backend server */
  targetProtocol: string;
  /** Target Hostname for backend server */
  targetHostname: string;
  /** Target Port for backend server */
  targetPort: number;
  /** Target Path prefix for backend server */
  targetPathPrefix?: string;
  /** Require HTTPS from the Client */
  requireHTTPS: boolean;
  /** Allow Binary body data from the Client */
  allowBinaryData: boolean;
}

/** Define an Exception interface for error handling */
export interface Exception extends Error {
  cause?: ExceptionCause;
}

/** Define an interface for error causes in Exception */
export interface ExceptionCause {
  errno?: number;
  code?: string;
  path?: string;
  syscall?: string;
  stack?: string;
}

export default {
  /**
   * CloudFlare Worker fetch action handler
   *
   * @param request - CloudFlare Worker Request object
   * @param env - CloudFlare Environmental Variables
   * @param ctx - CloudFlare Worker ExecutionContext
   * @returns Promised CloudFlare Worker Response object
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    /**
     * Generate a SnapLogic-Like JSON response with status code
     *
     * @param status_code - HTTP status code to return
     * @param message - JSON message to return
     * @returns CloudFlare Worker Response
     */
    function errorResponse(status_code: number, message: string): Response {
      return new Response(
        JSON.stringify({
          http_status_code: status_code,
          response_map: {
            error_list: [
              {
                message: message,
              },
            ],
          },
        }),
        {
          status: status_code,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    }

    /**
     * Generate a URL string for CloudFlare caching key
     *
     * @param url - Target URL
     * @param request - CloudFlare Worker Request object
     * @returns Promised string
     */
    async function getCacheKey(url: URL, request: Request): Promise<string> {
      /** Convert our request method and URL to Unit8Array joined by pipes */
      const keyRequest = new TextEncoder().encode(
        request.method.toUpperCase() + '|' + request.url + '|'
      );

      /** Convert the body data from request ArrayBuffer to a Uint8Array */
      const keyBody = new Uint8Array(await request.arrayBuffer());

      /** Combine our keyRequest and keyData into a Uint8Array buffer  */
      const keyBuffer = new Uint8Array(
        keyRequest.byteLength + keyBody.byteLength
      );
      keyBuffer.set(keyRequest, 0);
      keyBuffer.set(keyBody, keyRequest.byteLength);

      /** Run a SHA-256 digest on the Uint8Array outputting an ArrayBuffer */
      const hashBuffer = await crypto.subtle.digest('SHA-256', keyBuffer);

      /**
       * Remove pathname and set the search parameter to the SHA-256
       * digest as a hex string, generating a valid URL for caching in
       * CloudFlare
       */
      url.pathname = '';
      url.search = Buffer.from(hashBuffer).toString('hex');
      return url.toString();
    }

    try {
      /** Ensure our env variables are typed correctly */
      if (env.requireHTTPS !== undefined)
        env.requireHTTPS = env.requireHTTPS.toString() === 'true';
      env.targetPort = parseInt(env.targetPort.toString());
      env.ttl = parseInt(env.ttl.toString());
      if (env.allowBinaryData !== undefined)
        env.allowBinaryData = env.allowBinaryData.toString() === 'true';

      /** Validate we have required env variables */
      if (env.requireHTTPS === undefined)
        throw Error('requireHTTPS parameter required (true|false)');
      if (!env.targetHostname)
        throw Error('targetHostname parameter is required');
      if (
        env.targetPort === undefined ||
        env.targetPort < 0 ||
        env.targetPort > 65535
      )
        throw Error('targetPort parameter must be set from 0 to 65535');
      if (!env.targetProtocol.match(/^https?$/i))
        throw Error('targetUrl parameter must be either http or https');
      if (!env.ttl || env.ttl <= 0)
        throw Error('ttl parameter must be a number greater than 0');

      /** Set a default for binaryData to false if not defined */
      if (env.allowBinaryData === undefined) env.allowBinaryData = false;

      /**
       * Require Authorization header or bearer_token search parameter,
       * otherwise throw a SnapLogic like 401 response
       */
      if (
        !request.headers.get('authorization') &&
        !new URL(request.url).searchParams.get('bearer_token')
      )
        return errorResponse(401, 'Mismatched bearer token');

      /**
       * If we have requireHTTPS enabled, validate request is HTTPS,
       * otherwise throw a SnapLogic like 426 response
       */
      if (env.requireHTTPS && new URL(request.url).protocol !== 'https:') {
        return errorResponse(426, 'HTTPS is required');
      }

      /**
       * Ensure our request data is valid.
       *
       * Method must be POST, PUT, PATCH, HEAD, GET or DELETE
       *
       * If there is a body and allowBinaryData is not set,
       * the request must have a Content-Type of
       *  - application/json
       *  - application/x-www-form-urlencoded
       * and be method POST, PUT or PATCH
       *
       * If we have a body and JSON content-type, validate the data is in fact
       * JSON otherwise pass through the data as no validation is required.
       *
       * Without these validations SnapLogic will throw a 500 error with no
       * message. Data that does not conform to this will error in SnapLogic
       * with no current way to catch it and return a custom response.
       */
      if (
        !request.method.toUpperCase().match(/^POST|PUT|PATCH|HEAD|GET|DELETE$/)
      )
        return errorResponse(405, 'Method not allowed');

      if (request.body !== null) {
        /** Request must be POST, PUT or PATCH if there is data */
        if (!request.method.toUpperCase().match(/^(POST|PUT|PATCH)$/))
          return errorResponse(406, 'Body data not expected');

        if (!env.allowBinaryData) {
          /** Find our applicable content-type */
          const contentTypeMatch = (
            request.headers.get('content-type') || ''
          ).match(/^application\/(x-www-form-urlencoded|json)(;.*)?$/);

          /** If we did not match a valid content-type, return error */
          if (!contentTypeMatch)
            return errorResponse(
              406,
              'Content-Type not acceptable for request type'
            );

          /** If content-type is JSON, ensure the payload is valid */
          if (contentTypeMatch[1] === 'json') {
            try {
              await request.clone().json();
            } catch (e) {
              return errorResponse(400, 'JSON body not valid');
            }
          }

          /**
           * Form data is parsable as it's a KV pair, no matter what
           * the payload, so no validation applicable
           */
        }
      } else {
        /** If we have method that should have data and we have none, error */
        if (request.method.toUpperCase().match(/^(POST|PUT|PATCH)$/))
          return errorResponse(406, 'Body data expected');
      }

      /** Setup our cache */
      const cache = caches.default;
      let cacheResponse: Response | undefined;

      /** Build our target URL based off config */
      const targetUrl = new URL(request.url);
      targetUrl.protocol = env.targetProtocol;
      targetUrl.hostname = env.targetHostname;
      targetUrl.port = env.targetPort.toString();
      if (env.targetPathPrefix)
        targetUrl.pathname = env.targetPathPrefix + targetUrl.pathname;

      /** Get our cache key */
      const cacheKey = await getCacheKey(new URL(targetUrl), request.clone());

      /**
       * Delete from cache if cache-control header tells us to, ensuring
       * a fresh pull otherwise check our cache for a match
       */
      if (
        (request.headers.get('cache-control') || '')
          .toLowerCase()
          .includes('no-cache')
      ) {
        cache.delete(cacheKey);
      } else {
        cacheResponse = await cache.match(cacheKey);
      }

      /** If we have a cache, return it */
      if (cacheResponse) return cacheResponse;

      /** Fetch request from target */
      const response = await fetch(new Request(targetUrl, request));

      /** If we get a 200 OK then cache */
      if (response.status === 200) {
        /** Create new response body for caching/return */
        cacheResponse = new Response(response.body, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
          cf: response.cf,
        });

        /** Set our cache-control header, remove expires */
        cacheResponse.headers.set('cache-control', 'max-age=' + env.ttl);
        cacheResponse.headers.delete('expires');

        /** Cache the response before context ends */
        ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
      }

      /**
       * Return what we put in cache, if exists, otherwise proxy remote
       * response
       */
      return cacheResponse || response;
    } catch (err) {
      /** Log our raw error to wrangler/CloudFlare Worker console */
      console.log(err);

      /**
       * If this was a fetch error, try to get a more descriptive
       * cause of the error to give a better response to client
       */
      const error = err as Exception;
      if (error.message === 'fetch failed' && error.cause !== undefined) {
        switch (error.cause.code) {
          case 'ENOTFOUND':
          case 'ECONNREFUSED':
          case 'ECONNABORTED':
            return errorResponse(503, 'Service Unavailable');
          case 'ETIMEDOUT':
          case 'UND_ERR_CONNECT_TIMEOUT':
          case 'ECONNRESET':
          case 'EHOSTUNREACH':
          case 'EAI_AGAIN':
            return errorResponse(504, 'Gateway Timeout');
          default:
            return errorResponse(502, 'Bad Gateway');
        }
      }

      /** Otherwise return a generic 500 Proxy Error */
      return errorResponse(500, 'Proxy Error');
    }
  },
};
