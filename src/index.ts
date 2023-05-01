'use strict';
/**
 * CloudFlare Worker for caching SnapLogic API Responses
 */

export interface Env {
  /** TTL for response cache in seconds */
  ttl: number;
  /** Target Protocol for backend server */
  targetProtocol: string;
  /** Target Hostname for backend server */
  targetHostname: string;
  /** Target Port for backend server */
  targetPort: number;
  /** Require HTTPS */
  requireHTTPS: boolean;
}

/** Define an Exception interface for error handling */
export interface Exception extends Error {
  cause?: ExceptionCause;
}

/** Define for an interface for error causes  */
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
   * @param env - Env interface
   * @param ctx - CloudFlare Worker ExecutionContext
   * @returns - Promised CloudFlare Worker Response object
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
     * Generate a key value for caching
     *
     * @param url - Target URL
     * @param request - CloudFlare Worker Request object
     * @returns - Promised string
     */
    async function getCacheKey(url: URL, request: Request): Promise<string> {
      /** Make our key in to a Uint8 array formatted <method>|<url>|<bodyData> */
      const keyRequest = new TextEncoder().encode(
        [request.method.toUpperCase(), request.url, ''].join('|')
      );
      const keyData = new Uint8Array(await request.arrayBuffer());
      const keyUint8 = new Uint8Array(keyRequest.length + keyData.length);
      keyUint8.set(keyRequest);
      keyUint8.set(keyData, keyRequest.length);

      /** SHA-256 to ArrayBuffer */
      const hashBuffer = await crypto.subtle.digest('SHA-256', keyUint8);

      /** Convert ArrayBuffer to SHA-256 hex string */
      const sha256 = [...new Uint8Array(hashBuffer)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      /** Remove pathname and add SHA256 as search parameter */
      url.pathname = '';
      url.search = sha256;
      return url.toString();
    }

    try {
      /** Ensure our env variables are typed correctly */
      if (env.requireHTTPS !== undefined)
        env.requireHTTPS = env.requireHTTPS.toString() === 'true';
      env.targetPort = parseInt(env.targetPort.toString());
      env.ttl = parseInt(env.ttl.toString());

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
      if (!env.targetProtocol.toLowerCase().match(/^https?$/))
        throw Error('targetUrl parameter must be either http or https');
      if (!env.ttl || env.ttl <= 0)
        throw Error('ttl parameter must be a number greater than 0');

      /**
       * Require Authorization header or bearer_token search parameter,
       * otherwise throw a SnapLogic like 401 response
       */
      if (
        !request.headers.get('authorization') &&
        !new URL(request.url).searchParams.get('bearer_token')
      )
        return errorResponse(401, 'Mismatched bearer token');

      /** If we have requireHTTPS enabled, validate request is HTTPS */
      if (env.requireHTTPS && new URL(request.url).protocol !== 'https:') {
        return errorResponse(426, 'HTTPS is required');
      }

      /** Setup our cache */
      const cache = caches.default;
      let cacheResponse: Response | undefined;

      /** Build our target URL based off config */
      const targetUrl = new URL(request.url);
      targetUrl.protocol = env.targetProtocol;
      targetUrl.hostname = env.targetHostname;
      targetUrl.port = env.targetPort.toString();

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

      /** Send to target */
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
        cacheResponse.headers.set('cache-control', `max-age=${env.ttl}`);
        cacheResponse.headers.delete('expires');

        /** Cache the response before context ends */
        ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
      }

      /** Return what we put in cache, if exists, otherwise proxy remote response */
      return cacheResponse || response;
    } catch (err) {
      /** Log our raw error to wrangler/Worker console */
      console.log(err);

      /** Try to get more meaning of the error to give better understanding to client */
      const error = err as Exception;
      if (error.message === 'fetch failed' && error.cause !== undefined) {
        switch (error.cause.code) {
          case 'ENOTFOUND':
          case 'ECONNREFUSED':
          case 'ECONNABORTED':
            return errorResponse(503, 'Service Unavailable');
          case 'ETIMEDOUT':
          case 'ECONNRESET':
          case 'EHOSTUNREACH':
          case 'EAI_AGAIN':
            return errorResponse(504, 'Gateway Timeout');
          default:
            return errorResponse(502, 'Bad Gateway');
        }
      }

      /** Otherwise throw generic Proxy Error */
      return errorResponse(500, 'Proxy Error');
    }
  },
};
